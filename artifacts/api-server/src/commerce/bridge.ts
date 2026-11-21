// ═══════════════════════════════════════════════════════════════════════════════
//  OmniCommerce Bridge — ingesta y procesado de eventos del canal comercial.
//
//  Garantías:
//   • Idempotencia: (source, event_id) único en commerce_webhook_events. Un
//     reenvío de un evento ya procesado no hace nada.
//   • Upserts por (source, external_id): un mismo pedido/cliente/contrato
//     recibido por varios topics converge al mismo registro.
//   • Una compra NUNCA activa nada: como mucho deja la solicitud en
//     pending_review para que la apruebe un SUPER_ADMIN.
//   • Ningún dato de empresa se borra: suspender = organizations.status.
// ═══════════════════════════════════════════════════════════════════════════════
import { createHash } from "crypto";
import cron from "node-cron";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  commerceProductsTable, commerceCustomersTable, commerceOrdersTable, commerceSubscriptionsTable,
  commerceWebhookEventsTable, activationRequestsTable, activationAuditLogsTable, billingHistoryTable,
  organizationsTable,
  type CommerceLineItem, type CommerceSource, type SubscriptionStatus, type ActivationStatus,
} from "@workspace/db";
import { clearModuleCache } from "../middlewares/requireModule";
import { logAuditSystem } from "../utils/auditLogger";
import { logger } from "../lib/logger";
import {
  isSupportedTopic, normalizeCustomer, normalizeFinancialStatus, isPaid, orderStatusOf,
  mapContractStatus, refundTotal, noteAttribute, str, isRenewalOrder,
  type ShopifyOrderPayload, type ShopifyCustomerPayload, type ShopifyRefundPayload,
  type ShopifySubscriptionContractPayload, type ShopifyBillingAttemptPayload, type ShopifyDisputePayload,
} from "./shopifyMapping";
import { loadPolicies, onPaymentFailed, onPaymentSucceeded, shouldSuspendNow } from "./policies";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Ingesta ─────────────────────────────────────────────────────────────────
export interface IncomingEvent {
  source: CommerceSource;
  eventId: string;
  topic: string;
  shopDomain: string | null;
  rawBody: Buffer;
  payload: unknown;
}

export type IngestResult =
  | { outcome: "processed" | "ignored" | "duplicate"; eventRowId: number }
  | { outcome: "failed"; eventRowId: number; error: string; retryable: boolean };

export async function ingestEvent(ev: IncomingEvent): Promise<IngestResult> {
  const payloadHash = createHash("sha256").update(ev.rawBody).digest("hex");

  const [inserted] = await db.insert(commerceWebhookEventsTable).values({
    source: ev.source, eventId: ev.eventId, topic: ev.topic, shopDomain: ev.shopDomain,
    payloadHash, payload: ev.payload as Record<string, unknown>, status: "received",
  }).onConflictDoNothing().returning();

  let row = inserted;
  if (!row) {
    const [existing] = await db.select().from(commerceWebhookEventsTable).where(and(
      eq(commerceWebhookEventsTable.source, ev.source),
      eq(commerceWebhookEventsTable.eventId, ev.eventId),
    ));
    if (!existing) throw new Error("webhook event vanished after conflict");
    if (existing.status === "processed" || existing.status === "ignored") {
      return { outcome: "duplicate", eventRowId: existing.id };
    }
    row = existing; // received/failed → se reintenta
  }
  return processEventRow(row.id);
}

