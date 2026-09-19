// Endpoints de Super Admin de la capa comercial v1 (catálogo de packs, compras con paymentReference
// como clave de idempotencia, precios oficiales), contra Postgres real con el router real.
//
// Requiere ci-test con las migraciones 0004-0008. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, like } from "drizzle-orm";
import { db, aiModelPricingTable, creditPacksTable } from "@workspace/db";
import { getBalances, listLedger } from "../creditService";
import { creditsAdminRouter } from "../../routes/credits-admin";
import { refreshPricing } from "../../ai-gateway/pricingService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const PACK = `smoke_http_${Date.now()}`;

async function serve(strict: boolean) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.clerkUserId = strict ? "test-admin" : "test-staff"; req.isSuperAdmin = strict; next(); });
  app.use("/credits", creditsAdminRouter);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/credits` };
}
const close = (s: Server) => new Promise<void>((r) => { s.close(() => r()); });
const call = (base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe.skipIf(!hasRealDb)("Super Admin — packs, compras y precios oficiales (HTTP)", () => {
  let admin: { server: Server; base: string };
  let staff: { server: Server; base: string };
  let orgs: number[] = [];
  beforeAll(async () => {
    orgs = await createTempOrgs(4, "admin-http");
    admin = await serve(true);
    staff = await serve(false);
  });
  afterAll(async () => {
    await close(admin.server); await close(staff.server);
    await db.delete(creditPacksTable).where(inArray(creditPacksTable.code, [PACK]));
    await db.delete(aiModelPricingTable).where(like(aiModelPricingTable.provider, "smoke-http-%"));
    await refreshPricing();
    await deleteTempOrgs(orgs);
  });

  it("GET /packs devuelve el catálogo oficial", async () => {
    const res = await call(admin.base, "GET", "/packs");
    expect(res.status).toBe(200);
    const packs = await res.json() as Array<{ code: string; credits: number; priceAmount: number }>;
    expect(packs.filter((p) => p.code.startsWith("pack_")).map((p) => [p.credits, p.priceAmount])).toEqual([[25000, 29], [100000, 89], [250000, 199], [1000000, 599]]);
  });

  it("PUT /packs/:code: solo SUPER_ADMIN estricto, valida y devuelve antes/después", async () => {
    expect((await call(staff.base, "PUT", `/packs/${PACK}`, { credits: 10, priceAmount: 1 })).status).toBe(403);
    expect((await call(admin.base, "PUT", `/packs/${PACK}`, { credits: 0, priceAmount: 1 })).status).toBe(400);
    const created = await call(admin.base, "PUT", `/packs/${PACK}`, { credits: 500, priceAmount: 5 });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ previous: null, current: { code: PACK, credits: 500, priceAmount: 5 } });
    const changed = await call(admin.base, "PUT", `/packs/${PACK}`, { priceAmount: 6 });
    expect(await changed.json()).toMatchObject({ previous: { priceAmount: 5 }, current: { priceAmount: 6 } });
  });

  it("compra de un pack: exige paymentReference (cuerpo o Idempotency-Key) y un doble envío no duplica créditos", async () => {
    const org = orgs[0]!;
    const noKey = await call(admin.base, "POST", `/${org}/purchases`, { packCode: "pack_25k" });
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toMatchObject({ status: "CREDIT_INVALID" });
    expect((await getBalances(org)).balance).toBe(0);

    const first = await call(admin.base, "POST", `/${org}/purchases`, { packCode: "pack_25k", paymentReference: "http-pay-1" });
    const second = await call(admin.base, "POST", `/${org}/purchases`, { packCode: "pack_25k", paymentReference: "http-pay-1" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(await getBalances(org)).toMatchObject({ balance: 25000, extra: 25000 });
    expect(await listLedger(org)).toHaveLength(1);

    // misma clave como cabecera
    const h = { "idempotency-key": "http-pay-2" };
    expect((await call(admin.base, "POST", `/${org}/purchases`, { packCode: "pack_100k" }, h)).status).toBe(201);
    expect((await call(admin.base, "POST", `/${org}/purchases`, { packCode: "pack_100k" }, h)).status).toBe(200);
    expect((await getBalances(org)).balance).toBe(125000);
  });

  it("una compra libre también exige paymentReference, y un pack desconocido es un error controlado", async () => {
    const org = orgs[1]!;
    expect((await call(admin.base, "POST", `/${org}/purchases`, { credits: 100 })).status).toBe(400);
    const unknown = await call(admin.base, "POST", `/${org}/purchases`, { packCode: "nada", paymentReference: "http-pay-x" });
    expect(unknown.status).toBe(400);
    const free = await call(admin.base, "POST", `/${org}/purchases`, { credits: 100, paymentReference: "http-pay-3" });
    expect({ status: free.status, body: free.status === 201 ? "ok" : await free.text() }).toEqual({ status: 201, body: "ok" });
    expect((await getBalances(org)).extra).toBe(100);
  });

  it("las compras de una organización no aparecen en otra", async () => {
    const [a, b] = [orgs[2]!, orgs[3]!];
    await call(admin.base, "POST", `/${a}/purchases`, { packCode: "pack_25k", paymentReference: "http-iso" });
    await call(admin.base, "POST", `/${b}/purchases`, { packCode: "pack_100k", paymentReference: "http-iso" });
    expect((await getBalances(a)).balance).toBe(25000);
    expect((await getBalances(b)).balance).toBe(100000);
    const view = await (await call(admin.base, "GET", `/${a}`)).json() as { purchases: Array<{ orgId: number }> };
    expect(view.purchases.every((p) => p.orgId === a)).toBe(true);
  });

  it("POST /pricing/official: todo-o-nada, con fuente obligatoria; solo SUPER_ADMIN estricto", async () => {
    const entry = { provider: "smoke-http-openai", model: "modelo-oficial", inputCost: 1, cachedInputCost: 0.1, outputCost: 4, source: "https://docs.example.test/prices" };
    expect((await call(staff.base, "POST", "/pricing/official", { entries: [entry] })).status).toBe(403);
    expect((await call(admin.base, "POST", "/pricing/official", { entries: [] })).status).toBe(400);
    expect((await call(admin.base, "POST", "/pricing/official", { entries: [entry, { ...entry, model: "b", source: "" }] })).status).toBe(400);
    const none = await (await call(admin.base, "GET", "/pricing?provider=smoke-http-openai")).json() as unknown[];
    expect(none).toEqual([]);                                  // el fallo no escribió nada

    const ok = await call(admin.base, "POST", "/pricing/official", { entries: [entry] });
    expect(ok.status).toBe(201);
    const report = await (await call(admin.base, "GET", "/pricing/report")).json() as { official: Array<{ provider: string; provisional: boolean }>; legacyProvisional: Array<{ model: string }> };
    expect(report.official).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "smoke-http-openai", provisional: false })]));
    expect(report.legacyProvisional.map((m) => m.model)).toContain("gpt-4o-mini"); // el modelo antiguo no se borra: sigue provisional
  });
});
