// LA garantía comercial: dos peticiones simultáneas NO pueden consumir más
// créditos de los disponibles por una condición de carrera. Aquí se prueba con
// Postgres real y peticiones realmente concurrentes: reserva atómica,
// liquidación, idempotencia, simulación sin coste, y los límites del plan.
//
// Requiere ci-test con las migraciones 0004-0006. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  db, creditHoldsTable, creditLedgerTable, creditPlansTable, creditAlertsTable, aiUsageLogsTable, organizationsTable,
} from "@workspace/db";
import {
  grantCredits, getAvailable, getBalance, reserveCredits, settleCredits, releaseHold, creditsPort, listLedger,
  verifyLedgerIntegrity, InsufficientCreditsError, CreditLimitReachedError, DuplicateRequestError,
} from "../creditService";
import { upsertPlanConfig } from "../planService";
import { checkThresholdAlerts } from "../alerts";
import { callAI, AiSimulationModeError, type GatewayDeps } from "../../ai-gateway/gateway";
import { estimateCost, estimateTokens } from "../../ai-gateway/costEngine";
import { HOLD_SAFETY_FACTOR } from "../../ai-gateway/pricing";
import { ResponseCache } from "../../ai-gateway/responseCache";
import { checkBudgetBlocked, logAiCall } from "../../utils/aiUsageLogger";
import { createAgent } from "../../agents/agentService";
import { simulateAgent } from "../../agents/simulator";
import { defaultAgentConfig } from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import type { AIProvider, GenerateResult } from "../../ai/types";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const FN = `smoke_race_${Date.now()}`;
const PLANS: string[] = [];
let orgs: number[] = [];
let n = 0;
const nextOrg = () => orgs[n++]!;