/** Procesa (o reprocesa) un evento guardado. Lo usan la ingesta y el reintento manual. */
export async function processEventRow(eventRowId: number): Promise<IngestResult> {
  const policies = loadPolicies();
  const [row] = await db.select().from(commerceWebhookEventsTable).where(eq(commerceWebhookEventsTable.id, eventRowId));
  if (!row) throw new Error(`evento ${eventRowId} no existe`);
  if (row.status === "processed" || row.status === "ignored") return { outcome: "duplicate", eventRowId };

  const attempts = row.attempts + 1;
  if (!isSupportedTopic(row.topic)) {
    await db.update(commerceWebhookEventsTable)
      .set({ status: "ignored", attempts, processedAt: new Date(), payload: null })
      .where(eq(commerceWebhookEventsTable.id, eventRowId));
    return { outcome: "ignored", eventRowId };
  }
  if (row.payload == null) {
    await db.update(commerceWebhookEventsTable)
      .set({ status: "failed", attempts, lastError: "payload no disponible para reprocesar" })
      .where(eq(commerceWebhookEventsTable.id, eventRowId));
    return { outcome: "failed", eventRowId, error: "payload no disponible", retryable: false };
  }

  try {
    await db.transaction(async (tx) => {
      await dispatch(tx, row.source as CommerceSource, row.topic, row.payload, policies);
    });
    await db.update(commerceWebhookEventsTable)
      // payload a null: no se conservan datos personales del webhook una vez procesado (RGPD).
      .set({ status: "processed", attempts, processedAt: new Date(), lastError: null, payload: null })
      .where(eq(commerceWebhookEventsTable.id, eventRowId));
    return { outcome: "processed", eventRowId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, eventRowId, topic: row.topic }, "[OmniCommerce] fallo procesando evento");
    await db.update(commerceWebhookEventsTable)
      .set({ status: "failed", attempts, lastError: error.slice(0, 2000) })
      .where(eq(commerceWebhookEventsTable.id, eventRowId));
    return { outcome: "failed", eventRowId, error, retryable: attempts < policies.maxWebhookAttempts };
  }
}

async function dispatch(tx: Tx, source: CommerceSource, topic: string, payload: unknown, p: ReturnType<typeof loadPolicies>) {
  switch (topic) {
    case "orders/create":
    case "orders/updated":
    case "orders/paid":
    case "orders/cancelled":
      await upsertOrder(tx, source, payload as ShopifyOrderPayload, p);
      return;
    case "refunds/create":
      await handleRefund(tx, source, payload as ShopifyRefundPayload, p);
      return;
    case "customers/create":
    case "customers/update":
      await upsertCustomer(tx, source, payload as ShopifyCustomerPayload);
      return;
    case "customers/redact":
      await redactCustomer(tx, source, payload as { customer?: { id: number | string } });
      return;
    case "customers/data_request":
    case "shop/redact":
      // Requieren intervención humana: queda trazado en audit_logs para atenderlo en plazo RGPD.
      await logAuditSystem({ actorClerkId: "system:omnicommerce", action: `commerce_${topic.replace("/", "_")}`,
        resource: "commerce", details: { topic }, severity: "warning" });
      return;
    case "subscription_contracts/create":
    case "subscription_contracts/update":
      await upsertContract(tx, source, payload as ShopifySubscriptionContractPayload);
      return;
    case "subscription_billing_attempts/success":
      await handleBillingAttempt(tx, source, payload as ShopifyBillingAttemptPayload, true, p);
      return;
    case "subscription_billing_attempts/failure":
      await handleBillingAttempt(tx, source, payload as ShopifyBillingAttemptPayload, false, p);
      return;
    case "disputes/create":
    case "disputes/update":
      await handleDispute(tx, source, payload as ShopifyDisputePayload, p);
      return;
  }
}

// ── Clientes ────────────────────────────────────────────────────────────────
async function upsertCustomer(tx: Tx, source: CommerceSource, c: ShopifyCustomerPayload, extra?: { companyName?: string | null; taxId?: string | null }) {
  const n = normalizeCustomer(c);
  const companyName = extra?.companyName ?? n.companyName;
  const [row] = await tx.insert(commerceCustomersTable).values({
    source, externalCustomerId: n.externalCustomerId, email: n.email, name: n.name, phone: n.phone,
    companyName, taxId: extra?.taxId ?? null,
  }).onConflictDoUpdate({
    target: [commerceCustomersTable.source, commerceCustomersTable.externalCustomerId],
    set: {
      email: n.email, name: n.name, phone: n.phone,
      // No pisar empresa/NIF con null si un evento posterior no los trae.
      companyName: sql`coalesce(${companyName}, ${commerceCustomersTable.companyName})`,
      taxId: sql`coalesce(${extra?.taxId ?? null}, ${commerceCustomersTable.taxId})`,
      updatedAt: new Date(),
    },
  }).returning();
  return row!;
}

