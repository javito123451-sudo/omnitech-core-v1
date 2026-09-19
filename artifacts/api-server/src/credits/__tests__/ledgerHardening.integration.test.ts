// Endurecimiento del ledger (migración 0007) y operaciones manuales idempotentes:
//   - un movimiento no se puede borrar (DELETE directo ni TRUNCATE), pero borrar
//     una organización o una cuenta SÍ limpia su ledger en cascada;
//   - GRANT / ADJUSTMENT / REFUND / EXPIRATION exigen referencia (clave de
//     idempotencia): un doble envío no genera un segundo movimiento;
//   - el consumo con precio no configurado queda marcado como provisional.
//
// Requiere ci-test con las migraciones 0004-0007. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, creditAccountsTable, creditLedgerTable } from "@workspace/db";
import {
  adjustCredits, appendEntry, expireCredits, getBalance, grantCredits, listLedger, refundCredits,
  settleCredits, reserveCredits, verifyLedgerIntegrity, CreditError, ReferenceConflictError,
} from "../creditService";
import { getDashboard } from "../reporting";
import { creditsAdminRouter } from "../../routes/credits-admin";
import { toApiError } from "../../ai-gateway/apiErrors";
import { createTempOrgs, deleteTempOrgs, expectPgError } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
let orgs: number[] = [];
let n = 0;
const nextOrg = () => orgs[n++]!;

async function rawEntry(orgId: number, type: string, credits: number, ref: string | null) {
  const bal = await getBalance(orgId);
  const [acc] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgId));
  return db.execute(sql`INSERT INTO credit_ledger (org_id, account_id, entry_type, credits, balance_before, balance_after, reference, source)
    VALUES (${orgId}, ${acc!.id}, ${type}, ${credits.toFixed(4)}, ${bal.toFixed(4)}, ${(bal + credits).toFixed(4)}, ${ref}, 'test')`);
}

