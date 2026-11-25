# OmniCommerce Bridge — documentación técnica

Puente entre Shopify (canal comercial) y Omnitech-Core (motor SaaS). **Una compra nunca activa una licencia.**

## Flujo
1. Shopify → `POST /api/commerce/webhooks/shopify` (HMAC `X-Shopify-Hmac-Sha256` sobre cuerpo crudo, secreto `SHOPIFY_API_SECRET`; falla cerrado si falta).
2. `commerce_webhook_events` (único por `X-Shopify-Webhook-Id`) → handler en **una transacción**; fallo → `failed` + backoff 1m·2ⁿ (máx. 6 h); a los 5 intentos → `dead`. Tick cada 5 min (`commerce/scheduler.ts`; también `POST /api/internal/cron/commerce`).
3. `orders/paid` crea una `activation_requests` en `pending` (única por pedido). **No** crea empresa/licencia.
4. Control Center (`/api/commerce-control/*`, `requireSuperAdmin`): aprobar / rechazar / pedir info (solo `SUPER_ADMIN`; `STAFF_OMNITECH` solo lectura).
5. Aprobar (transacción): verifica pedido `paid` → crea/vincula `organizations` → `license_plans` → `module_configs` (módulos comprados) → membresía u **invitación `owner`** → estados comerciales → `activation_audit_logs` + `audit_logs` → email de bienvenida (fuera de la transacción; si falla, queda registrado y no revierte).

## Estados separados
Pedido: `received · pending_payment · paid · partially_refunded · refunded · cancelled · disputed`.
Suscripción: `pending · active · past_due · paused · suspended · cancelled · expired`.

## Políticas configurables (`commerce_settings`)
`grace_days=7`, `suspend_after_failed_attempts=3`, `suspend_on_full_refund=true`, `suspend_on_chargeback=true`, `auto_reactivate_on_payment=true`. Un pago solo reactiva suspensiones **por impago** (`payment_*`); reembolso/contracargo requieren decisión del administrador.
Suspender/cancelar = `license_plans.is_active=false`. **Nunca** se borra una empresa (FK `ON DELETE RESTRICT`).

## Tablas (migración aditiva e idempotente `commerce/migration.ts`)
`commerce_products, commerce_customers, commerce_orders, commerce_subscriptions, commerce_webhook_events, activation_requests, billing_history, activation_audit_logs (append-only por trigger), commerce_settings`.
`saas_licenses` **no se crea**: se reutiliza `license_plans` (`commerce_subscriptions.license_id`). Reversión: `ROLLBACK_SQL` (solo tablas nuevas).

## Precios del catálogo (confirmados por el propietario, 25-nov-2026; mensual, sin IVA)
Starter 149 € (promo lanzamiento 99 €, `promo_active=false` por defecto) · Professional 249 € · Enterprise 1.000 €.
Módulos individuales: sembrados con precio **NULL** y `sellable=false` (CHECK en BD impide venderlos sin precio).

## Seguridad / RGPD
HMAC en tiempo constante · dominio de tienda validado · idempotencia por webhook-id y por referencia de negocio · el navegador solo pide acciones; el servidor valida rol, estado y pago · secretos solo en entorno (`/integrations` devuelve booleanos) · `customers/redact` anonimiza PII sin borrar pedidos · consentimiento de marketing registrado.

## Variables de entorno
`SHOPIFY_API_SECRET` (obligatoria para recibir), `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` (futuro: sincronización saliente), `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_APP_URL`.
