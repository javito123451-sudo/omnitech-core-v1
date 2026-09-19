// Configuración comercial OFICIAL v1 de OmniCredits, contra Postgres real:
//   planes (Starter / Professional / Business / Enterprise), límites diarios, rollover por %,
//   catálogo de packs extra con paymentReference como clave de idempotencia, prioridad de
//   consumo por origen (incluidos → rollover → extra) con trazabilidad en el ledger,
//   presupuestos por agente (AGENT_CREDIT_LIMIT_REACHED), datos para mostrar al cliente y
//   vista global de Super Admin.
//
// Requiere ci-test con las migraciones 0004-0008. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, aiAgentsTable, aiUsageLogsTable, creditAccountsTable, creditPacksTable, creditPlansTable, organizationsTable } from "@workspace/db";
import {
  allocateDebit, appendEntry, getBalance, getBalances, grantCredits, listLedger, reserveCredits, settleCredits,
  verifyLedgerIntegrity, AgentCreditLimitReachedError, CreditLimitReachedError, CreditError,
} from "../creditService";
import { getPlanConfig, rolloverCarry, upsertPlanConfig } from "../planService";
import { renewSubscription } from "../subscriptionService";
import { recordPurchase } from "../purchaseService";
import { listPacks, purchasePack, upsertPack } from "../packService";
import { getDashboard, getGlobalOverview } from "../reporting";
import { stripTechnical } from "../customerView";
import { createAgent, updateAgentMeta } from "../../agents/agentService";
import { toApiError } from "../../ai-gateway/apiErrors";
import { createTempOrgs, deleteTempOrgs, expectPgError } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const PLANS: string[] = [];
const PACKS: string[] = [];
let orgs: number[] = [];
let n = 0;
const nextOrg = () => orgs[n++]!;
const setPlan = (orgId: number, plan: string) => db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgId));
const newPlan = (label: string) => { const p = `smoke-v1-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; PLANS.push(p); return p; };
const JAN = new Date("2026-01-15T10:00:00Z");
const FEB = new Date("2026-02-10T10:00:00Z");
const MAR = new Date("2026-03-10T10:00:00Z");

const consume = (orgId: number, credits: number, ref: string, extra: Record<string, unknown> = {}) =>
  appendEntry({ orgId, type: "consumption", credits: -credits, reference: ref, ...extra });

async function rawConsumption(orgId: number, credits: number, breakdown: unknown, ref: string) {
  const b = await getBalances(orgId);
  const [acc] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgId));
  return db.execute(sql`INSERT INTO credit_ledger (org_id, account_id, entry_type, credits, balance_before, balance_after, breakdown, reference, source)
    VALUES (${orgId}, ${acc!.id}, 'consumption', ${(-credits).toFixed(4)}, ${b.balance.toFixed(4)}, ${(b.balance - credits).toFixed(4)}, ${JSON.stringify(breakdown)}::jsonb, ${ref}, 'test')`);
}

describe.skipIf(!hasRealDb)("OmniCredits v1 — configuración comercial oficial", () => {
  beforeAll(async () => { orgs = await createTempOrgs(60, "commercial-v1"); });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(like(aiUsageLogsTable.functionName, "smoke_v1_%"));
    await db.delete(creditPlansTable).where(inArray(creditPlansTable.plan, PLANS));
    if (PACKS.length) await db.delete(creditPacksTable).where(inArray(creditPacksTable.code, PACKS));
    await deleteTempOrgs(orgs);
  });

  // ── Planes oficiales ──────────────────────────────────────────────────────

  describe("planes oficiales", () => {
    it("Starter, Professional y Business quedan configurados con los valores acordados", async () => {
      const common = { currency: "EUR", priceCustom: false, alertThresholds: [70, 90, 100], blockAtLimit: true, active: true };
      expect(await getPlanConfig("starter")).toMatchObject({ ...common, displayName: "Starter", priceAmount: 149, includedCredits: 50_000, dailyLimit: 5_000, rolloverPct: 0, rollover: false });
      expect(await getPlanConfig("professional")).toMatchObject({ ...common, displayName: "Professional", priceAmount: 349, includedCredits: 150_000, dailyLimit: 15_000, rolloverPct: 25, rollover: true });
      expect(await getPlanConfig("business")).toMatchObject({ ...common, displayName: "Business", priceAmount: 699, includedCredits: 400_000, dailyLimit: 40_000, rolloverPct: 50, rollover: true });
    });

    it("Enterprise es a medida: precio custom y todo lo demás configurable (sin valores inventados)", async () => {
      expect(await getPlanConfig("enterprise")).toMatchObject({
        displayName: "Enterprise", priceCustom: true, priceAmount: null, includedCredits: null, dailyLimit: null, monthlyLimit: null,
        rolloverPct: null, agentLimit: null, workspaceLimit: null, active: true,
      });
      // Se configura por cliente/plan sin tocar código: créditos, límite diario, rollover, agentes y workspaces.
      const plan = newPlan("enterprise");
      const saved = await upsertPlanConfig(plan, {
        displayName: "Enterprise ACME", priceCustom: true, includedCredits: 1_000_000, dailyLimit: 100_000, rolloverPct: 75, agentLimit: 40, workspaceLimit: 5,
      }, "admin");
      expect(saved.current).toMatchObject({ includedCredits: 1_000_000, dailyLimit: 100_000, rolloverPct: 75, agentLimit: 40, workspaceLimit: 5, priceCustom: true });
    });

    it("valida los campos comerciales nuevos", async () => {
      const plan = newPlan("valid");
      await expect(upsertPlanConfig(plan, { rolloverPct: 101 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { rolloverPct: -1 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { priceAmount: -5 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { currency: "euro" }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { agentLimit: 1.5 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPlanConfig(plan, { workspaceLimit: -1 }, "u")).rejects.toThrow(CreditError);
    });

    it("créditos incluidos: cada plan concede los suyos y solo una vez por ciclo", async () => {
      for (const [plan, credits] of [["starter", 50_000], ["professional", 150_000], ["business", 400_000]] as const) {
        const org = nextOrg();
        await setPlan(org, plan);
        expect(await renewSubscription(org, { at: JAN })).toMatchObject({ status: "granted", granted: credits, plan });
        expect(await renewSubscription(org, { at: JAN })).toMatchObject({ status: "already_granted", granted: 0 });
        expect(await getBalances(org)).toMatchObject({ balance: credits, included: credits, rollover: 0, extra: 0 });
      }
      const ent = nextOrg();
      await setPlan(ent, "enterprise");
      expect(await renewSubscription(ent, { at: JAN })).toMatchObject({ status: "not_configured", granted: 0 }); // sin acordar, no concede
    });
  });

  // ── Límites diarios y mensuales ───────────────────────────────────────────

  describe("límites", () => {
    it("Starter: el límite diario (5.000) frena la reserva que lo supera y cuenta lo ya reservado", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");
      await grantCredits(org, 100_000, { reference: "lim-g" });
      await expect(reserveCredits({ orgId: org, credits: 5_001, reference: "lim-1" })).rejects.toMatchObject({ code: "CREDIT_LIMIT_REACHED", scope: "workspace_daily", limit: 5_000 });
      await reserveCredits({ orgId: org, credits: 3_000, reference: "lim-2" });
      await reserveCredits({ orgId: org, credits: 2_000, reference: "lim-3" });
      await expect(reserveCredits({ orgId: org, credits: 1, reference: "lim-4" })).rejects.toBeInstanceOf(CreditLimitReachedError);
      expect(await getBalance(org)).toBe(100_000); // bloquear no cobra nada
    });

    it("Professional (15.000) y Business (40.000) tienen su propio límite diario", async () => {
      const pro = nextOrg(), biz = nextOrg();
      await setPlan(pro, "professional"); await setPlan(biz, "business");
      await grantCredits(pro, 200_000, { reference: "lim-pro" });
      await grantCredits(biz, 500_000, { reference: "lim-biz" });
      await expect(reserveCredits({ orgId: pro, credits: 15_001, reference: "p1" })).rejects.toMatchObject({ scope: "workspace_daily", limit: 15_000 });
      await expect(reserveCredits({ orgId: pro, credits: 15_000, reference: "p2" })).resolves.toBeTruthy();
      await expect(reserveCredits({ orgId: biz, credits: 40_001, reference: "b1" })).rejects.toMatchObject({ scope: "workspace_daily", limit: 40_000 });
      await expect(reserveCredits({ orgId: biz, credits: 40_000, reference: "b2" })).resolves.toBeTruthy();
    });

    it("el límite diario cuenta el consumo real ya liquidado, no solo las reservas", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");
      await grantCredits(org, 100_000, { reference: "dl-g" });
      await reserveCredits({ orgId: org, credits: 4_000, reference: "dl-1" });
      await settleCredits({ orgId: org, reference: "dl-1", credits: 4_000 });
      await expect(reserveCredits({ orgId: org, credits: 1_001, reference: "dl-2" })).rejects.toMatchObject({ scope: "workspace_daily", used: 4_000 });
      await expect(reserveCredits({ orgId: org, credits: 1_000, reference: "dl-3" })).resolves.toBeTruthy();
    });

    it("límite mensual: bloquea al superarlo (blockAtLimit) y deja pasar si no bloquea", async () => {
      const blocking = nextOrg(), soft = nextOrg();
      const p1 = newPlan("monthly"), p2 = newPlan("monthly-soft");
      await upsertPlanConfig(p1, { monthlyLimit: 1_000, blockAtLimit: true }, "u");
      await upsertPlanConfig(p2, { monthlyLimit: 1_000, blockAtLimit: false }, "u");
      await setPlan(blocking, p1); await setPlan(soft, p2);
      for (const org of [blocking, soft]) await grantCredits(org, 5_000, { reference: "ml-g" });
      await reserveCredits({ orgId: blocking, credits: 600, reference: "m1" });
      await settleCredits({ orgId: blocking, reference: "m1", credits: 600 });
      await expect(reserveCredits({ orgId: blocking, credits: 500, reference: "m2" })).rejects.toMatchObject({ scope: "workspace_monthly", limit: 1_000 });
      await reserveCredits({ orgId: soft, credits: 600, reference: "m1" });
      await settleCredits({ orgId: soft, reference: "m1", credits: 600 });
      await expect(reserveCredits({ orgId: soft, credits: 500, reference: "m2" })).resolves.toBeTruthy();
    });

    it("el límite de un workspace no afecta a otro (aislamiento)", async () => {
      const a = nextOrg(), b = nextOrg();
      await setPlan(a, "starter"); await setPlan(b, "starter");
      await grantCredits(a, 100_000, { reference: "iso-a" }); await grantCredits(b, 100_000, { reference: "iso-b" });
      await reserveCredits({ orgId: a, credits: 5_000, reference: "iso-1" });
      await expect(reserveCredits({ orgId: a, credits: 1, reference: "iso-2" })).rejects.toBeInstanceOf(CreditLimitReachedError);
      await expect(reserveCredits({ orgId: b, credits: 5_000, reference: "iso-1" })).resolves.toBeTruthy(); // misma referencia y plan, otra org
    });
  });

  // ── Rollover ──────────────────────────────────────────────────────────────

  describe("rollover", () => {
    it("rolloverCarry: porcentaje del sobrante, con tope opcional y sin acumular por encima", () => {
      expect(rolloverCarry({ rollover: false, rolloverPct: 0, rolloverCap: null }, 1000)).toBe(0);
      expect(rolloverCarry({ rollover: true, rolloverPct: 25, rolloverCap: null }, 1000)).toBe(250);
      expect(rolloverCarry({ rollover: true, rolloverPct: 50, rolloverCap: null }, 1000)).toBe(500);
      expect(rolloverCarry({ rollover: true, rolloverPct: 50, rolloverCap: 100 }, 1000)).toBe(100);
      expect(rolloverCarry({ rollover: true, rolloverPct: null, rolloverCap: null }, 1000)).toBe(1000); // booleano heredado: todo
      expect(rolloverCarry({ rollover: false, rolloverPct: null, rolloverCap: null }, 1000)).toBe(0);
      expect(rolloverCarry({ rollover: true, rolloverPct: 25, rolloverCap: null }, 0)).toBe(0);
    });

    it("Starter: 0 % — lo que sobra caduca del todo", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");
      await renewSubscription(org, { at: JAN });
      await consume(org, 10_000, "st-c");
      const r = await renewSubscription(org, { at: FEB });
      expect(r).toMatchObject({ status: "granted", granted: 50_000, carried: 0, expired: 40_000 });
      expect(await getBalances(org)).toMatchObject({ balance: 50_000, included: 50_000, rollover: 0 });
    });

    it("Professional: el 25 % del sobrante pasa como rollover y el resto caduca", async () => {
      const org = nextOrg();
      await setPlan(org, "professional");
      await renewSubscription(org, { at: JAN });
      await consume(org, 50_000, "pr-c");                       // sobran 100.000
      const r = await renewSubscription(org, { at: FEB });
      expect(r).toMatchObject({ granted: 150_000, carried: 25_000, expired: 75_000 });
      expect(await getBalances(org)).toMatchObject({ balance: 175_000, included: 150_000, rollover: 25_000, extra: 0 });
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });

    it("Business: el 50 % del sobrante pasa como rollover", async () => {
      const org = nextOrg();
      await setPlan(org, "business");
      await renewSubscription(org, { at: JAN });
      await consume(org, 100_000, "bu-c");                      // sobran 300.000
      expect(await renewSubscription(org, { at: FEB })).toMatchObject({ carried: 150_000, expired: 150_000, granted: 400_000 });
      expect(await getBalances(org)).toMatchObject({ included: 400_000, rollover: 150_000 });
    });

    it("el rollover deja rastro completo en el ledger: caducidad del cubo incluido + alta de rollover con su origen", async () => {
      const org = nextOrg();
      await setPlan(org, "professional");
      await renewSubscription(org, { at: JAN });
      await consume(org, 50_000, "tr-c");
      await renewSubscription(org, { at: FEB });
      const ledger = (await listLedger(org)).reverse();
      expect(ledger.map((e) => [e.entryType, e.bucket ?? (e.breakdown ? "breakdown" : null), e.source])).toEqual([
        ["subscription", "included", "subscription"],   // ciclo enero
        ["consumption", "breakdown", "system"],         // consumo
        ["expiration", "breakdown", "subscription"],    // cierre: caduca lo incluido sobrante
        ["subscription", "rollover", "rollover"],       // rollover del 25 %
        ["subscription", "included", "subscription"],   // ciclo febrero
      ]);
      expect(ledger[2]!.breakdown).toEqual({ included: 100_000, rollover: 0, extra: 0 });
      expect(Number(ledger[3]!.credits)).toBe(25_000);
      expect(ledger[3]!.metadata).toMatchObject({ rolloverPct: 25, period: "2026-02" });
    });

    it("el rollover NO se acumula: al cierre siguiente caduca, y solo lo incluido sin consumir se arrastra de nuevo", async () => {
      const org = nextOrg();
      await setPlan(org, "professional");
      await renewSubscription(org, { at: JAN });
      await consume(org, 50_000, "nc-c");
      await renewSubscription(org, { at: FEB });                // rollover 25.000, incluidos 150.000
      const mar = await renewSubscription(org, { at: MAR });    // sin consumo en febrero
      expect(mar).toMatchObject({ carried: 37_500, granted: 150_000, expired: 25_000 + 112_500 }); // rollover viejo + 75 % de incluidos
      expect(await getBalances(org)).toMatchObject({ included: 150_000, rollover: 37_500 });
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });

    it("los créditos EXTRA no se tocan al cerrar el ciclo", async () => {
      const org = nextOrg();
      await setPlan(org, "starter");
      await renewSubscription(org, { at: JAN });
      await recordPurchase({ orgId: org, credits: 25_000, paymentReference: "extra-keep" });
      await renewSubscription(org, { at: FEB });
      expect(await getBalances(org)).toMatchObject({ included: 50_000, rollover: 0, extra: 25_000, balance: 75_000 });
    });
  });

  // ── Prioridad de consumo y trazabilidad ───────────────────────────────────

  describe("prioridad de consumo: incluidos → rollover → extra", () => {
    it("allocateDebit reparte por prioridad y solo el último cubo puede quedar en negativo", () => {
      expect(allocateDebit(50, { included: 100, rollover: 30, extra: 20 })).toEqual({ included: 50, rollover: 0, extra: 0 });
      expect(allocateDebit(120, { included: 100, rollover: 30, extra: 20 })).toEqual({ included: 100, rollover: 20, extra: 0 });
      expect(allocateDebit(140, { included: 100, rollover: 30, extra: 20 })).toEqual({ included: 100, rollover: 30, extra: 10 });
      expect(allocateDebit(160, { included: 100, rollover: 30, extra: 20 })).toEqual({ included: 100, rollover: 30, extra: 30 }); // desvío al último cubo
      expect(allocateDebit(10, { included: 0, rollover: 0, extra: 5 })).toEqual({ included: 0, rollover: 0, extra: 10 });
    });

    it("el consumo gasta primero lo incluido, luego el rollover y al final lo extra, y cada movimiento lo registra", async () => {
      const org = nextOrg();
      const plan = newPlan("prio");
      await upsertPlanConfig(plan, { includedCredits: 100, rollover: true }, "u");   // rollover 100 % (booleano heredado)
      await setPlan(org, plan);
      await renewSubscription(org, { at: JAN });
      await consume(org, 10, "pr-1");
      await renewSubscription(org, { at: FEB });                                      // incluidos 100 + rollover 90
      await recordPurchase({ orgId: org, credits: 50, paymentReference: "prio-buy" }); // extra 50
      expect(await getBalances(org)).toEqual({ balance: 240, included: 100, rollover: 90, extra: 50 });

      const a = await consume(org, 150, "pr-2");
      expect(a.entry.breakdown).toEqual({ included: 100, rollover: 50, extra: 0 });
      expect(await getBalances(org)).toEqual({ balance: 90, included: 0, rollover: 40, extra: 50 });

      const b = await consume(org, 60, "pr-3");
      expect(b.entry.breakdown).toEqual({ included: 0, rollover: 40, extra: 20 });
      expect(await getBalances(org)).toEqual({ balance: 30, included: 0, rollover: 0, extra: 30 });

      // trazabilidad: cada alta conserva su origen y el reparto suma el importe de cada consumo
      const ledger = await listLedger(org);
      for (const e of ledger.filter((x) => x.entryType === "consumption")) {
        const bd = e.breakdown as { included: number; rollover: number; extra: number };
        expect(bd.included + bd.rollover + bd.extra).toBeCloseTo(-Number(e.credits), 4);
      }
      expect(ledger.find((e) => e.entryType === "purchase")).toMatchObject({ bucket: "extra", source: "purchase" });
      expect(ledger.find((e) => e.source === "rollover")).toMatchObject({ bucket: "rollover" });
      const v = await verifyLedgerIntegrity(org);
      expect(v).toMatchObject({ ok: true, buckets: { included: 0, rollover: 0, extra: 30 } });
    });

    it("un GRANT, un REFUND y un ajuste positivo entran como extra (el último en consumirse)", async () => {
      const org = nextOrg();
      await grantCredits(org, 10, { reference: "gx-1" });
      await appendEntry({ orgId: org, type: "refund", credits: 5, reference: "gx-2", metadata: { reason: "x" } });
      await appendEntry({ orgId: org, type: "adjustment", credits: 3, reference: "gx-3", metadata: { reason: "x" } });
      expect(await getBalances(org)).toMatchObject({ balance: 18, included: 0, rollover: 0, extra: 18 });
      expect((await listLedger(org)).every((e) => e.bucket === "extra")).toBe(true);
    });

    it("consumo simultáneo repartido entre los tres cubos: ninguno queda en negativo y la cadena se mantiene", async () => {
      const org = nextOrg();
      await appendEntry({ orgId: org, type: "subscription", credits: 100, bucket: "included", reference: "cc-1", source: "subscription" });
      await appendEntry({ orgId: org, type: "subscription", credits: 50, bucket: "rollover", reference: "cc-2", source: "rollover" });
      await grantCredits(org, 50, { reference: "cc-3" });
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => consume(org, 10, `cc-c${i}`)));
      expect(results.every((r) => !r.duplicate)).toBe(true);
      expect(await getBalances(org)).toEqual({ balance: 0, included: 0, rollover: 0, extra: 0 });
      const v = await verifyLedgerIntegrity(org);
      expect(v.ok).toBe(true);
      expect(v.issues).toEqual([]);
    });

    it("Postgres protege los cubos: incluidos y rollover no pueden quedar en negativo ni repartirse mal", async () => {
      const org = nextOrg();
      await appendEntry({ orgId: org, type: "subscription", credits: 100, bucket: "included", reference: "db-1", source: "subscription" });
      await expectPgError(rawConsumption(org, 150, { included: 150 }, "db-x1"), /incluidos no alcanzan/);
      await expectPgError(rawConsumption(org, 10, { rollover: 10 }, "db-x2"), /rollover no alcanza/);
      await expectPgError(rawConsumption(org, 10, { included: 4, extra: 4 }, "db-x3"), /no suma el importe/);
      await expectPgError(rawConsumption(org, 10, { included: -5, extra: 15 }, "db-x4"), /negativos/);
      await expectPgError(rawConsumption(org, 10, { otro: 10 }, "db-x5"), /solo admite included, rollover y extra/);
      await expectPgError(db.execute(sql`UPDATE credit_accounts SET included_balance = 999999, balance = 999999 WHERE org_id = ${org}`), /solo puede cambiar mediante un movimiento/);
      await expectPgError(db.execute(sql`UPDATE credit_accounts SET extra_balance = 5 WHERE org_id = ${org}`), /solo puede cambiar mediante un movimiento/);
      expect(await getBalances(org)).toEqual({ balance: 100, included: 100, rollover: 0, extra: 0 });
    });

    it("el desvío (consumo real por encima de lo disponible) se apunta al cubo extra y el resto sigue cuadrando", async () => {
      const org = nextOrg();
      await appendEntry({ orgId: org, type: "subscription", credits: 100, bucket: "included", reference: "ov-1", source: "subscription" });
      await reserveCredits({ orgId: org, credits: 100, reference: "ov-r" });
      const r = await settleCredits({ orgId: org, reference: "ov-r", credits: 130 });
      expect(r.overrun).toBe(true);
      expect(r.entry!.breakdown).toEqual({ included: 100, rollover: 0, extra: 30 });
      expect(await getBalances(org)).toEqual({ balance: -30, included: 0, rollover: 0, extra: -30 });
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });
  });

  // ── OmniCredits extra: catálogo y compras ─────────────────────────────────

  describe("packs de OmniCredits extra", () => {
    it("el catálogo oficial trae los cuatro packs configurables", async () => {
      const packs = await listPacks({ activeOnly: true });
      const official = packs.filter((p) => ["pack_25k", "pack_100k", "pack_250k", "pack_1m"].includes(p.code));
      expect(official.map((p) => [p.credits, p.priceAmount, p.currency])).toEqual([
        [25_000, 29, "EUR"], [100_000, 89, "EUR"], [250_000, 199, "EUR"], [1_000_000, 599, "EUR"],
      ]);
    });

    it("comprar un pack: créditos y precio del catálogo, entran como extra y quedan enlazados al pago", async () => {
      const org = nextOrg();
      const { purchase, entry, duplicate } = await purchasePack({ orgId: org, packCode: "pack_100k", paymentReference: "pay-100k", userClerkId: "admin" });
      expect(duplicate).toBe(false);
      expect(Number(purchase.credits)).toBe(100_000);
      expect(Number(purchase.priceAmount)).toBe(89);
      expect(purchase).toMatchObject({ currency: "EUR", paymentReference: "pay-100k", status: "completed" });
      expect(purchase.metadata).toMatchObject({ packCode: "pack_100k" });
      expect(entry).toMatchObject({ entryType: "purchase", bucket: "extra", reference: `purchase:${purchase.id}` });
      expect(await getBalances(org)).toMatchObject({ balance: 100_000, extra: 100_000, included: 0 });
    });

    it("paymentReference es la clave de idempotencia: obligatoria, y un doble envío no duplica créditos", async () => {
      const org = nextOrg();
      await expect(purchasePack({ orgId: org, packCode: "pack_25k", paymentReference: "" })).rejects.toThrow(/paymentReference/);
      await expect(purchasePack({ orgId: org, packCode: "pack_25k", paymentReference: "   " })).rejects.toThrow(CreditError);
      await expect(recordPurchase({ orgId: org, credits: 10 })).rejects.toThrow(/paymentReference/);
      expect(await listLedger(org)).toEqual([]);

      const a = await purchasePack({ orgId: org, packCode: "pack_25k", paymentReference: "pay-dup" });
      const b = await purchasePack({ orgId: org, packCode: "pack_25k", paymentReference: "pay-dup" });
      expect(a.duplicate).toBe(false);
      expect(b).toMatchObject({ duplicate: true, purchase: { id: a.purchase.id } });
      expect(await getBalance(org)).toBe(25_000);
      expect(await listLedger(org)).toHaveLength(1);
    });

    it("cinco envíos SIMULTÁNEOS de la misma compra generan una sola compra y un solo movimiento", async () => {
      const org = nextOrg();
      const results = await Promise.all(Array.from({ length: 5 }, () => purchasePack({ orgId: org, packCode: "pack_25k", paymentReference: "pay-race" }).then((r) => r.duplicate, (e) => `err:${String(e?.message ?? e).slice(0, 60)}`)));
      expect(results.filter((r) => r === false)).toHaveLength(1);
      expect(results.filter((r) => r === true)).toHaveLength(4);
      expect(await getBalance(org)).toBe(25_000);
      expect(await listLedger(org)).toHaveLength(1);
    });

    it("la misma referencia de pago en otra organización es otra compra (aislamiento)", async () => {
      const a = nextOrg(), b = nextOrg();
      expect((await purchasePack({ orgId: a, packCode: "pack_25k", paymentReference: "pay-shared" })).duplicate).toBe(false);
      expect((await purchasePack({ orgId: b, packCode: "pack_100k", paymentReference: "pay-shared" })).duplicate).toBe(false);
      expect(await getBalance(a)).toBe(25_000);
      expect(await getBalance(b)).toBe(100_000);
    });

    it("un pack inexistente o desactivado no se puede comprar", async () => {
      const org = nextOrg();
      await expect(purchasePack({ orgId: org, packCode: "no_existe", paymentReference: "x1" })).rejects.toThrow(/no existe/);
      const code = "smoke_off";
      PACKS.push(code);
      await upsertPack(code, { credits: 10, priceAmount: 1, active: false }, "admin");
      await expect(purchasePack({ orgId: org, packCode: code, paymentReference: "x2" })).rejects.toThrow(/no está disponible/);
      expect(await listLedger(org)).toEqual([]);
    });

    it("el catálogo es configurable y cambiar un precio no reescribe las compras ya hechas", async () => {
      const org = nextOrg();
      const code = "smoke_cfg";
      PACKS.push(code);
      const created = await upsertPack(code, { credits: 1_000, priceAmount: 10, sortOrder: 99 }, "admin");
      expect(created.previous).toBeNull();
      const before = await purchasePack({ orgId: org, packCode: code, paymentReference: "cfg-1" });
      const changed = await upsertPack(code, { priceAmount: 12, credits: 1_200 }, "admin2");
      expect(changed.previous).toMatchObject({ priceAmount: 10, credits: 1_000 });
      expect(changed.current).toMatchObject({ priceAmount: 12, credits: 1_200 });
      const after = await purchasePack({ orgId: org, packCode: code, paymentReference: "cfg-2" });
      expect(Number(before.purchase.credits)).toBe(1_000);   // la compra antigua conserva lo que se pagó
      expect(Number(before.purchase.priceAmount)).toBe(10);
      expect(Number(after.purchase.credits)).toBe(1_200);
      expect(await getBalance(org)).toBe(2_200);
    });

    it("valida el catálogo", async () => {
      await expect(upsertPack("Mal Codigo", { credits: 1, priceAmount: 1 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPack("smoke_bad", { credits: 0, priceAmount: 1 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPack("smoke_bad", { credits: 1, priceAmount: -1 }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPack("smoke_bad", { credits: 1, priceAmount: 1, currency: "eur" }, "u")).rejects.toThrow(CreditError);
      await expect(upsertPack("smoke_bad", { credits: 1 }, "u")).rejects.toThrow(/requiere credits y priceAmount/);
    });
  });

  // ── Presupuestos por agente ───────────────────────────────────────────────

  describe("presupuestos por agente (AGENT_CREDIT_LIMIT_REACHED)", () => {
    it("los presupuestos se guardan en el agente: mensual, diario y por ejecución", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Con presupuesto" });
      const updated = await updateAgentMeta(org, agent.id, { monthlyCreditLimit: 50_000, dailyCreditLimit: 5_000, perExecutionCreditLimit: 500 });
      expect(updated).toMatchObject({ monthlyCreditLimit: 50_000, dailyCreditLimit: 5_000, perExecutionCreditLimit: 500 });
      const cleared = await updateAgentMeta(org, agent.id, { dailyCreditLimit: null });
      expect(cleared).toMatchObject({ monthlyCreditLimit: 50_000, dailyCreditLimit: null, perExecutionCreditLimit: 500 });
    });

    it("presupuesto mensual del agente", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Mensual" });
      await grantCredits(org, 1_000, { reference: "am-g" });
      await reserveCredits({ orgId: org, credits: 60, reference: "am-1", agentId: agent.id, agentLimits: { monthly: 100 } });
      await settleCredits({ orgId: org, reference: "am-1", credits: 60, agentId: agent.id });
      const err = await reserveCredits({ orgId: org, credits: 50, reference: "am-2", agentId: agent.id, agentLimits: { monthly: 100 } }).catch((e) => e);
      expect(err).toBeInstanceOf(AgentCreditLimitReachedError);
      expect(err).toMatchObject({ code: "AGENT_CREDIT_LIMIT_REACHED", scope: "agent_monthly", used: 60, limit: 100, requested: 50 });
      await expect(reserveCredits({ orgId: org, credits: 40, reference: "am-3", agentId: agent.id, agentLimits: { monthly: 100 } })).resolves.toBeTruthy();
    });

    it("presupuesto diario del agente (cuenta lo consumido y lo reservado)", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Diario" });
      await grantCredits(org, 1_000, { reference: "ad-g" });
      await reserveCredits({ orgId: org, credits: 8, reference: "ad-1", agentId: agent.id, agentLimits: { daily: 10 } });
      await settleCredits({ orgId: org, reference: "ad-1", credits: 8, agentId: agent.id });
      await expect(reserveCredits({ orgId: org, credits: 3, reference: "ad-2", agentId: agent.id, agentLimits: { daily: 10 } }))
        .rejects.toMatchObject({ code: "AGENT_CREDIT_LIMIT_REACHED", scope: "agent_daily", limit: 10 });
      await reserveCredits({ orgId: org, credits: 2, reference: "ad-3", agentId: agent.id, agentLimits: { daily: 10 } }); // reservado, sin liquidar
      await expect(reserveCredits({ orgId: org, credits: 1, reference: "ad-4", agentId: agent.id, agentLimits: { daily: 10 } })).rejects.toMatchObject({ scope: "agent_daily" });
    });

    it("presupuesto por ejecución: varias llamadas de una misma ejecución no pueden pasarse", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Por ejecución" });
      await grantCredits(org, 1_000, { reference: "ae-g" });
      const lim = (executionUsed: number) => ({ perExecution: 10, executionUsed });
      await expect(reserveCredits({ orgId: org, credits: 4, reference: "ae-1", agentId: agent.id, agentLimits: lim(0) })).resolves.toBeTruthy();
      await expect(reserveCredits({ orgId: org, credits: 4, reference: "ae-2", agentId: agent.id, agentLimits: lim(4) })).resolves.toBeTruthy();
      await expect(reserveCredits({ orgId: org, credits: 4, reference: "ae-3", agentId: agent.id, agentLimits: lim(8) }))
        .rejects.toMatchObject({ code: "AGENT_CREDIT_LIMIT_REACHED", scope: "agent_execution", used: 8, limit: 10, requested: 4 });
      // una ejecución nueva empieza de cero
      await expect(reserveCredits({ orgId: org, credits: 4, reference: "ae-4", agentId: agent.id, agentLimits: lim(0) })).resolves.toBeTruthy();
    });

    it("el error llega estructurado (402 AGENT_CREDIT_LIMIT_REACHED), distinto del límite del workspace, y no cobra nada", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Estructurado" });
      await grantCredits(org, 100, { reference: "as-g" });
      const err = await reserveCredits({ orgId: org, credits: 20, reference: "as-1", agentId: agent.id, agentLimits: { perExecution: 10, executionUsed: 0 } }).catch((e) => e);
      expect(toApiError(err)).toMatchObject({ http: 402, body: { status: "AGENT_CREDIT_LIMIT_REACHED", scope: "agent_execution", limit: 10, requested: 20 } });
      expect(toApiError(new CreditLimitReachedError("workspace_daily", 1, 2, 3))!.body.status).toBe("CREDIT_LIMIT_REACHED");
      expect(await getBalance(org)).toBe(100);
      expect(await listLedger(org)).toHaveLength(1); // solo el grant
    });

    it("el presupuesto de un agente no afecta a otro agente ni a otra organización", async () => {
      const a = nextOrg(), b = nextOrg();
      const { agent: a1 } = await createAgent(a, "u", { name: "A1" });
      const { agent: a2 } = await createAgent(a, "u", { name: "A2" });
      const { agent: b1 } = await createAgent(b, "u", { name: "B1" });
      await grantCredits(a, 1_000, { reference: "iso-ga" }); await grantCredits(b, 1_000, { reference: "iso-gb" });
      await reserveCredits({ orgId: a, credits: 10, reference: "i1", agentId: a1.id, agentLimits: { monthly: 10 } });
      await settleCredits({ orgId: a, reference: "i1", credits: 10, agentId: a1.id });
      await expect(reserveCredits({ orgId: a, credits: 1, reference: "i2", agentId: a1.id, agentLimits: { monthly: 10 } })).rejects.toMatchObject({ code: "AGENT_CREDIT_LIMIT_REACHED" });
      await expect(reserveCredits({ orgId: a, credits: 10, reference: "i3", agentId: a2.id, agentLimits: { monthly: 10 } })).resolves.toBeTruthy();
      await expect(reserveCredits({ orgId: b, credits: 10, reference: "i1", agentId: b1.id, agentLimits: { monthly: 10 } })).resolves.toBeTruthy();
      void aiAgentsTable;
    });

    it("sin presupuesto configurado (NULL) no hay tope de agente", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Sin tope" });
      await grantCredits(org, 1_000, { reference: "an-g" });
      await expect(reserveCredits({ orgId: org, credits: 500, reference: "an-1", agentId: agent.id, agentLimits: { monthly: null, daily: null, perExecution: null, executionUsed: 999 } })).resolves.toBeTruthy();
    });
  });

  // ── Datos para mostrar al usuario ─────────────────────────────────────────

  describe("dashboard del cliente", () => {
    it("expone créditos usados/restantes, del plan, rollover, extra, % de uso, renovación y provisionales", async () => {
      const org = nextOrg();
      await setPlan(org, "professional");
      await renewSubscription(org, { at: JAN });
      await consume(org, 50_000, "d-c1");
      await renewSubscription(org, { at: FEB });                                    // rollover 25.000
      await recordPurchase({ orgId: org, credits: 25_000, paymentReference: "d-buy" });
      const { agent } = await createAgent(org, "u", { name: "Dash" });
      const meta = { priceSource: "legacy", provisional: true, functionName: `agent_${agent.id}`, usageKind: "agent_execution" };
      await consume(org, 1_000, "d-c2", { agentId: agent.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.25, metadata: meta });
      await consume(org, 500, "d-c3", { agentId: agent.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.125, metadata: { ...meta, provisional: false, priceSource: "db" } });

      const d = await getDashboard(org, new Date());
      // 150.000 - 50.000 = 100.000 sobrantes en enero: 25.000 pasan como rollover; luego -1.000 y -500 de lo incluido.
      expect(d).toMatchObject({
        monthlyCredits: 150_000, rolloverCredits: 25_000, extraCredits: 25_000, includedRemaining: 148_500, balance: 198_500,
        provisionalCredits: 1_000, pricing: { provisionalCredits: 1_000, provisionalRuns: 1, provisional: true },
      });
      expect(d.creditsUsed).toBe(d.used);
      expect(d.used).toBe(51_500);                              // todo se registró "ahora": 50.000 + 1.000 + 500
      expect(d.creditsRemaining).toBe(d.available);
      expect(d.creditsRemaining).toBe(d.balance - d.held);
      expect(d.usagePercentage).toBe(d.pctConsumed);
      expect(d.renewalDate).toEqual(d.period.renewsAt);
      expect(d.byAgent.find((r) => r.agentId === agent.id)).toMatchObject({ credits: 1_500, runs: 2 });
      expect(d.byModel.find((r) => r.model === "gpt-4o-mini")).toMatchObject({ credits: 1_500, runs: 2 });
      expect(d.byFeature.find((f) => f.feature === `agent_${agent.id}`)).toMatchObject({ credits: 1_500 });
      expect(d.byDay.length).toBeGreaterThan(0);
      expect(d.byDay.at(-1)).toMatchObject({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
      expect(d.usedByOrigin).toEqual({ included: 51_500, rollover: 0, extra: 0 });
    });

    it("al cliente no se le enseñan tokens ni costes en dinero; el modo técnico sí los ve", async () => {
      const org = nextOrg();
      const { agent } = await createAgent(org, "u", { name: "Sin USD" });
      await grantCredits(org, 5_000, { reference: "nu-g" });
      await consume(org, 100, "nu-c", { agentId: agent.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.025, metadata: { functionName: `agent_${agent.id}` } });
      const customer = JSON.stringify(await getDashboard(org));
      expect(customer).not.toMatch(/technicalCostUsd|costUsd|tokens/i);
      const technical = await getDashboard(org, new Date(), { technical: true });
      expect(technical.byModel[0]).toMatchObject({ technicalCostUsd: 0.025 });
      expect(technical.byAgent[0]).toMatchObject({ technicalCostUsd: 0.025 });
    });

    it("stripTechnical quita tokens y costes en dinero pero conserva el origen del precio y la marca provisional", () => {
      const raw = {
        estimate: { typicalCostUsd: 0.01, maxCostUsd: 0.02, typicalCredits: 40, maxCredits: 80, priceSource: "legacy", provisional: true },
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.001, credits: 4 },
        rows: [{ technicalCostUsd: 0.1, credits: 400 }], when: new Date("2026-01-01T00:00:00Z"),
      };
      const clean = stripTechnical(raw);
      expect(clean).toEqual({
        estimate: { typicalCredits: 40, maxCredits: 80, priceSource: "legacy", provisional: true },
        usage: { credits: 4 }, rows: [{ credits: 400 }], when: new Date("2026-01-01T00:00:00Z"),
      });
    });

    it("el dashboard de un workspace nunca incluye datos de otro", async () => {
      const a = nextOrg(), b = nextOrg();
      await grantCredits(a, 1_000, { reference: "dx-a" });
      await purchasePack({ orgId: a, packCode: "pack_25k", paymentReference: "dx-buy" });
      await consume(a, 100, "dx-c");
      const other = await getDashboard(b);
      expect(other).toMatchObject({ balance: 0, creditsUsed: 0, extraCredits: 0, rolloverCredits: 0, provisionalCredits: 0, byAgent: [], byModel: [], byFeature: [] });
      expect((await getDashboard(a)).extraCredits).toBe(25_900);
    });
  });

  // ── Super Admin ───────────────────────────────────────────────────────────

  describe("vista global de Super Admin", () => {
    it("muestra consumo por workspace, agente y modelo, concedido/consumido/extra, precio provisional y origen del consumo", async () => {
      const a = nextOrg(), b = nextOrg();
      const { agent } = await createAgent(a, "u", { name: "Global" });
      await setPlan(a, "starter");
      await renewSubscription(a, { at: JAN });
      await purchasePack({ orgId: a, packCode: "pack_25k", paymentReference: "ov-buy" });
      await grantCredits(b, 1_000, { reference: "ov-gb" });
      const m = (source: string, provisional: boolean) => ({ priceSource: source, provisional, functionName: "smoke_v1_x" });
      await consume(a, 2_000, "ov-1", { agentId: agent.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.5, metadata: m("legacy", true) });
      await consume(b, 300, "ov-2", { provider: "openai", model: "gpt-4o", technicalCostUsd: 0.075, metadata: m("db", false) });

      const o = await getGlobalOverview({ orgIds: [a, b] });
      expect(o.totals).toMatchObject({ granted: 50_000 + 1_000, purchased: 25_000, consumed: 2_300 });
      expect(o.byWorkspace.map((w) => [w.orgId, w.credits])).toEqual([[a, 2_000], [b, 300]]);
      expect(o.byAgent).toEqual([{ orgId: a, agentId: agent.id, credits: 2_000, runs: 1 }]);
      expect(o.byModel.map((r) => [r.model, r.credits])).toEqual([["gpt-4o-mini", 2_000], ["gpt-4o", 300]]);
      expect(o.pricing).toMatchObject({ provisionalCredits: 2_000, provisionalRuns: 1, provisional: true });
      expect(o.pricing.byPriceSource.map((r) => [r.priceSource, r.credits])).toEqual([["legacy", 2_000], ["db", 300]]);
      expect(o.consumedByOrigin).toEqual({ included: 2_000, rollover: 0, extra: 300 });   // a gasta lo incluido; b solo tiene extra
    });
  });

  it("todos los ledgers de estas pruebas siguen íntegros (cadena y cubos)", async () => {
    for (const org of orgs) {
      const [acc] = await db.select({ id: creditAccountsTable.id }).from(creditAccountsTable).where(eq(creditAccountsTable.orgId, org));
      if (acc) expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    }
  });
});