async function redactCustomer(tx: Tx, source: CommerceSource, payload: { customer?: { id: number | string } }) {
  const ext = str(payload.customer?.id);
  if (!ext) return;
  // Se anonimiza la persona; los registros de facturación se conservan (obligación legal).
  await tx.update(commerceCustomersTable)
    .set({ email: null, name: null, phone: null, updatedAt: new Date() })
    .where(and(eq(commerceCustomersTable.source, source), eq(commerceCustomersTable.externalCustomerId, ext)));
}

// ── Pedidos + solicitud de activación ───────────────────────────────────────
async function resolveLineItems(tx: Tx, order: ShopifyOrderPayload): Promise<{ items: CommerceLineItem[]; planProduct: typeof commerceProductsTable.$inferSelect | null }> {
  const skus = (order.line_items ?? []).map((li) => li.sku?.trim()).filter((s): s is string => !!s);
  const products = skus.length
    ? await tx.select().from(commerceProductsTable).where(inArray(commerceProductsTable.sku, skus))
    : [];
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const items: CommerceLineItem[] = (order.line_items ?? []).map((li) => ({
    sku: li.sku?.trim() || null,
    title: li.title ?? "",
    quantity: li.quantity ?? 1,
    price: li.price ?? "0",
    variantId: str(li.variant_id),
    productId: li.sku ? bySku.get(li.sku.trim())?.id ?? null : null,
  }));
  const planProduct = products.find((p) => p.kind === "plan" && p.isActive && !p.priceCustom) ?? null;
  return { items, planProduct };
}

async function upsertOrder(tx: Tx, source: CommerceSource, o: ShopifyOrderPayload, p: ReturnType<typeof loadPolicies>) {
  const customer = o.customer
    ? await upsertCustomer(tx, source, { ...o.customer, email: o.customer.email ?? o.email ?? null }, {
        companyName: noteAttribute(o, "empresa") ?? o.billing_address?.company ?? null,
        taxId: noteAttribute(o, "nif") ?? noteAttribute(o, "cif"),
      })
    : null;

  const financialStatus = normalizeFinancialStatus(o.financial_status);
  const orderStatus = orderStatusOf(o);
  const paid = isPaid(financialStatus);
  const { items, planProduct } = await resolveLineItems(tx, o);
  const now = new Date();

  const [order] = await tx.insert(commerceOrdersTable).values({
    source, externalOrderId: String(o.id), orderNumber: o.name ?? null, customerId: customer?.id ?? null,
    financialStatus, orderStatus, totalAmount: o.total_price ?? null, currency: o.currency ?? "EUR",
    lineItems: items, isTest: !!o.test,
    paidAt: paid ? now : null, cancelledAt: o.cancelled_at ? new Date(o.cancelled_at) : null,
  }).onConflictDoUpdate({
    target: [commerceOrdersTable.source, commerceOrdersTable.externalOrderId],
    set: {
      orderNumber: o.name ?? null,
      customerId: customer?.id ?? null,
      financialStatus, orderStatus,
      totalAmount: o.total_price ?? null,
      lineItems: items,
      isTest: !!o.test,
      paidAt: sql`coalesce(${commerceOrdersTable.paidAt}, ${paid ? now : null})`,
      cancelledAt: o.cancelled_at ? new Date(o.cancelled_at) : null,
      updatedAt: now,
    },
  }).returning();

  const renewal = isRenewalOrder(o);

  if (paid) {
    const inserted = await tx.insert(billingHistoryTable).values({
      source, kind: renewal ? "renewal" : "charge", externalTransactionId: `order:${o.id}`, orderId: order!.id,
      customerId: customer?.id ?? null, orgId: renewal ? customer?.orgId ?? null : null,
      amount: o.total_price ?? null, currency: o.currency ?? "EUR",
      details: { orderNumber: o.name ?? null, test: !!o.test },
    }).onConflictDoNothing().returning();
    // Renovación cobrada: equivale a un cobro correcto de la suscripción del cliente.
    if (renewal && inserted.length && customer) await applyRenewalPayment(tx, source, customer.id, p);
  }

  // Un pedido de renovación NUNCA abre una solicitud de activación.
  if (renewal) return;

  await syncActivationRequest(tx, {
    source, orderId: order!.id, customerId: customer?.id ?? null,
    plan: planProduct?.planKey ?? null, modules: (planProduct?.modules as string[] | undefined) ?? [],
    paid, cancelled: orderStatus === "cancelled" || financialStatus === "refunded" || financialStatus === "voided",
    unknownSku: !planProduct,
  });
}

