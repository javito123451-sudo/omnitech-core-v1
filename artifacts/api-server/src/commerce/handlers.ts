/**
 * Manejadores de eventos Shopify. Cada uno se ejecuta dentro de la transacción del evento.
 * REGLA: ninguno crea empresa, workspace, licencia ni módulos. Solo registran estado comercial
 * y, como mucho, una activation_request en 'pending' (la aprobación es siempre manual).
 */
import { sql } from "drizzle-orm";
import { dbRows, getPolicy } from "./settings";
import { findValidAuthorization } from "./capture";
import { auditActivation, cancelSubscription, recordPaymentFailure, recordPaymentSuccess, suspendSubscription, type Tx } from "./lifecycle";

const ACTOR = "system:shopify-webhook";
type P = Record<string, any>; // payload Shopify (no confiable: se valida campo a campo)

export const toCents = (v: unknown): number => {
  const n = Math.round(parseFloat(String(v ?? "0")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const lastId = (v: unknown): string | null => { const s = str(v); return s ? s.split("/").pop()! : null; };

export async function upsertCustomer(tx: Tx, c: P | null | undefined, billingCompany?: string | null): Promise<number | null> {
  const sid = lastId(c?.id);
  if (!sid) return null;
  const consent = c?.email_marketing_consent?.state === "subscribed" || c?.accepts_marketing === true;
  const rows = dbRows<{ id: number }>(await tx.execute(sql`
    INSERT INTO commerce_customers (shopify_customer_id, email, first_name, last_name, company, phone, marketing_consent, consent_at)
    VALUES (${sid}::text, ${str(c?.email)}::text, ${str(c?.first_name)}::text, ${str(c?.last_name)}::text,
            ${str(billingCompany ?? c?.default_address?.company)}::text, ${str(c?.phone)}::text, ${consent}::boolean,
            ${consent ? new Date().toISOString() : null}::timestamptz)
    ON CONFLICT (shopify_customer_id) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, commerce_customers.email),
      first_name = COALESCE(EXCLUDED.first_name, commerce_customers.first_name),
      last_name = COALESCE(EXCLUDED.last_name, commerce_customers.last_name),
      company = COALESCE(EXCLUDED.company, commerce_customers.company),
      phone = COALESCE(EXCLUDED.phone, commerce_customers.phone),
      marketing_consent = EXCLUDED.marketing_consent,
      consent_at = COALESCE(commerce_customers.consent_at, EXCLUDED.consent_at),
      updated_at = NOW()
    WHERE commerce_customers.redacted_at IS NULL
    RETURNING id`));
  return rows[0]?.id ?? (dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM commerce_customers WHERE shopify_customer_id=${sid}::text`))[0]?.id ?? null);
}

function orderStatusFrom(p: P): string {
  if (p.cancelled_at) return "cancelled";
  switch (p.financial_status) {
    case "paid": return "paid";
    case "refunded": return "refunded";
    case "partially_refunded": return "partially_refunded";
    case "voided": return "cancelled";
    case "pending": case "authorized": case "partially_paid": return "pending_payment";
    default: return "received";
  }
}

/** Upsert del pedido. Ignora eventos más antiguos que el ya guardado (entrega desordenada). */
async function upsertOrder(tx: Tx, p: P): Promise<{ id: number; status: string; stale: boolean } | null> {
  const sid = lastId(p.id);
  if (!sid) return null;
  const customerId = await upsertCustomer(tx, p.customer, p.billing_address?.company);
  const updatedAt = str(p.updated_at);
  const rows = dbRows<{ id: number; order_status: string; inserted: boolean }>(await tx.execute(sql`
    INSERT INTO commerce_orders (shopify_order_id, order_number, customer_id, email, currency, total_cents, order_status, line_items, shopify_created_at, shopify_updated_at)
    VALUES (${sid}::text, ${str(p.name ?? p.order_number)}::text, ${customerId}::int, ${str(p.email ?? p.customer?.email)}::text,
            ${str(p.currency) ?? "EUR"}::text, ${toCents(p.total_price)}::int, ${orderStatusFrom(p)}::text,
            ${JSON.stringify(Array.isArray(p.line_items) ? p.line_items : [])}::jsonb, ${str(p.created_at)}::timestamptz, ${updatedAt}::timestamptz)
    ON CONFLICT (shopify_order_id) DO UPDATE SET
      customer_id = COALESCE(EXCLUDED.customer_id, commerce_orders.customer_id),
      total_cents = EXCLUDED.total_cents, order_status = EXCLUDED.order_status,
      line_items = EXCLUDED.line_items, shopify_updated_at = EXCLUDED.shopify_updated_at, updated_at = NOW()
    WHERE commerce_orders.shopify_updated_at IS NULL OR EXCLUDED.shopify_updated_at IS NULL
       OR EXCLUDED.shopify_updated_at >= commerce_orders.shopify_updated_at
    RETURNING id, order_status, (xmax = 0) AS inserted`));
  if (rows[0]) return { id: rows[0].id, status: rows[0].order_status, stale: false };
  const cur = dbRows<{ id: number; order_status: string }>(await tx.execute(sql`SELECT id, order_status FROM commerce_orders WHERE shopify_order_id=${sid}::text`))[0];
  return cur ? { id: cur.id, status: cur.order_status, stale: true } : null;
}

async function linkSubscriptionsToOrder(tx: Tx, shopifyOrderId: string, orderId: number): Promise<void> {
  await tx.execute(sql`UPDATE commerce_subscriptions SET origin_order_id=${orderId}::int, updated_at=NOW()
                        WHERE origin_shopify_order_id=${shopifyOrderId}::text AND origin_order_id IS NULL`);
}

/** Crea la solicitud de activación (pending) a partir del pedido pagado. Idempotente por order_id. */
async function ensureActivationRequest(tx: Tx, orderId: number, p: P): Promise<void> {
  const items: P[] = Array.isArray(p.line_items) ? p.line_items : [];
  const modules = new Set<string>();
  const unmapped: unknown[] = [];
  let plan: string | null = null;
  for (const it of items) {
    const prod = dbRows<{ kind: string; plan: string | null; module_slugs: string[] }>(await tx.execute(sql`
      SELECT kind, plan, module_slugs FROM commerce_products
       WHERE (shopify_variant_id IS NOT NULL AND shopify_variant_id = ${str(it.variant_id)}::text) OR code = ${str(it.sku)}::text
       LIMIT 1`))[0];
    if (!prod) { unmapped.push({ title: it.title, sku: it.sku, variant_id: it.variant_id }); continue; }
    if (prod.plan) plan = prod.plan;
    for (const m of prod.module_slugs ?? []) modules.add(m);
  }
  const cust = dbRows<{ customer_id: number | null; email: string | null }>(await tx.execute(sql`
    SELECT o.customer_id, COALESCE(c.email, o.email) AS email FROM commerce_orders o LEFT JOIN commerce_customers c ON c.id=o.customer_id WHERE o.id=${orderId}::int`))[0];
  const auth = await findValidAuthorization(tx, cust?.email ?? null, plan);
  const sub = dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM commerce_subscriptions WHERE origin_order_id=${orderId}::int LIMIT 1`))[0];
  const ins = dbRows<{ id: number }>(await tx.execute(sql`
    INSERT INTO activation_requests (order_id, customer_id, subscription_id, status, requested_plan, requested_modules, unmapped_items, capture_request_id)
    VALUES (${orderId}::int, ${cust?.customer_id ?? null}::int, ${sub?.id ?? null}::int, 'pending', ${plan}::text,
            ${JSON.stringify([...new Set([...modules, ...(auth?.modules ?? [])])])}::jsonb, ${JSON.stringify(unmapped)}::jsonb, ${auth?.id ?? null}::int)
    ON CONFLICT (order_id) DO NOTHING RETURNING id`));
  if (ins[0]) await auditActivation(tx, { activationRequestId: ins[0].id, actor: ACTOR, action: "activation_requested", to: "pending", details: { orderId, plan, modules: [...modules], unmapped, captureRequestId: auth?.id ?? null, authorized: !!auth } });
}

async function subscriptionsOfOrder(tx: Tx, orderId: number): Promise<number[]> {
  return dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM commerce_subscriptions WHERE origin_order_id=${orderId}::int`)).map((r) => r.id);
}

async function recordBilling(tx: Tx, e: { subId?: number | null; orderId?: number | null; type: string; cents: number; currency?: string; ref: string }): Promise<void> {
  await tx.execute(sql`
    INSERT INTO billing_history (subscription_id, order_id, event_type, amount_cents, currency, shopify_ref)
    VALUES (${e.subId ?? null}::int, ${e.orderId ?? null}::int, ${e.type}::text, ${e.cents}::int, ${e.currency ?? "EUR"}::text, ${e.ref}::text)
    ON CONFLICT (event_type, shopify_ref) DO NOTHING`);
}

const subByContract = async (tx: Tx, contractId: string | null) =>
  contractId ? dbRows<{ id: number; origin_order_id: number | null }>(await tx.execute(sql`
    SELECT id, origin_order_id FROM commerce_subscriptions WHERE shopify_contract_id=${contractId}::text`))[0] ?? null : null;

type Handler = (tx: Tx, p: P) => Promise<void>;

export const HANDLERS: Record<string, Handler> = {
  "orders/create": async (tx, p) => { const o = await upsertOrder(tx, p); if (o) await linkSubscriptionsToOrder(tx, lastId(p.id)!, o.id); },
  "orders/updated": async (tx, p) => { const o = await upsertOrder(tx, p); if (o) await linkSubscriptionsToOrder(tx, lastId(p.id)!, o.id); },

  "orders/paid": async (tx, p) => {
    const o = await upsertOrder(tx, p);
    if (!o) return;
    await linkSubscriptionsToOrder(tx, lastId(p.id)!, o.id);
    if (o.stale && o.status !== "paid") return; // evento antiguo; el estado actual manda
    await recordBilling(tx, { orderId: o.id, type: "payment_succeeded", cents: toCents(p.total_price), currency: str(p.currency) ?? "EUR", ref: `order:${lastId(p.id)}` });
    for (const sid of await subscriptionsOfOrder(tx, o.id)) await recordPaymentSuccess(tx, sid, ACTOR);
    await ensureActivationRequest(tx, o.id, p);
  },

  "orders/cancelled": async (tx, p) => {
    const o = await upsertOrder(tx, p);
    if (!o) return;
    const prev = dbRows<{ id: number; status: string }>(await tx.execute(sql`
      UPDATE activation_requests SET status='cancelled', decision_note='Pedido cancelado en Shopify', updated_at=NOW()
       WHERE order_id=${o.id}::int AND status IN ('pending','info_requested') RETURNING id, status`));
    for (const r of prev) await auditActivation(tx, { activationRequestId: r.id, actor: ACTOR, action: "activation_cancelled_by_order", to: "cancelled" });
  },

  "refunds/create": async (tx, p) => {
    const sid = lastId(p.order_id);
    const ord = sid ? dbRows<{ id: number; total_cents: number; refunded_cents: number }>(await tx.execute(sql`
      SELECT id, total_cents, refunded_cents FROM commerce_orders WHERE shopify_order_id=${sid}::text FOR UPDATE`))[0] : null;
    if (!ord) throw new Error(`Reembolso de pedido desconocido (${sid}); se reintentará`);
    const cents = (Array.isArray(p.transactions) ? p.transactions : [])
      .filter((t: P) => t.kind === "refund" && t.status === "success").reduce((a: number, t: P) => a + toCents(t.amount), 0);
    const ref = `refund:${lastId(p.id)}`;
    const ins = dbRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO billing_history (order_id, event_type, amount_cents, shopify_ref) VALUES (${ord.id}::int,'refund',${cents}::int,${ref}::text)
      ON CONFLICT (event_type, shopify_ref) DO NOTHING RETURNING id`));
    if (!ins[0]) return; // ya procesado
    const refunded = ord.refunded_cents + cents;
    const full = ord.total_cents > 0 && refunded >= ord.total_cents;
    await tx.execute(sql`UPDATE commerce_orders SET refunded_cents=${refunded}::int, order_status=${full ? "refunded" : "partially_refunded"}::text, updated_at=NOW() WHERE id=${ord.id}::int`);
    if (full && (await getPolicy()).suspendOnFullRefund) {
      for (const subId of await subscriptionsOfOrder(tx, ord.id)) await suspendSubscription(tx, subId, "refund_full", ACTOR);
    }
  },

  "disputes/create": async (tx, p) => {
    const sid = lastId(p.order_id);
    const ord = sid ? dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM commerce_orders WHERE shopify_order_id=${sid}::text`))[0] : null;
    if (!ord) throw new Error(`Disputa de pedido desconocido (${sid}); se reintentará`);
    await recordBilling(tx, { orderId: ord.id, type: "chargeback", cents: toCents(p.amount), currency: str(p.currency) ?? "EUR", ref: `dispute:${lastId(p.id)}` });
    await tx.execute(sql`UPDATE commerce_orders SET order_status='disputed', updated_at=NOW() WHERE id=${ord.id}::int`);
    if ((await getPolicy()).suspendOnChargeback) for (const subId of await subscriptionsOfOrder(tx, ord.id)) await suspendSubscription(tx, subId, "chargeback", ACTOR);
  },

  "subscription_contracts/create": async (tx, p) => {
    const cid = lastId(p.admin_graphql_api_id ?? p.id);
    if (!cid) return;
    const orderSid = lastId(p.origin_order_id ?? p.admin_graphql_api_origin_order_id);
    const ord = orderSid ? dbRows<{ id: number; order_status: string; customer_id: number | null }>(await tx.execute(sql`
      SELECT id, order_status, customer_id FROM commerce_orders WHERE shopify_order_id=${orderSid}::text`))[0] : null;
    const rows = dbRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO commerce_subscriptions (shopify_contract_id, origin_shopify_order_id, shopify_customer_id, origin_order_id, customer_id, status)
      VALUES (${cid}::text, ${orderSid}::text, ${lastId(p.admin_graphql_api_customer_id ?? p.customer_id)}::text, ${ord?.id ?? null}::int, ${ord?.customer_id ?? null}::int, 'pending')
      ON CONFLICT (shopify_contract_id) DO NOTHING RETURNING id`));
    if (rows[0]) {
      await auditActivation(tx, { subscriptionId: rows[0].id, actor: ACTOR, action: "subscription_created", to: "pending", details: { contract: cid } });
      if (ord?.order_status === "paid") await recordPaymentSuccess(tx, rows[0].id, ACTOR); // primer pago ya confirmado
      if (ord) await tx.execute(sql`UPDATE activation_requests SET subscription_id=${rows[0].id}::int WHERE order_id=${ord.id}::int AND subscription_id IS NULL`);
    }
  },

  "subscription_contracts/update": async (tx, p) => {
    const sub = await subByContract(tx, lastId(p.admin_graphql_api_id ?? p.id));
    if (!sub) throw new Error("Contrato desconocido; se reintentará");
    const status = String(p.status ?? "").toLowerCase();
    if (status === "cancelled") await cancelSubscription(tx, sub.id, ACTOR, "cancelled_in_shopify");
    else if (status === "expired") await tx.execute(sql`UPDATE commerce_subscriptions SET status='expired', updated_at=NOW() WHERE id=${sub.id}::int AND status <> 'cancelled'`);
    else if (status === "paused") await tx.execute(sql`UPDATE commerce_subscriptions SET status='paused', updated_at=NOW() WHERE id=${sub.id}::int AND status IN ('active','past_due')`);
    // 'active' NO reactiva por sí solo: la reactivación exige pago confirmado o decisión del administrador.
  },

  "subscription_billing_attempts/success": async (tx, p) => {
    const sub = await subByContract(tx, lastId(p.subscription_contract_id ?? p.admin_graphql_api_subscription_contract_id));
    if (!sub) throw new Error("Contrato desconocido; se reintentará");
    const ref = `attempt:${lastId(p.idempotency_key ?? p.id)}`;
    const total = dbRows<{ total_cents: number }>(await tx.execute(sql`SELECT total_cents FROM commerce_orders WHERE shopify_order_id=${lastId(p.order_id)}::text`))[0];
    const ins = dbRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO billing_history (subscription_id, event_type, amount_cents, shopify_ref) VALUES (${sub.id}::int,'payment_succeeded',${total?.total_cents ?? 0}::int,${ref}::text)
      ON CONFLICT (event_type, shopify_ref) DO NOTHING RETURNING id`));
    if (!ins[0]) return;
    await tx.execute(sql`UPDATE commerce_subscriptions SET current_period_end = COALESCE(GREATEST(current_period_end, NOW()), NOW()) + interval '1 month', updated_at=NOW() WHERE id=${sub.id}::int`);
    await recordPaymentSuccess(tx, sub.id, ACTOR);
  },

  "subscription_billing_attempts/failure": async (tx, p) => {
    const sub = await subByContract(tx, lastId(p.subscription_contract_id ?? p.admin_graphql_api_subscription_contract_id));
    if (!sub) throw new Error("Contrato desconocido; se reintentará");
    const ref = `attempt:${lastId(p.idempotency_key ?? p.id)}`;
    const ins = dbRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO billing_history (subscription_id, event_type, amount_cents, shopify_ref) VALUES (${sub.id}::int,'payment_failed',0,${ref}::text)
      ON CONFLICT (event_type, shopify_ref) DO NOTHING RETURNING id`));
    if (ins[0]) await recordPaymentFailure(tx, sub.id, ACTOR);
  },

  "customers/create": async (tx, p) => { await upsertCustomer(tx, p); },
  "customers/update": async (tx, p) => { await upsertCustomer(tx, p); },

  // RGPD: se anonimizan los datos personales del comprador; NO se borran pedidos ni datos de la empresa cliente.
  "customers/redact": async (tx, p) => {
    const sid = lastId(p.customer?.id);
    if (!sid) return;
    await tx.execute(sql`UPDATE commerce_customers SET email=NULL, first_name=NULL, last_name=NULL, phone=NULL, tax_id=NULL,
                         marketing_consent=FALSE, redacted_at=NOW(), updated_at=NOW() WHERE shopify_customer_id=${sid}::text`);
  },
  "customers/data_request": async () => { /* registrado en commerce_webhook_events; atiende el administrador (RGPD art. 15) */ },
  "shop/redact": async () => { /* registrado; sin datos de tienda propios */ },
};
