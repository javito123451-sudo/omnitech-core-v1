// OmniSeller Fase 14 — cierre de Gap 1 (Contact Finder): GET
// /api/missions/:id/contacts, la ruta nueva y mínima que permite volver a
// listar los lead_contacts ya encontrados tras recargar la página — antes
// de este cierre no existía ninguna forma de recuperarlos salvo la
// respuesta síncrona de POST .../contacts/find (documentado como decisión
// abierta en el informe de Fase 13).
//
// Requiere una base de datos real desechable en DATABASE_URL. Se omite
// limpiamente sin DB real (mismo patrón que el resto de los .integration.test.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable,
} from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const { missionsRouter } = await import("../missions");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 14 — GET /api/missions/:id/contacts", () => {
  let orgA: number, orgB: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupContactIds: number[] = [];

  beforeAll(async () => {
    [orgA, orgB] = await createTempOrgs(2, "omniseller-f14");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Cada test fija su propia orgId simulada leyendo la cabecera —
      // permite probar aislamiento multi-tenant sin dos servidores.
      Object.assign(req, {
        orgId: Number(req.header("x-test-org-id")) || orgA,
        orgRole: "owner", userId: 1, clerkUserId: "omniseller-f14-user",
      });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupContactIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.id, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await deleteTempOrgs([orgA, orgB]);
  });

  async function seedMissionWithContacts(orgId: number, contactCount: number) {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F14 ${Date.now()}-${Math.random()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId, searchId: search!.id, name: `Empresa F14 ${Date.now()}`, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);

    for (let i = 0; i < contactCount; i++) {
      const [contact] = await db.insert(leadContactsTable).values({
        orgId, leadResultId: result!.id, name: `Contacto ${i}`, email: `contacto${i}-${Date.now()}@example.com`,
        provider: "mock", status: "encontrado",
      }).returning();
      cleanupContactIds.push(contact!.id);
    }
    return { missionId: mission!.id, resultId: result!.id };
  }

  it("devuelve los contactos ya encontrados de la misión (persistidos, no solo en sesión)", async () => {
    const { missionId, resultId } = await seedMissionWithContacts(orgA, 2);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { missionId: number; contacts: Array<{ id: number; leadResultId: number; name: string }> };
    expect(body.missionId).toBe(missionId);
    expect(body.contacts).toHaveLength(2);
    expect(body.contacts.every(c => c.leadResultId === resultId)).toBe(true);
  });

  it("devuelve un array vacío cuando la misión no tiene contactos encontrados todavía", async () => {
    const { missionId } = await seedMissionWithContacts(orgA, 0);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { contacts: unknown[] };
    expect(body.contacts).toEqual([]);
  });

  it("404 si la misión no existe", async () => {
    const resp = await fetch(`${base}/api/missions/999999999/contacts`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(404);
  });

  it("400 si el id no es numérico — mismo guard que el resto de rutas OmniSeller", async () => {
    const resp = await fetch(`${base}/api/missions/no-numerico/contacts`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(400);
  });

  it("aislamiento multi-tenant: una misión de otra organización no es visible ni devuelve sus contactos", async () => {
    const { missionId } = await seedMissionWithContacts(orgA, 1);
    // orgB pide la misión de orgA — debe caer en el mismo 404 que "no existe", sin filtrar su presencia.
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts`, { headers: { "x-test-org-id": String(orgB) } });
    expect(resp.status).toBe(404);
  });
});
