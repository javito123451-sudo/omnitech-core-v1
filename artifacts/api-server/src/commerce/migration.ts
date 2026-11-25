/**
 * OmniCommerce — migración ADITIVA e idempotente.
 *
 * Solo crea tablas nuevas (CREATE ... IF NOT EXISTS). No altera ni borra nada existente.
 * Las licencias se siguen guardando en `license_plans` (no se crea `saas_licenses`
 * duplicada): commerce_subscriptions.license_id apunta a license_plans.id.
 *
 * Reversión (manual, sin pérdida de datos de empresa): ver ROLLBACK_SQL.
 * Los FK hacia organizations son ON DELETE RESTRICT: nunca se borra una empresa
 * por terminar una suscripción.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const COMMERCE_MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS commerce_products (
    id               SERIAL PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    kind             TEXT NOT NULL CHECK (kind IN ('plan','module','service','enterprise')),
    name             TEXT NOT NULL,
    description      TEXT,
    plan             TEXT,
    module_slugs     JSONB NOT NULL DEFAULT '[]'::jsonb,
    billing_mode     TEXT NOT NULL CHECK (billing_mode IN ('subscription_monthly','one_time','quote')),
    list_price_cents INTEGER CHECK (list_price_cents IS NULL OR list_price_cents >= 0),
    promo_price_cents INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
    promo_active     BOOLEAN NOT NULL DEFAULT FALSE,
    currency         TEXT NOT NULL DEFAULT 'EUR',
    vat_included     BOOLEAN NOT NULL DEFAULT FALSE,
    shopify_product_id TEXT,
    shopify_variant_id TEXT UNIQUE,
    sellable         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT commerce_products_sellable_needs_price CHECK (NOT sellable OR list_price_cents IS NOT NULL)
  )`,
  `CREATE TABLE IF NOT EXISTS commerce_customers (
    id                  SERIAL PRIMARY KEY,
    shopify_customer_id TEXT UNIQUE,
    email               TEXT,
    first_name          TEXT,
    last_name           TEXT,
    company             TEXT,
    tax_id              TEXT,
    phone               TEXT,
    marketing_consent   BOOLEAN NOT NULL DEFAULT FALSE,
    consent_at          TIMESTAMPTZ,
    org_id              INTEGER REFERENCES organizations(id) ON DELETE RESTRICT,
    redacted_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS commerce_customers_email_idx ON commerce_customers (lower(email))`,
  `CREATE TABLE IF NOT EXISTS commerce_orders (
    id               SERIAL PRIMARY KEY,
    shopify_order_id TEXT NOT NULL UNIQUE,
    order_number     TEXT,
    customer_id      INTEGER REFERENCES commerce_customers(id) ON DELETE RESTRICT,
    email            TEXT,
    currency         TEXT NOT NULL DEFAULT 'EUR',
    total_cents      INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    refunded_cents   INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
    -- Estado del PEDIDO (independiente del estado de la suscripción)
    order_status     TEXT NOT NULL DEFAULT 'received'
      CHECK (order_status IN ('received','pending_payment','paid','partially_refunded','refunded','cancelled','disputed')),
    line_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
    shopify_created_at TIMESTAMPTZ,
    shopify_updated_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS commerce_orders_status_idx ON commerce_orders (order_status)`,
  `CREATE TABLE IF NOT EXISTS commerce_subscriptions (
    id                   SERIAL PRIMARY KEY,
    shopify_contract_id  TEXT NOT NULL UNIQUE,
    origin_shopify_order_id TEXT,
    shopify_customer_id  TEXT,
    customer_id          INTEGER REFERENCES commerce_customers(id) ON DELETE RESTRICT,
    origin_order_id      INTEGER REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    plan                 TEXT,
    -- Estado de la SUSCRIPCIÓN (independiente del estado del pedido)
    status               TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','past_due','paused','suspended','cancelled','expired')),
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    grace_until          TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    suspend_reason       TEXT,
    org_id               INTEGER REFERENCES organizations(id) ON DELETE RESTRICT,
    license_id           INTEGER REFERENCES license_plans(id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS commerce_subscriptions_status_idx ON commerce_subscriptions (status)`,
  `CREATE TABLE IF NOT EXISTS commerce_webhook_events (
    id            SERIAL PRIMARY KEY,
    webhook_id    TEXT NOT NULL UNIQUE,
    topic         TEXT NOT NULL,
    shop_domain   TEXT,
    status        TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','dead','ignored')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    payload       JSONB NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at  TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS commerce_webhook_events_retry_idx ON commerce_webhook_events (status, next_retry_at)`,
  `CREATE TABLE IF NOT EXISTS activation_requests (
    id               SERIAL PRIMARY KEY,
    order_id         INTEGER NOT NULL UNIQUE REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    customer_id      INTEGER REFERENCES commerce_customers(id) ON DELETE RESTRICT,
    subscription_id  INTEGER REFERENCES commerce_subscriptions(id) ON DELETE RESTRICT,
    status           TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','info_requested','approved','rejected','cancelled')),
    requested_plan   TEXT,
    requested_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    unmapped_items   JSONB NOT NULL DEFAULT '[]'::jsonb,
    decided_by       TEXT,
    decided_at       TIMESTAMPTZ,
    decision_note    TEXT,
    org_id           INTEGER REFERENCES organizations(id) ON DELETE RESTRICT,
    license_id       INTEGER REFERENCES license_plans(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT activation_requests_approved_has_org CHECK (status <> 'approved' OR (org_id IS NOT NULL AND license_id IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS activation_requests_status_idx ON activation_requests (status)`,
  `CREATE TABLE IF NOT EXISTS billing_history (
    id              SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES commerce_subscriptions(id) ON DELETE RESTRICT,
    order_id        INTEGER REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    event_type      TEXT NOT NULL CHECK (event_type IN ('payment_succeeded','payment_failed','refund','chargeback')),
    amount_cents    INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    shopify_ref     TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_type, shopify_ref)
  )`,
  `CREATE TABLE IF NOT EXISTS activation_audit_logs (
    id                    SERIAL PRIMARY KEY,
    activation_request_id INTEGER REFERENCES activation_requests(id) ON DELETE RESTRICT,
    subscription_id       INTEGER REFERENCES commerce_subscriptions(id) ON DELETE RESTRICT,
    actor                 TEXT NOT NULL,
    action                TEXT NOT NULL,
    from_status           TEXT,
    to_status             TEXT,
    details               JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Inmutable: la traza de activaciones no se edita ni se borra.
  `CREATE OR REPLACE FUNCTION activation_audit_logs_immutable() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'activation_audit_logs es append-only'; END; $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS activation_audit_logs_no_change ON activation_audit_logs`,
  `CREATE TRIGGER activation_audit_logs_no_change BEFORE UPDATE OR DELETE ON activation_audit_logs
   FOR EACH ROW EXECUTE FUNCTION activation_audit_logs_immutable()`,
  // ── Captación y autorización previa: primero se capta, un administrador autoriza, y solo entonces se puede contratar ──
  `CREATE TABLE IF NOT EXISTS commerce_capture_requests (
    id                 SERIAL PRIMARY KEY,
    email              TEXT NOT NULL,
    name               TEXT NOT NULL,
    company            TEXT,
    phone              TEXT,
    plan_interest      TEXT,
    modules_interest   JSONB NOT NULL DEFAULT '[]'::jsonb,
    message            TEXT,
    source             TEXT NOT NULL DEFAULT 'shopify_store',
    consent_privacy_at TIMESTAMPTZ NOT NULL,
    consent_marketing  BOOLEAN NOT NULL DEFAULT FALSE,
    status             TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new','info_requested','authorized','rejected','converted','expired')),
    authorized_plan    TEXT,
    authorized_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    authorized_until   TIMESTAMPTZ,
    decided_by         TEXT,
    decided_at         TIMESTAMPTZ,
    decision_note      TEXT,
    shopify_tag_result TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT capture_authorized_complete CHECK (status <> 'authorized' OR (authorized_plan IS NOT NULL AND authorized_until IS NOT NULL))
  )`,
  // Una sola solicitud viva por email (reenvíos del formulario no duplican)
  `CREATE UNIQUE INDEX IF NOT EXISTS commerce_capture_open_email_idx ON commerce_capture_requests (lower(email)) WHERE status IN ('new','info_requested','authorized')`,
  `ALTER TABLE activation_requests ADD COLUMN IF NOT EXISTS capture_request_id INTEGER REFERENCES commerce_capture_requests(id) ON DELETE RESTRICT`,
  `ALTER TABLE activation_audit_logs ADD COLUMN IF NOT EXISTS capture_request_id INTEGER REFERENCES commerce_capture_requests(id) ON DELETE RESTRICT`,
  `CREATE TABLE IF NOT EXISTS commerce_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Políticas configurables de suspensión / reactivación (valores por defecto; editables).
  `INSERT INTO commerce_settings (key, value) VALUES
     ('grace_days','7'),
     ('suspend_after_failed_attempts','3'),
     ('suspend_on_full_refund','true'),
     ('suspend_on_chargeback','true'),
     ('auto_reactivate_on_payment','true'),
     ('auto_activate_when_paid_and_authorized','true')
   ON CONFLICT (key) DO NOTHING`,
];

/** Reversión manual. NO se ejecuta automáticamente. Las tablas nuevas no contienen datos de empresa. */
export const ROLLBACK_SQL = `
DROP TABLE IF EXISTS commerce_capture_requests, activation_audit_logs, billing_history, activation_requests,
  commerce_webhook_events, commerce_subscriptions, commerce_orders, commerce_customers,
  commerce_products, commerce_settings CASCADE;
DROP FUNCTION IF EXISTS activation_audit_logs_immutable();
`;

