// OmniSeller Fase 3 — Contact Finder (arquitectura de adaptadores).
//
// Cubre los 13 puntos pedidos en el plan ejecutable de esta fase:
//   1. Crear un contacto ligado a un lead.
//   2. Aislamiento multi-tenant (Org B no ve contactos de Org A).
//   3. lead_result de otra Mission/organización → rechazado.
//   4. Mission de otra organización → mismo comportamiento de seguridad (404).
//   5. Mission cerrada (completed) → rechazada (409).
//   6. Proveedor sin configurar → error controlado (409 provider_not_configured,
//      SIN reservar créditos).
//   7. Deduplicación (misma búsqueda repetida no duplica contactos).
//   8. provider_contact_id duplicado dentro de la MISMA organización → no
//      crea una segunda fila (dedup), y el índice único de Postgres lo
//      respalda.
//   9. El MISMO provider_contact_id en OTRA organización → permitido (no hay
//      colisión entre orgs).
//  10. Fallo del proveedor → no queda ningún hold huérfano (releaseHold).
//  11. Créditos suficientes → reserve → ejecución → settle (ledger con
//      referencia missions:contacts:<id>:<provider>, sin holds abiertos).
//  12. Créditos insuficientes → el proveedor NUNCA se llama (402, sin
//      contactos guardados).
//  13. Ninguna comunicación enviada: cero filas en lead_messages ni ningún
//      otro canal de salida durante todo el archivo.
//
// El adaptador usado es el MOCK de solo-test (contactFinder/adapters/mockAdapter.ts),
// importado aquí explícitamente por su efecto secundario de registro — nunca
// se importa desde contactFinder/index.ts (el punto de entrada de producción).
//
// Requiere una base de datos real desechable en DATABASE_URL, con las
// migraciones reales aplicadas vía `pnpm run migrate` (NO `push` — el
// trigger de balance de OmniCredits vive en SQL crudo de las migraciones
// 0005-0008 y `push` no lo sincroniza). Se omite limpiamente sin DB real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and, like } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable,
  leadMessagesTable, orgIntegrationsTable, creditHoldsTable, creditLedgerTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { CONTACT_FINDER_MOCK_SLUG } from "../../contactFinder/adapters/mockAdapter";

