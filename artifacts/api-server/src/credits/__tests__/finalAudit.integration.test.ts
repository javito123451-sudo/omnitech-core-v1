// Auditoría final de integración: Agent Factory + OmniCredits v1.
// Comprueba, de extremo a extremo y con Postgres real (proveedor de IA falso), lo que las suites por
// capa no cubren por separado: una sola fuente de cálculo, la cadena completa LIVE con GPT-5.6,
// concurrencia con el gateway real, plan `free`/nombres de plan, rollover sin acumulación infinita,
// aislamiento multi-tenant por HTTP y auditoría.
//
// Los tests de arquitectura (primer bloque) no necesitan base de datos.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import { db, aiAgentsTable, aiUsageLogsTable, auditLogsTable, creditHoldsTable, creditLedgerTable, creditPlansTable, licensePlansTable, organizationsTable } from "@workspace/db";
import { callAI, InsufficientCreditsError, type GatewayDeps } from "../../ai-gateway/gateway";
import { ResponseCache } from "../../ai-gateway/responseCache";
import { estimateCost, estimateTokens } from "../../ai-gateway/costEngine";
import { HOLD_SAFETY_FACTOR } from "../../ai-gateway/pricing";
import { refreshPricing } from "../../ai-gateway/pricingService";
import { checkBudgetBlocked, logAiCall } from "../../utils/aiUsageLogger";
import {
  creditsPort, getAvailable, getBalance, getBalances, grantCredits, listLedger, reserveCredits, verifyLedgerIntegrity,
} from "../creditService";
import { getPlanConfig, resolveOrgPlan } from "../planService";
import { renewSubscription } from "../subscriptionService";
import { getDashboard } from "../reporting";
import { createAgent, updateAgentMeta } from "../../agents/agentService";
import { agentsRouter } from "../../routes/agents";
import { creditsAdminRouter } from "../../routes/credits-admin";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import type { AIProvider, GenerateResult } from "../../ai/types";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).replace(/\\/g, "/");

// ── 1. Una sola fuente de cálculo (no necesita base de datos) ─────────────────

