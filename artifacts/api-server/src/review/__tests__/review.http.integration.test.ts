// Aislamiento multiempresa, permisos y gate de módulo de /api/review — con el router
// REAL y Postgres REAL (sin mocks de BD). Requiere DATABASE_URL de una BD desechable.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db, auditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { reviewRouter } from "../routes";
import { cleanupOrgs, createOrg, hasRealDb, setModule, startApp, type Identity } from "./testHarness";

const PLACE_A = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const PLACE_B = "ChIJ2eUgeAK6j4ARbn5u_wAGqWA";

describe.skipIf(!hasRealDb)("/api/review — aislamiento, permisos y módulo (Postgres real)", () => {
  let orgA = 0, orgB = 0, orgOff = 0, orgNoRow = 0;
  let identity: Identity = {};
  let base = "";
  let close: () => Promise<void>;

  beforeAll(async () => {
    [orgA, orgB, orgOff, orgNoRow] = [await createOrg("A"), await createOrg("B"), await createOrg("off"), await createOrg("norow")];
    await setModule(orgA, true); await setModule(orgB, true); await setModule(orgOff, false); await setModule(orgNoRow, null);
    ({ base, close } = await startApp((app) => app.use("/api/review", reviewRouter), () => identity));
  });
  afterAll(async () => { await close(); await cleanupOrgs([orgA, orgB, orgOff, orgNoRow]); });

  // json() tipado como any: son respuestas de nuestra propia API, validadas por las aserciones.
  type Res = Omit<Response, "json"> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = (path: string, method = "GET", body?: unknown) =>
    fetch(`${base}/api/review${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<Res>;
  const as = (orgId: number, role = "owner", superAdmin = false) => { identity = { orgId, role, superAdmin }; };

  describe("gate del módulo (fail-closed)", () => {
    it("sin fila en module_configs → 403 module_disabled (a diferencia de requireModule, que lo dejaría pasar)", async () => {
      as(orgNoRow); const r = await call("/locations");
      expect(r.status).toBe(403); expect((await r.json()).error).toBe("module_disabled");
    });
    it("fila desactivada → 403", async () => { as(orgOff); expect((await call("/locations")).status).toBe(403); });
    it("fila activada → 200", async () => { as(orgA); expect((await call("/locations")).status).toBe(200); });
    it("sin contexto de organización → 403", async () => { identity = { role: "owner" }; expect((await call("/locations")).status).toBe(403); });
    it("SUPER_ADMIN supervisa aunque el módulo esté apagado", async () => { as(orgOff, "owner", true); expect((await call("/overview")).status).toBe(200); });
    it("un error de BD al comprobar el módulo deniega (503), nunca abre", async () => {
      as(orgA);
      const spy = vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("db down"); });
      const r = await call("/locations");
      spy.mockRestore();
      expect(r.status).toBe(503);
    });
  });

  describe("matriz de permisos", () => {
    const body = { name: "Local" };
    it.each([
      ["owner", 201], ["admin", 201], ["manager", 201],
      ["member", 403], ["vendedor", 403], ["read_only", 403], ["cliente", 403],
    ])("POST /locations con rol %s → %i", async (role, status) => {
      as(orgA, role); expect((await call("/locations", "POST", { ...body, name: `L-${role}` })).status).toBe(status);
    });
    it.each([["owner", 200], ["member", 200], ["vendedor", 200], ["read_only", 200], ["cliente", 403], ["sin-rol", 403]])(
      "GET /locations con rol %s → %i", async (role, status) => { as(orgA, role); expect((await call("/locations")).status).toBe(status); });
    it("DELETE exige review.write", async () => {
      as(orgA, "owner"); const created = await (await call("/locations", "POST", { name: "Borrable" })).json();
      as(orgA, "read_only"); expect((await call(`/locations/${created.location.id}`, "DELETE")).status).toBe(403);
    });
  });

  describe("aislamiento entre empresas", () => {
    let locA = 0;
    beforeAll(async () => {
      as(orgA); const r = await (await call("/locations", "POST", { name: "Sede A", googlePlaceId: PLACE_A })).json(); locA = r.location.id;
    });

    it("B no ve en el listado lo de A", async () => {
      as(orgB); const names = (await (await call("/locations")).json()).locations.map((l: { name: string }) => l.name);
      expect(names).not.toContain("Sede A");
    });
    it("B no puede leer, editar ni archivar un establecimiento de A (404, no 403: no revela existencia)", async () => {
      as(orgB);
      expect((await call(`/locations/${locA}`)).status).toBe(404);
      expect((await call(`/locations/${locA}`, "PATCH", { name: "Hackeado" })).status).toBe(404);
      expect((await call(`/locations/${locA}`, "DELETE")).status).toBe(404);
      as(orgA); const still = await (await call(`/locations/${locA}`)).json();
      expect(still.location.name).toBe("Sede A"); expect(still.location.status).toBe("active");
    });
    it("el orgId del cuerpo se rechaza y el de la query se ignora", async () => {
      as(orgB);
      const inBody = await call("/locations", "POST", { name: "Intruso", orgId: orgA });
      expect(inBody.status).toBe(400);
      const viaQuery = await (await (fetch(`${base}/api/review/locations?orgId=${orgA}`) as Promise<Res>)).json();
      expect(viaQuery.locations.map((l: { name: string }) => l.name)).not.toContain("Sede A");
    });
    it("mismo Place ID permitido en otra empresa; duplicado en la misma → 409", async () => {
      as(orgB); expect((await call("/locations", "POST", { name: "Sede B", googlePlaceId: PLACE_A })).status).toBe(201);
      as(orgA); expect((await call("/locations", "POST", { name: "Otra A", googlePlaceId: PLACE_A })).status).toBe(409);
    });
    it("overview cuenta solo lo de cada empresa", async () => {
      as(orgA); const a = await (await call("/overview")).json();
      as(orgB); const b = await (await call("/overview")).json();
      expect(a.locations).toBeGreaterThan(b.locations);
      expect(b.locations).toBe(1);
    });
  });

  describe("integridad de datos y honestidad del panel", () => {
    it("la URL de reseña la deriva el servidor del Place ID; el cliente no puede fijarla", async () => {
      as(orgA);
      const r = await (await call("/locations", "POST", { name: "Con URL", googlePlaceId: PLACE_B })).json();
      expect(r.location.googleReviewUrl).toBe(`https://search.google.com/local/writereview?placeid=${PLACE_B}`);
      expect((await call("/locations", "POST", { name: "x", googleReviewUrl: "https://evil.example" })).status).toBe(400);
    });
    it("Place ID con formato inválido → 400", async () => {
      as(orgA); expect((await call("/locations", "POST", { name: "Malo", googlePlaceId: "no válido!" })).status).toBe(400);
    });
    it("overview: sin Google conectado las reseñas se declaran no disponibles (no un 0 engañoso)", async () => {
      as(orgA); const o = await (await call("/overview")).json();
      expect(o.reviews.available).toBe(false); expect(o.reviews.reason).toMatch(/no está conectado/);
      expect(o.messages).toEqual({ queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, clicked: 0 });
    });
    it("registra auditoría de la creación con la empresa correcta", async () => {
      as(orgA); const r = await (await call("/locations", "POST", { name: "Auditada" })).json();
      await new Promise((res) => setTimeout(res, 100));
      const rows = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, orgA), eq(auditLogsTable.action, "review.location_created"), eq(auditLogsTable.resourceId, String(r.location.id))));
      expect(rows.length).toBe(1);
    });
  });
});