async function writeActivationAudit(tx: Tx, requestId: number, action: string, from: string | null, to: string | null, details?: Record<string, unknown>, actor: string | null = null) {
  await tx.insert(activationAuditLogsTable).values({
    activationRequestId: requestId, actorClerkId: actor, action, fromStatus: from, toStatus: to, details: details ?? null,
  });
}

/** Crea o avanza la solicitud del pedido. Nunca activa: el máximo estado automático es pending_review. */
async function syncActivationRequest(tx: Tx, a: {
  source: CommerceSource; orderId: number; customerId: number | null; plan: string | null; modules: string[];
  paid: boolean; cancelled: boolean; unknownSku: boolean;
}) {
  const [existing] = await tx.select().from(activationRequestsTable)
    .where(eq(activationRequestsTable.orderId, a.orderId)).for("update");

  const unknownSkuNote = a.unknownSku ? "Ningún SKU del pedido corresponde a un plan vendible del catálogo." : null;

  if (!existing) {
    const status: ActivationStatus = a.cancelled ? "rejected" : a.paid ? "pending_review" : "pending_payment";
    const [created] = await tx.insert(activationRequestsTable).values({
      source: a.source, orderId: a.orderId, customerId: a.customerId,
      requestedPlan: a.plan, requestedModules: a.modules, status,
      paymentVerified: a.paid, paymentVerifiedVia: a.paid ? "webhook" : null,
      lastError: unknownSkuNote, reviewNotes: a.cancelled ? "Pedido cancelado/reembolsado antes de revisión" : null,
    }).onConflictDoNothing().returning();
    if (created) await writeActivationAudit(tx, created.id, "created", null, status, { paid: a.paid, plan: a.plan });
    return;
  }

  // Estados finales o en manos del admin: los eventos del pedido no los mueven,
  // salvo marcar el pago verificado (dato informativo para quien revisa).
  let next: ActivationStatus = existing.status as ActivationStatus;
  if (existing.status === "pending_payment" && a.paid) next = "pending_review";
  if (a.cancelled && ["pending_payment", "pending_review", "info_requested"].includes(existing.status)) next = "rejected";

  const paymentVerified = existing.paymentVerified || a.paid;
  if (next !== existing.status || paymentVerified !== existing.paymentVerified || (a.plan && !existing.requestedPlan)) {
    await tx.update(activationRequestsTable).set({
      status: next,
      paymentVerified,
      paymentVerifiedVia: paymentVerified ? (existing.paymentVerifiedVia ?? "webhook") : null,
      requestedPlan: existing.requestedPlan ?? a.plan,
      requestedModules: existing.requestedPlan ? existing.requestedModules : a.modules,
      customerId: existing.customerId ?? a.customerId,
      lastError: existing.requestedPlan || a.plan ? null : unknownSkuNote,
      reviewNotes: next === "rejected" && existing.status !== "rejected"
        ? "Rechazada automáticamente: pedido cancelado/reembolsado antes de la activación"
        : existing.reviewNotes,
      decidedAt: next === "rejected" && existing.status !== "rejected" ? new Date() : existing.decidedAt,
      updatedAt: new Date(),
    }).where(eq(activationRequestsTable.id, existing.id));
    if (next !== existing.status) {
      await writeActivationAudit(tx, existing.id, a.cancelled ? "auto_rejected_order_cancelled" : "payment_confirmed", existing.status, next);
    }
  }
}

