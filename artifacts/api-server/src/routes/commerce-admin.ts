// OmniCommerce Control — /api/control-center/commerce/*
// Montado dentro de controlCenterRouter (ya protegido por requireSuperAdmin:
// SUPER_ADMIN o STAFF_OMNITECH pueden CONSULTAR). Las acciones que cambian
// estado (aprobar, rechazar, pedir info, reintentar, editar producto) exigen SUPER_ADMIN.
import { Router, type Request, type Response, type NextFunction } from "express";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db, activationRequestsTable, activationAuditLogsTable, commerceOrdersTable, commerceCustomersTable,
  commerceSubscriptionsTable, commerceProductsTable, commerceWebhookEventsTable, billingHistoryTable,
  organizationsTable, ACTIVATION_STATUSES,
} from "@workspace/db";
import { logAudit } from "../utils/auditLogger";
import { approveActivation, rejectActivation, requestMoreInfo, ActivationError } from "../commerce/activation";
import { processEventRow } from "../commerce/bridge";
import { isAdminApiConfigured } from "../commerce/shopifyAdmin";
import { loadPolicies } from "../commerce/policies";

export const commerceAdminRouter = Router();

const onlySuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede realizar esta acción" }); return; }
  next();
};

const page = (q: Request["query"]) => ({
  limit: Math.min(Math.max(Number(q["limit"] ?? 50) || 50, 1), 200),
  offset: Math.max(Number(q["offset"] ?? 0) || 0, 0),
});

const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof ActivationError) { res.status(err.status).json({ error: err.message }); return; }
    console.error("[OmniCommerce admin]", err);
    res.status(500).json({ error: "Error interno" });
  }
};

function baseUrl(req: Request) { return req.get("origin") || "https://www.omnitech-core.com"; }

// ── Dashboard comercial ─────────────────────────────────────────────────────
commerceAdminRouter.get("/dashboard", handle(async (_req, res) => {
  const [reqs, subs, orders, failedEvents, revenue] = await Promise.all([
    db.select({ status: activationRequestsTable.status, n: count() }).from(activationRequestsTable).groupBy(activationRequestsTable.status),
    db.select({ status: commerceSubscriptionsTable.status, n: count() }).from(commerceSubscriptionsTable).groupBy(commerceSubscriptionsTable.status),
    db.select({ status: commerceOrdersTable.financialStatus, n: count() }).from(commerceOrdersTable)
      .where(eq(commerceOrdersTable.isTest, false)).groupBy(commerceOrdersTable.financialStatus),
    db.select({ n: count() }).from(commerceWebhookEventsTable).where(eq(commerceWebhookEventsTable.status, "failed")),
    db.select({
      kind: billingHistoryTable.kind,
      total: sql<string>`coalesce(sum(${billingHistoryTable.amount}), 0)`,
    }).from(billingHistoryTable)
      .where(sql`${billingHistoryTable.occurredAt} >= date_trunc('month', now())`)
      .groupBy(billingHistoryTable.kind),
  ]);
  const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  res.json({
    activationRequests: toMap(reqs),
    subscriptions: toMap(subs),
    orders: toMap(orders),
    failedWebhooks: Number(failedEvents[0]?.n ?? 0),
    monthToDate: Object.fromEntries(revenue.map((r) => [r.kind, r.total])),
    integration: {
      webhookSecretConfigured: !!process.env["SHOPIFY_WEBHOOK_SECRET"],
      shopDomain: process.env["SHOPIFY_SHOP_DOMAIN"] ?? null,
      adminApiConfigured: isAdminApiConfigured(),
    },
    policies: loadPolicies(),
  });
}));

