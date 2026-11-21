// Mapeo PURO de payloads de webhooks de Shopify → modelo interno.
// Sin acceso a BD: lo testea commerce/__tests__/shopifyMapping.test.ts.
import type { SubscriptionStatus } from "@workspace/db";

export const SUPPORTED_TOPICS = [
  "orders/create",
  "orders/paid",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
  "customers/create",
  "customers/update",
  "customers/redact",
  "customers/data_request",
  "shop/redact",
  "subscription_contracts/create",
  "subscription_contracts/update",
  "subscription_billing_attempts/success",
  "subscription_billing_attempts/failure",
  "disputes/create",
  "disputes/update",
] as const;
export type SupportedTopic = (typeof SUPPORTED_TOPICS)[number];

export function isSupportedTopic(topic: string): topic is SupportedTopic {
  return (SUPPORTED_TOPICS as readonly string[]).includes(topic);
}

// ── Tipos mínimos de los payloads (solo los campos que usamos) ──────────────
export interface ShopifyCustomerPayload {
  id: number | string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  default_address?: { company?: string | null; phone?: string | null } | null;
}

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string;                     // "#1001"
  email?: string | null;
  financial_status?: string | null;  // pending|authorized|paid|partially_paid|refunded|partially_refunded|voided
  cancelled_at?: string | null;
  closed_at?: string | null;
  processed_at?: string | null;
  total_price?: string;
  currency?: string;
  test?: boolean;
  customer?: ShopifyCustomerPayload | null;
  billing_address?: { company?: string | null; name?: string | null; phone?: string | null } | null;
  note_attributes?: Array<{ name: string; value: string }>;
  source_name?: string | null;       // "subscription_contract" en pedidos de renovación
  tags?: string | null;              // lista separada por comas
  line_items?: Array<{
    sku?: string | null;
    title?: string;
    quantity?: number;
    price?: string;
    variant_id?: number | string | null;
  }>;
}

export interface ShopifyRefundPayload {
  id: number | string;
  order_id: number | string;
  transactions?: Array<{ id: number | string; amount?: string; kind?: string; status?: string; currency?: string }>;
}

export interface ShopifySubscriptionContractPayload {
  id: number | string;
  admin_graphql_api_id?: string;
  status?: string;            // active|paused|cancelled|expired|failed
  customer_id?: number | string | null;
  origin_order_id?: number | string | null;
  currency_code?: string;
}

export interface ShopifyBillingAttemptPayload {
  id: number | string;
  order_id?: number | string | null;
  subscription_contract_id: number | string;
  error_message?: string | null;
  error_code?: string | null;
}

export interface ShopifyDisputePayload {
  id: number | string;
  order_id?: number | string | null;
  type?: string;              // chargeback | inquiry
  amount?: string;
  currency?: string;
  reason?: string;
  status?: string;
}

// ── Normalizadores ──────────────────────────────────────────────────────────
export const str = (v: number | string | null | undefined): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

export interface NormalizedCustomer {
  externalCustomerId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  companyName: string | null;
}

export function normalizeCustomer(c: ShopifyCustomerPayload): NormalizedCustomer {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;
  return {
    externalCustomerId: String(c.id),
    email: c.email?.trim().toLowerCase() || null,
    name,
    phone: c.phone || c.default_address?.phone || null,
    companyName: c.default_address?.company || null,
  };
}

/** Atributos de checkout que la tienda pide (empresa y NIF) — ver docs/omnicommerce. */
export function noteAttribute(order: ShopifyOrderPayload, key: string): string | null {
  const hit = order.note_attributes?.find((a) => a.name.toLowerCase() === key.toLowerCase());
  return hit?.value?.trim() || null;
}

export type FinancialStatus = "pending" | "authorized" | "paid" | "partially_refunded" | "refunded" | "voided";

export function normalizeFinancialStatus(s: string | null | undefined): FinancialStatus {
  switch ((s ?? "").toLowerCase()) {
    case "paid":               return "paid";
    case "authorized":         return "authorized";
    case "partially_refunded": return "partially_refunded";
    case "refunded":           return "refunded";
    case "voided":             return "voided";
    default:                   return "pending"; // pending, partially_paid, desconocido
  }
}

/** Solo "paid" cuenta como pago confirmado. "authorized" NO (no se ha capturado). */
export function isPaid(status: FinancialStatus): boolean {
  return status === "paid";
}

export function orderStatusOf(o: ShopifyOrderPayload): "open" | "cancelled" | "closed" {
  if (o.cancelled_at) return "cancelled";
  if (o.closed_at) return "closed";
  return "open";
}

export function mapContractStatus(s: string | null | undefined): SubscriptionStatus {
  switch ((s ?? "").toLowerCase()) {
    case "active":    return "active";
    case "paused":    return "suspended";
    case "cancelled": return "cancelled";
    case "expired":   return "expired";
    case "failed":    return "past_due";
    default:          return "pending";
  }
}

export function refundTotal(r: ShopifyRefundPayload): number {
  return (r.transactions ?? [])
    .filter((t) => (t.kind ?? "refund") === "refund" && (t.status ?? "success") === "success")
    .reduce((acc, t) => acc + Number(t.amount ?? 0), 0);
}

/**
 * ¿Es un pedido de RENOVACIÓN generado por la app de suscripciones?
 * Esos pedidos no son una contratación nueva: se registran como renewal y
 * nunca abren una solicitud de activación.
 */
export function isRenewalOrder(o: ShopifyOrderPayload): boolean {
  if ((o.source_name ?? "").toLowerCase() === "subscription_contract") return true;
  const tags = (o.tags ?? "").toLowerCase().split(",").map((t) => t.trim());
  return tags.includes("subscription recurring order");
}