const usedPlan = (label: string) => { const p = `smoke-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; PLANS.push(p); return p; };
const setPlan = (orgId: number, plan: string) => db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgId));

const messages = [{ role: "user" as const, content: "hola, necesito ayuda con una consulta" }];
const OK: GenerateResult = { text: "ok", usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 } };

function realDeps(generate: () => Promise<GenerateResult>): GatewayDeps {
  // timeoutMs generoso: el test de carrera mantiene la llamada "en vuelo" varios segundos a propósito.
  const provider = { id: "fake", name: "fake", generate: vi.fn(generate) } as unknown as AIProvider;
  return {
    resolveRoutes: () => [{ provider, providerId: "fake", model: "gpt-4o-mini", timeoutMs: 30_000 }],
    checkBudgetBlocked, logAiCall, credits: creditsPort, cache: new ResponseCache(), sleep: async () => {},
    ensurePricingLoaded: async () => {}, auditBlock: async () => {},
  };
}
const providerOf = (d: GatewayDeps) => d.resolveRoutes()[0]!.provider.generate as unknown as ReturnType<typeof vi.fn>;

const holdCount = async (orgId: number) => (await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.orgId, orgId))).length;
const consumptionRows = (orgId: number) => db.select().from(creditLedgerTable)
  .where(and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.entryType, "consumption")));

describe.skipIf(!hasRealDb)("OmniCredits — reservas, carreras e idempotencia", () => {
  beforeAll(async () => { orgs = await createTempOrgs(24, "race"); });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(like(aiUsageLogsTable.functionName, "smoke_race_%"));
    await db.delete(creditPlansTable).where(inArray(creditPlansTable.plan, PLANS));
    await deleteTempOrgs(orgs);
  });

  it("reservar → liquidar: el consumo real sustituye a la reserva y el saldo baja lo justo", async () => {
    const org = nextOrg();
    await grantCredits(org, 100, { reference: "g" });
    const hold = await reserveCredits({ orgId: org, credits: 10, reference: "r1" });
    expect(hold.available).toBe(90);
    expect(await getAvailable(org)).toEqual({ balance: 100, held: 10, available: 90 });

    const { entry, overrun } = await settleCredits({ orgId: org, reference: "r1", credits: 7, provider: "fake", model: "m", technicalCostUsd: 0.007 });
    expect(overrun).toBe(false);
    expect(entry).toMatchObject({ entryType: "consumption", reference: "r1" });
    expect(Number(entry!.credits)).toBe(-7);
    expect(Number(entry!.balanceBefore)).toBe(100);
    expect(Number(entry!.balanceAfter)).toBe(93);
    expect(entry!.metadata).toMatchObject({ reservedCredits: 10, overrun: false });
    expect(await getAvailable(org)).toEqual({ balance: 93, held: 0, available: 93 });
    expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
  });

  it("una reserva liberada no cobra nada y devuelve lo disponible", async () => {
    const org = nextOrg();
    await grantCredits(org, 20, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 15, reference: "r1" });
    expect((await getAvailable(org)).available).toBe(5);
    expect(await releaseHold(org, "r1")).toBe(true);
    expect(await releaseHold(org, "r1")).toBe(false); // ya liberada
    expect(await getAvailable(org)).toEqual({ balance: 20, held: 0, available: 20 });
    expect(await consumptionRows(org)).toEqual([]);
  });

  it("si el coste real supera la reserva, se registra el real y se marca el desvío", async () => {
    const org = nextOrg();
    await grantCredits(org, 100, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 5, reference: "r1" });
    const { entry, overrun } = await settleCredits({ orgId: org, reference: "r1", credits: 8 });
    expect(overrun).toBe(true);
    expect(Number(entry!.credits)).toBe(-8);
    expect(entry!.metadata).toMatchObject({ reservedCredits: 5, overrun: true });
    expect(await getBalance(org)).toBe(92);
  });

  it("INSUFFICIENT_CREDITS estructurado: lo reservado por otras peticiones cuenta como no disponible", async () => {
    const org = nextOrg();
    await grantCredits(org, 10, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 6, reference: "r1" });
    const err = await reserveCredits({ orgId: org, credits: 6, reference: "r2" }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.code).toBe("INSUFFICIENT_CREDITS");
    expect({ balance: err.balance, available: err.available, required: err.required }).toEqual({ balance: 10, available: 4, required: 6 });
    expect(await holdCount(org)).toBe(1); // la fallida no dejó reserva
  });

  it("una cuenta sin créditos ni cuenta creada devuelve INSUFFICIENT_CREDITS, no un error genérico", async () => {
    const org = nextOrg();
    const err = await reserveCredits({ orgId: org, credits: 1, reference: "r1" }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.balance).toBe(0);
  });

  it("IDEMPOTENCIA: la misma petición no se reserva ni se cobra dos veces", async () => {
    const org = nextOrg();
    await grantCredits(org, 50, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 5, reference: "dup" });
    await expect(reserveCredits({ orgId: org, credits: 5, reference: "dup" })).rejects.toBeInstanceOf(DuplicateRequestError); // en curso

    await settleCredits({ orgId: org, reference: "dup", credits: 4 });
    await expect(reserveCredits({ orgId: org, credits: 5, reference: "dup" })).rejects.toBeInstanceOf(DuplicateRequestError); // ya cobrada
    const again = await settleCredits({ orgId: org, reference: "dup", credits: 4 });
    expect(again.duplicate).toBe(true);
    expect(await consumptionRows(org)).toHaveLength(1);
    expect(await getBalance(org)).toBe(46);

    // una petición fallida (reserva liberada) sí se puede reintentar con el mismo id
    await reserveCredits({ orgId: org, credits: 5, reference: "retry" });
    await releaseHold(org, "retry");
    await expect(reserveCredits({ orgId: org, credits: 5, reference: "retry" })).resolves.toBeTruthy();
  });

  it("una reserva caducada (proceso caído) deja de contar sola", async () => {
    const org = nextOrg();
    await grantCredits(org, 10, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 10, reference: "ghost", ttlMs: -1000 }); // ya caducada
    expect((await getAvailable(org)).available).toBe(10);
    await expect(reserveCredits({ orgId: org, credits: 10, reference: "real" })).resolves.toBeTruthy();
  });

  it("CARRERA: 12 reservas simultáneas nunca superan lo disponible", async () => {
    const org = nextOrg();
    await grantCredits(org, 10, { reference: "g" });
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
      reserveCredits({ orgId: org, credits: 4, reference: `race-${i}` })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(2); // 2 × 4 = 8 ≤ 10; una tercera (12) no cabe
    expect(refused).toHaveLength(10);
    expect(refused.every((r) => r.reason instanceof InsufficientCreditsError)).toBe(true);
    expect((await getAvailable(org)).held).toBe(8);
  });

  it("CARRERA de extremo a extremo con el gateway: solo una de 6 llamadas simultáneas llega al proveedor", { timeout: 30_000 }, async () => {
    const org = nextOrg();
    const { agent } = await createAgent(org, "u", { name: "Carrera" });
    const estimate = estimateCost("fake", "gpt-4o-mini", {
      inputTokens: estimateTokens(JSON.stringify(messages)), maxOutputTokens: 1024,
    }).credits;
    const oneHold = Math.ceil(estimate * HOLD_SAFETY_FACTOR * 1e4) / 1e4;
    const granted = Math.round(oneHold * 1.5 * 1e4) / 1e4; // cabe una reserva, no dos
    await grantCredits(org, granted, { reference: "g" });

    // La llamada tarda más que el total de las 6 reservas (serializadas por el bloqueo de la cuenta, con la latencia
    // de una base remota), para que TODAS coincidan con la primera reserva viva: eso es lo que hace real la carrera.
    const deps = realDeps(() => new Promise((r) => setTimeout(() => r(OK), 3000)));
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => callAI({
      mode: "live", orgId: org, functionName: FN, agentId: agent.id, requestId: `${FN}-${i}`,
      messages, billing: { ledger: true },
    }, deps)));

    const served = outcomes.filter((o) => o.status === "fulfilled");
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(served).toHaveLength(1);
    expect(refused).toHaveLength(5);
    expect(refused.every((o) => o.reason instanceof InsufficientCreditsError)).toBe(true);
    expect(providerOf(deps)).toHaveBeenCalledTimes(1);            // el proveedor (que cuesta dinero) se llamó UNA vez

    const spent = (await consumptionRows(org)).reduce((s, r) => s - Number(r.credits), 0);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(granted);                  // nunca se consumió más de lo concedido
    expect(await getBalance(org)).toBeCloseTo(granted - spent, 4);
    expect(await getBalance(org)).toBeGreaterThanOrEqual(0);
    expect((await getAvailable(org)).held).toBe(0);
    expect((await verifyLedgerIntegrity(org)).ok).toBe(true);

    const blocked = await db.select().from(aiUsageLogsTable).where(and(eq(aiUsageLogsTable.orgId, org), eq(aiUsageLogsTable.status, "blocked")));
    expect(blocked).toHaveLength(5);                              // los 5 intentos rechazados quedaron registrados
  });

  it("IDEMPOTENCIA de extremo a extremo: el mismo requestId dos veces llama una vez al proveedor y cobra una vez", async () => {
    const org = nextOrg();
    await grantCredits(org, 1000, { reference: "g" });
    const deps = realDeps(async () => OK);
    const req = { mode: "live" as const, orgId: org, functionName: FN, requestId: `${FN}-same`, messages, billing: { ledger: true } };
    await callAI(req, deps);
    await expect(callAI(req, deps)).rejects.toBeInstanceOf(DuplicateRequestError);
    expect(providerOf(deps)).toHaveBeenCalledTimes(1);
    expect(await consumptionRows(org)).toHaveLength(1);
  });

  it("un proveedor que falla no cobra nada y libera la reserva", async () => {
    const org = nextOrg();
    await grantCredits(org, 500, { reference: "g" });
    const deps = realDeps(async () => { throw Object.assign(new Error("boom"), { status: 400 }); });
    await expect(callAI({ mode: "live", orgId: org, functionName: FN, requestId: `${FN}-fail`, messages, billing: { ledger: true } }, deps)).rejects.toThrow();
    expect(await getBalance(org)).toBe(500);
    expect(await getAvailable(org)).toEqual({ balance: 500, held: 0, available: 500 });
    expect(await consumptionRows(org)).toEqual([]);
  });

  it("SIMULATION no consume: ni reserva, ni movimiento, ni llamada al proveedor", async () => {
    const org = nextOrg();
    await grantCredits(org, 500, { reference: "g" });
    const deps = realDeps(async () => OK);
    const snapshot = async () => ({ ledger: (await listLedger(org)).length, holds: await holdCount(org), balance: await getBalance(org) });
    const before = await snapshot();

    await expect(callAI({ mode: "simulation", orgId: org, functionName: FN, messages, billing: { ledger: true } }, deps)).rejects.toBeInstanceOf(AiSimulationModeError);
    const sim = simulateAgent({
      agent: { id: 1, name: "Ana" }, versionNumber: 1, config: defaultAgentConfig(), message: "hola",
      readTools: [], actionTools: [],
    });
    expect(sim.simulated).toBe(true);
    expect(sim.estimate.typicalCredits).toBeGreaterThan(0); // muestra cuánto costaría…
    expect(sim.tokensEstimated.input).toBeGreaterThan(0);

    expect(providerOf(deps)).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);                // …sin haber costado nada
  });

  it("LIVE consume de verdad: reserva, llama, liquida y enlaza el consumo al registro técnico", async () => {
    const org = nextOrg();
    await grantCredits(org, 500, { reference: "g" });
    const deps = realDeps(async () => OK);
    const r = await callAI({ mode: "live", orgId: org, functionName: FN, requestId: `${FN}-live`, messages, billing: { ledger: true } }, deps);
    const [entry] = await consumptionRows(org);
    expect(entry).toMatchObject({ reference: `${FN}-live`, provider: "fake", model: "gpt-4o-mini" });
    expect(Number(entry!.credits)).toBeCloseTo(-r.credits, 4);
    expect(entry!.usageLogId).toBeTruthy();
    const [log] = await db.select().from(aiUsageLogsTable).where(eq(aiUsageLogsTable.id, entry!.usageLogId!));
    expect(log).toMatchObject({ orgId: org, status: "ok" });
    expect(await getBalance(org)).toBeCloseTo(500 - r.credits, 4);
  });

  // ── Límites del plan (configurables; sin configurar no hay límite) ─────────

  it("sin plan configurado no hay límites: solo cuenta el saldo", async () => {
    const org = nextOrg();
    await setPlan(org, usedPlan("sinconfig"));
    await grantCredits(org, 1000, { reference: "g" });
    await expect(reserveCredits({ orgId: org, credits: 900, reference: "big" })).resolves.toBeTruthy();
  });

  it("límite mensual del workspace: bloquea al alcanzarlo y no bloquea si blockAtLimit=false", async () => {
    const org = nextOrg();
    const plan = usedPlan("mensual");
    await setPlan(org, plan);
    await upsertPlanConfig(plan, { monthlyLimit: 10, blockAtLimit: true }, "u");
    await grantCredits(org, 1000, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 8, reference: "a" });
    await settleCredits({ orgId: org, reference: "a", credits: 8 });

    const err = await reserveCredits({ orgId: org, credits: 3, reference: "b" }).catch((e) => e);
    expect(err).toBeInstanceOf(CreditLimitReachedError);
    expect(err).toMatchObject({ code: "CREDIT_LIMIT_REACHED", scope: "workspace_monthly", limit: 10, used: 8 });
    await expect(reserveCredits({ orgId: org, credits: 2, reference: "c" })).resolves.toBeTruthy(); // 8 + 2 = 10, justo en el límite

    await upsertPlanConfig(plan, { blockAtLimit: false }, "u");
    await expect(reserveCredits({ orgId: org, credits: 50, reference: "d" })).resolves.toBeTruthy();
  });

  it("límite diario del workspace", async () => {
    const org = nextOrg();
    const plan = usedPlan("diario");
    await setPlan(org, plan);
    await upsertPlanConfig(plan, { dailyLimit: 5 }, "u");
    await grantCredits(org, 100, { reference: "g" });
    await reserveCredits({ orgId: org, credits: 4, reference: "a" });
    await settleCredits({ orgId: org, reference: "a", credits: 4 });
    await expect(reserveCredits({ orgId: org, credits: 2, reference: "b" })).rejects.toMatchObject({ scope: "workspace_daily", limit: 5 });
  });

  it("las reservas en curso también cuentan contra el límite (dos peticiones a la vez no lo superan)", async () => {
    const org = nextOrg();
    const plan = usedPlan("paralelo");
    await setPlan(org, plan);
    await upsertPlanConfig(plan, { monthlyLimit: 10 }, "u");
    await grantCredits(org, 1000, { reference: "g" });
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => reserveCredits({ orgId: org, credits: 4, reference: `p-${i}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r): r is PromiseRejectedResult => r.status === "rejected").every((r) => r.reason instanceof CreditLimitReachedError)).toBe(true);
  });

  it("límite por agente: el del plan y el propio del agente (el menor manda), sin afectar a otros agentes", async () => {
    const org = nextOrg();
    const plan = usedPlan("agente");
    await setPlan(org, plan);
    await upsertPlanConfig(plan, { perAgentMonthlyLimit: 10 }, "u");
    await grantCredits(org, 1000, { reference: "g" });
    const { agent: a1 } = await createAgent(org, "u", { name: "A1" });
    const { agent: a2 } = await createAgent(org, "u", { name: "A2" });

    await reserveCredits({ orgId: org, credits: 9, reference: "a1-1", agentId: a1.id });
    await settleCredits({ orgId: org, reference: "a1-1", credits: 9, agentId: a1.id });
    await expect(reserveCredits({ orgId: org, credits: 2, reference: "a1-2", agentId: a1.id })).rejects.toMatchObject({ scope: "agent_monthly", limit: 10 });
    await expect(reserveCredits({ orgId: org, credits: 9, reference: "a2-1", agentId: a2.id })).resolves.toBeTruthy(); // otro agente

    // el tope propio del agente (más bajo que el del plan) manda
    await expect(reserveCredits({ orgId: org, credits: 3, reference: "cap", agentId: a2.id, agentCap: 10 })).rejects.toMatchObject({ scope: "agent_monthly", limit: 10 });
    await expect(reserveCredits({ orgId: org, credits: 1, reference: "cap2", agentId: a2.id, agentCap: 100 })).resolves.toBeTruthy();
  });

  it("alertas de consumo: una por umbral y periodo, y quedan auditadas", async () => {
    const org = nextOrg();
    const plan = usedPlan("alertas");
    await setPlan(org, plan);
    await upsertPlanConfig(plan, { includedCredits: 100, alertThresholds: [50, 100] }, "u");
    await grantCredits(org, 1000, { reference: "g" });

    await settleCredits({ orgId: org, reference: "s1", credits: 40 });
    expect(await checkThresholdAlerts(org)).toHaveLength(0);
    await settleCredits({ orgId: org, reference: "s2", credits: 20 });          // 60 % → umbral 50
    expect((await checkThresholdAlerts(org)).map((a) => a.threshold)).toEqual([50]);
    expect(await checkThresholdAlerts(org)).toHaveLength(0);                     // no se repite
    await settleCredits({ orgId: org, reference: "s3", credits: 45 });          // 105 % → umbral 100
    expect((await checkThresholdAlerts(org)).map((a) => a.threshold)).toEqual([100]);

    const rows = await db.select().from(creditAlertsTable).where(eq(creditAlertsTable.orgId, org));
    expect(rows.map((r) => r.threshold).sort((a, b) => a - b)).toEqual([50, 100]);
    const audit = await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE org_id = ${org} AND action = 'credits_alert_threshold'`);
    expect((audit.rows[0] as { n: number }).n).toBe(2);
  });

  it("un workspace no puede consultar, reservar ni consumir créditos de otro", async () => {
    const a = nextOrg(), b = nextOrg();
    await grantCredits(a, 100, { reference: "g" });
    expect(await getBalance(b)).toBe(0);
    await expect(reserveCredits({ orgId: b, credits: 1, reference: "steal" })).rejects.toBeInstanceOf(InsufficientCreditsError);
    // la misma referencia en otra org es independiente
    await reserveCredits({ orgId: a, credits: 5, reference: "same" });
    await grantCredits(b, 10, { reference: "g" });
    await expect(reserveCredits({ orgId: b, credits: 5, reference: "same" })).resolves.toBeTruthy();
    expect((await getAvailable(a)).held).toBe(5);
    expect((await getAvailable(b)).held).toBe(5);
    expect(await getBalance(a)).toBe(100);
  });
});
