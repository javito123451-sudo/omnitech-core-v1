// Omni Fleet — contrato HTTP del router real (fleetRouter) con identidad simulada.
//  · Validaciones y permisos: no tocan la base de datos, se ejecutan siempre.
//  · Aislamiento entre workspaces y cambio manual de estado con contadores: necesitan Postgres desechable (DATABASE_URL);
//    se omiten limpiamente sin ella (mismo criterio que fleetDeliveryUpdate.integration.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, fleetDriversTable, fleetVehiclesTable, fleetRoutesTable, fleetDeliveriesTable } from "@workspace/db";
import { fleetRouter } from "../fleet";
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
  app.use("/api/fleet", fleetRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fleet`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { id = { orgId: 1, role: "admin" }; });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: Record<string, any> = {};
  try { json = await res.json() as Record<string, any>; } catch { /* sin cuerpo */ }
  return { status: res.status, body: json };
};

describe("permisos y validación (sin base de datos)", () => {
  it("read_only puede leer pero no escribir: cualquier alta o cambio da 403", async () => {
    id = { orgId: 1, role: "read_only" };
    for (const [m, p, b] of [
      ["POST", "/drivers", { name: "Ana" }], ["POST", "/vehicles", { plate: "1234ABC" }], ["POST", "/routes", { name: "R", date: "2026-09-21" }],
      ["POST", "/routes/1/deliveries", { address: "x" }], ["PATCH", "/drivers/1", { name: "x" }], ["PATCH", "/routes/1/deliveries/1", { status: "delivered" }],
    ] as const) {
      expect((await call(m, p, b)).status, `${m} ${p}`).toBe(403);
    }
  });

  it("estados no válidos se rechazan con 400 y la lista de los permitidos", async () => {
    for (const [m, p, b] of [
      ["POST", "/drivers", { name: "Ana", status: "volando" }], ["PATCH", "/drivers/1", { status: "volando" }],
      ["POST", "/vehicles", { plate: "1234ABC", status: "volando" }], ["PATCH", "/vehicles/1", { status: "volando" }],
      ["PATCH", "/routes/1", { status: "volando" }], ["PATCH", "/routes/1/deliveries/1", { status: "volando" }],
    ] as const) {
      const r = await call(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(400);
      expect(r.body["error"]).toBe("invalid_status");
      expect(Array.isArray(r.body["allowed"])).toBe(true);
    }
  });

  it("campos obligatorios y formato de fecha", async () => {
    expect((await call("POST", "/drivers", { name: "  " })).body["error"]).toBe("name_required");
    expect((await call("POST", "/vehicles", {})).body["error"]).toBe("plate_required");
    expect((await call("POST", "/routes", { name: "R" })).body["error"]).toBe("name_and_date_required");
    const badDate = await call("POST", "/routes", { name: "R", date: "21/09/2026" });
    expect([badDate.status, badDate.body["error"]]).toEqual([400, "invalid_date"]);
  });

  it("identificadores no numéricos dan 400 (no llegan a la base de datos)", async () => {
    expect((await call("PATCH", "/drivers/abc", { name: "x" })).status).toBe(400);
    expect((await call("PATCH", "/vehicles/abc", { model: "x" })).status).toBe(400);
    expect((await call("PATCH", "/routes/abc", { status: "pending" })).status).toBe(400);
    expect((await call("PATCH", "/routes/1/deliveries/abc", { status: "pending" })).status).toBe(400);
  });
});

describe.skipIf(!hasRealDb)("aislamiento entre workspaces y cambio manual de estado (Postgres)", () => {
  let A = 0, B = 0;
  beforeAll(async () => { [A, B] = await createTempOrgs(2, "fleetops"); });
  afterAll(async () => { await deleteTempOrgs([A, B]); });

  const asA = () => { id = { orgId: A, role: "admin" }; };
  const asB = () => { id = { orgId: B, role: "admin" }; };

  it("A no puede enlazar rutas ni vehículos con conductores, vehículos o clientes de B (400), y no queda nada creado", async () => {
    asB();
    const driverB = (await call("POST", "/drivers", { name: "Conductor de B" })).body as { id: number };
    const vehicleB = (await call("POST", "/vehicles", { plate: `B-${Date.now()}` })).body as { id: number };
    asA();
    expect((await call("POST", "/routes", { name: "R", date: "2026-09-21", driverId: driverB.id })).body["error"]).toBe("driver_not_found");
    expect((await call("POST", "/routes", { name: "R", date: "2026-09-21", vehicleId: vehicleB.id })).body["error"]).toBe("vehicle_not_found");
    expect((await call("POST", "/vehicles", { plate: `A-${Date.now()}`, driverId: driverB.id })).body["error"]).toBe("driver_not_found");
    const routeA = (await call("POST", "/routes", { name: "R de A", date: "2026-09-21" })).body as { id: number };
    expect((await call("PATCH", `/routes/${routeA.id}`, { driverId: driverB.id })).body["error"]).toBe("driver_not_found");
    expect((await call("POST", `/routes/${routeA.id}/deliveries`, { address: "x", clientId: 999999999 })).body["error"]).toBe("client_not_found");
    expect((await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.orgId, A))).map((r) => r.name)).toEqual(["R de A"]);
  });

  it("B no puede leer ni modificar lo de A: listas vacías y 404 en cambios", async () => {
    asA();
    const driverA = (await call("POST", "/drivers", { name: "Conductor de A" })).body as { id: number };
    const routeA = (await call("POST", "/routes", { name: "Ruta A2", date: "2026-09-22", driverId: driverA.id })).body as { id: number };
    const deliveryA = (await call("POST", `/routes/${routeA.id}/deliveries`, { address: "Calle A 1" })).body as { id: number };
    asB();
    expect((await call("GET", "/drivers")).body).not.toContainEqual(expect.objectContaining({ name: "Conductor de A" }));
    expect((await call("GET", `/routes/${routeA.id}/deliveries`)).body).toEqual([]);
    expect((await call("PATCH", `/drivers/${driverA.id}`, { name: "hack" })).status).toBe(404);
    expect((await call("PATCH", `/routes/${routeA.id}`, { status: "cancelled" })).status).toBe(404);
    expect((await call("PATCH", `/routes/${routeA.id}/deliveries/${deliveryA.id}`, { status: "delivered" })).status).toBe(404);
    expect((await call("POST", `/routes/${routeA.id}/deliveries`, { address: "intruso" })).status).toBe(404);
    const [d] = await db.select().from(fleetDriversTable).where(eq(fleetDriversTable.id, driverA.id));
    expect(d!.name).toBe("Conductor de A");
  });

  it("cambio manual de estado: los contadores de la ruta suben y bajan sin duplicarse", async () => {
    asA();
    const route = (await call("POST", "/routes", { name: "Ruta contadores", date: "2026-09-23" })).body as { id: number };
    const d1 = (await call("POST", `/routes/${route.id}/deliveries`, { address: "Uno" })).body as { id: number };
    const d2 = (await call("POST", `/routes/${route.id}/deliveries`, { address: "Dos" })).body as { id: number };
    const counters = async () => { const [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route.id)); return [r!.totalStops, r!.completedStops, r!.incidentStops]; };
    expect(await counters()).toEqual([2, 0, 0]);

    await call("PATCH", `/routes/${route.id}/deliveries/${d1.id}`, { status: "delivered", note: "ok" });
    await call("PATCH", `/routes/${route.id}/deliveries/${d1.id}`, { status: "delivered" });      // repetido: no cuenta doble
    expect(await counters()).toEqual([2, 1, 0]);
    await call("PATCH", `/routes/${route.id}/deliveries/${d2.id}`, { status: "incident", note: "cliente ausente" });
    expect(await counters()).toEqual([2, 1, 1]);
    await call("PATCH", `/routes/${route.id}/deliveries/${d1.id}`, { status: "failed" });         // entregada -> fallida
    expect(await counters()).toEqual([2, 0, 2]);

    const [row] = await db.select().from(fleetDeliveriesTable).where(eq(fleetDeliveriesTable.id, d2.id));
    expect([row!.status, row!.lastStatusNote]).toEqual(["incident", "cliente ausente"]);
  });

  it("dos cambios simultáneos no se pisan (incrementos en SQL)", async () => {
    asA();
    const route = (await call("POST", "/routes", { name: "Ruta concurrente", date: "2026-09-24" })).body as { id: number };
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => call("POST", `/routes/${route.id}/deliveries`, { address: `Calle ${i}` }).then((r) => r.body["id"] as number)));
    await Promise.all(ids.map((d) => call("PATCH", `/routes/${route.id}/deliveries/${d}`, { status: "delivered" })));
    const [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route.id));
    expect([r!.totalStops, r!.completedStops]).toEqual([6, 6]);
  });

  it("una matrícula repetida en el mismo workspace da 409, y es válida en otro", async () => {
    const plate = `DUP-${Date.now()}`;
    asA();
    expect((await call("POST", "/vehicles", { plate })).status).toBe(201);
    expect((await call("POST", "/vehicles", { plate })).status).toBe(409);
    asB();
    expect((await call("POST", "/vehicles", { plate })).status).toBe(201);
    expect((await db.select().from(fleetVehiclesTable).where(eq(fleetVehiclesTable.plate, plate))).length).toBe(2);
  });
});
