// OmniSeller Fase 16 — cierre de dos gaps de la Fase 15/mandato F16-F18:
//
//  1. Trazabilidad: GET /api/missions/:id/audit — endpoint mínimo, read-only,
//     aislado por org, protegido por el permiso omniseller.read ya
//     existente, que reutiliza auditLogsTable/logAudit (misma tabla que ya
//     usan missions.ts/outreachBookings.ts/outreachFollowup.ts). El audit
//     endpoint de plataforma (GET /api/control-center/audit,
//     requireSuperAdmin) NO se toca ni se le quita protección.
//
//  2. Historial de Outreach por contacto: GET /api/leads/results/:id/messages
//     ahora admite `?contactId=` opcional, reutilizando la columna
//     lead_messages.contact_id (y su índice) que ya existía antes de esta
//     fase — sin migración ni cambio de esquema. Sin el parámetro, el
//     comportamiento es idéntico al de siempre.
//
// Requiere una base de datos real desechable en DATABASE_URL. Se omite
// limpiamente sin DB real (mismo patrón que el resto de los .integration.test.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable, leadMessagesTable, auditLogsTable,
} from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const { missionsRouter } = await import("../missions");
const { leadsRouter } = await import("../leads");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 16 — Trazabilidad (GET /api/missions/:id/audit)", () => {
  let orgA: number, orgB: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupAuditIds: number[] = [];

  beforeAll(async () => {
    [orgA, orgB] = await createTempOrgs(2, "omniseller-f16-audit");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        orgId: Number(req.header("x-test-org-id")) || orgA,
        orgRole: "owner", userId: 1, clerkUserId: "omniseller-f16-audit-user",
      });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupAuditIds) await db.delete(auditLogsTable).where(eq(auditLogsTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await deleteTempOrgs([orgA, orgB]);
  });

  async function seedMission(orgId: number) {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F16 audit ${Date.now()}-${Math.random()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    return mission!.id;
  }

  async function seedAuditEntry(orgId: number, values: { action: string; resource?: string; resourceId?: string; details?: Record<string, unknown> }) {
    const [row] = await db.insert(auditLogsTable).values({
      actorClerkId: "omniseller-f16-audit-user", action: values.action, resource: values.resource ?? null,
      resourceId: values.resourceId ?? null, orgId, details: values.details ?? {}, severity: "info",
    }).returning();
    cleanupAuditIds.push(row!.id);
    return row!.id;
  }

  it("devuelve las entradas de auditoría de la misión — tanto las que usan resource=mission como las que llevan missionId en details", async () => {
    const missionId = await seedMission(orgA);
    await seedAuditEntry(orgA, { action: "missions.create", resource: "mission", resourceId: String(missionId) });
    await seedAuditEntry(orgA, { action: "outreach.send_succeeded", resource: "lead_message", resourceId: "999", details: { missionId } });
    // Entrada de otra misión (mismo org) — no debe aparecer.
    const otherMissionId = await seedMission(orgA);
    await seedAuditEntry(orgA, { action: "missions.create", resource: "mission", resourceId: String(otherMissionId) });

    const resp = await fetch(`${base}/api/missions/${missionId}/audit`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { missionId: number; entries: Array<{ action: string }> };
    expect(body.missionId).toBe(missionId);
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map(e => e.action).sort()).toEqual(["missions.create", "outreach.send_succeeded"]);
  });

  it("no expone ipAddress ni userAgent — solo los campos necesarios para el operador", async () => {
    const missionId = await seedMission(orgA);
    await seedAuditEntry(orgA, { action: "missions.create", resource: "mission", resourceId: String(missionId) });
    const resp = await fetch(`${base}/api/missions/${missionId}/audit`, { headers: { "x-test-org-id": String(orgA) } });
    const body = await resp.json() as { entries: Array<Record<string, unknown>> };
    expect(body.entries[0]).not.toHaveProperty("ipAddress");
    expect(body.entries[0]).not.toHaveProperty("userAgent");
  });

  it("404 si la misión no existe", async () => {
    const resp = await fetch(`${base}/api/missions/999999999/audit`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(404);
  });

  it("400 si el id no es numérico", async () => {
    const resp = await fetch(`${base}/api/missions/no-numerico/audit`, { headers: { "x-test-org-id": String(orgA) } });
    expect(resp.status).toBe(400);
  });

  it("aislamiento multi-tenant: Org B no puede ver el audit trail de una misión de Org A", async () => {
    const missionId = await seedMission(orgA);
    await seedAuditEntry(orgA, { action: "missions.create", resource: "mission", resourceId: String(missionId) });
    const resp = await fetch(`${base}/api/missions/${missionId}/audit`, { headers: { "x-test-org-id": String(orgB) } });
    expect(resp.status).toBe(404);
  });
});

describe.skipIf(!hasRealDb)("OmniSeller Fase 16 — Historial de Outreach por contacto (?contactId=)", () => {
  let orgA: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupContactIds: number[] = [];
  const cleanupMessageIds: number[] = [];

  beforeAll(async () => {
    [orgA] = await createTempOrgs(1, "omniseller-f16-history");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: orgA, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f16-history-user" });
      next();
    });
    app.use("/api/leads", leadsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupMessageIds) await db.delete(leadMessagesTable).where(eq(leadMessagesTable.id, id));
    for (const id of cleanupContactIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.id, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await deleteTempOrgs([orgA]);
  });

  it("con dos contactos del mismo lead_result, ?contactId= devuelve solo los mensajes de ESE contacto", async () => {
    const [mission] = await db.insert(missionsTable).values({ orgId: orgA, name: `Mission F16 history ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId: orgA, missionId: mission!.id, sector: "t", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId: orgA, searchId: search!.id, name: `Empresa F16 ${Date.now()}`, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);

    const [contact1] = await db.insert(leadContactsTable).values({
      orgId: orgA, leadResultId: result!.id, name: "Contacto 1", provider: "mock", status: "encontrado",
    }).returning();
    cleanupContactIds.push(contact1!.id);
    const [contact2] = await db.insert(leadContactsTable).values({
      orgId: orgA, leadResultId: result!.id, name: "Contacto 2", provider: "mock", status: "encontrado",
    }).returning();
    cleanupContactIds.push(contact2!.id);

    const [msg1] = await db.insert(leadMessagesTable).values({
      orgId: orgA, resultId: result!.id, contactId: contact1!.id, channel: "email", content: "Hola contacto 1", status: "sent",
    }).returning();
    cleanupMessageIds.push(msg1!.id);
    const [msg2] = await db.insert(leadMessagesTable).values({
      orgId: orgA, resultId: result!.id, contactId: contact2!.id, channel: "email", content: "Hola contacto 2", status: "sent",
    }).returning();
    cleanupMessageIds.push(msg2!.id);

    const filtered = await fetch(`${base}/api/leads/results/${result!.id}/messages?contactId=${contact1!.id}`);
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as Array<{ id: number; content: string }>;
    expect(filteredBody).toHaveLength(1);
    expect(filteredBody[0]!.content).toBe("Hola contacto 1");

    // Sin el parámetro, el comportamiento es idéntico al de siempre: devuelve TODOS los mensajes del lead_result.
    const unfiltered = await fetch(`${base}/api/leads/results/${result!.id}/messages`);
    expect(unfiltered.status).toBe(200);
    const unfilteredBody = await unfiltered.json() as unknown[];
    expect(unfilteredBody).toHaveLength(2);
  });
});