// ── Reembolsos ──────────────────────────────────────────────────────────────
async function handleRefund(tx: Tx, source: CommerceSource, r: ShopifyRefundPayload, p: ReturnType<typeof loadPolicies>) {
  const [order] = await tx.select().from(commerceOrdersTable).where(and(
    eq(commerceOrdersTable.source, source), eq(commerceOrdersTable.externalOrderId, String(r.order_id)),
  )).for("update");
  if (!order) throw new Error(`reembolso de un pedido desconocido (${r.order_id}): se reintentará cuando llegue orders/create`);

  const amount = refundTotal(r);
  const inserted = await tx.insert(billingHistoryTable).values({
    source, kind: "refund", externalTransactionId: `refund:${r.id}`, orderId: order.id, customerId: order.customerId,
    amount: amount.toFixed(2), currency: order.currency,
  }).onConflictDoNothing().returning();
  if (!inserted.length) return; // reembolso ya contabilizado

  const refunded = Number(order.refundedAmount) + amount;
  const full = order.totalAmount != null && refunded >= Number(order.totalAmount) - 0.005;
  await tx.update(commerceOrdersTable).set({
    refundedAmount: refunded.toFixed(2),
    financialStatus: full ? "refunded" : "partially_refunded",
    updatedAt: new Date(),
  }).where(eq(commerceOrdersTable.id, order.id));

  if (!full) return;
  const [req] = await tx.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, order.id)).for("update");
  if (!req) return;
  if (["pending_payment", "pending_review", "info_requested"].includes(req.status)) {
    await tx.update(activationRequestsTable).set({
      status: "rejected", decidedAt: new Date(), updatedAt: new Date(),
      reviewNotes: "Rechazada automáticamente: pedido reembolsado por completo antes de la activación",
    }).where(eq(activationRequestsTable.id, req.id));
    await writeActivationAudit(tx, req.id, "auto_rejected_full_refund", req.status, "rejected", { amount });
  } else if (req.status === "activated" && req.orgId && p.suspendOnFullRefund) {
    await suspendOrg(tx, req.orgId, "full_refund");
    await writeActivationAudit(tx, req.id, "org_suspended_full_refund", req.status, req.status, { orgId: req.orgId });
  }
}

// ── Suscripciones ───────────────────────────────────────────────────────────
async function findOrderByExternal(tx: Tx, source: CommerceSource, ext: string | null) {
  if (!ext) return null;
  const [o] = await tx.select().from(commerceOrdersTable).where(and(
    eq(commerceOrdersTable.source, source), eq(commerceOrdersTable.externalOrderId, ext),
  ));
  return o ?? null;
}

async function upsertContract(tx: Tx, source: CommerceSource, c: ShopifySubscriptionContractPayload) {
  const status = mapContractStatus(c.status);
  const originOrder = await findOrderByExternal(tx, source, str(c.origin_order_id));
  const [customer] = c.customer_id
    ? await tx.select().from(commerceCustomersTable).where(and(
        eq(commerceCustomersTable.source, source), eq(commerceCustomersTable.externalCustomerId, String(c.customer_id)),
      ))
    : [];
  const planProductId = originOrder?.lineItems.find((li) => li.productId)?.productId ?? null;
  const now = new Date();
  const terminal = status === "cancelled" || status === "expired";

  const [prev] = await tx.select().from(commerceSubscriptionsTable).where(and(
    eq(commerceSubscriptionsTable.source, source), eq(commerceSubscriptionsTable.externalContractId, String(c.id)),
  )).for("update");

  let sub;
  if (!prev) {
    [sub] = await tx.insert(commerceSubscriptionsTable).values({
      source, externalContractId: String(c.id), customerId: customer?.id ?? null,
      originOrderId: originOrder?.id ?? null, productId: planProductId, status,
      cancelledAt: terminal ? now : null,
    }).returning();
  } else {
    // Un "active" de Shopify no saca de grace/suspended: eso solo lo hace un cobro correcto.
    const keep = (prev.status === "grace" || prev.status === "suspended") && status === "active";
    [sub] = await tx.update(commerceSubscriptionsTable).set({
      status: keep ? prev.status : status,
      customerId: prev.customerId ?? customer?.id ?? null,
      originOrderId: prev.originOrderId ?? originOrder?.id ?? null,
      productId: prev.productId ?? planProductId,
      cancelledAt: terminal ? (prev.cancelledAt ?? now) : null,
      updatedAt: now,
    }).where(eq(commerceSubscriptionsTable.id, prev.id)).returning();
  }

  if (originOrder) {
    const [req] = await tx.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, originOrder.id));
    if (req && !req.subscriptionId) {
      await tx.update(activationRequestsTable).set({ subscriptionId: sub!.id, updatedAt: now })
        .where(eq(activationRequestsTable.id, req.id));
      if (req.orgId && !sub!.orgId) {
        await tx.update(commerceSubscriptionsTable).set({ orgId: req.orgId }).where(eq(commerceSubscriptionsTable.id, sub!.id));
      }
    }
  }
}

