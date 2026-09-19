// El ledger de OmniCredits contra Postgres real: saldo, idempotencia,
// aislamiento entre organizaciones y, sobre todo, inmutabilidad — el trigger de
// la migración 0005 debe rechazar cualquier UPDATE de un movimiento.
//
// Requiere una base desechable en DATABASE_URL (rama ci-test de Neon con las
// migraciones 0004 y 0005 aplicadas). Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, creditLedgerTable, aiAgentsTable } from "@workspace/db";
import {
  appendEntry, getBalance, getSummary, listLedger, getAgentMonthUsage, grantCredits, topUpCredits,
  adjustCredits, refundCredits, creditsPort, CreditError,
} from "../creditService";
import { createAgent } from "../../agents/agentService";
import { createTempOrgs, deleteTempOrgs, expectPgError } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
let orgA = 0, orgB = 0;


describe.skipIf(!hasRealDb)("OmniCredits — ledger", () => {
  beforeAll(async () => {
    [orgA, orgB] = await createTempOrgs(2, "credits");
  });
  afterAll(async () => { await deleteTempOrgs([orgA, orgB]); });

  it("los créditos incluidos, recargas y consumos mueven el saldo y dejan cadena de saldos", async () => {
    expect(await getBalance(orgA)).toBe(0);
    await grantCredits(orgA, 100, { reference: "smoke-grant-1" });
    await topUpCredits(orgA, 50, { reference: "smoke-topup-1" });
    const usage = await appendEntry({ orgId: orgA, type: "usage", credits: -12.5, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.0125, reference: "smoke-usage-1" });
    expect(usage.balance).toBe(137.5);
    expect(await getBalance(orgA)).toBe(137.5);

    const ledger = (await listLedger(orgA)).reverse();
    expect(ledger.map((e) => e.entryType)).toEqual(["grant", "topup", "usage"]);
    expect(ledger.map((e) => Number(e.balanceAfter))).toEqual([100, 150, 137.5]);
    expect(ledger.reduce((s, e) => s + Number(e.credits), 0)).toBe(137.5); // el ledger es la fuente de verdad
  });

  it("es idempotente por referencia: repetir no duplica el cobro", async () => {
    const again = await appendEntry({ orgId: orgA, type: "usage", credits: -12.5, reference: "smoke-usage-1" });
    expect(again.duplicate).toBe(true);
    expect(await getBalance(orgA)).toBe(137.5);
    expect((await listLedger(orgA)).filter((e) => e.reference === "smoke-usage-1")).toHaveLength(1);
  });

  it("valida signos, importes y motivos", async () => {
    await expect(appendEntry({ orgId: orgA, type: "usage", credits: 5 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "grant", credits: -5 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "topup", credits: 0 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "grant", credits: Number.NaN })).rejects.toThrow(CreditError);
    await expect(adjustCredits(orgA, -3, { reason: " " })).rejects.toThrow(/motivo/);
    await expect(refundCredits(orgA, 3, { reason: "" })).rejects.toThrow(/motivo/);
    expect(await getBalance(orgA)).toBe(137.5);
  });

  it("los ajustes y devoluciones son movimientos nuevos con motivo, no ediciones", async () => {
    await adjustCredits(orgA, -2.5, { reason: "corrección manual", userClerkId: "u" });
    await refundCredits(orgA, 10, { reason: "error de facturación", userClerkId: "u" });
    expect(await getBalance(orgA)).toBe(145);
    const last = (await listLedger(orgA, { limit: 2 })).map((e) => e.entryType).sort();
    expect(last).toEqual(["adjustment", "refund"]);
  });

  it("aísla las organizaciones", async () => {
    await grantCredits(orgB, 7, { reference: "smoke-b-1" });
    expect(await getBalance(orgB)).toBe(7);
    expect(await getBalance(orgA)).toBe(145);
    expect((await listLedger(orgA)).every((e) => e.orgId === orgA)).toBe(true);
    expect((await listLedger(orgB)).map((e) => e.reference)).toEqual(["smoke-b-1"]);
    // la misma referencia en otra org es otro movimiento, no un duplicado
    const same = await appendEntry({ orgId: orgB, type: "usage", credits: -1, reference: "smoke-usage-1" });
    expect(same.duplicate).toBe(false);
  });

  it("consumos concurrentes no pierden ni duplican saldo (bloqueo de fila)", async () => {
    const before = await getBalance(orgA);
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      appendEntry({ orgId: orgA, type: "usage", credits: -1, reference: `smoke-par-${i}` })));
    expect(await getBalance(orgA)).toBe(before - 8);
    const rows = (await listLedger(orgA, { limit: 8 })).map((e) => Number(e.balanceAfter));
    expect(new Set(rows).size).toBe(8); // cada movimiento vio un saldo distinto
  });

  it("el consumo real puede dejar el saldo bajo cero (el servicio ya se prestó)", async () => {
    const before = await getBalance(orgB);
    await creditsPort.recordUsage({ orgId: orgB, credits: before + 5, provider: "openai", model: "gpt-4o", technicalCostUsd: 1, reference: "smoke-overdraft" });
    expect(await getBalance(orgB)).toBe(-5);
  });

  it("INMUTABLE: Postgres rechaza cualquier UPDATE de un movimiento", async () => {
    const [entry] = await listLedger(orgA, { limit: 1 });
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET credits = '999' WHERE id = ${entry!.id}`), /inmutable/);
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET balance_after = '1' WHERE id = ${entry!.id}`), /inmutable/);
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET entry_type = 'grant' WHERE id = ${entry!.id}`), /inmutable/);
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET reference = 'otra' WHERE id = ${entry!.id}`), /inmutable/);
    const [after] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.id, entry!.id));
    expect(after).toEqual(entry);
  });

  it("INMUTABLE: tampoco se puede reasignar un movimiento a otro agente", async () => {
    const { agent: a1 } = await createAgent(orgA, "u", { name: "A1" });
    const { agent: a2 } = await createAgent(orgA, "u", { name: "A2" });
    const { entry } = await appendEntry({ orgId: orgA, type: "usage", credits: -1, agentId: a1.id, reference: "smoke-agent-attr" });
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET agent_id = ${a2.id} WHERE id = ${entry.id}`), /inmutable/);
  });

  it("borrar un agente solo deja su referencia a NULL en el histórico (los importes no se tocan)", async () => {
    const { agent } = await createAgent(orgA, "u", { name: "Efímero" });
    const { entry } = await appendEntry({ orgId: orgA, type: "usage", credits: -2, agentId: agent.id, reference: "smoke-fk-null" });
    await db.delete(aiAgentsTable).where(eq(aiAgentsTable.id, agent.id));
    const [row] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.id, entry.id));
    expect(row!.agentId).toBeNull();
    expect(row!.credits).toBe(entry.credits);
    expect(row!.balanceAfter).toBe(entry.balanceAfter);
  });

  it("resume el consumo del mes por agente y por modelo, y el uso mensual de un agente", async () => {
    const { agent } = await createAgent(orgB, "u", { name: "Resumen" });
    await grantCredits(orgB, 100, { reference: "smoke-sum-grant" });
    await appendEntry({ orgId: orgB, type: "usage", credits: -4, agentId: agent.id, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.004, reference: "smoke-sum-1" });
    await appendEntry({ orgId: orgB, type: "usage", credits: -6, agentId: agent.id, provider: "openai", model: "gpt-4o", technicalCostUsd: 0.006, reference: "smoke-sum-2" });

    expect(await getAgentMonthUsage(orgB, agent.id)).toBe(10);
    const s = await getSummary(orgB);
    expect(s.month.byAgent.find((x) => x.agentId === agent.id)).toMatchObject({ credits: 10 });
    expect(s.month.byModel.map((x) => x.model)).toEqual(expect.arrayContaining(["gpt-4o-mini", "gpt-4o"]));
    expect(await getAgentMonthUsage(orgA, agent.id)).toBe(0); // no se ve desde otra org
  });
});
