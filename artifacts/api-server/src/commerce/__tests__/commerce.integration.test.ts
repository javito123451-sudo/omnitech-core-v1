// OmniCommerce — 15 escenarios obligatorios con BD real desechable (DATABASE_URL) y webhooks
// firmados con un secreto de PRUEBA. Ningún cobro real, ningún email real, sin Shopify real.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

vi.hoisted(() => { process.env["COMMERCE_CAPTURE_MAX_PER_HOUR"] = "100000"; });
const emailMock = vi.hoisted(() => ({ sendInvitationEmail: vi.fn(async () => ({ ok: true })), sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../lib/email", () => emailMock);
vi.mock("../../middlewares/superAdmin", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    const r = req.get("x-test-role");
    if (!r) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (r !== "SUPER_ADMIN" && r !== "STAFF_OMNITECH") { res.status(403).json({ error: "Access denied" }); return; }
    req.clerkUserId = req.get("x-test-clerk"); req.isSuperAdmin = r === "SUPER_ADMIN"; next();
  },
}));

import { runCommerceMigration } from "../migration";
import { seedCatalog } from "../catalog";
import { signShopifyBody } from "../hmac";
import { commerceWebhookRouter } from "../../routes/commerceWebhook";
import { commerceControlRouter } from "../../routes/commerceControl";
import { commerceCaptureRouter } from "../../routes/commerceCapture";
import { expireAuthorizations } from "../capture";
import { sweepGracePeriods } from "../lifecycle";
import { processEvent, retryDueEvents, MAX_ATTEMPTS } from "../ingest";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const SECRET = "test-secret-not-real";
const rows = async <T = any>(q: any): Promise<T[]> => (await db.execute(q) as any).rows;