async function applyRenewalPayment(tx: Tx, source: CommerceSource, customerId: number, p: ReturnType<typeof loadPolicies>) {
  const subs = await tx.select().from(commerceSubscriptionsTable).where(and(
    eq(commerceSubscriptionsTable.source, source), eq(commerceSubscriptionsTable.customerId, customerId),
  )).for("update");
  const now = new Date();
  for (const sub of subs) {
    const r = onPaymentSucceeded(sub.status as SubscriptionStatus, p);
    await tx.update(commerceSubscriptionsTable).set({
      status: r.status, lastPaymentAt: now, failedPaymentCount: 0, graceUntil: null,
      suspendedAt: r.reactivateOrg ? null : sub.suspendedAt, updatedAt: now,
    }).where(eq(commerceSubscriptionsTable.id, sub.id));
    if (r.reactivateOrg && sub.orgId) await reactivateOrg(tx, sub.orgId, "renewal_order_paid");
  }
}

async function findContract(tx: Tx, source: CommerceSource, ext: string) {
  const [s] = await tx.select().from(commerceSubscriptionsTable).where(and(
    eq(commerceSubscriptionsTable.source, source), eq(commerceSubscriptionsTable.externalContractId, ext),
  )).for("update");
  return s ?? null;
}

async function handleBillingAttempt(tx: Tx, source: CommerceSource, b: ShopifyBillingAttemptPayload, ok: boolean, p: ReturnType<typeof loadPolicies>) {
  const sub = await findContract(tx, source, String(b.subscription_contract_id));
  if (!sub) throw new Error(`cobro de un contrato desconocido (${b.subscription_contract_id}): se reintentará`);
  const order = await findOrderByExternal(tx, source, str(b.order_id));
  const now = new Date();

  const inserted = await tx.insert(billingHistoryTable).values({
    source, kind: ok ? "renewal" : "failed_payment", externalTransactionId: `billing_attempt:${b.id}`,
    orderId: order?.id ?? null, subscriptionId: sub.id, customerId: sub.customerId, orgId: sub.orgId,
    amount: order?.totalAmount ?? null, currency: order?.currency ?? "EUR",
    details: ok ? null : { errorCode: b.error_code ?? null, errorMessage: b.error_message ?? null },
  }).onConflictDoNothing().returning();
  if (!inserted.length) return;

  if (ok) {
    const r = onPaymentSucceeded(sub.status as SubscriptionStatus, p);
    await tx.update(commerceSubscriptionsTable).set({
      status: r.status, lastPaymentAt: now, failedPaymentCount: 0, graceUntil: null,
      suspendedAt: r.reactivateOrg ? null : sub.suspendedAt, updatedAt: now,
    }).where(eq(commerceSubscriptionsTable.id, sub.id));
    if (r.reactivateOrg && sub.orgId) await reactivateOrg(tx, sub.orgId, "payment_received");
  } else {
    const r = onPaymentFailed(sub.status as SubscriptionStatus, now, p, sub.graceUntil);
    await tx.update(commerceSubscriptionsTable).set({
      status: r.status, graceUntil: r.graceUntil, failedPaymentCount: sub.failedPaymentCount + 1, updatedAt: now,
    }).where(eq(commerceSubscriptionsTable.id, sub.id));
  }
}