/**
 * Decisión (25-nov-2026): el plan `business` no se comercializa y se desactiva en credit_plans.
 * ATENCIÓN: un plan inactivo deja de conceder créditos incluidos mensuales y de aplicar límites/alertas a las
 * empresas que lo tengan. Por eso SOLO se desactiva si ninguna empresa (organizations.plan) ni licencia activa
 * (license_plans) usa `business`; si alguna lo usa, no se toca y se avisa (se reintenta en cada arranque).
 * Una sola vez: tras desactivarlo deja una marca y NO vuelve a forzarlo (un SUPER_ADMIN puede reactivarlo).
 */
export async function deactivateBusinessPlanOnce(): Promise<"done" | "already_done" | "skipped_in_use" | "no_plan"> {
  const marker = (await db.execute(sql`SELECT 1 FROM commerce_settings WHERE key='business_plan_deactivated'`) as { rows: unknown[] }).rows;
  if (marker.length) return "already_done";
  const exists = (await db.execute(sql`SELECT 1 FROM credit_plans WHERE plan='business'`) as { rows: unknown[] }).rows;
  if (!exists.length) return "no_plan";
  const inUse = (await db.execute(sql`
    SELECT (SELECT COUNT(*) FROM organizations WHERE plan='business')::int AS orgs,
           (SELECT COUNT(*) FROM license_plans WHERE plan='business' AND is_active)::int AS licenses`) as { rows: { orgs: number; licenses: number }[] }).rows[0]!;
  if (inUse.orgs > 0 || inUse.licenses > 0) {
    console.warn(`[Commerce] plan business NO desactivado: en uso (${inUse.orgs} empresas, ${inUse.licenses} licencias activas)`);
    return "skipped_in_use";
  }
  await db.execute(sql`UPDATE credit_plans SET active=FALSE, updated_at=NOW() WHERE plan='business'`);
  await db.execute(sql`INSERT INTO commerce_settings (key, value) VALUES ('business_plan_deactivated','true') ON CONFLICT (key) DO NOTHING`);
  return "done";
}

export async function runCommerceMigration(): Promise<void> {
  for (const stmt of COMMERCE_MIGRATION_SQL) await db.execute(sql.raw(stmt));
  await deactivateBusinessPlanOnce().catch((e) => console.error("[Commerce] no se pudo evaluar la desactivación de business:", e));
}