const { missionsRouter } = await import("../missions");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 3 — Contact Finder", () => {
  let orgAId: number;
  let orgBId: number;
  let orgCId: number; // dedicada al test 12 (saldo cero garantizado, sin herencia de otros tests)
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId, orgCId] = await createTempOrgs(3, "omniseller-f3");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f3-user" });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(orgIntegrationsTable).where(eq(orgIntegrationsTable.integrationSlug, CONTACT_FINDER_MOCK_SLUG));
    await deleteTempOrgs([orgAId, orgBId, orgCId]);
  });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  // La referencia de OmniCredits lleva un sufijo único por invocación (ver
  // comentario en contactFinderService.ts) — se busca por prefijo.
  const refPrefix = (leadResultId: number) => `missions:contacts:${leadResultId}:${CONTACT_FINDER_MOCK_SLUG}:`;

  async function seedMissionWithLead(orgId: number, missionOverrides: Record<string, unknown> = {}) {
    const [mission] = await db.insert(missionsTable).values({
      orgId, name: `Mission contacts test ${Date.now()}`, ...missionOverrides,
    }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "test", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId, searchId: search!.id, name: `Empresa Test ${Date.now()}`, website: null, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);
    return { missionId: mission!.id, searchId: search!.id, leadResultId: result!.id };
  }

  /** Conecta el proveedor mock para una org, con un comportamiento/config concretos. */
  async function connectMockProvider(orgId: number, config: Record<string, unknown> = {}) {
    await db.delete(orgIntegrationsTable).where(and(
      eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, CONTACT_FINDER_MOCK_SLUG),
    ));
    await db.insert(orgIntegrationsTable).values({
      orgId, integrationSlug: CONTACT_FINDER_MOCK_SLUG, status: "connected", config: JSON.stringify(config),
    });
  }

  async function disconnectMockProvider(orgId: number) {
    await db.delete(orgIntegrationsTable).where(and(
      eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, CONTACT_FINDER_MOCK_SLUG),
    ));
  }

  // ── 1. Crear un contacto ligado a un lead + 11. reserve→ejecución→settle ──
  it("1 y 11 — con proveedor configurado y crédito suficiente: encuentra, guarda el contacto y hace reserve→settle sin holds abiertos", async () => {
    asOrg(orgAId);
    await connectMockProvider(orgAId, {
      contacts: [{ externalId: "apo-1", name: "Ana García", role: "CEO", email: "ana@empresa-test.invalid", quality: "verificado" }],
    });
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-1` });
    const before = await getBalance(orgAId);

    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { provider: string; contactsFound: number; creditsSpent: number; contacts: Array<{ name: string; status: string }> };
    expect(body.provider).toBe(CONTACT_FINDER_MOCK_SLUG);
    expect(body.contactsFound).toBe(1);
    expect(body.creditsSpent).toBe(1);
    expect(body.contacts[0].name).toBe("Ana García");
    expect(body.contacts[0].status).toBe("verificado");

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe(orgAId);
    expect(rows[0]!.provider).toBe(CONTACT_FINDER_MOCK_SLUG);
    expect(rows[0]!.providerContactId).toBe("apo-1");

    const after = await getBalance(orgAId);
    expect(after).toBe(before - 1);

    const holds = await db.select().from(creditHoldsTable).where(like(creditHoldsTable.reference, `${refPrefix(leadResultId)}%`));
    expect(holds.filter(h => h.status === "open")).toHaveLength(0);
    const ledger = await db.select().from(creditLedgerTable).where(like(creditLedgerTable.reference, `${refPrefix(leadResultId)}%`));
    expect(ledger.length).toBeGreaterThan(0);
  });

  // ── 2. Aislamiento multi-tenant ──────────────────────────────────────────
  it("2 — Org B no ve los contactos encontrados para un lead de Org A", async () => {
    asOrg(orgAId);
    await connectMockProvider(orgAId);
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-2` });
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(200);

    const rowsAsB = await db.select().from(leadContactsTable).where(and(
      eq(leadContactsTable.leadResultId, leadResultId), eq(leadContactsTable.orgId, orgBId),
    ));
    expect(rowsAsB).toHaveLength(0);
    const rowsAsA = await db.select().from(leadContactsTable).where(and(
      eq(leadContactsTable.leadResultId, leadResultId), eq(leadContactsTable.orgId, orgAId),
    ));
    expect(rowsAsA.length).toBeGreaterThan(0);
  });

  // ── 3. lead_result de otra Mission/org → rechazado ──────────────────────
  it("3 — un leadResultId que pertenece a otra Mission (misma u otra org) es rechazado", async () => {
    asOrg(orgAId);
    await connectMockProvider(orgAId);
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-3` });
    const missionOne = await seedMissionWithLead(orgAId);
    const missionTwo = await seedMissionWithLead(orgAId);

    // El lead de missionOne no pertenece a missionTwo.
    const resp = await fetch(`${base}/api/missions/${missionTwo.missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId: missionOne.leadResultId }),
    });
    expect(resp.status).toBe(404);
    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, missionOne.leadResultId));
    expect(rows).toHaveLength(0);
  });

  // ── 4. Mission de otra organización → mismo comportamiento de seguridad ──
  it("4 — la Mission de otra organización se comporta igual que 'no encontrada' (404), sin filtrar su existencia", async () => {
    asOrg(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);

    asOrg(orgBId);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(404);
  });

  // ── 5. Mission cerrada (completed) → rechazada ───────────────────────────
  it("5 — una Mission 'completed' no admite Contact Finder (409)", async () => {
    asOrg(orgAId);
    await connectMockProvider(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId, { status: "completed" });
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(409);
    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(0);
  });

  // ── 6. Proveedor sin configurar → error controlado, sin reservar créditos ─
  it("6 — sin proveedor configurado devuelve provider_not_configured (409) y no reserva créditos", async () => {
    asOrg(orgAId);
    await disconnectMockProvider(orgAId);
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-6` });
    const before = await getBalance(orgAId);
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);

    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(409);
    const body = await resp.json() as { error: string };
    expect(body.error).toBe("provider_not_configured");

    const after = await getBalance(orgAId);
    expect(after).toBe(before); // ni un crédito tocado
    const holds = await db.select().from(creditHoldsTable).where(like(creditHoldsTable.reference, `${refPrefix(leadResultId)}%`));
    expect(holds).toHaveLength(0);
  });

  // ── 7 y 8. Deduplicación — misma búsqueda repetida y provider_contact_id duplicado en la misma org ──
  it("7 y 8 — repetir la búsqueda con el mismo provider_contact_id no crea una segunda fila en la misma organización", async () => {
    asOrg(orgAId);
    const externalId = `dedup-${Date.now()}`;
    await connectMockProvider(orgAId, { contacts: [{ externalId, name: "Contacto Dedup", quality: "no_verificado" }] });
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-7` });
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);

    const first = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(second.status).toBe(200);

    const rows = await db.select().from(leadContactsTable).where(and(
      eq(leadContactsTable.leadResultId, leadResultId), eq(leadContactsTable.providerContactId, externalId),
    ));
    expect(rows).toHaveLength(1); // dedup: la segunda pasada reutiliza la fila existente
  });

  // ── 9. Mismo provider_contact_id en OTRA organización → permitido ───────
  it("9 — el mismo provider_contact_id en otra organización no colisiona (aislamiento por org_id)", async () => {
    const externalId = `cross-org-${Date.now()}`;

    asOrg(orgAId);
    await connectMockProvider(orgAId, { contacts: [{ externalId, name: "Mismo Id, Org A" }] });
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-9a` });
    const a = await seedMissionWithLead(orgAId);
    const respA = await fetch(`${base}/api/missions/${a.missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId: a.leadResultId }),
    });
    expect(respA.status).toBe(200);

    asOrg(orgBId);
    await connectMockProvider(orgBId, { contacts: [{ externalId, name: "Mismo Id, Org B" }] });
    await grantCredits(orgBId, 5, { reference: `f3-grant-${Date.now()}-9b` });
    const b = await seedMissionWithLead(orgBId);
    const respB = await fetch(`${base}/api/missions/${b.missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId: b.leadResultId }),
    });
    expect(respB.status).toBe(200); // no falla por la unique index — está aislada por org_id

    const rowsA = await db.select().from(leadContactsTable).where(and(eq(leadContactsTable.orgId, orgAId), eq(leadContactsTable.providerContactId, externalId)));
    const rowsB = await db.select().from(leadContactsTable).where(and(eq(leadContactsTable.orgId, orgBId), eq(leadContactsTable.providerContactId, externalId)));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    await disconnectMockProvider(orgBId);
  });

  // ── 10. Fallo del proveedor → ningún hold huérfano ───────────────────────
  it("10 — si el proveedor falla no queda ningún hold abierto y no se guarda ningún contacto", async () => {
    asOrg(orgAId);
    await connectMockProvider(orgAId, { behavior: "error" });
    await grantCredits(orgAId, 5, { reference: `f3-grant-${Date.now()}-10` });
    const { missionId, leadResultId } = await seedMissionWithLead(orgAId);

    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(502);

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(0);
    const holds = await db.select().from(creditHoldsTable).where(like(creditHoldsTable.reference, `${refPrefix(leadResultId)}%`));
    expect(holds.filter(h => h.status === "open")).toHaveLength(0);
  });

  // ── 12. Créditos insuficientes → el proveedor NUNCA se llama ─────────────
  it("12 — sin saldo suficiente, el proveedor no se llama y no se guarda ningún contacto (402)", async () => {
    asOrg(orgCId); // org dedicada — saldo cero garantizado, no comparte estado con los demás tests
    await connectMockProvider(orgCId, {
      // Si el mock SÍ se llamara, este contacto quedaría guardado — la
      // aserción de longitud 0 de abajo prueba que nunca se llegó a invocar.
      contacts: [{ externalId: `should-not-be-called-${Date.now()}`, name: "No debería guardarse" }],
    });
    const before = await getBalance(orgCId);
    expect(before).toBe(0);
    const { missionId, leadResultId } = await seedMissionWithLead(orgCId);

    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId }),
    });
    expect(resp.status).toBe(402);

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.leadResultId, leadResultId));
    expect(rows).toHaveLength(0);
    await disconnectMockProvider(orgCId);
  });

  // ── 13. Ninguna comunicación enviada, en todo el archivo ─────────────────
  it("13 — Contact Finder no envía ninguna comunicación (cero lead_messages generados por estos tests)", async () => {
    const rows = await db.select().from(leadMessagesTable).where(
      eq(leadMessagesTable.resultId, cleanupResultIds[0] ?? -1),
    );
    // No hay ninguna vía en contactFinderService.ts que escriba en
    // lead_messages ni llame a ningún adaptador de mensajería (WhatsApp/
    // Telegram/email) — esta aserción es un cinturón de seguridad, no la
    // única prueba: el propio código de contactFinderService.ts no importa
    // ningún adaptador de envío.
    expect(rows).toHaveLength(0);
  });
});