async function handleDispute(tx: Tx, source: CommerceSource, d: ShopifyDisputePayload, p: ReturnType<typeof loadPolicies>) {
  if ((d.type ?? "chargeback") !== "chargeback") return; // las "inquiry" no son contracargos
  const order = await findOrderByExternal(tx, source, str(d.order_id));
  const inserted = await tx.insert(billingHistoryTable).values({
    source, kind: "chargeback", externalTransactionId: `dispute:${d.id}`, orderId: order?.id ?? null,
    customerId: order?.customerId ?? null, amount: d.amount ?? null, currency: d.currency ?? order?.currency ?? "EUR",
    details: { reason: d.reason ?? null, status: d.status ?? null },
  }).onConflictDoNothing().returning();
  if (!inserted.length || !order || !p.suspendOnChargeback) return;

  const [req] = await tx.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, order.id));
  const orgId = req?.orgId ?? null;
  if (orgId) {
    await suspendOrg(tx, orgId, "chargeback");
    await tx.update(commerceSubscriptionsTable).set({ status: "suspended", suspendedAt: new Date(), updatedAt: new Date() })
      .where(eq(commerceSubscriptionsTable.orgId, orgId));
    await writeActivationAudit(tx, req!.id, "org_suspended_chargeback", req!.status, req!.status, { disputeId: String(d.id) });
  }
}

// ── Empresa: suspender / reactivar (nunca borrar) ───────────────────────────
async function suspendOrg(tx: Tx, orgId: number, reason: string) {
  await tx.update(organizationsTable).set({ status: "suspended" }).where(eq(organizationsTable.id, orgId));
  clearModuleCache(orgId);
  await logAuditSystem({ actorClerkId: "system:omnicommerce", action: "workspace_suspended", resource: "workspace",
    resourceId: String(orgId), orgId, details: { reason }, severity: "warning" });
}

async function reactivateOrg(tx: Tx, orgId: number, reason: string) {
  await tx.update(organizationsTable).set({ status: "active" }).where(eq(organizationsTable.id, orgId));
  clearModuleCache(orgId);
  await logAuditSystem({ actorClerkId: "system:omnicommerce", action: "workspace_activated", resource: "workspace",
    resourceId: String(orgId), orgId, details: { reason } });
}

// ── Tick de políticas (cron externo → /internal/cron/commerce-policies) ─────
export async function runCommercePolicyTick(now = new Date()): Promise<{ suspended: number[] }> {
  const p = loadPolicies();
  const candidates = await db.select().from(commerceSubscriptionsTable).where(
    inArray(commerceSubscriptionsTable.status, ["grace", "cancelled", "expired"]),
  );
  const suspended: number[] = [];
  for (const s of candidates) {
    if (!s.orgId) continue;
    if (!shouldSuspendNow({
      status: s.status as SubscriptionStatus, graceUntil: s.graceUntil, cancelledAt: s.cancelledAt, suspendedAt: s.suspendedAt,
    }, now, p)) continue;
    await db.transaction(async (tx) => {
      await suspendOrg(tx, s.orgId!, s.status === "grace" ? "grace_expired" : "subscription_ended");
      await tx.update(commerceSubscriptionsTable).set({
        status: s.status === "grace" ? "suspended" : s.status, suspendedAt: now, updatedAt: now,
      }).where(eq(commerceSubscriptionsTable.id, s.id));
    });
    suspended.push(s.orgId);
  }
  return { suspended };
}

/** Scheduler residente (Render): aplica las políticas cada hora, en el minuto 7. */
let policySchedulerStarted = false;
export function startCommercePolicyScheduler() {
  if (policySchedulerStarted) return;
  policySchedulerStarted = true;
  cron.schedule("7 * * * *", () => {
    runCommercePolicyTick()
      .then((r) => { if (r.suspended.length) logger.warn({ suspended: r.suspended }, "[OmniCommerce] empresas suspendidas por política"); })
      .catch((err) => logger.error({ err }, "[OmniCommerce] tick de políticas falló"));
  });
  logger.info("[OmniCommerce] Policy scheduler started (hourly)");
}
