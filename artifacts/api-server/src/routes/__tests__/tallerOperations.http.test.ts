// Omni Taller — contrato HTTP del router real (tallerRouter) con identidad simulada.
//  · Validación y permisos: no tocan la base de datos, se ejecutan siempre.
//  · Aislamiento entre workspaces, enlaces cita/presupuesto y fecha de entrega: necesitan Postgres desechable (DATABASE_URL);
//    se omiten limpiamente sin ella.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, clientsTable, repairOrdersTable } from "@workspace/db";
import { tallerRouter } from "../taller";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

interface Identity { orgId: number; role: string }
let id: Identity = { orgId: 1, role: "admin" };
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: id.orgId, userId: 42, orgRole: id.role, effectiveRole: id.role, isSuperAdmin: false, clerkUserId: "clerk_42" });
    next();
  });
  app.use("/api/taller", tallerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taller`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { id = { orgId: 1, role: "admin" }; });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = {};
  try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, body: json as Record<string, any> };
};

describe("permisos y validación (sin base de datos)", () => {
  it("read_only puede leer pero no crear, editar ni buscar clientes para una orden: 403", async () => {
    id = { orgId: 1, role: "read_only" };
    expect((await call("POST", "/orders", { clientId: 1 })).status).toBe(403);
    expect((await call("PATCH", "/orders/1", { stage: "ready" })).status).toBe(403);
    expect((await call("GET", "/clients?q=ana")).status).toBe(403);
  });

  it("estado, tipo de servicio y kilómetros no válidos se rechazan con 400 (antes se sustituían en silencio)", async () => {
    const stage = await call("PATCH", "/orders/1", { stage: "volando" });
    expect([stage.status, stage.body["error"]]).toEqual([400, "invalid_stage"]);
    const svc = await call("PATCH", "/orders/1", { serviceType: "magia" });
    expect([svc.status, svc.body["error"]]).toEqual([400, "invalid_service_type"]);
    expect((await call("PATCH", "/orders/1", { vehicleMileageKm: -5 })).body["error"]).toBe("invalid_mileage");
    expect((await call("PATCH", "/orders/1", { vehicleMileageKm: 1.5 })).body["error"]).toBe("invalid_mileage");
    expect((await call("POST", "/orders", { clientId: 1, serviceType: "magia" })).body["error"]).toBe("invalid_service_type");
    expect((await call("POST", "/orders", { clientId: 1, vehicleMileageKm: -1 })).body["error"]).toBe("invalid_mileage");
    expect((await call("GET", "/orders?stage=volando")).body["error"]).toBe("invalid_stage");
  });

  it("cliente obligatorio e identificador numérico", async () => {
    expect((await call("POST", "/orders", {})).body["error"]).toBe("client_id_required");
    expect((await call("PATCH", "/orders/abc", { stage: "ready" })).status).toBe(400);
  });
});

describe.skipIf(!hasRealDb)("aislamiento entre workspaces y ciclo de la orden (Postgres)", () => {
  let A = 0, B = 0, clientA = 0, clientB = 0;
  beforeAll(async () => {
    [A, B] = await createTempOrgs(2, "tallerops");
    const [a] = await db.insert(clientsTable).values({ orgId: A, name: "Ana Taller", email: `ana-${Date.now()}@test.local` } as never).returning();
    const [b] = await db.insert(clientsTable).values({ orgId: B, name: "Beto Taller", email: `beto-${Date.now()}@test.local` } as never).returning();
    clientA = a!.id; clientB = b!.id;
  });
  afterAll(async () => { await deleteTempOrgs([A, B]); });
  const asA = () => { id = { orgId: A, role: "admin" }; };
  const asB = () => { id = { orgId: B, role: "admin" }; };

  it("A no puede crear una orden con un cliente de B (404) ni enlazar citas o presupuestos ajenos (400)", async () => {
    asA();
    expect((await call("POST", "/orders", { clientId: clientB })).status).toBe(404);
    expect((await call("POST", "/orders", { clientId: clientA, quoteId: 999999999 })).body["error"]).toBe("quote_not_found");
    expect((await call("POST", "/orders", { clientId: clientA, appointmentId: 999999999 })).body["error"]).toBe("appointment_not_found");
    expect((await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.orgId, A))).length).toBe(0);
  });

  it("el buscador de clientes solo devuelve los del workspace", async () => {
    asA();
    expect((await call("GET", "/clients?q=Taller")).body).toEqual([expect.objectContaining({ id: clientA, name: "Ana Taller" })]);
    asB();
    expect((await call("GET", "/clients?q=Ana")).body).toEqual([]);
  });

  it("crear normaliza la matrícula, listar y buscar funcionan, y B no ve ni toca lo de A", async () => {
    asA();
    const created = await call("POST", "/orders", { clientId: clientA, vehiclePlate: " 1234abc ", vehicleModel: "Seat Ibiza", vehicleMileageKm: 80000, serviceType: "itv" });
    expect([created.status, created.body["vehiclePlate"], created.body["serviceType"]]).toEqual([201, "1234ABC", "itv"]);
    expect((await call("GET", "/orders?q=ibiza")).body).toHaveLength(1);
    expect((await call("GET", "/orders?q=zzz")).body).toHaveLength(0);
    asB();
    expect((await call("GET", "/orders")).body).toEqual([]);
    expect((await call("PATCH", `/orders/${created.body["id"]}`, { stage: "ready" })).status).toBe(404);
    const [row] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, created.body["id"]));
    expect(row!.stage).toBe("received");
  });

  it("entregar fija la fecha de entrega y reabrir la borra; editar los datos del vehículo funciona", async () => {
    asA();
    const { body: o } = await call("POST", "/orders", { clientId: clientA, vehiclePlate: "9999ZZZ" });
    const delivered = await call("PATCH", `/orders/${o["id"]}`, { stage: "delivered" });
    expect(delivered.body["deliveredAt"]).toBeTruthy();
    const reopened = await call("PATCH", `/orders/${o["id"]}`, { stage: "in_repair", vehicleModel: "León", notes: "  revisar frenos  " });
    expect([reopened.body["deliveredAt"], reopened.body["vehicleModel"], reopened.body["notes"]]).toEqual([null, "León", "revisar frenos"]);
  });
});