describe.skipIf(!hasRealDb)("OmniCredits — ledger protegido y operaciones manuales idempotentes", () => {
  beforeAll(async () => { orgs = await createTempOrgs(20, "hardening"); });
  afterAll(async () => { await deleteTempOrgs(orgs); });

  // ── 0007: el ledger no se borra ───────────────────────────────────────────

  describe("borrado del ledger", () => {
    it("un DELETE directo se rechaza y no cambia nada", async () => {
      const org = nextOrg();
      await grantCredits(org, 100, { reference: "del-1" });
      const [entry] = await listLedger(org);
      await expectPgError(db.execute(sql`DELETE FROM credit_ledger WHERE id = ${entry!.id}`), /no se borra|inmutable/);
      await expectPgError(db.execute(sql`DELETE FROM credit_ledger WHERE org_id = ${org}`), /no se borra|inmutable/);
      expect(await getBalance(org)).toBe(100);
      expect(await listLedger(org)).toHaveLength(1);
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });

    // TRUNCATE toma un bloqueo exclusivo sobre el ledger y sus tablas enlazadas: ejecutarlo aquí bloquearía (y llegaría a
    // interbloquear) a los demás tests que corren en paralelo. Se comprueba que la protección existe, es de tipo TRUNCATE
    // y está activa; su efecto (rechazar TRUNCATE ... CASCADE) se verificó directamente contra la base al añadir la migración.
    it("TRUNCATE también está protegido: hay un trigger BEFORE TRUNCATE activo sobre el ledger", async () => {
      const rows = await db.execute(sql`SELECT tgtype::int AS tgtype, tgenabled AS enabled FROM pg_trigger WHERE tgrelid = 'credit_ledger'::regclass AND tgname = 'credit_ledger_no_truncate'`);
      const t = rows.rows[0] as { tgtype: number; enabled: string } | undefined;
      expect(t).toBeTruthy();
      expect(t!.tgtype & 32).toBe(32);   // TRIGGER_TYPE_TRUNCATE
      expect(t!.tgtype & 2).toBe(2);     // BEFORE
      expect(t!.enabled).toBe("O");      // habilitado
    });

    it("eliminar la organización limpia su ledger, cuenta y reservas en cascada (y solo las suyas)", async () => {
      const gone = nextOrg(), kept = nextOrg();
      for (const org of [gone, kept]) {
        await grantCredits(org, 50, { reference: "casc-g" });
        await appendEntry({ orgId: org, type: "consumption", credits: -5, reference: "casc-c" });
        await reserveCredits({ orgId: org, credits: 1, reference: "casc-h" });
      }
      await deleteTempOrgs([gone]);
      expect(await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.orgId, gone))).toEqual([]);
      expect(await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, gone))).toEqual([]);
      expect(await listLedger(kept)).toHaveLength(2);           // la otra organización no se toca
      expect(await getBalance(kept)).toBe(45);
      expect((await verifyLedgerIntegrity(kept)).ok).toBe(true);
    });

    it("borrar la cuenta (cascada desde credit_accounts) también limpia sus movimientos", async () => {
      const org = nextOrg();
      await grantCredits(org, 10, { reference: "acc-g" });
      await db.delete(creditAccountsTable).where(eq(creditAccountsTable.orgId, org));
      expect(await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.orgId, org))).toEqual([]);
    });
  });

  // ── Referencia obligatoria en operaciones manuales ────────────────────────

  describe("referencia obligatoria (clave de idempotencia)", () => {
    it("GRANT, ADJUSTMENT, REFUND y EXPIRATION sin referencia se rechazan antes de tocar la base", async () => {
      const org = nextOrg();
      await expect(grantCredits(org, 5)).rejects.toThrow(/referencia/);
      await expect(grantCredits(org, 5, { reference: "  " })).rejects.toThrow(/referencia/);
      await expect(adjustCredits(org, -1, { reason: "x" })).rejects.toThrow(/referencia/);
      await expect(refundCredits(org, 1, { reason: "x" })).rejects.toThrow(/referencia/);
      await expect(expireCredits(org, 1, { reason: "x" })).rejects.toThrow(/referencia/);
      await expect(grantCredits(org, 5)).rejects.toBeInstanceOf(CreditError);
      expect(await listLedger(org)).toEqual([]);
      expect(await getBalance(org)).toBe(0);
    });

    it("Postgres lo exige también: un INSERT directo de una operación manual sin referencia se rechaza", async () => {
      const org = nextOrg();
      await grantCredits(org, 10, { reference: "chk-base" });
      await expectPgError(rawEntry(org, "grant", 5, null), /manual_reference_check/);
      await expectPgError(rawEntry(org, "adjustment", 5, "  "), /manual_reference_check/);
      await expectPgError(rawEntry(org, "refund", 5, null), /manual_reference_check/);
      await expectPgError(rawEntry(org, "expiration", -5, null), /manual_reference_check/);
      await rawEntry(org, "consumption", -1, null);        // consumo/compra/suscripción llevan su propia clave: no cambian
      expect(await getBalance(org)).toBe(9);
    });

    it("un doble envío de cada operación manual no genera un segundo movimiento", async () => {
      const org = nextOrg();
      const first = await grantCredits(org, 100, { reference: "dbl-grant", reason: "promo" });
      const second = await grantCredits(org, 100, { reference: "dbl-grant", reason: "promo" });
      expect(first.duplicate).toBe(false);
      expect(second).toMatchObject({ duplicate: true, entry: { id: first.entry.id } });

      await adjustCredits(org, -10, { reference: "dbl-adj", reason: "corrección" });
      expect((await adjustCredits(org, -10, { reference: "dbl-adj", reason: "corrección" })).duplicate).toBe(true);
      await refundCredits(org, 4, { reference: "dbl-ref", reason: "error" });
      expect((await refundCredits(org, 4, { reference: "dbl-ref", reason: "error" })).duplicate).toBe(true);
      await expireCredits(org, 6, { reference: "dbl-exp", reason: "caduca" });
      expect((await expireCredits(org, 6, { reference: "dbl-exp", reason: "caduca" })).duplicate).toBe(true);

      expect(await getBalance(org)).toBe(100 - 10 + 4 - 6);
      expect(await listLedger(org)).toHaveLength(4);
      expect((await verifyLedgerIntegrity(org)).ok).toBe(true);
    });

    it("cinco envíos SIMULTÁNEOS de la misma operación manual generan un solo movimiento", async () => {
      const org = nextOrg();
      const results = await Promise.all(Array.from({ length: 5 }, () => grantCredits(org, 25, { reference: "race-grant", reason: "promo" }).then((r) => r.duplicate, (e) => `err:${String(e?.message ?? e).slice(0, 40)}`)));
      expect(results.filter((r) => r === false)).toHaveLength(1);
      expect(await getBalance(org)).toBe(25);
      expect(await listLedger(org)).toHaveLength(1);
    });

    it("reutilizar una referencia para OTRA operación es un conflicto explícito, no un descarte silencioso", async () => {
      const org = nextOrg();
      await grantCredits(org, 50, { reference: "reuse", reason: "promo" });
      await expect(grantCredits(org, 70, { reference: "reuse", reason: "promo" })).rejects.toBeInstanceOf(ReferenceConflictError);
      await expect(adjustCredits(org, -50, { reference: "reuse", reason: "x" })).rejects.toBeInstanceOf(ReferenceConflictError);
      expect(await getBalance(org)).toBe(50);
      expect(toApiError(new ReferenceConflictError("reuse", "grant 50"))).toMatchObject({ http: 409, body: { status: "REFERENCE_CONFLICT", reference: "reuse" } });
    });

    it("la misma referencia en dos organizaciones son dos operaciones independientes", async () => {
      const a = nextOrg(), b = nextOrg();
      expect((await grantCredits(a, 10, { reference: "shared-ref" })).duplicate).toBe(false);
      expect((await grantCredits(b, 10, { reference: "shared-ref" })).duplicate).toBe(false);
      expect(await getBalance(a)).toBe(10);
      expect(await getBalance(b)).toBe(10);
    });

    it("los tipos con clave propia siguen funcionando igual (consumo → requestId)", async () => {
      const org = nextOrg();
      await grantCredits(org, 20, { reference: "own-g" });
      await reserveCredits({ orgId: org, credits: 5, reference: "req-own" });
      const a = await settleCredits({ orgId: org, reference: "req-own", credits: 3 });
      const b = await settleCredits({ orgId: org, reference: "req-own", credits: 3 });
      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(true);
      expect(await getBalance(org)).toBe(17);
    });
  });

  // ── Endpoint administrativo ───────────────────────────────────────────────

  describe("POST /control-center/credits/:orgId/entries", () => {
    let server: Server;
    let base = "";
    beforeAll(async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.clerkUserId = "test-admin"; req.isSuperAdmin = true; next(); });
      app.use("/credits", creditsAdminRouter);
      await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/credits`;
    });
    afterAll(async () => { await new Promise<void>((r) => { server.close(() => r()); }); });

    const post = (orgId: number, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/${orgId}/entries`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    it("sin referencia: 400 y no se crea nada", async () => {
      const org = nextOrg();
      for (const type of ["grant", "adjustment", "refund", "expiration"]) {
        const res = await post(org, { type, credits: 5, reason: "x" });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ status: "CREDIT_INVALID" });
      }
      expect(await listLedger(org)).toEqual([]);
    });

    it("doble envío: el primero crea (201), el segundo devuelve el mismo movimiento (200, duplicate) y el saldo no cambia", async () => {
      const org = nextOrg();
      const body = { type: "grant", credits: 40, reason: "promo", reference: "http-dbl" };
      const a = await post(org, body);
      const b = await post(org, body);
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      const [ja, jb] = [await a.json() as { entry: { id: number }; duplicate: boolean }, await b.json() as { entry: { id: number }; duplicate: boolean }];
      expect(ja.duplicate).toBe(false);
      expect(jb).toMatchObject({ duplicate: true, entry: { id: ja.entry.id } });
      expect(await getBalance(org)).toBe(40);
      expect(await listLedger(org)).toHaveLength(1);
    });

    it("acepta la referencia como cabecera Idempotency-Key", async () => {
      const org = nextOrg();
      const h = { "idempotency-key": "http-key-1" };
      expect((await post(org, { type: "grant", credits: 7, reason: "x" }, h)).status).toBe(201);
      expect((await post(org, { type: "grant", credits: 7, reason: "x" }, h)).status).toBe(200);
      expect(await getBalance(org)).toBe(7);
      expect((await listLedger(org))[0]!.reference).toBe("http-key-1");
    });

    it("misma referencia con otro importe: 409 REFERENCE_CONFLICT", async () => {
      const org = nextOrg();
      await post(org, { type: "grant", credits: 10, reason: "x", reference: "http-conf" });
      const res = await post(org, { type: "grant", credits: 99, reason: "x", reference: "http-conf" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ status: "REFERENCE_CONFLICT", reference: "http-conf" });
      expect(await getBalance(org)).toBe(10);
    });

    it("quien no es SUPER_ADMIN estricto no puede escribir", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.clerkUserId = "staff"; req.isSuperAdmin = false; next(); });
      app.use("/credits", creditsAdminRouter);
      const s = await new Promise<Server>((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); });
      try {
        const org = nextOrg();
        const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/credits/${org}/entries`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "grant", credits: 5, reason: "x", reference: "staff-1" }),
        });
        expect(res.status).toBe(403);
        expect(await listLedger(org)).toEqual([]);
      } finally { await new Promise<void>((r) => { s.close(() => r()); }); }
    });
  });

  // ── Consumo con precio provisional ────────────────────────────────────────

  describe("consumo provisional en el dashboard", () => {
    it("separa el consumo calculado con precio no configurado del de un precio definitivo", async () => {
      const org = nextOrg();
      await grantCredits(org, 100, { reference: "prov-g" });
      const cons = (credits: number, ref: string, provisional: boolean) =>
        appendEntry({ orgId: org, type: "consumption", credits: -credits, reference: ref, metadata: { priceSource: provisional ? "legacy" : "db", provisional } });
      await cons(10, "p1", true);
      await cons(4, "p2", true);
      await cons(6, "p3", false);
      const d = await getDashboard(org);
      expect(d.used).toBe(20);
      expect(d.pricing).toEqual({ provisionalCredits: 14, provisionalRuns: 2, provisional: true });

      const clean = nextOrg();
      await grantCredits(clean, 10, { reference: "prov-g2" });
      await appendEntry({ orgId: clean, type: "consumption", credits: -1, reference: "p4", metadata: { priceSource: "db", provisional: false } });
      expect((await getDashboard(clean)).pricing).toEqual({ provisionalCredits: 0, provisionalRuns: 0, provisional: false });
    });
  });
});
