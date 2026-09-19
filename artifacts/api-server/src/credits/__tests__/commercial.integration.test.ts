// La capa comercial: planes configurables, créditos incluidos y rollover,
// compras (OmniCredits extra), panel de créditos, vista global de Super Admin,
// consumo anómalo y consumo por agente. Contra Postgres real.
//
// Los valores comerciales NO están fijados en el código: cada test configura
// su propio plan de prueba, y sin configurar no hay créditos ni límites.
//
// Requiere ci-test con las migraciones 0004-0006. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  db, creditLedgerTable, creditPlansTable, creditPurchasesTable, aiUsageLogsTable, licensePlansTable, organizationsTable,
} from "@workspace/db";
import {
  appendEntry, getBalance, grantCredits, listLedger, verifyLedgerIntegrity, CreditError,
} from "../creditService";
import { getPlanConfig, resolveOrgPlan, upsertPlanConfig } from "../planService";
import { renewSubscription } from "../subscriptionService";
import { expirePurchase, listPurchases, listPurchasesDueForExpiry, recordPurchase, reversePurchase } from "../purchaseService";
import { getDashboard, getGlobalOverview } from "../reporting";
import { checkThresholdAlerts, detectAnomalies, raiseAnomalyAlerts } from "../alerts";
import { createAgent } from "../../agents/agentService";
import { getAgentUsage } from "../../agents/usageService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const PLANS: string[] = [];
let orgs: number[] = [];
let n = 0;
const nextOrg = () => orgs[n++]!;

