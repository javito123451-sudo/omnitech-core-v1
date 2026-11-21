-- Reversión de 0018_omnicommerce_bridge (ejecutar a mano solo si se quiere retirar OmniCommerce).
-- ATENCIÓN: borra el historial comercial. Exporta antes (pg_dump -t 'commerce_*' -t activation_* -t billing_history).
-- No toca organizations / org_invitations (las columnas ADD COLUMN IF NOT EXISTS ya existían en producción).
DROP TABLE IF EXISTS "activation_audit_logs";
DROP TABLE IF EXISTS "billing_history";
DROP TABLE IF EXISTS "activation_requests";
DROP TABLE IF EXISTS "commerce_subscriptions";
DROP TABLE IF EXISTS "commerce_orders";
DROP TABLE IF EXISTS "commerce_customers";
DROP TABLE IF EXISTS "commerce_products";
DROP TABLE IF EXISTS "commerce_webhook_events";
