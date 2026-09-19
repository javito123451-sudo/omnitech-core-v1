// El ledger comercial de OmniCredits contra Postgres real. Lo importante no es
// solo que el código lo haga bien, sino que la BASE DE DATOS no deja hacerlo
// mal: un movimiento no se edita, el saldo solo cambia mediante un movimiento,
// y la cadena balance_before → balance_after es verificada por Postgres.
//
// Requiere una base desechable en DATABASE_URL (rama ci-test de Neon con las
// migraciones 0004, 0005 y 0006). Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, creditAccountsTable, creditLedgerTable, aiAgentsTable } from "@workspace/db";
import {
  appendEntry, getBalance, listLedger, getAgentMonthUsage, grantCredits, purchaseCredits, adjustCredits,
  refundCredits, expireCredits, verifyLedgerIntegrity, CreditError,
} from "../creditService";
import { createAgent } from "../../agents/agentService";
import { createTempOrgs, deleteTempOrgs, expectPgError } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
let orgA = 0, orgB = 0, orgC = 0;

describe.skipIf(!hasRealDb)("OmniCredits — ledger comercial", () => {
  beforeAll(async () => { [orgA, orgB, orgC] = await createTempOrgs(3, "ledger"); });
  afterAll(async () => { await deleteTempOrgs([orgA, orgB, orgC]); });

  it("los 7 tipos de movimiento mueven el saldo y dejan la cadena saldo anterior → saldo posterior", async () => {
    expect(await getBalance(orgA)).toBe(0);
    await grantCredits(orgA, 100, { reference: "t-grant" });
    await purchaseCredits(orgA, 50, { reference: "t-purchase" });
    await appendEntry({ orgId: orgA, type: "subscription", credits: 20, reference: "t-sub", source: "subscription" });
    await appendEntry({ orgId: orgA, type: "consumption", credits: -12.5, provider: "openai", model: "gpt-4o-mini", technicalCostUsd: 0.0125, reference: "t-cons" });
    await refundCredits(orgA, 5, { reference: "t-refund", reason: "consumo erróneo" });
    await adjustCredits(orgA, -2.5, { reference: "t-adj", reason: "corrección manual" });
    await expireCredits(orgA, 10, { reference: "t-exp", reason: "caducidad" });

    expect(await getBalance(orgA)).toBe(150); // 100+50+20-12.5+5-2.5-10
    const ledger = (await listLedger(orgA)).reverse();
    expect(ledger.map((e) => e.entryType)).toEqual(["grant", "purchase", "subscription", "consumption", "refund", "adjustment", "expiration"]);
    expect(ledger.map((e) => Number(e.balanceBefore))).toEqual([0, 100, 150, 170, 157.5, 162.5, 160]);
    expect(ledger.map((e) => Number(e.balanceAfter))).toEqual([100, 150, 170, 157.5, 162.5, 160, 150]);
    for (const e of ledger) expect(Number(e.balanceAfter)).toBe(Number(e.balanceBefore) + Number(e.credits));
    expect(ledger.reduce((s, e) => s + Number(e.credits), 0)).toBe(150); // el ledger es la fuente de verdad

    const integrity = await verifyLedgerIntegrity(orgA);
    expect(integrity).toMatchObject({ ok: true, issues: [], entries: 7, accountBalance: 150, ledgerBalance: 150 });
  });

  it("es idempotente por referencia: repetir no duplica el movimiento", async () => {
    const again = await appendEntry({ orgId: orgA, type: "consumption", credits: -12.5, reference: "t-cons" });
    expect(again.duplicate).toBe(true);
    expect(await getBalance(orgA)).toBe(150);
    expect((await listLedger(orgA)).filter((e) => e.reference === "t-cons")).toHaveLength(1);
  });

  it("valida signos, importes y motivos antes de tocar la base de datos", async () => {
    await expect(appendEntry({ orgId: orgA, type: "consumption", credits: 5 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "expiration", credits: 5, metadata: { reason: "x" } })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "grant", credits: -5 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "purchase", credits: 0 })).rejects.toThrow(CreditError);
    await expect(appendEntry({ orgId: orgA, type: "grant", credits: Number.NaN })).rejects.toThrow(CreditError);
    await expect(adjustCredits(orgA, -3, { reason: " " })).rejects.toThrow(/motivo/);
    await expect(refundCredits(orgA, 3, { reason: "" })).rejects.toThrow(/motivo/);
    await expect(expireCredits(orgA, 3, { reason: "" })).rejects.toThrow(/motivo/);
    expect(await getBalance(orgA)).toBe(150);
  });

  it("aísla las organizaciones", async () => {
    await grantCredits(orgB, 7, { reference: "t-b-grant" });
    expect(await getBalance(orgB)).toBe(7);
    expect(await getBalance(orgA)).toBe(150);
    expect((await listLedger(orgA)).every((e) => e.orgId === orgA)).toBe(true);
    expect((await listLedger(orgB)).map((e) => e.reference)).toEqual(["t-b-grant"]);
    // la misma referencia en otra org es otro movimiento, no un duplicado
    const same = await appendEntry({ orgId: orgB, type: "consumption", credits: -1, reference: "t-cons" });
    expect(same.duplicate).toBe(false);
    expect((await verifyLedgerIntegrity(orgB)).ok).toBe(true);
  });

  it("escrituras concurrentes no pierden ni duplican saldo y mantienen la cadena", async () => {
    const before = await getBalance(orgA);
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      appendEntry({ orgId: orgA, type: "consumption", credits: -1, reference: `t-par-${i}` })));
    expect(await getBalance(orgA)).toBe(before - 8);
    const rows = (await listLedger(orgA, { limit: 8 })).map((e) => Number(e.balanceAfter));
    expect(new Set(rows).size).toBe(8); // cada movimiento partió de un saldo distinto
    expect((await verifyLedgerIntegrity(orgA)).ok).toBe(true);
  });

  it("INMUTABLE: Postgres rechaza cualquier UPDATE de un movimiento", async () => {
    const [entry] = await listLedger(orgA, { limit: 1 });
    for (const set of ["credits = '999'", "balance_before = '1'", "balance_after = '1'", "entry_type = 'grant'", "reference = 'otra'", "org_id = 1"]) {
      await expectPgError(db.execute(sql.raw(`UPDATE credit_ledger SET ${set} WHERE id = ${entry!.id}`)), /inmutable/);
    }
    const [after] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.id, entry!.id));
    expect(after).toEqual(entry);
  });

  it("INMUTABLE: tampoco se puede reasignar un movimiento a otro agente", async () => {
    const { agent: a1 } = await createAgent(orgA, "u", { name: "A1" });
    const { agent: a2 } = await createAgent(orgA, "u", { name: "A2" });
    const { entry } = await appendEntry({ orgId: orgA, type: "consumption", credits: -1, agentId: a1.id, reference: "t-attr" });
    await expectPgError(db.execute(sql`UPDATE credit_ledger SET agent_id = ${a2.id} WHERE id = ${entry.id}`), /inmutable/);
  });

  it("borrar un agente solo deja su referencia a NULL en el histórico (los importes no se tocan)", async () => {
    const { agent } = await createAgent(orgA, "u", { name: "Efímero" });
    const { entry } = await appendEntry({ orgId: orgA, type: "consumption", credits: -2, agentId: agent.id, reference: "t-fk-null" });
    await db.delete(aiAgentsTable).where(eq(aiAgentsTable.id, agent.id));
    const [row] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.id, entry.id));
    expect(row!.agentId).toBeNull();
    expect(row!.credits).toBe(entry.credits);
    expect(row!.balanceBefore).toBe(entry.balanceBefore);
    expect(row!.balanceAfter).toBe(entry.balanceAfter);
  });

  it("SALDO: no se puede modificar directamente, ni abrir una cuenta con saldo, ni cambiarla de organización", async () => {
    const before = await getBalance(orgA);
    await expectPgError(db.execute(sql`UPDATE credit_accounts SET balance = '999999' WHERE org_id = ${orgA}`), /solo puede cambiar mediante un movimiento/);
    await expectPgError(db.execute(sql`UPDATE credit_accounts SET balance = balance + 1 WHERE org_id = ${orgA}`), /solo puede cambiar mediante un movimiento/);
    await expectPgError(db.execute(sql`UPDATE credit_accounts SET org_id = ${orgB} WHERE org_id = ${orgA}`), /no se puede cambiar la organización|unique|duplicate/i);
    await expectPgError(db.execute(sql`INSERT INTO credit_accounts (org_id, balance) VALUES (${orgC}, '50')`), /empieza en 0/);
    expect(await getBalance(orgA)).toBe(before);
    // Lo que sí se puede tocar de una cuenta no es el saldo:
    await db.update(creditAccountsTable).set({ updatedAt: new Date() }).where(eq(creditAccountsTable.orgId, orgA));
    expect(await getBalance(orgA)).toBe(before);
  });

  it("CADENA: Postgres rechaza un movimiento cuyo saldo anterior no es el saldo real de la cuenta", async () => {
    const [acc] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgA));
    await expectPgError(db.execute(sql`INSERT INTO credit_ledger (org_id, account_id, entry_type, credits, balance_before, balance_after, source)
      VALUES (${orgA}, ${acc!.id}, 'grant', '10', '999', '1009', 'test')`), /no coincide con el saldo real/);
    // ni un movimiento de otra org sobre esta cuenta
    await expectPgError(db.execute(sql`INSERT INTO credit_ledger (org_id, account_id, entry_type, credits, balance_before, balance_after, source)
      VALUES (${orgB}, ${acc!.id}, 'grant', '10', ${acc!.balance}, ${sql.raw(`'${(Number(acc!.balance) + 10).toFixed(4)}'`)}, 'test')`), /no pertenece a la organización/);
  });

  it("CHECKS: el tipo, el signo por tipo y la cuenta de saldos los verifica la base de datos", async () => {
    const [acc] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgA));
    const bal = Number(acc!.balance);
    const insert = (type: string, credits: number, after: number) => db.execute(sql`INSERT INTO credit_ledger
      (org_id, account_id, entry_type, credits, balance_before, balance_after, source)
      VALUES (${orgA}, ${acc!.id}, ${type}, ${credits.toFixed(4)}, ${bal.toFixed(4)}, ${after.toFixed(4)}, 'test')`);
    await expectPgError(insert("regalo", 5, bal + 5), /credit_ledger_(type|amount)_check/);
    await expectPgError(insert("consumption", 5, bal + 5), /credit_ledger_amount_check/);   // un consumo nunca suma
    await expectPgError(insert("grant", -5, bal - 5), /credit_ledger_amount_check/);         // una concesión nunca resta
    await expectPgError(insert("purchase", -5, bal - 5), /credit_ledger_amount_check/);
    await expectPgError(insert("expiration", 5, bal + 5), /credit_ledger_amount_check/);
    await expectPgError(insert("adjustment", 0, bal), /credit_ledger_amount_check/);          // nada de movimientos a cero
    await expectPgError(insert("grant", 5, bal + 6), /credit_ledger_chain_check/);            // saldo posterior mal calculado
    expect(await getBalance(orgA)).toBe(bal);
    expect((await verifyLedgerIntegrity(orgA)).ok).toBe(true);
  });

  it("el uso mensual de un agente sale del ledger y no se ve desde otra organización", async () => {
    const { agent } = await createAgent(orgB, "u", { name: "Resumen" });
    await grantCredits(orgB, 100, { reference: "t-sum-grant" });
    await appendEntry({ orgId: orgB, type: "consumption", credits: -4, agentId: agent.id, reference: "t-sum-1" });
    await appendEntry({ orgId: orgB, type: "consumption", credits: -6, agentId: agent.id, reference: "t-sum-2" });
    expect(await getAgentMonthUsage(orgB, agent.id)).toBe(10);
    expect(await getAgentMonthUsage(orgA, agent.id)).toBe(0);
  });
});