describe("cadena: sin cálculos duplicados", () => {
  const files = sources();
  const offenders = (re: RegExp, allowed: string[]) =>
    files.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !allowed.includes(f));

  it("la conversión coste técnico → créditos (creditsPerUsd, markup, usdToCredits) vive solo en el Cost Engine y su configuración", () => {
    expect(offenders(/creditsPerUsd|\bOMNICREDITS\b|usdToCredits|OMNICREDITS_MARKUP/, ["ai-gateway/costEngine.ts", "ai-gateway/pricing.ts"])).toEqual([]);
  });

  it("los precios de modelos solo se resuelven en el registro de precios (y se cargan en pricingService)", () => {
    expect(offenders(/resolvePricing\(/, ["ai-gateway/pricingRegistry.ts", "ai-gateway/costEngine.ts"])).toEqual([]);
    expect(offenders(/LEGACY_PRICING|FALLBACK_PRICING/, ["ai-gateway/pricing.ts", "ai-gateway/pricingRegistry.ts", "ai-gateway/pricingService.ts"])).toEqual([]);
  });

  it("el AGENTE no calcula créditos: no importa el ledger ni el Cost Engine de conversión; solo suma lo que devuelve el gateway", () => {
    const runner = readFileSync(join(SRC, "agents/agentRunner.ts"), "utf8");
    expect(runner).not.toMatch(/credits\/creditService|planService|usdToCredits|creditsPerUsd/);
    expect(runner).toMatch(/usage\.credits \+= result\.credits/);
  });

  it("el Gateway no tiene segunda lógica comercial: usa el Cost Engine y el puerto de créditos, sin fórmulas de conversión", () => {
    const gw = readFileSync(join(SRC, "ai-gateway/gateway.ts"), "utf8");
    expect(gw).not.toMatch(/creditsPerUsd|usdToCredits|OMNICREDITS\b|markup/);
    expect(gw).toMatch(/computeCost\(/);
    expect(gw).toMatch(/deps\.credits\.(reserve|settle|release)/);
  });

  it("solo el servicio de créditos escribe en el ledger (consumo, compras, suscripción); nadie más inserta movimientos", () => {
    const writers = files.filter((f) => /insert\(creditLedgerTable\)/.test(readFileSync(f, "utf8"))).map(rel);
    expect(writers).toEqual(["credits/creditService.ts"]);
  });

  it("el simulador sigue siendo puro y la estimación usa el mismo Cost Engine que el consumo real", () => {
    const est = readFileSync(join(SRC, "agents/runEstimate.ts"), "utf8");
    expect(est).toMatch(/computeCost\(/);
    expect(est).not.toMatch(/creditService|gateway"/);
  });
});

// ── Infraestructura de los tests con base de datos ────────────────────────────

const OK_USAGE: GenerateResult["usage"] = { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cachedTokens: 0 };

function route(model: string, generate: () => Promise<GenerateResult>) {
  return { provider: { id: "openai", name: "fake", generate } as unknown as AIProvider, providerId: "openai", model, timeoutMs: 2000 };
}
const realDeps = (r: ReturnType<typeof route>): GatewayDeps => ({
  resolveRoutes: () => [r], checkBudgetBlocked, logAiCall, credits: creditsPort, cache: new ResponseCache(),
  sleep: async () => {}, ensurePricingLoaded: () => refreshPricing().then(() => {}), auditBlock: async () => {},
});

async function serveAgents(orgId: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.orgId = orgId; req.userId = 1; req.clerkUserId = `user-of-${orgId}`; req.orgRole = "owner"; req.isSuperAdmin = false; next(); });
  app.use("/agents", agentsRouter);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents` };
}
const close = (s: Server) => new Promise<void>((r) => { s.close(() => r()); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasRealDb)("auditoría final — Agent Factory + OmniCredits v1", () => {
  let orgs: number[] = [];
  let n = 0;
  const nextOrg = () => orgs[n++]!;
  const FN = `smoke_audit_${Date.now()}`;
  const setPlan = (orgId: number, plan: string) => db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgId));

  beforeAll(async () => {
    orgs = await createTempOrgs(30, "final-audit");
    await refreshPricing();
  });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(eq(aiUsageLogsTable.functionName, FN));
    await db.delete(creditPlansTable).where(sql`${creditPlansTable.plan} like 'smoke-audit-%'`);
    await deleteTempOrgs(orgs);
  });

  // ── 2. Cadena completa LIVE ─────────────────────────────────────────────────

  describe("cadena completa: plan → workspace → agente → gateway → precio → créditos → hold → ledger → uso", () => {
    it("un consumo LIVE atraviesa toda la cadena y cada eslabón deja su rastro coherente", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");                                               // PLAN → CREDIT PLAN (starter) → WORKSPACE
      expect(await renewSubscription(org, { at: new Date("2026-05-10T10:00:00Z"), userClerkId: "admin" })).toMatchObject({ status: "granted", granted: 50_000 });
      const { agent } = await createAgent(org, "u", { name: "Cadena" });           // AGENT
      const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "hola", usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000, cachedTokens: 0 } }));

      const r = await callAI({                                                     // AI REQUEST → AI GATEWAY → PROVIDER ROUTER (ruta inyectada)
        mode: "live", orgId: org, userClerkId: "u", functionName: FN, agentId: agent.id, requestId: `${FN}-chain`,
        messages: [{ role: "user", content: "hola" }], billing: { ledger: true, agentLimits: { monthly: 10_000, daily: 5_000, perExecution: 1_000 } },
        options: { maxTokens: 500 },
      }, realDeps(route("gpt-5.6-luna", generate)));

      // MODEL PRICING → COST ENGINE: Luna 1M in + 1M out = $1,40 → 5.600 OmniCredits, precio de la BD
      expect(r).toMatchObject({ costUsd: 1.4, credits: 5600, provisional: false, model: "gpt-5.6-luna", provider: "openai" });
      // Hold: reservado antes y liquidado después (no queda "held")
      const [hold] = await db.select().from(creditHoldsTable).where(and(eq(creditHoldsTable.orgId, org), eq(creditHoldsTable.reference, `${FN}-chain`)));
      expect(hold).toMatchObject({ status: "settled", agentId: agent.id });
      expect(Number(hold!.settledCredits)).toBe(5600);
      // LEDGER: consumo con origen (incluidos), enlazado al registro de uso, sin doble conteo
      const [entry] = await db.select().from(creditLedgerTable).where(and(eq(creditLedgerTable.orgId, org), eq(creditLedgerTable.reference, `${FN}-chain`)));
      expect(entry).toMatchObject({ entryType: "consumption", agentId: agent.id, provider: "openai", model: "gpt-5.6-luna" });
      expect(Number(entry!.credits)).toBe(-5600);
      expect(entry!.breakdown).toEqual({ included: 5600, rollover: 0, extra: 0 });
      expect(entry!.metadata).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false, usageKind: "agent_execution" });
      // AI USAGE LOG (registro técnico, separado del comercial): el ledger apunta a él
      const [log] = await db.select().from(aiUsageLogsTable).where(eq(aiUsageLogsTable.id, entry!.usageLogId!));
      expect(log).toMatchObject({ orgId: org, model: "gpt-5.6-luna", status: "ok", tokensInput: 1_000_000, tokensOutput: 1_000_000 });
      expect(Number(log!.costUsd)).toBeCloseTo(1.4, 6);
      expect(log!.metadata).toMatchObject({ credits: 5600, priceSource: "db", requestId: `${FN}-chain` });
      // saldo y cadena
      expect(await getBalances(org)).toEqual({ balance: 44_400, included: 44_400, rollover: 0, extra: 0 });
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("sin saldo: no se llama al proveedor, no hay movimiento ni hold vivo, y el intento queda en el registro técnico", async () => {
      const org = nextOrg();
      const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "no", usage: OK_USAGE }));
      await expect(callAI({
        mode: "live", orgId: org, functionName: FN, requestId: `${FN}-nofunds`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
      }, realDeps(route("gpt-5.6-sol", generate)))).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(generate).not.toHaveBeenCalled();
      expect(await listLedger(org)).toEqual([]);
      expect(await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.orgId, org))).toEqual([]);
      const [blocked] = await db.select().from(aiUsageLogsTable).where(and(eq(aiUsageLogsTable.orgId, org), eq(aiUsageLogsTable.status, "blocked")));
      expect(blocked!.metadata).toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    });

    it("si el proveedor falla: el hold se libera, no se cobra nada y el saldo queda intacto", async () => {
      const org = nextOrg();
      await grantCredits(org, 1_000, { reference: "f-g" });
      const generate = vi.fn(async (): Promise<GenerateResult> => { throw new Error("proveedor caído"); });
      await expect(callAI({
        mode: "live", orgId: org, functionName: FN, requestId: `${FN}-fail`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true }, maxRetries: 0,
      }, realDeps(route("gpt-5.6-luna", generate)))).rejects.toThrow();
      const [hold] = await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.orgId, org));
      expect(hold!.status).toBe("released");
      expect(await getBalance(org)).toBe(1_000);
      expect(await getAvailable(org)).toMatchObject({ balance: 1_000, held: 0, available: 1_000 });
      expect((await listLedger(org)).map((e) => e.entryType)).toEqual(["grant"]);
    });

    it("el consumo con un modelo legacy en la misma cadena sigue marcado como provisional", async () => {
      const org = nextOrg();
      await grantCredits(org, 10_000, { reference: "l-g" });
      const r = await callAI({
        mode: "live", orgId: org, functionName: FN, requestId: `${FN}-legacy`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
      }, realDeps(route("gpt-4o-mini", async () => ({ text: "ok", usage: OK_USAGE }))));
      expect(r).toMatchObject({ provisional: true, model: "gpt-4o-mini" });
      const [entry] = await listLedger(org, { type: "consumption" });
      expect(entry!.metadata).toMatchObject({ priceSource: "legacy", provisional: true });
    });
  });

  // ── 3. Concurrencia con el gateway real ─────────────────────────────────────

  describe("concurrencia de extremo a extremo (gateway + holds + ledger reales, precio oficial Sol)", () => {
    it("diez ejecuciones simultáneas sobre un saldo que solo cubre dos: exactamente dos se ejecutan y las demás reciben INSUFFICIENT_CREDITS sin llegar al proveedor", async () => {
      const org = nextOrg();
      await grantCredits(org, 50_000, { reference: "cc-g" });
      const messages = [{ role: "user" as const, content: "hola" }];
      // hold por llamada: máximo de salida 200.000 tokens de Sol ($4) × 4000 × 1,2 ≈ 19.200 créditos → caben 2 en 50.000
      const perHold = estimateCost("openai", "gpt-5.6-sol", { inputTokens: estimateTokens(JSON.stringify(messages)), maxOutputTokens: 200_000 }).credits * HOLD_SAFETY_FACTOR;
      expect(perHold * 2).toBeLessThan(50_000);
      expect(perHold * 3).toBeGreaterThan(50_000);

      const generate = vi.fn(async (): Promise<GenerateResult> => { await sleep(500); return { text: "ok", usage: OK_USAGE }; });
      const d = realDeps(route("gpt-5.6-sol", generate));
      const outcomes = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        callAI({ mode: "live", orgId: org, functionName: FN, requestId: `${FN}-race-${i}`, messages, options: { maxTokens: 200_000 }, billing: { ledger: true } }, d)
          .then(() => "ok" as const, (e: unknown) => (e instanceof InsufficientCreditsError ? "no-credits" as const : `error:${String(e)}`))));

      expect(outcomes.filter((o) => o === "ok")).toHaveLength(2);
      expect(outcomes.filter((o) => o === "no-credits")).toHaveLength(8);
      expect(generate).toHaveBeenCalledTimes(2);                                   // los rechazados nunca llegaron al proveedor
      const consumption = await listLedger(org, { type: "consumption" });
      expect(consumption).toHaveLength(2);
      // coste real de cada una: 1000 in + 1000 out de Sol = $0,024 = 96 créditos
      expect(consumption.every((e) => Number(e.credits) === -96)).toBe(true);
      expect(await getBalance(org)).toBe(50_000 - 192);
      expect(await getAvailable(org)).toMatchObject({ held: 0 });                  // nada retenido: todo liquidado o rechazado
      const holds = await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.orgId, org));
      expect(holds.map((h) => h.status)).toEqual(["settled", "settled"]);
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    }, 30_000);

    it("una reserva abandonada deja de bloquear el saldo al caducar (TTL) y la reserva vigente sí lo bloquea mientras dura", async () => {
      const org = nextOrg();
      await grantCredits(org, 50_000, { reference: "ttl-g" });
      await reserveCredits({ orgId: org, credits: 40_000, reference: "ttl-1", ttlMs: 4000 });   // "proceso caído": nadie la liquida
      await expect(reserveCredits({ orgId: org, credits: 20_000, reference: "ttl-2" })).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(await getAvailable(org)).toMatchObject({ held: 40_000, available: 10_000 });
      await sleep(4500);
      expect(await getAvailable(org)).toMatchObject({ held: 0, available: 50_000 });        // ya no cuenta
      await expect(reserveCredits({ orgId: org, credits: 20_000, reference: "ttl-3" })).resolves.toBeTruthy();
      // riesgo conocido, documentado: repetir el MISMO requestId de la reserva caducada sigue siendo DUPLICATE_REQUEST
      await expect(reserveCredits({ orgId: org, credits: 1, reference: "ttl-1" })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    }, 20_000);
  });

  // ── 4. Plan free, nombres de plan y valores por defecto ─────────────────────

  describe("plan free y nombres de plan", () => {
    it("una organización `free` no recibe créditos, no consume y no rompe nada; Super Admin puede asignarle un plan después", async () => {
      const org = nextOrg();
      await setPlan(org, "free");
      expect(await resolveOrgPlan(org)).toMatchObject({ plan: "free", license: null });
      expect(await getPlanConfig("free")).toBeNull();                                        // no hay fila de plan: nada que conceder
      expect(await renewSubscription(org, { at: new Date("2026-06-10T10:00:00Z") })).toMatchObject({ status: "not_configured", granted: 0 });
      expect(await listLedger(org)).toEqual([]);

      const d = await getDashboard(org);                                                     // el panel funciona con saldo 0 y sin plan configurado
      expect(d).toMatchObject({ plan: "free", balance: 0, creditsRemaining: 0, monthlyCredits: null, usagePercentage: null, provisionalCredits: 0 });

      const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "no", usage: OK_USAGE }));
      await expect(callAI({
        mode: "live", orgId: org, functionName: FN, requestId: `${FN}-free`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
      }, realDeps(route("gpt-5.6-luna", generate)))).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(generate).not.toHaveBeenCalled();

      // Super Admin le asigna un plan (por organizations.plan o por licencia) y entonces sí recibe sus créditos
      await setPlan(org, "starter");
      expect(await renewSubscription(org, { at: new Date("2026-06-10T10:00:00Z"), userClerkId: "admin" })).toMatchObject({ status: "granted", granted: 50_000 });
      const org2 = nextOrg();
      await setPlan(org2, "free");
      await db.insert(licensePlansTable).values({ orgId: org2, plan: "professional", validUntil: new Date(Date.now() + 86_400_000) });
      expect(await renewSubscription(org2, { at: new Date("2026-06-10T10:00:00Z") })).toMatchObject({ status: "granted", granted: 150_000, plan: "professional" });
    });

    it("los nombres antiguos (growth, scale, enterprise_plus, free) no tienen fila de plan: no conceden créditos ni imponen límites por accidente", async () => {
      for (const legacy of ["growth", "scale", "enterprise_plus", "free", "Starter", "STARTER", "pro"]) {
        expect(await getPlanConfig(legacy)).toBeNull();
        const org = nextOrg();
        await setPlan(org, legacy);
        expect(await renewSubscription(org, { at: new Date("2026-06-10T10:00:00Z") })).toMatchObject({ status: "not_configured", granted: 0 });
      }
    });

    it("los cuatro planes oficiales existen con los nombres que ya usa el resto de la app (minúsculas)", async () => {
      const rows = await db.select().from(creditPlansTable);
      const official = rows.filter((r) => ["starter", "professional", "business", "enterprise"].includes(r.plan)).map((r) => r.plan).sort();
      expect(official).toEqual(["business", "enterprise", "professional", "starter"]);
    });

    it("ningún plan puede conceder créditos por sus valores por defecto: las columnas de créditos y límites no tienen default", async () => {
      const cols = await db.execute(sql`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'credit_plans' AND column_name IN ('included_credits','monthly_limit','daily_limit','per_agent_monthly_limit','rollover_cap','rollover_pct','price_amount','agent_limit','workspace_limit')`);
      expect(cols.rows).toHaveLength(9);
      for (const c of cols.rows as Array<{ column_name: string; column_default: string | null; is_nullable: string }>) {
        expect(c.column_default, c.column_name).toBeNull();
        expect(c.is_nullable, c.column_name).toBe("YES");
      }
      // un plan creado "en crudo" sin valores no concede nada
      const plan = `smoke-audit-${Date.now()}`;
      await db.execute(sql`INSERT INTO credit_plans (plan) VALUES (${plan})`);
      const org = nextOrg();
      await setPlan(org, plan);
      expect(await getPlanConfig(plan)).toMatchObject({ includedCredits: null, monthlyLimit: null, dailyLimit: null, rollover: false, rolloverPct: null, alertThresholds: [] });
      expect(await renewSubscription(org, { at: new Date("2026-06-10T10:00:00Z") })).toMatchObject({ status: "not_configured", granted: 0 });
      // y Enterprise, sin acordar, tampoco
      const ent = nextOrg();
      await setPlan(ent, "enterprise");
      expect(await renewSubscription(ent, { at: new Date("2026-06-10T10:00:00Z") })).toMatchObject({ status: "not_configured", granted: 0 });
    });
  });

  // ── 5. Rollover: sin acumulación infinita ───────────────────────────────────

  describe("rollover no genera créditos infinitos", () => {
    it("Business, 12 ciclos sin consumir nada: el saldo se estabiliza (400.000 incluidos + 200.000 de rollover) y no crece", async () => {
      const org = nextOrg();
      await setPlan(org, "business");
      const seen: number[] = [];
      for (let m = 0; m < 12; m++) {
        await renewSubscription(org, { at: new Date(Date.UTC(2026, m, 10, 10)) });
        const b = await getBalances(org);
        seen.push(b.balance);
        expect(b.included).toBe(400_000);
        expect(b.rollover).toBeLessThanOrEqual(200_000);                                      // nunca más del 50 % del ciclo anterior
        expect(b.balance).toBeLessThanOrEqual(600_000);
      }
      expect(seen[0]).toBe(400_000);                                                          // enero: sin rollover todavía
      expect(seen.slice(1).every((b) => b === 600_000)).toBe(true);                          // estable, no acumula
      const v = await verifyLedgerIntegrity(org);
      expect(v).toMatchObject({ ok: true, buckets: { included: 400_000, rollover: 200_000, extra: 0 } });
      // trazabilidad propia del rollover: cada alta de rollover es un movimiento identificable
      const rollovers = (await listLedger(org, { limit: 500 })).filter((e) => e.source === "rollover");
      expect(rollovers).toHaveLength(11);
      expect(rollovers.every((e) => e.bucket === "rollover" && Number(e.credits) === 200_000)).toBe(true);
    }, 60_000);

    it("Starter: 0 % — tras 12 ciclos no hay ni un crédito de rollover", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");
      for (let m = 0; m < 12; m++) await renewSubscription(org, { at: new Date(Date.UTC(2026, m, 10, 10)) });
      expect(await getBalances(org)).toEqual({ balance: 50_000, included: 50_000, rollover: 0, extra: 0 });
      expect((await listLedger(org, { limit: 500 })).filter((e) => e.source === "rollover")).toEqual([]);
    }, 60_000);
  });

  // ── 6. Multi-tenant (servicio y HTTP) ───────────────────────────────────────

  describe("aislamiento multi-tenant", () => {
    it("el workspace A no puede consumir créditos de B: sin saldo propio se le rechaza aunque B tenga millones", async () => {
      const a = nextOrg(), b = nextOrg();
      await grantCredits(b, 1_000_000, { reference: "mt-g" });
      await expect(reserveCredits({ orgId: a, credits: 10, reference: "mt-1" })).rejects.toBeInstanceOf(InsufficientCreditsError);
      const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "no", usage: OK_USAGE }));
      await expect(callAI({ mode: "live", orgId: a, functionName: FN, requestId: `${FN}-mt`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true } },
        realDeps(route("gpt-5.6-luna", generate)))).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(generate).not.toHaveBeenCalled();
      expect(await getBalance(b)).toBe(1_000_000);
      expect(await getAvailable(b)).toMatchObject({ held: 0 });
    });

    it("A no ve el ledger, las compras ni el consumo de B por ninguna de las rutas de workspace (HTTP real)", async () => {
      const a = nextOrg(), b = nextOrg();
      const { agent: bAgent } = await createAgent(b, "u", { name: "Agente de B" });
      await grantCredits(b, 5_000, { reference: "http-g" });
      await callAI({ mode: "live", orgId: b, functionName: FN, agentId: bAgent.id, requestId: `${FN}-http`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true } },
        realDeps(route("gpt-5.6-luna", async () => ({ text: "ok", usage: OK_USAGE }))));

      const A = await serveAgents(a), B = await serveAgents(b);
      try {
        const get = async (base: string, path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, body: await r.text() }; };

        // lo de B lo ve B
        const bLedger = JSON.parse((await get(B.base, "/credits/ledger")).body) as unknown[];
        expect(bLedger.length).toBe(2);                                                       // grant + consumption
        // lo de B no lo ve A
        expect(JSON.parse((await get(A.base, "/credits/ledger")).body)).toEqual([]);
        expect(JSON.parse((await get(A.base, `/credits/ledger?agentId=${bAgent.id}`)).body)).toEqual([]);
        expect(JSON.parse((await get(A.base, "/credits/balance")).body)).toMatchObject({ balance: 0, held: 0, available: 0 });
        const aDash = JSON.parse((await get(A.base, "/credits")).body);
        expect(aDash).toMatchObject({ balance: 0, creditsUsed: 0, byAgent: [], byModel: [], byFeature: [] });
        // el agente y sus presupuestos/consumo de B no existen para A
        for (const path of [`/${bAgent.id}`, `/${bAgent.id}/usage`]) expect((await get(A.base, path)).status).toBe(404);
        const patch = await fetch(`${A.base}/${bAgent.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ monthlyBudget: 1, dailyBudget: 1, perExecutionBudget: 1 }) });
        expect(patch.status).toBe(404);
        const sim = await fetch(`${A.base}/${bAgent.id}/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hola" }) });
        expect(sim.status).toBe(404);
        const run = await fetch(`${A.base}/${bAgent.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "live", message: "hola" }) });
        expect(run.status).toBe(404);
        const [still] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, bAgent.id));
        expect([still!.monthlyCreditLimit, still!.dailyCreditLimit, still!.perExecutionCreditLimit]).toEqual([null, null, null]); // los presupuestos de B no se tocaron

        // pricing/planes globales no se filtran por las rutas de workspace: solo el catálogo público de packs
        for (const path of ["/credits", "/credits/packs", "/credits/ledger", "/credits/balance"]) {
          expect((await get(A.base, path)).body).not.toMatch(/gpt-5\.6|inputCost|cachedInputCost|premerge|source":"https/);
        }
        expect((await get(A.base, "/pricing")).status).toBe(400);                            // ni existe ruta de pricing en el router de workspace
        expect(JSON.parse((await get(A.base, "/credits/packs")).body).map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(["pack_25k", "pack_1m"]));
      } finally { await close(A.server); await close(B.server); }
    }, 30_000);

    it("un workspace no puede gastar el presupuesto de un agente de otro: el consumo de A con agentId de B no cuenta contra B", async () => {
      const a = nextOrg(), b = nextOrg();
      const { agent: bAgent } = await createAgent(b, "u", { name: "B1" });
      await updateAgentMeta(b, bAgent.id, { monthlyCreditLimit: 10 });
      await grantCredits(b, 1_000, { reference: "bud-gb" });
      await grantCredits(a, 1_000, { reference: "bud-ga" });
      // El runner nunca lo permite (resuelve el agente dentro de la organización → 404). Aun forzando el servicio con un agentId ajeno,
      // el consumo se apunta a A (org de la cuenta) y los límites/consumo de B se calculan solo con SU ledger:
      await reserveCredits({ orgId: a, credits: 500, reference: "bud-1", agentId: bAgent.id }).catch(() => {});
      await expect(reserveCredits({ orgId: b, credits: 10, reference: "bud-b1", agentId: bAgent.id, agentLimits: { monthly: 10 } })).resolves.toBeTruthy();
      expect((await listLedger(b, { agentId: bAgent.id })).length).toBe(0);                  // nada de A aparece en el ledger de B
    });
  });

  // ── 7. Auditoría ────────────────────────────────────────────────────────────

  describe("auditoría", () => {
    it("las operaciones comerciales de Super Admin dejan rastro en audit_logs con el detalle y el actor", async () => {
      const org = nextOrg();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.clerkUserId = "audit-admin"; req.isSuperAdmin = true; next(); });
      app.use("/credits", creditsAdminRouter);
      const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/credits`;
      try {
        const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        expect((await post(`/${org}/entries`, { type: "grant", credits: 100, reason: "auditoría", reference: "aud-grant" })).status).toBe(201);
        expect((await post(`/${org}/purchases`, { packCode: "pack_25k", paymentReference: "aud-pay" })).status).toBe(201);
        await sleep(300);
        const rows = await db.select().from(auditLogsTable).where(eq(auditLogsTable.orgId, org));
        const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
        expect(byAction["credits_grant"]).toMatchObject({ actorClerkId: "audit-admin", resource: "credits" });
        expect(byAction["credits_grant"]!.details).toMatchObject({ reference: "aud-grant", credits: 100, reason: "auditoría" });
        expect(byAction["credits_purchase"]!.details).toMatchObject({ packCode: "pack_25k", paymentReference: "aud-pay", credits: 25_000, priceAmount: 29 });
      } finally { await close(server); }
    });

    it("un bloqueo por saldo/límite en LIVE queda auditado (credits_blocked) con su código", async () => {
      const org = nextOrg();
      const logged: Array<{ orgId: number; details: Record<string, unknown> }> = [];
      const d = { ...realDeps(route("gpt-5.6-luna", async () => ({ text: "no", usage: OK_USAGE }))), auditBlock: async (orgId: number, _r: string, details: Record<string, unknown>) => { logged.push({ orgId, details }); } };
      await expect(callAI({ mode: "live", orgId: org, functionName: FN, requestId: `${FN}-audblock`, messages: [{ role: "user", content: "hola" }], billing: { ledger: true } }, d)).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(logged).toEqual([{ orgId: org, details: expect.objectContaining({ code: "INSUFFICIENT_CREDITS" }) }]);
    });
  });
});