// ── Solicitudes de activación ───────────────────────────────────────────────
commerceAdminRouter.get("/activation-requests", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const status = String(req.query["status"] ?? "");
  const q = String(req.query["q"] ?? "").trim();
  const conds: SQL[] = [];
  if (status && status !== "all") {
    const list = status.split(",").filter((s) => (ACTIVATION_STATUSES as readonly string[]).includes(s));
    if (list.length) conds.push(inArray(activationRequestsTable.status, list));
  }
  if (q) conds.push(or(ilike(commerceCustomersTable.email, `%${q}%`), ilike(commerceCustomersTable.companyName, `%${q}%`),
    ilike(commerceOrdersTable.orderNumber, `%${q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select({
    request: activationRequestsTable,
    order: {
      id: commerceOrdersTable.id, orderNumber: commerceOrdersTable.orderNumber, financialStatus: commerceOrdersTable.financialStatus,
      orderStatus: commerceOrdersTable.orderStatus, totalAmount: commerceOrdersTable.totalAmount, currency: commerceOrdersTable.currency,
      isTest: commerceOrdersTable.isTest, createdAt: commerceOrdersTable.createdAt,
    },
    customer: {
      id: commerceCustomersTable.id, email: commerceCustomersTable.email, name: commerceCustomersTable.name,
      companyName: commerceCustomersTable.companyName, taxId: commerceCustomersTable.taxId, phone: commerceCustomersTable.phone,
    },
    orgName: organizationsTable.name,
  })
    .from(activationRequestsTable)
    .innerJoin(commerceOrdersTable, eq(commerceOrdersTable.id, activationRequestsTable.orderId))
    .leftJoin(commerceCustomersTable, eq(commerceCustomersTable.id, activationRequestsTable.customerId))
    .leftJoin(organizationsTable, eq(organizationsTable.id, activationRequestsTable.orgId))
    .where(where).orderBy(desc(activationRequestsTable.createdAt)).limit(limit).offset(offset);
  res.json({ items: rows, limit, offset });
}));

commerceAdminRouter.get("/activation-requests/:id", handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const [row] = await db.select().from(activationRequestsTable).where(eq(activationRequestsTable.id, id));
  if (!row) { res.status(404).json({ error: "No encontrada" }); return; }
  const [[order], [customer], history, billing] = await Promise.all([
    db.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.id, row.orderId)),
    row.customerId ? db.select().from(commerceCustomersTable).where(eq(commerceCustomersTable.id, row.customerId)) : Promise.resolve([]),
    db.select().from(activationAuditLogsTable).where(eq(activationAuditLogsTable.activationRequestId, id)).orderBy(desc(activationAuditLogsTable.createdAt)),
    db.select().from(billingHistoryTable).where(eq(billingHistoryTable.orderId, row.orderId)).orderBy(desc(billingHistoryTable.occurredAt)),
  ]);
  res.json({ request: row, order, customer: customer ?? null, history, billing });
}));

const actorOf = (req: Request) => ({ clerkUserId: req.clerkUserId!, userId: req.userId ?? null });

commerceAdminRouter.post("/activation-requests/:id/approve", onlySuperAdmin, handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const body = (req.body ?? {}) as { linkOrgId?: number; ownerEmail?: string; notes?: string };
  const out = await approveActivation(id, actorOf(req), {
    linkOrgId: body.linkOrgId ? Number(body.linkOrgId) : null,
    ownerEmail: body.ownerEmail ?? null,
    notes: body.notes ?? null,
  }, baseUrl(req));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_activation_approved", resource: "activation_request",
    resourceId: id, orgId: out.orgId, details: { plan: out.plan, orgCreated: out.orgCreated, invitationSent: out.invitationSent }, req });
  res.json(out);
}));

commerceAdminRouter.post("/activation-requests/:id/reject", onlySuperAdmin, handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const { reason } = (req.body ?? {}) as { reason?: string };
  const out = await rejectActivation(id, actorOf(req), reason ?? "");
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_activation_rejected", resource: "activation_request",
    resourceId: id, details: { reason }, severity: "warning", req });
  res.json(out);
}));

commerceAdminRouter.post("/activation-requests/:id/request-info", onlySuperAdmin, handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const { message } = (req.body ?? {}) as { message?: string };
  const out = await requestMoreInfo(id, actorOf(req), message ?? "");
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_activation_info_requested", resource: "activation_request",
    resourceId: id, details: { emailSent: out.emailSent }, req });
  res.json(out);
}));

// ── Consultas: pedidos, clientes, suscripciones, facturación ────────────────
commerceAdminRouter.get("/orders", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const fs = String(req.query["financialStatus"] ?? "");
  const where = fs && fs !== "all" ? eq(commerceOrdersTable.financialStatus, fs) : undefined;
  const items = await db.select({ order: commerceOrdersTable, customerEmail: commerceCustomersTable.email, companyName: commerceCustomersTable.companyName })
    .from(commerceOrdersTable).leftJoin(commerceCustomersTable, eq(commerceCustomersTable.id, commerceOrdersTable.customerId))
    .where(where).orderBy(desc(commerceOrdersTable.createdAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

commerceAdminRouter.get("/customers", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const q = String(req.query["q"] ?? "").trim();
  const where = q ? or(ilike(commerceCustomersTable.email, `%${q}%`), ilike(commerceCustomersTable.companyName, `%${q}%`), ilike(commerceCustomersTable.name, `%${q}%`)) : undefined;
  const items = await db.select().from(commerceCustomersTable).where(where).orderBy(desc(commerceCustomersTable.createdAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

commerceAdminRouter.get("/subscriptions", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const st = String(req.query["status"] ?? "");
  const where = st && st !== "all" ? eq(commerceSubscriptionsTable.status, st) : undefined;
  const items = await db.select({
    subscription: commerceSubscriptionsTable, customerEmail: commerceCustomersTable.email,
    companyName: commerceCustomersTable.companyName, orgName: organizationsTable.name, productName: commerceProductsTable.name,
  }).from(commerceSubscriptionsTable)
    .leftJoin(commerceCustomersTable, eq(commerceCustomersTable.id, commerceSubscriptionsTable.customerId))
    .leftJoin(organizationsTable, eq(organizationsTable.id, commerceSubscriptionsTable.orgId))
    .leftJoin(commerceProductsTable, eq(commerceProductsTable.id, commerceSubscriptionsTable.productId))
    .where(where).orderBy(desc(commerceSubscriptionsTable.updatedAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

commerceAdminRouter.get("/billing", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const kind = String(req.query["kind"] ?? "");
  const where = kind && kind !== "all" ? eq(billingHistoryTable.kind, kind) : undefined;
  const items = await db.select().from(billingHistoryTable).where(where).orderBy(desc(billingHistoryTable.occurredAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

commerceAdminRouter.get("/activations", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const items = await db.select().from(activationAuditLogsTable).orderBy(desc(activationAuditLogsTable.createdAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

// ── Productos (catálogo ↔ Shopify) ──────────────────────────────────────────
commerceAdminRouter.get("/products", handle(async (_req, res) => {
  res.json({ items: await db.select().from(commerceProductsTable).orderBy(commerceProductsTable.id) });
}));

// Solo se vincula con IDs de Shopify / Hotmart. El precio NO se edita aquí:
// la fuente es credit_plans (Control Center → OmniCredits).
commerceAdminRouter.patch("/products/:id", onlySuperAdmin, handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const b = (req.body ?? {}) as { shopifyProductId?: string | null; shopifyVariantId?: string | null; hotmartProductId?: string | null; isActive?: boolean };
  const set: Partial<typeof commerceProductsTable.$inferInsert> = { updatedAt: new Date() };
  if ("shopifyProductId" in b) set.shopifyProductId = b.shopifyProductId || null;
  if ("shopifyVariantId" in b) set.shopifyVariantId = b.shopifyVariantId || null;
  if ("hotmartProductId" in b) set.hotmartProductId = b.hotmartProductId || null;
  if (typeof b.isActive === "boolean") set.isActive = b.isActive;
  const [row] = await db.update(commerceProductsTable).set(set).where(eq(commerceProductsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_product_linked", resource: "commerce_product", resourceId: id, details: b, req });
  res.json(row);
}));

// ── Integraciones / webhooks ────────────────────────────────────────────────
commerceAdminRouter.get("/webhook-events", handle(async (req, res) => {
  const { limit, offset } = page(req.query);
  const st = String(req.query["status"] ?? "");
  const where = st && st !== "all" ? eq(commerceWebhookEventsTable.status, st) : undefined;
  // Sin payload: puede contener datos personales.
  const items = await db.select({
    id: commerceWebhookEventsTable.id, source: commerceWebhookEventsTable.source, eventId: commerceWebhookEventsTable.eventId,
    topic: commerceWebhookEventsTable.topic, status: commerceWebhookEventsTable.status, attempts: commerceWebhookEventsTable.attempts,
    lastError: commerceWebhookEventsTable.lastError, receivedAt: commerceWebhookEventsTable.receivedAt, processedAt: commerceWebhookEventsTable.processedAt,
  }).from(commerceWebhookEventsTable).where(where).orderBy(desc(commerceWebhookEventsTable.receivedAt)).limit(limit).offset(offset);
  res.json({ items, limit, offset });
}));

commerceAdminRouter.post("/webhook-events/:id/retry", onlySuperAdmin, handle(async (req, res) => {
  const id = Number(req.params["id"]);
  const out = await processEventRow(id);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "commerce_webhook_retried", resource: "commerce_webhook_event", resourceId: id,
    details: { outcome: out.outcome }, req });
  res.json(out);
}));
