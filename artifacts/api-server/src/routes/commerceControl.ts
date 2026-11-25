/**
 * OmniCommerce Control — API administrativa. Todo bajo requireSuperAdmin (SUPER_ADMIN o STAFF_OMNITECH).
 * Lectura: ambos roles. Aprobar / rechazar / pedir info / cambiar política y promo: solo SUPER_ADMIN.
 * El navegador nunca decide el estado de una licencia: solo pide la acción; el servidor valida rol, estado y pago.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireSuperAdmin } from "../middlewares/superAdmin";
import { approveActivation, rejectActivation, requestMoreInfo, ActivationError } from "../commerce/activation";
import { dbRows, getPolicy } from "../commerce/settings";
import { logAudit } from "../utils/auditLogger";
import { authorizeCapture, rejectCapture, requestCaptureInfo, CaptureError } from "../commerce/capture";
import { tagCustomerAuthorized } from "../commerce/shopifyAdmin";
import { onCaptureAuthorized } from "../commerce/autoActivate";
import { validateSetting, EDITABLE_SETTINGS } from "../commerce/settings";

export const commerceControlRouter: IRouter = Router();
commerceControlRouter.use(requireSuperAdmin);

const page = (req: Request) => ({ limit: Math.min(Number(req.query["limit"]) || 50, 200), offset: Math.max(Number(req.query["offset"]) || 0, 0) });
const onlySuper = (req: Request, res: Response): boolean => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return false; }
  return true;
};
const handle = (res: Response, err: unknown) => {
  if (err instanceof CaptureError) { res.status(err.code === "not_found" ? 404 : err.code === "invalid_state" ? 409 : 400).json({ error: err.code, message: err.message }); return; }
  if (err instanceof ActivationError) {
    const status = err.code === "not_found" ? 404 : err.code === "invalid_state" || err.code === "payment_not_confirmed" || err.code === "not_authorized" ? 409 : 400;
    res.status(status).json({ error: err.code, message: err.message });
  } else { res.status(500).json({ error: "internal_error" }); }
};
const reqId = (req: Request) => Number(req.params["id"]);

commerceControlRouter.get("/dashboard", async (_req, res) => {
  const r = dbRows<Record<string, string>>(await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM activation_requests WHERE status='pending')       AS pending_activations,
      (SELECT COUNT(*) FROM activation_requests WHERE status='info_requested') AS info_requested,
      (SELECT COUNT(*) FROM commerce_orders WHERE order_status='paid')         AS paid_orders,
      (SELECT COUNT(*) FROM commerce_orders WHERE order_status='pending_payment') AS pending_payment_orders,
      (SELECT COUNT(*) FROM commerce_subscriptions WHERE status='active')      AS active_subscriptions,
      (SELECT COUNT(*) FROM commerce_subscriptions WHERE status IN ('past_due','suspended')) AS incident_subscriptions,
      (SELECT COALESCE(SUM(amount_cents),0) FROM billing_history WHERE event_type='payment_succeeded' AND occurred_at > NOW() - interval '30 days') AS revenue_30d_cents,
      (SELECT COUNT(*) FROM commerce_webhook_events WHERE status IN ('failed','dead')) AS webhook_failures,
      (SELECT COUNT(*) FROM commerce_capture_requests WHERE status='new')       AS new_captures,
      (SELECT COUNT(*) FROM commerce_capture_requests WHERE status='authorized') AS authorized_waiting_purchase,
      (SELECT COUNT(*) FROM activation_requests WHERE status IN ('pending','info_requested') AND capture_request_id IS NULL) AS unauthorized_purchases`))[0];
  res.json(Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v)])));
});

commerceControlRouter.get("/capture-requests", async (req, res) => {
  const { limit, offset } = page(req);
  const status = (req.query["status"] as string) || null;
  res.json(dbRows(await db.execute(sql`SELECT * FROM commerce_capture_requests WHERE (${status}::text IS NULL OR status=${status}::text) ORDER BY id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.post("/capture-requests/:id/authorize", async (req, res) => {
  if (!onlySuper(req, res)) return;
  const b = (req.body ?? {}) as { plan?: string; modules?: string[]; validDays?: number };
  try {
    const r = await authorizeCapture(reqId(req), { clerkId: req.clerkUserId! }, { plan: String(b.plan ?? ""), modules: Array.isArray(b.modules) ? b.modules : [], validDays: b.validDays });
    const tag = await tagCustomerAuthorized(r.email); // comodidad de la tienda; no es la barrera de seguridad
    await db.execute(sql`UPDATE commerce_capture_requests SET shopify_tag_result=${tag}::text WHERE id=${r.id}::int`);
    const auto = await onCaptureAuthorized(r.id).catch(() => ({ linked: 0, activated: 0 })); // si ya había compra pagada, se activa ahora
    res.json({ ok: true, ...r, shopifyTag: tag, linkedPurchases: auto.linked, autoActivated: auto.activated });
  } catch (e) { handle(res, e); }
});
commerceControlRouter.post("/capture-requests/:id/reject", async (req, res) => {
  if (!onlySuper(req, res)) return;
  try { res.json({ ok: true, ...(await rejectCapture(reqId(req), { clerkId: req.clerkUserId! }, String(req.body?.reason ?? ""))) }); } catch (e) { handle(res, e); }
});
commerceControlRouter.post("/capture-requests/:id/request-info", async (req, res) => {
  if (!onlySuper(req, res)) return;
  try { res.json({ ok: true, ...(await requestCaptureInfo(reqId(req), { clerkId: req.clerkUserId! }, String(req.body?.message ?? ""))) }); } catch (e) { handle(res, e); }
});

commerceControlRouter.get("/orders", async (req, res) => {
  const { limit, offset } = page(req);
  const status = (req.query["status"] as string) || null;
  res.json(dbRows(await db.execute(sql`
    SELECT o.*, c.email AS customer_email, c.company FROM commerce_orders o LEFT JOIN commerce_customers c ON c.id=o.customer_id
     WHERE (${status}::text IS NULL OR o.order_status=${status}::text) ORDER BY o.id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.get("/customers", async (req, res) => {
  const { limit, offset } = page(req);
  res.json(dbRows(await db.execute(sql`SELECT id, shopify_customer_id, email, first_name, last_name, company, org_id, marketing_consent, redacted_at, created_at
    FROM commerce_customers ORDER BY id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.get("/subscriptions", async (req, res) => {
  const { limit, offset } = page(req);
  const status = (req.query["status"] as string) || null;
  res.json(dbRows(await db.execute(sql`SELECT s.*, c.email AS customer_email FROM commerce_subscriptions s LEFT JOIN commerce_customers c ON c.id=s.customer_id
    WHERE (${status}::text IS NULL OR s.status=${status}::text) ORDER BY s.id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.get("/activation-requests", async (req, res) => {
  const { limit, offset } = page(req);
  const status = (req.query["status"] as string) || null;
  res.json(dbRows(await db.execute(sql`
    SELECT ar.*, (ar.capture_request_id IS NOT NULL) AS authorized, o.order_number, o.order_status, o.total_cents, c.email AS customer_email, c.company
      FROM activation_requests ar JOIN commerce_orders o ON o.id=ar.order_id LEFT JOIN commerce_customers c ON c.id=ar.customer_id
     WHERE (${status}::text IS NULL OR ar.status=${status}::text) ORDER BY ar.id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.post("/activation-requests/:id/approve", async (req, res) => {
  if (!onlySuper(req, res)) return;
  const b = (req.body ?? {}) as { companyName?: string; ownerEmail?: string; existingOrgId?: number; seats?: number };
  try {
    const r = await approveActivation(reqId(req), { clerkId: req.clerkUserId! }, {
      companyName: b.companyName, ownerEmail: b.ownerEmail, existingOrgId: b.existingOrgId, seats: b.seats,
      baseUrl: req.get("origin") ?? undefined });
    res.json({ ok: true, orgId: r.orgId, licenseId: r.licenseId, plan: r.plan, welcomeEmailSent: r.welcomeEmailSent });
  } catch (e) { handle(res, e); }
});

commerceControlRouter.post("/activation-requests/:id/reject", async (req, res) => {
  if (!onlySuper(req, res)) return;
  try { res.json({ ok: true, ...(await rejectActivation(reqId(req), { clerkId: req.clerkUserId! }, String(req.body?.reason ?? ""))) }); } catch (e) { handle(res, e); }
});

commerceControlRouter.post("/activation-requests/:id/request-info", async (req, res) => {
  if (!onlySuper(req, res)) return;
  try { res.json({ ok: true, ...(await requestMoreInfo(reqId(req), { clerkId: req.clerkUserId! }, String(req.body?.message ?? ""))) }); } catch (e) { handle(res, e); }
});

commerceControlRouter.get("/billing", async (req, res) => {
  const { limit, offset } = page(req);
  res.json(dbRows(await db.execute(sql`SELECT * FROM billing_history ORDER BY id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});

commerceControlRouter.get("/products", async (_req, res) => { res.json(dbRows(await db.execute(sql`SELECT * FROM commerce_products ORDER BY id`))); });

// Solo el interruptor de promoción es editable aquí; los precios de catálogo no se cambian desde la API.
commerceControlRouter.patch("/products/:id/promo", async (req, res) => {
  if (!onlySuper(req, res)) return;
  const active = req.body?.active;
  if (typeof active !== "boolean") { res.status(400).json({ error: "active (boolean) requerido" }); return; }
  const r = dbRows<{ id: number; promo_price_cents: number | null }>(await db.execute(sql`
    UPDATE commerce_products SET promo_active=${active}::boolean, updated_at=NOW()
     WHERE id=${Number(req.params["id"])}::int AND (NOT ${active}::boolean OR promo_price_cents IS NOT NULL) RETURNING id, promo_price_cents`));
  if (!r[0]) { res.status(409).json({ error: "El producto no existe o no tiene precio promocional" }); return; }
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_promo_toggled", resource: "commerce_product", resourceId: r[0].id, details: { active }, severity: "warning", req });
  res.json({ ok: true });
});

commerceControlRouter.get("/integrations", async (_req, res) => {
  // Solo estado (booleanos): jamás se devuelven valores de secretos.
  const events = dbRows<{ status: string; n: string }>(await db.execute(sql`SELECT status, COUNT(*)::text AS n FROM commerce_webhook_events GROUP BY status`));
  res.json({
    shopify: { apiSecretConfigured: !!process.env["SHOPIFY_API_SECRET"], shopDomainConfigured: !!process.env["SHOPIFY_SHOP_DOMAIN"], adminTokenConfigured: !!process.env["SHOPIFY_ADMIN_TOKEN"] },
    email: { resendConfigured: !!process.env["RESEND_API_KEY"] },
    webhookEvents: Object.fromEntries(events.map((e) => [e.status, Number(e.n)])),
    policy: await getPolicy(),
  });
});

commerceControlRouter.patch("/settings", async (req, res) => {
  if (!onlySuper(req, res)) return;
  const key = String(req.body?.key ?? "");
  const value = EDITABLE_SETTINGS[key] ? validateSetting(key, req.body?.value) : null;
  if (value === null) { res.status(400).json({ error: "invalid_setting" }); return; }
  await db.execute(sql`INSERT INTO commerce_settings (key, value) VALUES (${key}::text, ${value}::text) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_setting_changed", resource: "commerce_setting", resourceId: key, details: { value }, severity: "warning", req });
  res.json({ ok: true, policy: await getPolicy() });
});

commerceControlRouter.get("/audit", async (req, res) => {
  const { limit, offset } = page(req);
  res.json(dbRows(await db.execute(sql`SELECT * FROM activation_audit_logs ORDER BY id DESC LIMIT ${limit}::int OFFSET ${offset}::int`)));
});
