// OmniSeller Fase 11 — Auditoría técnica, hardening y cierre de riesgos.
//
// Este archivo cubre el único hallazgo clasificado como A (bug real,
// corregido en este mismo cierre) de la Parte 7 del mandato: ningún
// :id/:contactId/:messageId/:leadMessageId de las rutas de OmniSeller se
// validaba como numérico antes de usarse en una consulta. Un valor no
// numérico (típicamente Number("algo") = NaN) llegaba tal cual hasta
// Postgres, que lo rechazaba con una excepción — en missions.ts esa
// excepción se capturaba y se devolvía como `res.status(500).json({error:
// String(err)})`, filtrando el texto crudo de la consulta SQL (nombres de
// columnas y tabla) en el cuerpo de la respuesta a cualquier caller
// autenticado; en outreachFollowup.ts, al no haber ningún catch propio,
// Express 5 la reenviaba a su manejador de errores por defecto (sin el
// mismo volcado de SQL, pero tampoco un 400 limpio).
//
// Arreglo: un guard `Number.isFinite(...)` justo después de cada
// `Number(req.params...)`, devolviendo 400 antes de tocar la base de datos
// — mismo patrón ya usado en outreachBookings.ts desde Fase 8/10.
// assertMissionOpen (outreach/outreachService.ts) se corrigió una sola vez,
// cubriendo de paso las 3 rutas que ya delegaban en ella.
//
// También cubre el hallazgo menor, mismo Parte 7: `ids` en el body de
// POST /:id/research se filtra a enteros finitos antes de usarse en
// inArray(...) — un elemento no numérico ya no crashea la petición
// completa, simplemente se ignora.
//
// Requiere una base de datos real desechable en DATABASE_URL. Se omite
// limpiamente sin DB real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, missionsTable, leadSearchesTable, leadResultsTable, usersTable } from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const { missionsRouter } = await import("../missions");
const { outreachFollowupRouter } = await import("../outreachFollowup");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 11 — Parte 7: validación de IDs en rutas OmniSeller", () => {
  let orgId: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgId] = await createTempOrgs(1, "omniseller-f11");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f11-user" });
      next();
    });
    app.use("/api/missions", missionsRouter);
    app.use("/api/outreach/followups", outreachFollowupRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await deleteTempOrgs([orgId]);
  });

  async function seedMission() {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F11 ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId, searchId: search!.id, name: `Empresa F11 ${Date.now()}`, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);
    return { missionId: mission!.id, resultId: result!.id };
  }

  it("GET /api/missions/:id con id no numérico → 400 limpio, sin filtrar SQL crudo en la respuesta", async () => {
    const resp = await fetch(`${base}/api/missions/no-es-un-numero`);
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).not.toMatch(/select|from|where/i); // nunca texto de consulta SQL en la respuesta
  });

  it("POST /api/missions/:id/research con id no numérico → 400", async () => {
    const resp = await fetch(`${base}/api/missions/abc/research`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/missions/:id/research con un elemento no numérico en ids → no crashea, se ignora", async () => {
    const { missionId } = await seedMission();
    const resp = await fetch(`${base}/api/missions/${missionId}/research`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["no-es-un-numero", null, {}] }),
    });
    // Ningún id válido sobrevive el filtro → inArray(id, []) no debería
    // ejecutarse con basura; la petición responde limpio, nunca 500.
    expect(resp.status).not.toBe(500);
    expect([200, 402]).toContain(resp.status);
  });

  it("POST /api/missions/:id/contacts/find con id no numérico → 400", async () => {
    const resp = await fetch(`${base}/api/missions/xyz/contacts/find`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadResultId: 1 }),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/missions/:id/contacts/:contactId/messages con contactId no numérico → 400", async () => {
    const { missionId } = await seedMission();
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/no-numerico/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "email", content: "hola" }),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/missions/:id/messages/:messageId/request-confirmation con messageId no numérico → 400", async () => {
    const { missionId } = await seedMission();
    const resp = await fetch(`${base}/api/missions/${missionId}/messages/no-numerico/request-confirmation`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/missions/:id/messages/:messageId/confirm con messageId no numérico → 400", async () => {
    const { missionId } = await seedMission();
    const resp = await fetch(`${base}/api/missions/${missionId}/messages/no-numerico/confirm`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmToken: "x" }),
    });
    expect(resp.status).toBe(400);
  });

  it("assertMissionOpen rechaza un missionId no numérico con 400 (cubre las 3 rutas que delegan en él)", async () => {
    const resp = await fetch(`${base}/api/missions/no-numerico/messages/1/confirm`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmToken: "x" }),
    });
    // El path param :id es "no-numerico" — llega como NaN a assertMissionOpen.
    expect(resp.status).toBe(400);
  });

  it("GET /api/outreach/followups/message/:leadMessageId con leadMessageId no numérico → 400", async () => {
    const resp = await fetch(`${base}/api/outreach/followups/message/no-numerico`);
    expect(resp.status).toBe(400);
  });

  it("GET /api/outreach/followups/:id con id no numérico → 400", async () => {
    const resp = await fetch(`${base}/api/outreach/followups/no-numerico`);
    expect(resp.status).toBe(400);
  });

  it("POST /api/outreach/followups/:id/cancel con id no numérico → 400", async () => {
    const resp = await fetch(`${base}/api/outreach/followups/no-numerico/cancel`, { method: "POST" });
    expect(resp.status).toBe(400);
  });

  it("regresión: un id numérico válido pero inexistente sigue devolviendo 404 (el guard no rompe el camino normal)", async () => {
    const resp = await fetch(`${base}/api/missions/999999999`);
    expect(resp.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OmniSeller Fase 15 — Parte 9 del mandato ("Permisos"): auditoría end-to-end
// confirmó que NINGÚN test existente de OmniSeller (Fase 1-14) ejercita el
// camino de RECHAZO de requirePermission — todos montan sus routers con
// orgRole:"owner" fijo, que tiene todos los permisos. Este bloque prueba el
// enforcement real (middlewares/permissions.ts), no solo que la ruta exista:
//  - "read_only" tiene omniseller.read pero NO omniseller.write (ver
//    PERMISSIONS_BY_ROLE) → puede leer, no puede ejecutar escrituras.
//  - "cliente" no tiene ningún permiso omniseller.* → 403 incluso en lectura.
// No se crea ningún permiso nuevo — solo se ejercita el ya existente.
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasRealDb)("OmniSeller Fase 15 — Parte 9: aplicación real de permisos (omniseller.read/write)", () => {
  let orgId: number;
  let userId: number;
  let server: Server;
  let base = "";
  let currentRole = "owner";
  const cleanupMissionIds: number[] = [];

  beforeAll(async () => {
    [orgId] = await createTempOrgs(1, "omniseller-f15-perms");
    // missions.ownerId / created_by referencian users.id de verdad (FK) —
    // un usuario real, igual que en Fase 1, no un id inventado.
    const suffix = Date.now();
    const [user] = await db.insert(usersTable)
      .values({ clerkId: `omniseller-f15-perms-user-${suffix}`, email: `omniseller-f15-perms-${suffix}@example.com` }).returning();
    userId = user!.id;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId, orgRole: currentRole, userId, clerkUserId: `omniseller-f15-perms-user-${suffix}` });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await deleteTempOrgs([orgId]);
  });

  it("con rol owner: crea una misión para las siguientes pruebas de lectura/escritura", async () => {
    currentRole = "owner";
    const resp = await fetch(`${base}/api/missions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mission F15 permisos" }),
    });
    expect(resp.status).toBe(201);
    const body = await resp.json() as { id: number };
    cleanupMissionIds.push(body.id);
  });

  it("con rol read_only: puede leer (GET /api/missions/:id) pero no ejecutar escrituras", async () => {
    currentRole = "owner";
    const create = await fetch(`${base}/api/missions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mission F15 read_only" }),
    });
    const { id: missionId } = await create.json() as { id: number };
    cleanupMissionIds.push(missionId);

    currentRole = "read_only";
    const read = await fetch(`${base}/api/missions/${missionId}`);
    expect(read.status).toBe(200);

    const write = await fetch(`${base}/api/missions/${missionId}/research`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect(write.status).toBe(403);
    const body = await write.json() as { error: string; permission: string };
    expect(body.error).toBe("permission_denied");
    expect(body.permission).toBe("omniseller.write");
  });

  it("con rol cliente (sin ningún permiso omniseller.*): ni siquiera puede leer", async () => {
    currentRole = "owner";
    const create = await fetch(`${base}/api/missions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mission F15 cliente" }),
    });
    const { id: missionId } = await create.json() as { id: number };
    cleanupMissionIds.push(missionId);

    currentRole = "cliente";
    const read = await fetch(`${base}/api/missions/${missionId}`);
    expect(read.status).toBe(403);
    const body = await read.json() as { error: string; permission: string };
    expect(body.error).toBe("permission_denied");
    expect(body.permission).toBe("omniseller.read");

    const list = await fetch(`${base}/api/missions`);
    expect(list.status).toBe(403);
  });
});