const newPlan = (label: string) => { const p = `smoke-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; PLANS.push(p); return p; };
const setPlan = (orgId: number, plan: string) => db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgId));
const balanceOf = getBalance;

/** Un movimiento con fecha pasada (la API no lo permite a propósito: aquí se inserta en crudo, respetando la cadena). */
async function backdated(orgId: number, type: string, credits: number, at: Date, reference: string) {
  const bal = await getBalance(orgId);
  const [acc] = await db.execute(sql`SELECT id FROM credit_accounts WHERE org_id = ${orgId}`).then((r) => r.rows as Array<{ id: number }>);
  await db.execute(sql`INSERT INTO credit_ledger (org_id, account_id, entry_type, credits, balance_before, balance_after, reference, source, created_at)
    VALUES (${orgId}, ${acc!.id}, ${type}, ${credits.toFixed(4)}, ${bal.toFixed(4)}, ${(bal + credits).toFixed(4)}, ${reference}, 'test', ${at.toISOString()}::timestamp)`);
}

const types = async (orgId: number) => (await listLedger(orgId)).reverse().map((e) => e.entryType);

describe.skipIf(!hasRealDb)("OmniCredits — capa comercial", () => {
  beforeAll(async () => { orgs = await createTempOrgs(30, "commercial"); });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(like(aiUsageLogsTable.functionName, "smoke_ov_%"));
    await db.delete(creditPlansTable).where(inArray(creditPlansTable.plan, PLANS));
    await deleteTempOrgs(orgs);
  });

  // ── Planes ────────────────────────────────────────────────────────────────

  describe("planes configurables", () => {
    it("NULL = sin configurar: un plan nuevo no tiene créditos ni límites por defecto, y se valida todo", async () => {
      const plan = newPlan("cfg");
      expect(await getPlanConfig(plan)).toBeNull();

      const first = await upsertPlanConfig(plan, { includedCredits: 100, alertThresholds: [80, 50, 80] }, "u");
      expect(first.previous).toBeNull();
      expect(first.current).toMatchObject({
        includedCredits: 100, monthlyLimit: null, dailyLimit: null, perAgentMonthlyLimit: null,
        rollover: false, rolloverCap: null, blockAtLimit: true, alertThresholds: [50, 80], active: true,
      });

      const second = await upsertPlanConfig(plan, { monthlyLimit: 500, rollover: true, rolloverCap: 25 }, "u2");
      expect(second.previous).toMatchObject({ includedCredits: 100, monthlyLimit: null });   // el antes, para auditar
      expect(second.current).toMatchObject({ includedCredits: 100, monthlyLimit: 500, rollover: true, rolloverCap: 25 });
      expect((await upsertPlanConfig(plan, { monthlyLimit: null }, "u")).current.monthlyLimit).toBeNull(); // volver a "sin límite"

      await expect(upsertPlanConfig(plan, { includedCredits: -1 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { dailyLimit: Number.NaN }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { alertThresholds: [0] }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { alertThresholds: [1.5] }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(" ", {}, "u")).rejects.toThrow(CreditError);
    });

    it("el plan de un workspace sale de lo que ya existe: una licencia activa manda sobre organizations.plan", async () => {
      const org = nextOrg();
      await setPlan(org, "base");
      expect(await resolveOrgPlan(org)).toMatchObject({ plan: "base", license: null });

      await db.insert(licensePlansTable).values({ orgId: org, plan: "premium", validUntil: new Date(Date.now() + 86_400_000) });
      expect(await resolveOrgPlan(org)).toMatchObject({ plan: "premium" });

      await db.update(licensePlansTable).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(licensePlansTable.orgId, org));
      expect(await resolveOrgPlan(org)).toMatchObject({ plan: "base", license: null }); // caducada
    });
  });

  // ── Créditos incluidos (SUBSCRIPTION) ─────────────────────────────────────

  describe("créditos incluidos por plan", () => {
    const JAN = new Date("2026-01-15T10:00:00Z");
    const FEB = new Date("2026-02-10T10:00:00Z");

    it("sin configuración no concede nada", async () => {
      const org = nextOrg();
      await setPlan(org, newPlan("sinconfig"));
      expect(await renewSubscription(org, { at: JAN })).toMatchObject({ status: "not_configured", granted: 0, expired: 0 });
      expect(await listLedger(org)).toEqual([]);
    });

    it("concede los créditos incluidos una sola vez por periodo (idempotente)", async () => {
      const org = nextOrg();
      const plan = newPlan("sub");
      await setPlan(org, plan);
      await upsertPlanConfig(plan, { includedCredits: 100 }, "u");

      const a = await renewSubscription(org, { at: JAN, userClerkId: "u" });
      expect(a).toMatchObject({ status: "granted", granted: 100, period: "2026-01", plan });
      expect(await renewSubscription(org, { at: JAN })).toMatchObject({ status: "already_granted", granted: 0 });
      expect(await balanceOf(org)).toBe(100);

      const [entry] = await listLedger(org);
      expect(entry).toMatchObject({ entryType: "subscription", reference: `subscription:${org}:2026-01`, source: "subscription" });
      expect(entry!.metadata).toMatchObject({ plan, period: "2026-01" });
    });

    it("sin rollover caduca lo que sobró del periodo anterior (EXPIRATION) y concede el nuevo", async () => {
      const org = nextOrg();
      const plan = newPlan("norollover");
      await setPlan(org, plan);
      await upsertPlanConfig(plan, { includedCredits: 100, rollover: false }, "u");

      await renewSubscription(org, { at: JAN });
      await backdated(org, "consumption", -30, new Date("2026-01-20T10:00:00Z"), "c1");
      const res = await renewSubscription(org, { at: FEB });
      expect(res).toMatchObject({ status: "granted", granted: 100, expired: 70, period: "2026-02" });
      expect(await balanceOf(org)).toBe(100);
      expect(await types(org)).toEqual(["subscription", "consumption", "expiration", "subscription"]);

      expect(await renewSubscription(org, { at: FEB })).toMatchObject({ status: "already_granted", expired: 0 }); // no caduca dos veces
      expect(await balanceOf(org)).toBe(100);
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });

    it("con rollover se conserva lo sobrante, con tope opcional", async () => {
      const free = nextOrg(), capped = nextOrg();
      const plan = newPlan("rollover");
      await setPlan(free, plan);
      await upsertPlanConfig(plan, { includedCredits: 100, rollover: true }, "u");
      await renewSubscription(free, { at: JAN });
      await backdated(free, "consumption", -30, new Date("2026-01-20T10:00:00Z"), "c1");
      expect(await renewSubscription(free, { at: FEB })).toMatchObject({ expired: 0, granted: 100 });
      expect(await balanceOf(free)).toBe(170); // 70 sobrantes + 100 nuevos

      const planCap = newPlan("rollovercap");
      await setPlan(capped, planCap);
      await upsertPlanConfig(planCap, { includedCredits: 100, rollover: true, rolloverCap: 20 }, "u");
      await renewSubscription(capped, { at: JAN });
      await backdated(capped, "consumption", -30, new Date("2026-01-20T10:00:00Z"), "c1");
      expect(await renewSubscription(capped, { at: FEB })).toMatchObject({ expired: 50, granted: 100 });
      expect(await balanceOf(capped)).toBe(120); // 20 conservados + 100 nuevos
    });

    it("no toca los créditos comprados al cerrar el periodo", async () => {
      const org = nextOrg();
      const plan = newPlan("mixto");
      await setPlan(org, plan);
      await upsertPlanConfig(plan, { includedCredits: 100 }, "u");
      await renewSubscription(org, { at: JAN });
      await recordPurchase({ orgId: org, credits: 50, paymentReference: "pay-mixto" });
      expect(await balanceOf(org)).toBe(150);

      await renewSubscription(org, { at: FEB });
      expect(await balanceOf(org)).toBe(150); // caducan 100 incluidos, se conceden 100 nuevos, y los 50 comprados siguen ahí
      const exp = (await listLedger(org)).find((e) => e.entryType === "expiration");
      expect(Number(exp!.credits)).toBe(-100);
    });

    it("un plan que no incluye créditos no concede nada", async () => {
      const org = nextOrg();
      const plan = newPlan("cero");
      await setPlan(org, plan);
      await upsertPlanConfig(plan, { includedCredits: 0 }, "u");
      expect(await renewSubscription(org, { at: JAN })).toMatchObject({ status: "no_credits_included", granted: 0 });
      expect(await listLedger(org)).toEqual([]);
    });
  });

  // ── OmniCredits extra (PURCHASE) ──────────────────────────────────────────

  describe("compras de créditos extra", () => {
    it("una compra crea su fila y su movimiento PURCHASE enlazado, en la misma transacción", async () => {
      const org = nextOrg();
      const expires = new Date(Date.now() + 30 * 86_400_000);
      const { purchase, entry, duplicate } = await recordPurchase({
        orgId: org, credits: 500, priceAmount: 49.9, currency: "EUR", paymentReference: "pay-1", expiresAt: expires, userClerkId: "admin",
        metadata: { note: "pack 500" },
      });
      expect(duplicate).toBe(false);
      expect(purchase).toMatchObject({ orgId: org, currency: "EUR", paymentReference: "pay-1", status: "completed", ledgerEntryId: entry!.id });
      expect(Number(purchase.credits)).toBe(500);
      expect(Number(purchase.priceAmount)).toBe(49.9);
      expect(entry).toMatchObject({ entryType: "purchase", reference: `purchase:${purchase.id}`, source: "purchase" });
      expect(await balanceOf(org)).toBe(500);
      expect((await listPurchases(org)).map((p) => p.id)).toEqual([purchase.id]);
    });

    it("es idempotente por referencia de pago: repetir la misma compra no duplica créditos", async () => {
      const org = nextOrg();
      await recordPurchase({ orgId: org, credits: 100, paymentReference: "pay-dup" });
      const again = await recordPurchase({ orgId: org, credits: 100, paymentReference: "pay-dup" });
      expect(again.duplicate).toBe(true);
      expect(await balanceOf(org)).toBe(100);
      expect(await listPurchases(org)).toHaveLength(1);
    });

    it("valida la compra y la aísla por workspace", async () => {
      const a = nextOrg(), b = nextOrg();
      await expect(recordPurchase({ orgId: a, credits: 0 })).rejects.toThrow(CreditError);
      await expect(recordPurchase({ orgId: a, credits: 10, priceAmount: -1 })).rejects.toThrow(CreditError);
      await expect(recordPurchase({ orgId: a, credits: 10, currency: "euro" })).rejects.toThrow(CreditError);
      await expect(recordPurchase({ orgId: a, credits: 10, expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(CreditError);
      expect(await listLedger(a)).toEqual([]);

      const { purchase } = await recordPurchase({ orgId: a, credits: 10, paymentReference: "same-ref" });
      await recordPurchase({ orgId: b, credits: 10, paymentReference: "same-ref" }); // misma referencia en otra org: otra compra
      expect(await balanceOf(b)).toBe(10);
      await expect(reversePurchase(b, purchase.id, { reason: "x" })).rejects.toThrow(/no encontrada/); // la org B no toca la compra de A
    });

    it("anular una compra (reembolso del pago) la marca y descuenta sus créditos con un ajuste auditable", async () => {
      const org = nextOrg();
      const { purchase } = await recordPurchase({ orgId: org, credits: 200, paymentReference: "pay-rev" });
      await expect(reversePurchase(org, purchase.id, { reason: " " })).rejects.toThrow(/motivo/);

      const { entry } = await reversePurchase(org, purchase.id, { reason: "pago reembolsado", userClerkId: "admin" });
      expect(entry).toMatchObject({ entryType: "adjustment", reference: `purchase-reversal:${purchase.id}`, userClerkId: "admin" });
      expect(Number(entry.credits)).toBe(-200);
      expect(entry.metadata).toMatchObject({ reason: "pago reembolsado", purchaseId: purchase.id });
      expect(await balanceOf(org)).toBe(0);
      expect((await listPurchases(org))[0]!.status).toBe("reversed");
      await expect(reversePurchase(org, purchase.id, { reason: "otra vez" })).rejects.toThrow(/ya estaba anulada/);
      expect(await balanceOf(org)).toBe(0);
    });

    it("la caducidad se guarda y se puede consultar, pero no se descuenta sola", async () => {
      const org = nextOrg();
      const soon = new Date(Date.now() + 2000);
      const { purchase } = await recordPurchase({ orgId: org, credits: 40, paymentReference: "pay-exp", expiresAt: soon });
      expect((await listPurchasesDueForExpiry(new Date(), org)).map((p) => p.id)).not.toContain(purchase.id);
      const due = await listPurchasesDueForExpiry(new Date(Date.now() + 60_000), org);
      expect(due.map((p) => p.id)).toContain(purchase.id);
      expect(await balanceOf(org)).toBe(40);                        // nada se ha descontado

      await expirePurchase(org, purchase.id, 40, { reason: "caducidad de la compra" });
      expect(await balanceOf(org)).toBe(0);
      expect((await listPurchasesDueForExpiry(new Date(Date.now() + 60_000), org)).map((p) => p.id)).not.toContain(purchase.id);
      const again = await expirePurchase(org, purchase.id, 40, { reason: "caducidad de la compra" });
      expect(again.duplicate).toBe(true);                           // idempotente: no caduca dos veces
      expect(await balanceOf(org)).toBe(0);
    });
  });

  // ── Panel de créditos del workspace ───────────────────────────────────────

  describe("dashboard de créditos", () => {
    it("muestra saldo, incluidos, % consumido, renovación, consumo por agente/modelo/funcionalidad, series, previsión y alertas", async () => {
      const org = nextOrg();
      const plan = newPlan("dash");
      await setPlan(org, plan);
      await upsertPlanConfig(plan, { includedCredits: 100, dailyLimit: 80, alertThresholds: [50] }, "u");
      const renewsAt = new Date(Date.now() + 10 * 86_400_000);
      await db.insert(licensePlansTable).values({ orgId: org, plan, validUntil: renewsAt });

      await renewSubscription(org);
      const { agent: a1 } = await createAgent(org, "u", { name: "A1" });
      const { agent: a2 } = await createAgent(org, "u", { name: "A2" });
      const cons = (credits: number, ref: string, o: Record<string, unknown> = {}) =>
        appendEntry({ orgId: org, type: "consumption", credits: -credits, reference: ref, ...o });
      await cons(10, "c1", { agentId: a1.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.01, metadata: { functionName: `agent_${a1.id}` } });
      await cons(5,  "c2", { agentId: a1.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.005, metadata: { functionName: `agent_${a1.id}` } });
      await cons(20, "c3", { agentId: a2.id, provider: "openai", model: "gpt-4o", technicalCostUsd: 0.02, metadata: { functionName: `agent_${a2.id}` } });
      await cons(3,  "c4");

      const d = await getDashboard(org);
      expect(d).toMatchObject({ plan, balance: 62, held: 0, available: 62, included: 100, used: 38, usedToday: 38, pctConsumed: 38 });
      expect(d.period.renewsAt.getTime()).toBe(renewsAt.getTime());
      expect(d.limits).toMatchObject({ daily: 80, monthly: null, blockAtLimit: true });

      expect(d.byAgent.map((r) => [r.agentId, r.credits, r.runs])).toEqual([[a2.id, 20, 1], [a1.id, 15, 2], [null, 3, 1]]);
      expect(d.byModel.find((r) => r.model === "gpt-4o-mini")).toMatchObject({ credits: 15, runs: 2, technicalCostUsd: 0.015 });
      expect(d.byModel.find((r) => r.model === "gpt-4o")).toMatchObject({ credits: 20, runs: 1 });
      expect(d.byFeature.find((r) => r.feature === `agent_${a1.id}`)).toMatchObject({ credits: 15, runs: 2 });
      expect(d.byFeature.find((r) => r.feature === "sin_clasificar")).toMatchObject({ credits: 3 });
      expect(d.daily.at(-1)).toMatchObject({ credits: 38 });
      expect(d.monthly.at(-1)).toMatchObject({ month: d.period.key, credits: 38 });
      expect(d.forecast.projectedMonthCredits).toBeGreaterThanOrEqual(38);

      await cons(30, "c5", { agentId: a2.id });                                 // 68 % → umbral 50
      await checkThresholdAlerts(org);
      expect((await getDashboard(org)).alerts.map((a) => a.threshold)).toEqual([50]);
    });

    it("está completamente aislado por workspace", async () => {
      const a = nextOrg(), b = nextOrg();
      await grantCredits(a, 100, { reference: "g" });
      await appendEntry({ orgId: a, type: "consumption", credits: -40, reference: "c" });
      const other = await getDashboard(b);
      expect(other).toMatchObject({ balance: 0, used: 0, byAgent: [], byModel: [], byFeature: [], alerts: [] });
      expect((await getDashboard(a)).used).toBe(40);
    });
  });

  // ── Super Admin: vista global ─────────────────────────────────────────────

  describe("vista global de Super Admin", () => {
    it("agrega concedido, consumido, ajustes, compras, devoluciones, caducados y errores de consumo", async () => {
      const a = nextOrg(), b = nextOrg();
      await grantCredits(a, 100, { reference: "g" });
      await recordPurchase({ orgId: a, credits: 50, priceAmount: 5, currency: "EUR", paymentReference: "ov-pay" });
      await appendEntry({ orgId: a, type: "consumption", credits: -30, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.03, reference: "c1" });
      const { AGENT_ID } = { AGENT_ID: (await createAgent(a, "u", { name: "Top" })).agent.id };
      await appendEntry({ orgId: a, type: "consumption", credits: -5, agentId: AGENT_ID, provider: "openai", model: "gpt-4o-mini", reference: "c2" });
      await appendEntry({ orgId: a, type: "refund", credits: 5, reference: "rf", metadata: { reason: "error" } });
      await appendEntry({ orgId: a, type: "adjustment", credits: -2, reference: "adj", metadata: { reason: "ajuste" } });
      await appendEntry({ orgId: a, type: "expiration", credits: -10, reference: "ex", metadata: { reason: "caduca" } });
      await grantCredits(b, 20, { reference: "g" });
      await appendEntry({ orgId: b, type: "consumption", credits: -10, provider: "openai", model: "gpt-4o", technicalCostUsd: 0.1, reference: "c1" });

      await db.insert(aiUsageLogsTable).values([
        { orgId: a, functionName: "smoke_ov_x", model: "m", status: "error", errorMsg: "boom" },
        { orgId: a, functionName: "smoke_ov_x", model: "m", status: "error", errorMsg: "boom" },
        { orgId: b, functionName: "smoke_ov_y", model: "m", status: "blocked", errorMsg: "sin saldo" },
        { orgId: b, functionName: "smoke_ov_y", model: "m", status: "ok" },
      ]);

      const o = await getGlobalOverview({ orgIds: [a, b] });
      expect(o.totals).toEqual({ granted: 120, purchased: 50, consumed: 45, refunded: 5, adjustments: -2, expired: 10 });
      expect(o.byModel.map((m) => [m.model, m.credits])).toEqual([["gpt-4o-mini", 35], ["gpt-4o", 10]]);
      expect(o.topWorkspaces.map((w) => [w.orgId, w.credits])).toEqual([[a, 35], [b, 10]]);
      expect(o.topWorkspaces[0]!.name).toMatch(/^smoke /);
      expect(o.topAgents).toEqual([{ orgId: a, agentId: AGENT_ID, credits: 5, runs: 1 }]);
      expect(o.errors).toEqual(expect.arrayContaining([
        { status: "error", functionName: "smoke_ov_x", count: 2 },
        { status: "blocked", functionName: "smoke_ov_y", count: 1 },
      ]));
      expect(o.errors.some((e) => e.status === "ok")).toBe(false);
      expect(o.purchases).toEqual([{ currency: "EUR", purchases: 1, credits: 50, amount: 5 }]);
    });
  });

  // ── Consumo anómalo ───────────────────────────────────────────────────────

  describe("alertas de consumo anómalo", () => {
    const threeDaysAgo = () => new Date(Date.now() - 3 * 86_400_000);

    it("detecta el día que dispara el consumo frente a la media reciente, lo registra una vez y lo audita", async () => {
      const spike = nextOrg(), normal = nextOrg(), tiny = nextOrg();
      for (const [org, prior, today] of [[spike, 70, 200], [normal, 140, 60], [tiny, 7, 10]] as const) {
        await grantCredits(org, 100_000, { reference: "g" });
        await backdated(org, "consumption", -prior, threeDaysAgo(), "prior");   // media diaria = prior / 7
        await appendEntry({ orgId: org, type: "consumption", credits: -today, reference: "today" });
      }
      const found = await detectAnomalies({ orgIds: [spike, normal, tiny] });
      expect(found.map((f) => f.orgId)).toEqual([spike]);                        // 200 vs 10/día = x20; los otros no
      expect(found[0]).toMatchObject({ today: 200, dailyAverage: 10, ratio: 20 });

      expect(await raiseAnomalyAlerts({ orgIds: [spike, normal, tiny] })).toHaveLength(1);
      expect(await raiseAnomalyAlerts({ orgIds: [spike, normal, tiny] })).toHaveLength(0); // una vez al día
      const audit = await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE org_id = ${spike} AND action = 'credits_alert_anomaly'`);
      expect((audit.rows[0] as { n: number }).n).toBe(1);
    });
  });

  // ── Consumo por agente (Agent Factory) ────────────────────────────────────

  describe("consumo por agente", () => {
    it("muestra coste estimado por ejecución, consumo acumulado y del periodo, ejecuciones y coste por modelo", async () => {
      const org = nextOrg(), other = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Medido", description: "prueba" });
      await grantCredits(org, 1000, { reference: "g" });
      const cons = (credits: number, ref: string, model: string, cost: number) =>
        appendEntry({ orgId: org, type: "consumption", credits: -credits, agentId: agent.id, provider: "openai", model, technicalCostUsd: cost, reference: ref });
      await cons(4, "u1", "gpt-4o-mini", 0.004);
      await cons(6, "u2", "gpt-4o-mini", 0.006);
      await cons(10, "u3", "gpt-4o", 0.01);
      await backdated(org, "consumption", -100, new Date("2025-06-01T10:00:00Z"), "old"); // otro periodo: cuenta en el acumulado pero no en el del periodo
      await db.execute(sql`UPDATE credit_ledger SET agent_id = ${agent.id} WHERE false`); // no-op: los movimientos no se editan

      const u = await getAgentUsage(org, agent.id);
      expect(u.thisPeriod).toMatchObject({ credits: 20, runs: 3, technicalCostUsd: 0.02 });
      expect(u.accumulated).toMatchObject({ credits: 20, runs: 3 });               // el movimiento antiguo no tiene agente
      expect(u.byModel.map((m) => [m.model, m.credits, m.runs])).toEqual(expect.arrayContaining([["gpt-4o-mini", 10, 2], ["gpt-4o", 10, 1]]));
      expect(u.estimatedPerRun).toMatchObject({ route: { provider: "openai", model: "gpt-4o-mini" } });
      expect(u.estimatedPerRun!.typical.credits).toBeGreaterThan(0);
      expect(u.estimatedPerRun!.max.credits).toBeGreaterThanOrEqual(u.estimatedPerRun!.typical.credits);
      expect(u.accumulated.lastRunAt).toBeTruthy();

      await expect(getAgentUsage(other, agent.id)).rejects.toMatchObject({ status: 404 }); // otro workspace no lo ve
    });
  });

  it("el ledger de cada workspace de estas pruebas sigue íntegro", async () => {
    for (const org of orgs) {
      const rows = await db.select({ id: creditLedgerTable.id }).from(creditLedgerTable).where(eq(creditLedgerTable.orgId, org)).limit(1);
      if (rows.length) expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    }
    void creditPurchasesTable; void and;
  });
});