describe.skipIf(!hasRealDb)("OmniCommerce Bridge — escenarios", () => {
  let server: Server; let base = ""; let n = 1000 + Math.floor(Math.random() * 1e6);
  const uid = () => ++n;
  const RUN = Date.now().toString(36);
  const ADMIN = "commerce-test-admin";

  beforeAll(async () => {
    process.env["SHOPIFY_API_SECRET"] = SECRET;
    await runCommerceMigration(); await seedCatalog();
    await db.execute(sql`INSERT INTO users (clerk_id, email, name) VALUES (${ADMIN}, 'admin-test@example.com', 'Admin') ON CONFLICT (clerk_id) DO NOTHING`);
    const app = express();
    app.use(express.json({ verify: (r, _s, buf) => { (r as any).rawBody = buf; } }));
    app.use("/api/commerce", commerceWebhookRouter);
    app.use("/api/commerce-control", commerceControlRouter);
    app.use("/api/commerce-public", commerceCaptureRouter);
    await new Promise<void>((ok) => { server = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => { await new Promise<void>((r) => { server.close(() => r()); }); });

  const post = async (topic: string, payload: object, opts: { id?: string; secret?: string; sign?: boolean } = {}) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json", "x-shopify-topic": topic, "x-shopify-webhook-id": opts.id ?? `wh-${uid()}`, "x-shopify-shop-domain": "test.myshopify.com" };
    if (opts.sign !== false) headers["x-shopify-hmac-sha256"] = signShopifyBody(body, opts.secret ?? SECRET);
    const r = await fetch(`${base}/commerce/webhooks/shopify`, { method: "POST", headers, body });
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  };
  const admin = (role = "SUPER_ADMIN") => ({ "content-type": "application/json", "x-test-role": role, "x-test-clerk": ADMIN });
  const call = async (method: string, path: string, body?: object, role = "SUPER_ADMIN") => {
    const r = await fetch(`${base}/commerce-control${path}`, { method, headers: admin(role), body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  };

  // Fábrica de un cliente + pedido + contrato Starter
  const mk = () => {
    const i = uid();
    return {
      orderId: `9${i}`, customerId: `7${i}`, contractId: `gid://shopify/SubscriptionContract/5${i}`, email: `cliente${i}@empresa.test`, company: `Empresa ${i} SL`,
      order: (financial_status: string, extra: object = {}) => ({
        id: Number(`9${i}`), name: `#${i}`, email: `cliente${i}@empresa.test`, currency: "EUR", total_price: "149.00", financial_status,
        created_at: "2026-11-25T10:00:00Z", updated_at: "2026-11-25T10:00:00Z", billing_address: { company: `Empresa ${i} SL` },
        customer: { id: Number(`7${i}`), email: `cliente${i}@empresa.test`, first_name: "Ana", last_name: "Pérez", email_marketing_consent: { state: "subscribed" } },
        line_items: [{ id: 1, sku: "plan_starter", title: "Starter", quantity: 1, price: "149.00" }], ...extra }),
      contract: (status = "ACTIVE") => ({ admin_graphql_api_id: `gid://shopify/SubscriptionContract/5${i}`, id: Number(`5${i}`), origin_order_id: Number(`9${i}`), admin_graphql_api_customer_id: `gid://shopify/Customer/7${i}`, status }),
      attempt: (kind: "success" | "failure", key: string) => ({ id: Number(`3${i}`), idempotency_key: key, order_id: Number(`9${i}`), subscription_contract_id: Number(`5${i}`) }),
    };
  };
  const sub = async (m: ReturnType<typeof mk>) => (await rows(sql`SELECT * FROM commerce_subscriptions WHERE shopify_contract_id = ${String(m.contract().id)}`))[0];
  const act = async (m: ReturnType<typeof mk>) => (await rows(sql`SELECT ar.* FROM activation_requests ar JOIN commerce_orders o ON o.id=ar.order_id WHERE o.shopify_order_id=${m.orderId}`))[0];
  const capture = (m: ReturnType<typeof mk>, extra: object = {}) => fetch(`${base}/commerce-public/requests`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: m.email, name: "Ana Pérez", company: m.company, consentPrivacy: true, planInterest: "starter", ...extra }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) as any }));
  const capRow = async (m: ReturnType<typeof mk>) => (await rows(sql`SELECT * FROM commerce_capture_requests WHERE lower(email)=${m.email}`))[0];
  const authorize = async (m: ReturnType<typeof mk>, plan = "starter", modules: string[] = []) => {
    await capture(m); const c = await capRow(m);
    return call("POST", `/capture-requests/${c.id}/authorize`, { plan, modules });
  };
  const paidFlow = async (m: ReturnType<typeof mk>, authorized = true) => {
    if (authorized) await authorize(m);
    await post("orders/create", m.order("paid")); await post("subscription_contracts/create", m.contract()); await post("orders/paid", m.order("paid"));
  };

  it("1. compra satisfactoria: registra pedido, suscripción y solicitud PENDING; NO crea empresa/licencia", async () => {
    const m = mk(); const orgsBefore = (await rows(sql`SELECT COUNT(*)::int c FROM organizations`))[0].c; const licBefore = (await rows(sql`SELECT COUNT(*)::int c FROM license_plans`))[0].c;
    await paidFlow(m);
    expect((await act(m)).status).toBe("pending");
    expect((await act(m)).requested_plan).toBe("starter");
    expect((await sub(m)).status).toBe("active");
    expect((await rows(sql`SELECT COUNT(*)::int c FROM organizations`))[0].c).toBe(orgsBefore);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM license_plans`))[0].c).toBe(licBefore);
  });

  it("2. pedido duplicado (otro webhook-id, mismo pedido) → 1 pedido, 1 solicitud, 1 cobro", async () => {
    const m = mk(); await paidFlow(m); await post("orders/paid", m.order("paid")); await post("orders/paid", m.order("paid"));
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].c).toBe(1);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM activation_requests ar JOIN commerce_orders o ON o.id=ar.order_id WHERE o.shopify_order_id=${m.orderId}`))[0].c).toBe(1);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM billing_history WHERE shopify_ref=${"order:" + m.orderId}`))[0].c).toBe(1);
  });

  it("3. pago pendiente → pedido pending_payment y SIN solicitud de activación", async () => {
    const m = mk(); await post("orders/create", m.order("pending"));
    expect((await rows(sql`SELECT order_status FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].order_status).toBe("pending_payment");
    expect(await act(m)).toBeUndefined();
  });

  it("4. pago confirmado tras pendiente → pedido paid + solicitud pending", async () => {
    const m = mk(); await post("orders/create", m.order("pending"));
    await post("orders/paid", m.order("paid", { updated_at: "2026-11-25T10:05:00Z" }));
    expect((await rows(sql`SELECT order_status FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].order_status).toBe("paid");
    expect((await act(m)).status).toBe("pending");
  });

  it("5. solicitud pendiente visible en Control Center (con filtros)", async () => {
    const m = mk(); await paidFlow(m);
    const r = await call("GET", "/activation-requests?status=pending&limit=200");
    expect(r.status).toBe(200);
    expect(r.json.some((x: any) => x.customer_email === m.email)).toBe(true);
    const d = await call("GET", "/dashboard"); expect(d.json.pending_activations).toBeGreaterThan(0);
  });

  it("6-8. aprobación admin → empresa + workspace + licencia + módulos + invitación + email + auditoría", async () => {
    const m = mk(); await paidFlow(m); const ar = await act(m);
    emailMock.sendInvitationEmail.mockClear();
    const r = await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company });
    expect(r.status).toBe(200); expect(r.json.ok).toBe(true);
    const org = (await rows(sql`SELECT * FROM organizations WHERE id=${r.json.orgId}`))[0];
    expect(org.plan).toBe("starter"); expect(org.name).toBe(m.company);
    const lic = (await rows(sql`SELECT * FROM license_plans WHERE id=${r.json.licenseId}`))[0];
    expect(lic.is_active).toBe(true); expect(lic.org_id).toBe(org.id);
    expect((await sub(m)).status).toBe("active"); expect((await sub(m)).license_id).toBe(lic.id);
    expect((await act(m)).status).toBe("approved");
    expect((await rows(sql`SELECT role FROM org_invitations WHERE org_id=${org.id}`))[0].role).toBe("owner");
    expect(emailMock.sendInvitationEmail).toHaveBeenCalledTimes(1);
    const audit = await rows(sql`SELECT action FROM activation_audit_logs WHERE activation_request_id=${ar.id} ORDER BY id`);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["activation_requested", "activation_approved", "welcome_email_sent"]));
    // doble aprobación rechazada
    expect((await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company })).status).toBe(409);
  });

  it("6b. rechazar y pedir información (con motivo obligatorio y auditoría)", async () => {
    const a = mk(); await paidFlow(a); const ra = await act(a);
    expect((await call("POST", `/activation-requests/${ra.id}/reject`, {})).status).toBe(400);
    expect((await call("POST", `/activation-requests/${ra.id}/request-info`, { message: "Falta el CIF" })).json.status).toBe("info_requested");
    expect((await call("POST", `/activation-requests/${ra.id}/reject`, { reason: "Datos no válidos" })).json.status).toBe("rejected");
    expect((await rows(sql`SELECT COUNT(*)::int c FROM license_plans lp JOIN commerce_subscriptions s ON s.license_id=lp.id WHERE s.shopify_contract_id=${String(a.contract().id)}`))[0].c).toBe(0);
  });

  const activate = async (m: ReturnType<typeof mk>) => { await paidFlow(m); const ar = await act(m); const r = await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company }); return r.json; };
  const license = async (id: number) => (await rows(sql`SELECT is_active FROM license_plans WHERE id=${id}`))[0].is_active;

  it("9. renovación mensual → billing_history, periodo avanza, sigue activa; reenvío no duplica", async () => {
    const m = mk(); await activate(m);
    await post("subscription_billing_attempts/success", m.attempt("success", `renov-1-${RUN}`));
    await post("subscription_billing_attempts/success", m.attempt("success", `renov-1-${RUN}`), { id: `wh-${uid()}` }); // mismo intento, otro webhook-id
    expect((await rows(sql`SELECT COUNT(*)::int c FROM billing_history WHERE shopify_ref=${'attempt:renov-1-' + RUN}`))[0].c).toBe(1);
    const s = await sub(m); expect(s.status).toBe("active"); expect(s.current_period_end).not.toBeNull();
  });

  it("10. pago fallido → past_due + gracia; al superar el umbral → suspendida y licencia inactiva", async () => {
    const m = mk(); const a = await activate(m);
    await post("subscription_billing_attempts/failure", m.attempt("failure", `f1-${RUN}`));
    let s = await sub(m); expect(s.status).toBe("past_due"); expect(s.grace_until).not.toBeNull(); expect(await license(a.licenseId)).toBe(true);
    await post("subscription_billing_attempts/failure", m.attempt("failure", `f2-${RUN}`)); await post("subscription_billing_attempts/failure", m.attempt("failure", `f3-${RUN}`));
    s = await sub(m); expect(s.status).toBe("suspended"); expect(await license(a.licenseId)).toBe(false);
  });

  it("10b. periodo de gracia vencido → el barrido suspende", async () => {
    const m = mk(); const a = await activate(m);
    await post("subscription_billing_attempts/failure", m.attempt("failure", `g1-${RUN}`));
    await db.execute(sql`UPDATE commerce_subscriptions SET grace_until = NOW() - interval '1 day' WHERE shopify_contract_id=${String(m.contract().id)}`);
    expect(await sweepGracePeriods()).toBeGreaterThanOrEqual(1);
    expect((await sub(m)).status).toBe("suspended"); expect(await license(a.licenseId)).toBe(false);
  });

  it("11. cancelación → cancelled, licencia inactiva, la empresa y sus datos SE CONSERVAN", async () => {
    const m = mk(); const a = await activate(m);
    await post("subscription_contracts/update", m.contract("CANCELLED"));
    expect((await sub(m)).status).toBe("cancelled"); expect(await license(a.licenseId)).toBe(false);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM organizations WHERE id=${a.orgId}`))[0].c).toBe(1);
  });

  it("12. reembolso parcial no suspende; total → refunded + suspendida (política); reenvío idempotente", async () => {
    const m = mk(); const a = await activate(m);
    await post("refunds/create", { id: Number(`1${m.orderId}`), order_id: Number(m.orderId), transactions: [{ kind: "refund", status: "success", amount: "50.00" }] });
    expect((await rows(sql`SELECT order_status FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].order_status).toBe("partially_refunded");
    expect((await sub(m)).status).toBe("active");
    const full = { id: Number(`2${m.orderId}`), order_id: Number(m.orderId), transactions: [{ kind: "refund", status: "success", amount: "99.00" }] };
    await post("refunds/create", full); await post("refunds/create", full);
    expect((await rows(sql`SELECT order_status, refunded_cents FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0]).toEqual({ order_status: "refunded", refunded_cents: 14900 });
    expect((await sub(m)).status).toBe("suspended"); expect(await license(a.licenseId)).toBe(false);
  });

  it("13. suspensión y reactivación: impago se reactiva al pagar; contracargo NO se reactiva solo", async () => {
    const m = mk(); const a = await activate(m);
    for (const k of ["r1", "r2", "r3"]) await post("subscription_billing_attempts/failure", m.attempt("failure", `${k}-${RUN}`));
    expect((await sub(m)).status).toBe("suspended");
    await post("subscription_billing_attempts/success", m.attempt("success", `r4-${RUN}`));
    expect((await sub(m)).status).toBe("active"); expect(await license(a.licenseId)).toBe(true);

    const c = mk(); const b = await activate(c);
    await post("disputes/create", { id: Number(`8${c.orderId}`), order_id: Number(c.orderId), amount: "149.00", currency: "EUR" });
    expect((await sub(c)).status).toBe("suspended");
    await post("subscription_billing_attempts/success", c.attempt("success", `c1-${RUN}`));
    expect((await sub(c)).status).toBe("suspended"); expect(await license(b.licenseId)).toBe(false);
  });

  it("14. acceso no autorizado: HMAC inválido/ausente, sin secreto, sin rol, STAFF no aprueba, pago no confirmado", async () => {
    const m = mk();
    expect((await post("orders/paid", m.order("paid"), { secret: "otro" })).status).toBe(401);
    expect((await post("orders/paid", m.order("paid"), { sign: false })).status).toBe(401);
    expect(await act(m)).toBeUndefined();
    const saved = process.env["SHOPIFY_API_SECRET"]; delete process.env["SHOPIFY_API_SECRET"];
    expect((await post("orders/paid", m.order("paid"))).status).toBe(503); process.env["SHOPIFY_API_SECRET"] = saved;
    await paidFlow(m); const ar = await act(m);
    const noAuth = await fetch(`${base}/commerce-control/activation-requests/${ar.id}/approve`, { method: "POST" });
    expect(noAuth.status).toBe(401);
    expect((await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: "X" }, "STAFF_OMNITECH")).status).toBe(403);
    expect((await call("POST", `/activation-requests/${ar.id}/approve`, {}, "CLIENT")).status).toBe(403);
    expect((await call("GET", "/orders", undefined, "STAFF_OMNITECH")).status).toBe(200); // STAFF sí lee
    // solicitud con pedido sin pagar (forzada) no se puede aprobar
    await db.execute(sql`UPDATE commerce_orders SET order_status='pending_payment' WHERE shopify_order_id=${m.orderId}`);
    const r = await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company });
    expect(r.status).toBe(409); expect(r.json.error).toBe("payment_not_confirmed");
    expect((await rows(sql`SELECT COUNT(*)::int c FROM organizations WHERE name=${m.company}`))[0].c).toBe(0);
    // el estado de una licencia no puede fijarse por la API (no existe endpoint) ni por cuerpo
    const evil = await call("POST", `/activation-requests/${ar.id}/reject`, { reason: "x", status: "approved" });
    expect(evil.json.status).toBe("rejected");
  });

  it("15. reenvío del mismo webhook (mismo id) → duplicate, sin efectos dobles", async () => {
    const m = mk(); const id = `wh-same-${uid()}`;
    const a = await post("orders/paid", m.order("paid"), { id }); const b = await post("orders/paid", m.order("paid"), { id });
    expect(a.json.duplicate).toBe(false); expect(b.json.duplicate).toBe(true);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_webhook_events WHERE webhook_id=${id}`))[0].c).toBe(1);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM billing_history WHERE shopify_ref=${"order:" + m.orderId}`))[0].c).toBe(1);
  });

  it("extra: evento desordenado antiguo no pisa el estado más reciente", async () => {
    const m = mk(); await post("orders/paid", m.order("paid", { updated_at: "2026-11-25T12:00:00Z" }));
    await post("orders/updated", m.order("pending", { updated_at: "2026-11-25T09:00:00Z" }));
    expect((await rows(sql`SELECT order_status FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].order_status).toBe("paid");
  });

  it("extra: fallo → reintento con backoff → dead tras el máximo; los datos no quedan a medias", async () => {
    const r = await post("subscription_contracts/update", { admin_graphql_api_id: "gid://shopify/SubscriptionContract/0000", status: "CANCELLED" });
    expect(r.status).toBe(200);
    const ev = (await rows(sql`SELECT id, status, attempts, next_retry_at FROM commerce_webhook_events ORDER BY id DESC LIMIT 1`))[0];
    expect(ev.status).toBe("failed"); expect(ev.attempts).toBe(1); expect(ev.next_retry_at).not.toBeNull();
    for (let i = 1; i < MAX_ATTEMPTS; i++) await processEvent(ev.id);
    expect((await rows(sql`SELECT status FROM commerce_webhook_events WHERE id=${ev.id}`))[0].status).toBe("dead");
    expect(await retryDueEvents()).toBe(0);
  });

  it("extra: producto no mapeado no rompe y queda señalado", async () => {
    const m = mk(); await post("orders/paid", m.order("paid", { line_items: [{ id: 1, sku: "DESCONOCIDO", title: "Algo" }] }));
    expect((await act(m)).unmapped_items).toHaveLength(1);
  });

  it("extra: módulos con precio por grupo (25/35/45 €), no vendibles sueltos; crm incluido; no pisa precios editados", async () => {
    const price = async (slug: string) => (await rows(sql`SELECT list_price_cents p, sellable, billing_mode FROM commerce_products WHERE code=${"module_" + slug}`))[0];
    expect((await price("omni_tax")).p).toBe(2500); expect((await price("omni_security")).p).toBe(2500);
    expect((await price("omni_marketing")).p).toBe(3500); expect((await price("whatsapp")).p).toBe(3500);
    expect((await price("omni_import_ai")).p).toBe(4500); expect((await price("omni_leads")).p).toBe(4500);
    expect((await price("crm")).p).toBeNull();
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_products WHERE kind='module' AND sellable`))[0].c).toBe(0);
    await db.execute(sql`UPDATE commerce_products SET list_price_cents=3000 WHERE code='module_omni_tax'`);
    await seedCatalog(); expect((await price("omni_tax")).p).toBe(3000); // editado: se respeta
    await db.execute(sql`UPDATE commerce_products SET list_price_cents=2500 WHERE code='module_omni_tax'`);
    await db.execute(sql`UPDATE commerce_products SET list_price_cents=NULL WHERE code='module_omni_docs'`);
    await seedCatalog(); expect((await price("omni_docs")).p).toBe(2500); // sin precio: se rellena
  });

  it("extra: precios del catálogo = los confirmados; promo Starter desactivada y conmutable", async () => {
    const p = await rows(sql`SELECT code, list_price_cents, promo_price_cents, promo_active, vat_included FROM commerce_products WHERE kind IN ('plan','enterprise') ORDER BY list_price_cents`);
    expect(p.map((x: any) => [x.code, x.list_price_cents])).toEqual([["plan_starter", 14900], ["plan_professional", 24900], ["plan_enterprise", 100000]]);
    expect(p[0].promo_price_cents).toBe(9900); expect(p.every((x: any) => x.vat_included === false)).toBe(true);
    const id = (await rows(sql`SELECT id FROM commerce_products WHERE code='plan_starter'`))[0].id;
    expect((await call("PATCH", `/products/${id}/promo`, { active: true })).status).toBe(200);
    expect((await call("PATCH", `/products/${id}/promo`, { active: true }, "STAFF_OMNITECH")).status).toBe(403);
    await call("PATCH", `/products/${id}/promo`, { active: false });
    const pro = (await rows(sql`SELECT id FROM commerce_products WHERE code='plan_professional'`))[0].id;
    expect((await call("PATCH", `/products/${pro}/promo`, { active: true })).status).toBe(409);
  });

  it("extra: auditoría inmutable y RGPD (redact anonimiza sin borrar el pedido)", async () => {
    await expect(db.execute(sql`UPDATE activation_audit_logs SET action='x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM activation_audit_logs`)).rejects.toThrow();
    const m = mk(); await post("orders/paid", m.order("paid"));
    await post("customers/redact", { customer: { id: Number(m.customerId), email: m.email } });
    const c = (await rows(sql`SELECT email, first_name, redacted_at FROM commerce_customers WHERE shopify_customer_id=${m.customerId}`))[0];
    expect(c.email).toBeNull(); expect(c.redacted_at).not.toBeNull();
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_orders WHERE shopify_order_id=${m.orderId}`))[0].c).toBe(1);
  });

  // ── Captación y autorización previa: primero se capta, luego se autoriza, solo entonces se contrata y activa ──
  it("C1. captación pública: consentimiento obligatorio, honeypot, email válido, duplicados sin enumerar", async () => {
    const m = mk();
    expect((await capture(m, { consentPrivacy: false })).status).toBe(400);
    expect((await capture(m, { email: "no-es-email" })).status).toBe(400);
    expect(await capRow(m)).toBeUndefined();
    expect((await capture(m, { website: "http://spam" })).status).toBe(200);
    expect(await capRow(m)).toBeUndefined();
    expect((await capture(m)).status).toBe(200); expect((await capture(m)).status).toBe(200);
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_capture_requests WHERE lower(email)=${m.email}`))[0].c).toBe(1);
    const c = await capRow(m); expect(c.status).toBe("new"); expect(c.consent_privacy_at).not.toBeNull();
    // captar NO crea cuenta, pedido ni licencia
    expect((await rows(sql`SELECT COUNT(*)::int c FROM commerce_orders WHERE email=${m.email}`))[0].c).toBe(0);
  });

  it("C2. autorizar: solo SUPER_ADMIN, plan válido, caducidad configurable, auditado", async () => {
    const m = mk(); await capture(m); const c = await capRow(m);
    expect((await call("POST", `/capture-requests/${c.id}/authorize`, { plan: "starter" }, "STAFF_OMNITECH")).status).toBe(403);
    expect((await call("POST", `/capture-requests/${c.id}/authorize`, { plan: "business" })).status).toBe(400);
    expect((await call("POST", `/capture-requests/${c.id}/authorize`, { plan: "starter", modules: ["no_existe"] })).status).toBe(400);
    const r = await call("POST", `/capture-requests/${c.id}/authorize`, { plan: "starter", modules: ["omni_tax"], validDays: 10 });
    expect(r.status).toBe(200); expect(r.json.shopifyTag).toMatch(/^skipped/); // sin credenciales de Shopify
    const after = await capRow(m); expect(after.status).toBe("authorized"); expect(after.authorized_modules).toEqual(["omni_tax"]);
    expect((await rows(sql`SELECT action FROM activation_audit_logs WHERE capture_request_id=${c.id} ORDER BY id`)).map((a: any) => a.action)).toEqual(["capture_received", "capture_authorized"]);
  });

  it("C3. compra SIN autorización previa: queda marcada, no se puede activar y no crea nada", async () => {
    const m = mk(); await paidFlow(m, false); const ar = await act(m);
    expect(ar.capture_request_id).toBeNull();
    const list = await call("GET", "/activation-requests?status=pending&limit=200");
    expect(list.json.find((x: any) => x.id === ar.id).authorized).toBe(false);
    expect((await call("GET", "/dashboard")).json.unauthorized_purchases).toBeGreaterThan(0);
    const r = await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company });
    expect(r.status).toBe(409); expect(r.json.error).toBe("not_authorized");
    expect((await rows(sql`SELECT COUNT(*)::int c FROM organizations WHERE name=${m.company}`))[0].c).toBe(0);
  });

  it("C4. autorizado para un plan pero compra otro → no se puede activar", async () => {
    const m = mk(); await authorize(m, "starter");
    await post("orders/paid", m.order("paid", { line_items: [{ id: 1, sku: "plan_professional", title: "Pro" }] }));
    const ar = await act(m); expect(ar.requested_plan).toBe("professional"); expect(ar.capture_request_id).toBeNull();
    expect((await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company })).json.error).toBe("not_authorized");
  });

  it("C5. autorización caducada antes de comprar no vale; la ya comprada NO caduca; activación convierte la captación", async () => {
    const a = mk(); await authorize(a);
    await db.execute(sql`UPDATE commerce_capture_requests SET authorized_until = NOW() - interval '1 day' WHERE lower(email)=${a.email}`);
    await post("orders/paid", a.order("paid"));
    expect((await act(a)).capture_request_id).toBeNull();
    await expireAuthorizations(); expect((await capRow(a)).status).toBe("expired");

    const b = mk(); await paidFlow(b);                       // autorizado y comprado a tiempo
    await db.execute(sql`UPDATE commerce_capture_requests SET authorized_until = NOW() - interval '1 day' WHERE lower(email)=${b.email}`);
    await expireAuthorizations(); expect((await capRow(b)).status).toBe("authorized"); // ya comprado: no caduca
    const r = await call("POST", `/activation-requests/${(await act(b)).id}/approve`, { companyName: b.company });
    expect(r.status).toBe(200); expect((await capRow(b)).status).toBe("converted");
  });

  it("C6. módulos autorizados se incorporan al activar; rechazar/pedir info exigen motivo", async () => {
    const m = mk(); await authorize(m, "starter", ["omni_tax", "omni_import_ai"]); await paidFlow(m, false);
    const ar = await act(m); expect(ar.requested_modules).toEqual(expect.arrayContaining(["omni_tax", "omni_import_ai"]));
    const r = await call("POST", `/activation-requests/${ar.id}/approve`, { companyName: m.company });
    const mods = await rows(sql`SELECT module_slug FROM module_configs WHERE org_id=${r.json.orgId} AND is_enabled`);
    expect(mods.map((x: any) => x.module_slug).sort()).toEqual(["omni_import_ai", "omni_tax"]);
    const n = mk(); await capture(n); const c = await capRow(n);
    expect((await call("POST", `/capture-requests/${c.id}/reject`, {})).status).toBe(400);
    expect((await call("POST", `/capture-requests/${c.id}/request-info`, { message: "¿Cuántos usuarios?" })).json.status).toBe("info_requested");
    expect((await call("POST", `/capture-requests/${c.id}/reject`, { reason: "Fuera de perfil" })).json.status).toBe("rejected");
    expect((await call("POST", `/capture-requests/${c.id}/authorize`, { plan: "starter" })).status).toBe(409); // rechazada: no se puede autorizar
  });

  it("C7. límite antispam de la captación pública por IP", async () => {
    vi.resetModules(); process.env["COMMERCE_CAPTURE_MAX_PER_HOUR"] = "2";
    const { commerceCaptureRouter: limited } = await import("../../routes/commerceCapture");
    const a = express(); a.use(express.json()); a.use("/p", limited);
    const srv: Server = await new Promise((ok) => { const s2 = a.listen(0, () => ok(s2)); });
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/p/requests`;
    const send = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ website: "x" }) }).then((r) => r.status);
    expect([await send(), await send(), await send()]).toEqual([200, 200, 429]);
    await new Promise<void>((r) => srv.close(() => r())); process.env["COMMERCE_CAPTURE_MAX_PER_HOUR"] = "100000";
  });
});
