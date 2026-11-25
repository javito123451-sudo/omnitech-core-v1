// API de plantillas/campañas + enlaces públicos (clic y baja), con HTTP real y Postgres real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { db, reviewContactsTable, reviewMessagesTable, reviewEventsTable, auditLogsTable, outreachSuppressionsTable } from "@workspace/db";
import { reviewRouter } from "../routes";
import { reviewPublicRouter, isLikelyBot } from "../publicRoutes";
import { runTick } from "../engine/worker";
import { checkEligibility } from "../guard";
import { cleanupOrgs, fakeProvider, hasRealDb, registryOf, seedOrg, startApp, T0, type Identity, type Seed } from "./testHarness";

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

describe.skipIf(!hasRealDb)("API de campañas y enlaces públicos (HTTP + Postgres reales)", () => {
  let A: Seed, B: Seed; let identity: Identity = {};
  let base = ""; let close: () => Promise<void>; let pubBase = ""; let closePub: () => Promise<void>;
  const orgs: number[] = [];
  const oldKey = process.env["RESEND_API_KEY"], oldUrl = process.env["PUBLIC_URL"];

  beforeAll(async () => {
    process.env["RESEND_API_KEY"] = "test-key-no-real"; process.env["PUBLIC_URL"] = "https://app.test";
    A = await seedOrg("camp-a", Array.from({ length: 8 }, (_, i) => ({ email: `h${i}@camp.es`, phone: i < 4 ? `60011122${i}` : undefined })));
    B = await seedOrg("camp-b", Array.from({ length: 3 }, (_, i) => ({ email: `b${i}@camp.es` })));
    orgs.push(A.orgId, B.orgId);
    ({ base, close } = await startApp((app) => app.use("/api/review", reviewRouter), () => identity));
    const pub = express(); pub.use(express.urlencoded({ extended: true })); pub.use("/api/review-public", reviewPublicRouter);
    const srv = await new Promise<import("node:http").Server>((r) => { const s = pub.listen(0, "127.0.0.1", () => r(s)); });
    pubBase = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/review-public`; closePub = () => new Promise((r) => srv.close(() => r()));
  });
  afterAll(async () => {
    await close(); await closePub(); await cleanupOrgs(orgs);
    if (oldKey === undefined) delete process.env["RESEND_API_KEY"]; else process.env["RESEND_API_KEY"] = oldKey;
    if (oldUrl === undefined) delete process.env["PUBLIC_URL"]; else process.env["PUBLIC_URL"] = oldUrl;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Res = Omit<Response, "json"> & { json(): Promise<any> };
  const as = (s: Seed, role = "owner") => { identity = { orgId: s.orgId, role }; };
  const api = (path: string, method = "GET", body?: unknown) => fetch(`${base}/api/review${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<Res>;
  const campaignBody = (s: Seed, over = {}) => ({ name: "Reseñas dic", locationId: s.locationId, templateId: s.templateId, channel: "email", ratePerMinute: 600, ...over });

  describe("plantillas", () => {
    it("crea, lista y edita; rechaza incentivos con 400 y el motivo", async () => {
      as(A);
      const ok = await api("/templates", "POST", { channel: "email", name: "Dos", subject: "¿Qué tal con {{establecimiento}}?", body: "Hola {{nombre}}. Tu opinión nos importa: {{enlace}}" });
      expect(ok.status).toBe(201); const t = (await ok.json()).template; expect(t.variables.sort()).toEqual(["enlace", "establecimiento", "nombre"]);
      const bad = await api("/templates", "POST", { channel: "email", name: "x", subject: "s", body: "Opina y te hacemos un descuento {{enlace}}" });
      expect(bad.status).toBe(400); expect((await bad.json()).message).toMatch(/incentivos/);
      expect((await api(`/templates/${t.id}`, "PUT", { channel: "email", name: "Dos bis", subject: "s", body: "Hola {{nombre}} {{enlace}}" })).status).toBe(200);
      expect((await api(`/templates/${t.id}`, "PUT", { channel: "whatsapp", name: "x", body: "BAJA {{enlace}}" })).status).toBe(400); // no se cambia el canal
      expect((await (await api("/templates")).json()).templates.length).toBeGreaterThanOrEqual(2);
    });
    it("una plantilla de WhatsApp vuelve a «pending» al cambiar el texto: la aprobación de Meta no se hereda", async () => {
      as(A); const w = await api("/templates", "POST", { channel: "whatsapp", name: "W", body: "Hola {{nombre}} {{enlace}} Responde BAJA para no recibir más.", waTemplateName: "w_one", waLanguage: "es" });
      const id = (await w.json()).template.id;
      await db.execute((await import("drizzle-orm")).sql`UPDATE review_templates SET wa_status = 'approved' WHERE id = ${id}::integer`);
      const r = await (await api(`/templates/${id}`, "PUT", { channel: "whatsapp", name: "W", body: "Buenas {{nombre}} {{enlace}} Responde BAJA para no recibir más.", waTemplateName: "w_one", waLanguage: "es" })).json();
      expect(r.template.waStatus).toBe("pending");
    });
  });

  describe("flujo completo por API: crear → vista previa → lanzar → enviar → resultados", () => {
    let campaignId = 0;
    it("crea la campaña y la vista previa explica la audiencia", async () => {
      as(A); const r = await api("/campaigns", "POST", campaignBody(A)); expect(r.status).toBe(201); campaignId = (await r.json()).campaign.id;
      expect((await (await api(`/campaigns/${campaignId}/audience`)).json()).audience).toMatchObject({ matchingContacts: 8, eligible: 8 });
    });
    it("el filtro por satisfacción se rechaza con 400", async () => {
      as(A); const r = await api("/campaigns", "POST", campaignBody(A, { audienceFilter: { minRating: 4 } }));
      expect(r.status).toBe(400); expect((await r.json()).message).toMatch(/satisfacción/);
      expect((await api("/campaigns", "POST", campaignBody(A, { orgId: B.orgId }))).status).toBe(400); // campo no permitido
    });
    it("lanza (encola 8), se envía por la cola y los resultados salen de la BD", async () => {
      as(A); const l = await api(`/campaigns/${campaignId}/launch`, "POST"); expect(l.status).toBe(200);
      expect((await l.json()).launch).toMatchObject({ enqueued: 8, status: "running" });
      expect((await api(`/campaigns/${campaignId}/launch`, "POST")).status).toBe(409); // ya lanzada
      const prov = fakeProvider("email", (r, n) => (r.to === "h7@camp.es" ? { ok: false, retryable: false, code: "email_rejected", message: "rechazado" } : { ok: true, providerMessageId: `api-${n}` }));
      await runTick({ orgId: A.orgId, now: T0, providers: registryOf(prov) });
      const res = await (await api(`/campaigns/${campaignId}/results`)).json();
      expect(res.messages).toMatchObject({ requests: 8, sent: 7, failed: 1, delivered: 0, clicked: 0, queued: 0 });
      expect(res.reviews.available).toBe(false);
      const list = await (await api(`/campaigns/${campaignId}/messages?status=failed`)).json(); expect(list.messages).toHaveLength(1); expect(list.messages[0].errorCode).toBe("email_rejected");
      expect((await (await api("/campaigns")).json()).campaigns.find((c: { id: number }) => c.id === campaignId)).toMatchObject({ total_messages: 8, sent: 7 });
    });
    it("auditoría de crear y lanzar", async () => {
      await new Promise((r) => setTimeout(r, 100));
      for (const a of ["review.campaign_created", "review.campaign_launched"]) expect((await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, A.orgId), eq(auditLogsTable.action, a)))).length, a).toBeGreaterThan(0);
    });
  });

  describe("pausa/reanudación/cancelación/duplicado por API", () => {
    it("transiciones válidas e inválidas", async () => {
      as(A); const id = (await (await api("/campaigns", "POST", campaignBody(A, { name: "ctl" }))).json()).campaign.id;
      expect((await api(`/campaigns/${id}/pause`, "POST")).status).toBe(409);   // un borrador no se pausa
      const dup = await api(`/campaigns/${id}/duplicate`, "POST"); expect(dup.status).toBe(201); expect((await dup.json()).campaign.name).toMatch(/copia/);
      expect((await api(`/campaigns/${id}`, "PUT", { name: "renombrada" })).status).toBe(200);
      expect((await api(`/campaigns/${id}/cancel`, "POST")).status).toBe(200);
      expect((await api(`/campaigns/${id}/cancel`, "POST")).status).toBe(409);
      expect((await api(`/campaigns/${id}`, "PUT", { name: "x" })).status).toBe(409);
    });
  });

  describe("permisos y aislamiento entre empresas", () => {
    let aCampaign = 0, aTemplate = 0;
    beforeAll(async () => {
      as(A); aCampaign = (await (await api("/campaigns", "POST", campaignBody(A, { name: "privada" }))).json()).campaign.id;
      aTemplate = (await (await api("/templates", "POST", { channel: "email", name: "priv", subject: "s", body: "Hola {{enlace}}" })).json()).template.id;
    });
    it.each([
      ["owner", 201], ["admin", 201], ["manager", 201], ["member", 403], ["vendedor", 403], ["read_only", 403], ["cliente", 403],
    ])("crear campaña con rol %s → %i", async (role, status) => { as(A, role); expect((await api("/campaigns", "POST", campaignBody(A, { name: `p-${role}` }))).status).toBe(status); });
    it.each([["member", 200], ["read_only", 200], ["cliente", 403]])("ver campañas con rol %s → %i", async (role, status) => { as(A, role); expect((await api("/campaigns")).status).toBe(status); });
    it("lanzar y pausar exigen review.write", async () => {
      as(A, "read_only"); expect((await api(`/campaigns/${aCampaign}/launch`, "POST")).status).toBe(403);
      expect((await api(`/campaigns/${aCampaign}/pause`, "POST")).status).toBe(403);
      expect((await api(`/campaigns/${aCampaign}/retry-failed`, "POST")).status).toBe(403);
    });
    it("B no ve ni toca campañas, resultados, mensajes ni plantillas de A (404/409, nunca datos)", async () => {
      as(B);
      for (const [path, method] of [[`/campaigns/${aCampaign}`, "GET"], [`/campaigns/${aCampaign}/results`, "GET"], [`/campaigns/${aCampaign}/messages`, "GET"], [`/campaigns/${aCampaign}/audience`, "GET"],
        [`/campaigns/${aCampaign}/launch`, "POST"], [`/campaigns/${aCampaign}/duplicate`, "POST"], [`/campaigns/${aCampaign}/retry-failed`, "POST"], [`/templates/${aTemplate}`, "GET"]] as const)
        expect((await api(path, method)).status, `${method} ${path}`).toBe(404);
      for (const act of ["pause", "resume", "cancel"]) expect((await api(`/campaigns/${aCampaign}/${act}`, "POST")).status).toBe(409);
      expect((await api(`/campaigns/${aCampaign}`, "PUT", { name: "robada" })).status).toBe(404);
      expect((await api(`/templates/${aTemplate}`, "PUT", { channel: "email", name: "x", subject: "s", body: "{{enlace}}" })).status).toBe(404);
      expect((await (await api("/campaigns")).json()).campaigns.some((c: { id: number }) => c.id === aCampaign)).toBe(false);
      as(A); expect((await (await api(`/campaigns/${aCampaign}`)).json()).campaign).toMatchObject({ name: "privada", status: "draft" }); // intacta
    });
    it("no se puede usar la plantilla o el establecimiento de otra empresa al crear campañas", async () => {
      as(B); expect((await api("/campaigns", "POST", campaignBody(B, { templateId: aTemplate }))).status).toBe(404);
      expect((await api("/campaigns", "POST", campaignBody(B, { locationId: A.locationId }))).status).toBe(404);
    });
  });

  describe("enlaces públicos: clic y baja", () => {
    let token = "", reviewUrl = "", contactId = 0;
    beforeAll(async () => {
      as(B); const id = (await (await api("/campaigns", "POST", campaignBody(B, { name: "pub" }))).json()).campaign.id;
      await api(`/campaigns/${id}/launch`, "POST");
      await runTick({ orgId: B.orgId, now: T0, providers: registryOf(fakeProvider("email")) });
      const [m] = await db.select().from(reviewMessagesTable).where(eq(reviewMessagesTable.campaignId, id)).limit(1);
      token = m!.trackingToken; contactId = m!.contactId;
      reviewUrl = (await (await api(`/campaigns/${id}`)).json()) && `https://search.google.com/local/writereview?placeid=`;
    });
    it("el clic redirige 302 a la URL de reseña de Google del establecimiento y se registra una vez como primer clic", async () => {
      const r = await fetch(`${pubBase}/r/${token}`, { redirect: "manual", headers: { "user-agent": BROWSER } });
      expect(r.status).toBe(302); expect(r.headers.get("location")).toContain(reviewUrl); expect(r.headers.get("cache-control")).toBe("no-store");
      await fetch(`${pubBase}/r/${token}`, { redirect: "manual", headers: { "user-agent": BROWSER } });
      const [m] = await db.select().from(reviewMessagesTable).where(eq(reviewMessagesTable.trackingToken, token));
      expect(m!.firstClickedAt).toBeTruthy();
      expect((await db.select().from(reviewEventsTable).where(and(eq(reviewEventsTable.messageId, m!.id), eq(reviewEventsTable.type, "click")))).length).toBe(2); // 2 clics, 1 primer clic
    });
    it("las vistas previas y bots redirigen pero NO cuentan como clic", async () => {
      const [m0] = await db.select().from(reviewMessagesTable).where(and(eq(reviewMessagesTable.orgId, B.orgId), eq(reviewMessagesTable.status, "sent")));
      const other = (await db.select().from(reviewMessagesTable).where(eq(reviewMessagesTable.orgId, B.orgId))).find((m) => m.trackingToken !== token && !m.firstClickedAt)!;
      for (const ua of ["WhatsApp/2.24.1 A", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; Googlebot/2.1)", ""]) {
        const r = await fetch(`${pubBase}/r/${other.trackingToken}`, { redirect: "manual", headers: { "user-agent": ua } }); expect(r.status, ua).toBe(302);
      }
      expect((await db.select().from(reviewMessagesTable).where(eq(reviewMessagesTable.id, other.id)))[0]!.firstClickedAt).toBeNull();
      expect(m0).toBeTruthy(); expect(isLikelyBot(BROWSER)).toBe(false);
    });
    it("tokens inválidos o inexistentes → 404 sin revelar nada", async () => {
      for (const t of ["x", "../../etc/passwd", "a".repeat(40), "!!!!!!!!!!!!!!!!!!!!"]) expect((await fetch(`${pubBase}/r/${encodeURIComponent(t)}`, { redirect: "manual" })).status, t).toBe(404);
      expect((await fetch(`${pubBase}/u/${"b".repeat(40)}`)).status).toBe(404);
    });
    it("GET de baja NO da de baja (los escáneres de correo siguen enlaces); el POST sí, y es de un clic", async () => {
      const page = await fetch(`${pubBase}/u/${token}`); expect(page.status).toBe(200); expect(await page.text()).toContain("Confirmar baja");
      expect((await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.id, contactId)))[0]!.status).toBe("active");
      const post = await fetch(`${pubBase}/u/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      expect(post.status).toBe(200); expect(await post.text()).toContain("Baja confirmada");
      const [c] = await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.id, contactId));
      expect(c!.status).toBe("unsubscribed");
      expect((await checkEligibility(B.orgId, contactId, "email"))).toEqual({ ok: false, reason: "contact_unsubscribed" });
      const sup = await db.select().from(outreachSuppressionsTable).where(and(eq(outreachSuppressionsTable.orgId, B.orgId), eq(outreachSuppressionsTable.email, c!.emailNorm ?? "")));
      expect(sup[0]).toMatchObject({ reason: "opt_out", source: "omni_review_link" });
      expect((await fetch(`${pubBase}/u/${token}`, { method: "POST" })).status).toBe(200); // idempotente
    });
  });
});
