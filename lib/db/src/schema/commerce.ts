// ═══════════════════════════════════════════════════════════════════════════════
//  OmniCommerce Bridge — esquema comercial (Shopify hoy, Hotmart preparado)
//
//  Principios:
//   • Una compra NUNCA activa una licencia: crea un activation_request que un
//     SUPER_ADMIN aprueba desde Omni Control Center.
//   • El estado del pedido (commerce_orders) y el de la suscripción
//     (commerce_subscriptions) son independientes.
//   • Nada se borra en cascada desde organizations: al terminar una suscripción
//     la empresa se suspende, sus datos se conservan.
//   • Las licencias reutilizan license_plans + module_configs (no hay tabla
//     saas_licenses duplicada).
//   • Precios: commerce_products refleja credit_plans (tarifa oficial vigente),
//     no la sustituye.
// ═══════════════════════════════════════════════════════════════════════════════
import {
  pgTable, serial, text, timestamp, boolean, integer, jsonb, numeric, unique, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

export const COMMERCE_SOURCES = ["shopify", "hotmart"] as const;
export type CommerceSource = (typeof COMMERCE_SOURCES)[number];

// ── Catálogo comercial: SKU interno ↔ variante del canal ────────────────────
export const commerceProductsTable = pgTable("commerce_products", {
  id:                serial("id").primaryKey(),
  sku:               text("sku").notNull().unique(),              // identificador interno OmniTech (= SKU en Shopify)
  name:              text("name").notNull(),
  kind:              text("kind").notNull().default("plan"),      // plan | module | service
  planKey:           text("plan_key"),                            // = credit_plans.plan / organizations.plan
  modules:           jsonb("modules").$type<string[]>().notNull().default([]),
  priceAmount:       numeric("price_amount", { precision: 12, scale: 2 }),
  currency:          text("currency").notNull().default("EUR"),
  billingInterval:   text("billing_interval").notNull().default("monthly"), // monthly | one_time
  priceCustom:       boolean("price_custom").notNull().default(false),      // Enterprise: a medida, no vendible online
  shopifyProductId:  text("shopify_product_id"),
  shopifyVariantId:  text("shopify_variant_id"),
  hotmartProductId:  text("hotmart_product_id"),
  isActive:          boolean("is_active").notNull().default(true),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  check("commerce_products_kind_check", sql`${t.kind} in ('plan','module','service')`),
  check("commerce_products_interval_check", sql`${t.billingInterval} in ('monthly','one_time')`),
]);

// ── Clientes del canal (no son usuarios de la plataforma hasta la aprobación) ─
export const commerceCustomersTable = pgTable("commerce_customers", {
  id:                 serial("id").primaryKey(),
  source:             text("source").notNull(),
  externalCustomerId: text("external_customer_id").notNull(),
  email:              text("email"),
  name:               text("name"),
  phone:              text("phone"),
  companyName:        text("company_name"),
  taxId:              text("tax_id"),
  orgId:              integer("org_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("commerce_customers_source_ext_unique").on(t.source, t.externalCustomerId),
  index("commerce_customers_email_idx").on(t.email),
]);

// ── Pedidos (estado del pedido ≠ estado de la suscripción) ──────────────────
export const commerceOrdersTable = pgTable("commerce_orders", {
  id:                  serial("id").primaryKey(),
  source:              text("source").notNull(),
  externalOrderId:     text("external_order_id").notNull(),
  orderNumber:         text("order_number"),
  customerId:          integer("customer_id").references(() => commerceCustomersTable.id, { onDelete: "set null" }),
  financialStatus:     text("financial_status").notNull().default("pending"), // pending|authorized|paid|partially_refunded|refunded|voided
  orderStatus:         text("order_status").notNull().default("open"),         // open|cancelled|closed
  totalAmount:         numeric("total_amount", { precision: 12, scale: 2 }),
  refundedAmount:      numeric("refunded_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency:            text("currency").notNull().default("EUR"),
  lineItems:           jsonb("line_items").$type<CommerceLineItem[]>().notNull().default([]),
  isTest:              boolean("is_test").notNull().default(false),
  paidAt:              timestamp("paid_at"),
  cancelledAt:         timestamp("cancelled_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("commerce_orders_source_ext_unique").on(t.source, t.externalOrderId),
  index("commerce_orders_customer_idx").on(t.customerId),
  index("commerce_orders_financial_idx").on(t.financialStatus),
]);

export interface CommerceLineItem {
  sku:       string | null;
  title:     string;
  quantity:  number;
  price:     string;
  variantId: string | null;
  productId: number | null;   // commerce_products.id si el SKU es conocido
}

// ── Suscripciones (contratos recurrentes) ───────────────────────────────────
export const SUBSCRIPTION_STATUSES = [
  "pending", "active", "past_due", "grace", "suspended", "cancelled", "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const commerceSubscriptionsTable = pgTable("commerce_subscriptions", {
  id:                  serial("id").primaryKey(),
  source:              text("source").notNull(),
  externalContractId:  text("external_contract_id").notNull(),
  customerId:          integer("customer_id").references(() => commerceCustomersTable.id, { onDelete: "set null" }),
  originOrderId:       integer("origin_order_id").references(() => commerceOrdersTable.id, { onDelete: "set null" }),
  productId:           integer("product_id").references(() => commerceProductsTable.id, { onDelete: "set null" }),
  orgId:               integer("org_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  status:              text("status").notNull().default("pending"),
  currentPeriodEnd:    timestamp("current_period_end"),
  nextBillingAt:       timestamp("next_billing_at"),
  graceUntil:          timestamp("grace_until"),
  lastPaymentAt:       timestamp("last_payment_at"),
  failedPaymentCount:  integer("failed_payment_count").notNull().default(0),
  cancelledAt:         timestamp("cancelled_at"),
  suspendedAt:         timestamp("suspended_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("commerce_subscriptions_source_ext_unique").on(t.source, t.externalContractId),
  index("commerce_subscriptions_status_idx").on(t.status),
  index("commerce_subscriptions_org_idx").on(t.orgId),
  check("commerce_subscriptions_status_check",
    sql`${t.status} in ('pending','active','past_due','grace','suspended','cancelled','expired')`),
]);

// ── Registro de webhooks (idempotencia + trazabilidad + reintentos) ─────────
export const commerceWebhookEventsTable = pgTable("commerce_webhook_events", {
  id:           serial("id").primaryKey(),
  source:       text("source").notNull(),
  eventId:      text("event_id").notNull(),        // X-Shopify-Webhook-Id
  topic:        text("topic").notNull(),
  shopDomain:   text("shop_domain"),
  payloadHash:  text("payload_hash").notNull(),    // sha256 del cuerpo — no se guarda el payload (RGPD)
  payload:      jsonb("payload"),                  // solo mientras status != processed (para reintentar); se vacía al procesar
  status:       text("status").notNull().default("received"), // received|processed|failed|ignored
  attempts:     integer("attempts").notNull().default(0),
  lastError:    text("last_error"),
  receivedAt:   timestamp("received_at").defaultNow().notNull(),
  processedAt:  timestamp("processed_at"),
}, (t) => [
  unique("commerce_webhook_events_source_event_unique").on(t.source, t.eventId),
  index("commerce_webhook_events_status_idx").on(t.status),
]);

// ── Solicitudes de activación (cola de aprobación manual) ───────────────────
export const ACTIVATION_STATUSES = [
  "pending_payment", "pending_review", "info_requested", "approved", "rejected", "activated", "failed",
] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

export const activationRequestsTable = pgTable("activation_requests", {
  id:                 serial("id").primaryKey(),
  source:             text("source").notNull(),
  orderId:            integer("order_id").notNull().references(() => commerceOrdersTable.id, { onDelete: "restrict" }),
  customerId:         integer("customer_id").references(() => commerceCustomersTable.id, { onDelete: "set null" }),
  subscriptionId:     integer("subscription_id").references(() => commerceSubscriptionsTable.id, { onDelete: "set null" }),
  requestedPlan:      text("requested_plan"),
  requestedModules:   jsonb("requested_modules").$type<string[]>().notNull().default([]),
  status:             text("status").notNull().default("pending_payment"),
  paymentVerified:    boolean("payment_verified").notNull().default(false),
  paymentVerifiedVia: text("payment_verified_via"),  // webhook | admin_api
  orgId:              integer("org_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  reviewerClerkId:    text("reviewer_clerk_id"),
  reviewNotes:        text("review_notes"),
  infoRequest:        text("info_request"),
  lastError:          text("last_error"),
  decidedAt:          timestamp("decided_at"),
  activatedAt:        timestamp("activated_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("activation_requests_order_unique").on(t.orderId),   // un pedido ⇒ una solicitud (anti-duplicado)
  index("activation_requests_status_idx").on(t.status),
  check("activation_requests_status_check",
    sql`${t.status} in ('pending_payment','pending_review','info_requested','approved','rejected','activated','failed')`),
]);

// ── Auditoría específica de activaciones (además de audit_logs global) ──────
export const activationAuditLogsTable = pgTable("activation_audit_logs", {
  id:                  serial("id").primaryKey(),
  activationRequestId: integer("activation_request_id").notNull().references(() => activationRequestsTable.id, { onDelete: "restrict" }),
  actorClerkId:        text("actor_clerk_id"),            // null = sistema (webhook)
  action:              text("action").notNull(),
  fromStatus:          text("from_status"),
  toStatus:            text("to_status"),
  details:             jsonb("details"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("activation_audit_logs_request_idx").on(t.activationRequestId),
]);

// ── Historial de facturación (cobros, renovaciones, reembolsos, contracargos) ─
export const billingHistoryTable = pgTable("billing_history", {
  id:                    serial("id").primaryKey(),
  source:                text("source").notNull(),
  kind:                  text("kind").notNull(),   // charge|renewal|failed_payment|refund|chargeback
  externalTransactionId: text("external_transaction_id").notNull(),
  orderId:               integer("order_id").references(() => commerceOrdersTable.id, { onDelete: "set null" }),
  subscriptionId:        integer("subscription_id").references(() => commerceSubscriptionsTable.id, { onDelete: "set null" }),
  customerId:            integer("customer_id").references(() => commerceCustomersTable.id, { onDelete: "set null" }),
  orgId:                 integer("org_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  amount:                numeric("amount", { precision: 12, scale: 2 }),
  currency:              text("currency").notNull().default("EUR"),
  details:               jsonb("details"),
  occurredAt:            timestamp("occurred_at").defaultNow().notNull(),
}, (t) => [
  unique("billing_history_source_tx_kind_unique").on(t.source, t.externalTransactionId, t.kind),
  index("billing_history_org_idx").on(t.orgId),
  check("billing_history_kind_check",
    sql`${t.kind} in ('charge','renewal','failed_payment','refund','chargeback')`),
]);

export type CommerceProduct      = typeof commerceProductsTable.$inferSelect;
export type CommerceCustomer     = typeof commerceCustomersTable.$inferSelect;
export type CommerceOrder        = typeof commerceOrdersTable.$inferSelect;
export type CommerceSubscription = typeof commerceSubscriptionsTable.$inferSelect;
export type CommerceWebhookEvent = typeof commerceWebhookEventsTable.$inferSelect;
export type ActivationRequest    = typeof activationRequestsTable.$inferSelect;
export type BillingHistoryEntry  = typeof billingHistoryTable.$inferSelect;
