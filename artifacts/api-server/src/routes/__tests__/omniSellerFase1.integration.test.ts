// OmniSeller Fase 1 — Mission + extensión de POST /api/leads/search.
//
// Cubre lo pedido en el plan ejecutable para esta fase:
//   - Aislamiento multi-tenant de Missions (una organización nunca ve ni
//     referencia la misión de otra).
//   - Una búsqueda que referencia un missionId de otra organización se
//     rechaza (404), sin crear nada.
//   - El coste de la búsqueda se reserva ANTES de llamar a la API externa:
//     una organización sin saldo recibe 402 y no queda ningún hold ni
//     movimiento de crédito huérfano (el fallo cierra limpio).
//   - La deduplicación de leads (findDuplicateLead) sigue funcionando igual
//     esté o no la búsqueda asociada a una misión — Mission es puramente
//     orquestación, no toca la identidad del prospecto.
//
// Requiere una base de datos real desechable en DATABASE_URL (mismo patrón
// que guestAppointments.integration.test.ts / fleetDeliveryUpdate...). Se
// omite limpiamente si solo hay placeholder.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db, organizationsTable, usersTable, missionsTable, leadSearchesTable, leadResultsTable,
  creditHoldsTable, creditLedgerTable,
} from "@workspace/db";
import { leadsRouter, findDuplicateLead } from "../leads";
import { missionsRouter } from "../missions";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 1 — Missions + leads.search", () => {
  let orgAId: number;
  let orgBId: number;
  let userId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupMissionIds: number[] = [];

  beforeAll(async () => {
    const suffix = Date.now();
    const [orgA] = await db.insert(organizationsTable)
      .values({ name: `OmniSeller Test Org A ${suffix}`, slug: `omniseller-test-a-${suffix}` }).returning();
    const [orgB] = await db.insert(organizationsTable)
      .values({ name: `OmniSeller Test Org B ${suffix}`, slug: `omniseller-test-b-${suffix}` }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;
    // missions.ownerId / created_by referencian users.id de verdad — un
    // usuario real, igual que en producción (resolveOrg siempre resuelve un
    // clerk user existente antes de llegar aquí).
    const [user] = await db.insert(usersTable)
      .values({ clerkId: `omniseller-test-user-${suffix}`, email: `omniseller-test-${suffix}@example.com` }).returning();
    userId = user!.id;

    const app = express();
    app.use(express.json());
    // Identidad simulada: el test elige la org activa vía currentOrgId (nunca
    // desde la URL/body, igual que el middleware real resolveOrg).
    app.use((req, _res, next) => {
      Object.assign(req, {
        orgId: currentOrgId, orgRole: "owner", userId, clerkUserId: "omniseller-test-user",
      });
      next();
    });
    app.use("/api/leads", leadsRouter);
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    // organizationsTable cascade se lleva credit_accounts/credit_holds/credit_ledger asociados.
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgAId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgBId));
  });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  it("crea una misión y la mantiene aislada por organización", async () => {
    asOrg(orgAId);
    const createRes = await fetch(`${base}/api/missions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dentistas Madrid — smoke test", sector: "dentistas", location: "Madrid" }),
    });
    expect(createRes.status).toBe(201);
    const mission = await createRes.json() as { id: number; orgId: number };
    cleanupMissionIds.push(mission.id);

    // Org A la ve.
    const listA = await fetch(`${base}/api/missions`).then(r => r.json()) as Array<{ id: number }>;
    expect(listA.some(m => m.id === mission.id)).toBe(true);

    // Org B — misma llamada, otra identidad — NO la ve.
    asOrg(orgBId);
    const listB = await fetch(`${base}/api/missions`).then(r => r.json()) as Array<{ id: number }>;
    expect(listB.some(m => m.id === mission.id)).toBe(false);

    // Org B pidiendo el detalle directamente por id: 404, no la fila de otro.
    const detailB = await fetch(`${base}/api/missions/${mission.id}`);
    expect(detailB.status).toBe(404);
  });

  it("rechaza con 404 una búsqueda que referencia una misión de otra organización", async () => {
    asOrg(orgAId);
    const createRes = await fetch(`${base}/api/missions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Misión solo de A" }),
    });
    const mission = await createRes.json() as { id: number };
    cleanupMissionIds.push(mission.id);

    asOrg(orgBId);
    const searchRes = await fetch(`${base}/api/leads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sector: "fontaneros", city: "Valencia", missionId: mission.id }),
    });
    expect(searchRes.status).toBe(404);
    const body = await searchRes.json() as { error: string };
    expect(body.error).toMatch(/no encontrada/i);

    // No debe haber quedado ninguna lead_search de B colgando de la misión de A.
    const orphan = await db.select().from(leadSearchesTable)
      .where(and(eq(leadSearchesTable.orgId, orgBId), eq(leadSearchesTable.missionId, mission.id)));
    expect(orphan.length).toBe(0);
  });

  it("responde 402 y no deja ningún hold vivo cuando la organización no tiene créditos (falla ANTES de llamar a la API externa)", async () => {
    asOrg(orgAId); // orgA es de nueva creación: nunca se le ha concedido ni un crédito.
    const searchRes = await fetch(`${base}/api/leads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sector: "abogados", city: "Sevilla" }),
    });
    expect(searchRes.status).toBe(402);

    const [search] = await db.select().from(leadSearchesTable)
      .where(and(eq(leadSearchesTable.orgId, orgAId), eq(leadSearchesTable.sector, "abogados")))
      .orderBy(leadSearchesTable.id);
    expect(search).toBeDefined();
    cleanupSearchIds.push(search!.id);
    expect(search!.status).toBe("failed");

    const reference = `leads:search:${search!.id}`;
    const holds = await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.reference, reference));
    expect(holds.length).toBe(0);
    const ledgerRows = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.reference, reference));
    expect(ledgerRows.length).toBe(0);
  });

  it("findDuplicateLead sigue detectando duplicados por teléfono, esté o no la búsqueda asociada a una misión", async () => {
    asOrg(orgAId);
    const [mission] = await db.insert(missionsTable).values({ orgId: orgAId, name: "Misión para dedupe" }).returning();
    cleanupMissionIds.push(mission!.id);

    const [search] = await db.insert(leadSearchesTable).values({
      orgId: orgAId, missionId: mission!.id, sector: "test", city: "Madrid",
    }).returning();
    cleanupSearchIds.push(search!.id);

    const [existing] = await db.insert(leadResultsTable).values({
      orgId: orgAId, searchId: search!.id, name: "Clínica Dental Ejemplo",
      phone: "+34 912 345 678", address: "Calle Falsa 1",
    }).returning();
    cleanupResultIds.push(existing!.id);

    // Mismo teléfono, formato distinto — debe encontrarse aunque el lead
    // exista dentro de una búsqueda que pertenece a una misión.
    const dup = await findDuplicateLead(orgAId, { name: "Otra grafía del mismo negocio", phone: "912345678" });
    expect(dup?.id).toBe(existing!.id);
    expect(dup?.matchReason).toBe("phone");

    // Org B, mismo teléfono — nunca cruza organizaciones.
    const noCross = await findDuplicateLead(orgBId, { name: "Otra grafía del mismo negocio", phone: "912345678" });
    expect(noCross).toBeNull();
  });
});
