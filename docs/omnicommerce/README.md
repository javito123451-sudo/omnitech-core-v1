# OmniCommerce Bridge — documentación técnica

Puente entre Shopify (canal comercial) y Omnitech-Core (motor SaaS). **Una compra nunca activa una licencia.**

## Flujo (captar → autorizar → contratar → activar automáticamente)
1. **Captación**: el formulario de la tienda envía `POST /api/commerce-public/requests` (sin auth; honeypot, 5/hora/IP, consentimiento RGPD obligatorio, no enumera emails). Crea `commerce_capture_requests` en `new`. No crea cuenta, pedido ni licencia.
2. **Autorización manual** (SUPER_ADMIN, Control Center → Captación): fija plan, módulos a incorporar y vigencia (1–90 días, por defecto 14). Marca al cliente con la etiqueta `autorizado` en Shopify si hay credenciales (solo comodidad de la tienda).
3. **Contratación**: el cliente autorizado compra en Shopify. Webhook → `POST /api/commerce/webhooks/shopify` (HMAC `X-Shopify-Hmac-Sha256`, `SHOPIFY_API_SECRET`; falla cerrado). Evento único por `X-Shopify-Webhook-Id`, una transacción por evento, reintentos con backoff (1m·2ⁿ, máx. 6 h; 5 intentos → `dead`). `orders/paid` crea `activation_requests` y la **enlaza a la autorización vigente** del mismo email y plan; si no existe queda marcada «sin autorización».
4. **Activación** — **automática** cuando el pedido está `paid` y hay autorización vigente del mismo plan (ajuste `auto_activate_when_paid_and_authorized`, por defecto activo, editable por SUPER_ADMIN en Integraciones; actor registrado = quien autorizó, `details.automatic=true`). Se dispara tras `orders/paid`, al autorizar una captación con compra ya pagada, y en el tick de 5 min. **No** se activa sola si: pedido sin pagar, solicitud en `info_requested`, líneas de pedido sin producto del catálogo, plan distinto o sin autorización; si falla (p. ej. sin nombre de empresa) queda pendiente, se audita una vez y la activa un administrador a mano (pestaña Activaciones). La activación manual sigue disponible y exige lo mismo (pedido `paid` **y** autorización previa); crea/vincula empresa → `license_plans` → `module_configs` (módulos autorizados) → propietario/invitación `owner` → auditoría → email de bienvenida (fuera de la transacción). La captación pasa a `converted`.
Una autorización ya comprada no caduca; una no comprada caduca (`expired`) por el tick de 5 min.
**Barrera real = servidor**: aunque alguien compre sin autorización (URL directa), no se puede activar y queda señalado en el dashboard («Compras SIN autorización») para reembolsar. Para bloquearlo en el propio checkout haría falta una Shopify Function de validación de carrito (no incluida).

## Estados separados
Pedido: `received · pending_payment · paid · partially_refunded · refunded · cancelled · disputed`.
Suscripción: `pending · active · past_due · paused · suspended · cancelled · expired`.

## Políticas configurables (`commerce_settings`)
`grace_days=7`, `suspend_after_failed_attempts=3`, `suspend_on_full_refund=true`, `suspend_on_chargeback=true`, `auto_reactivate_on_payment=true`, `auto_activate_when_paid_and_authorized=true`. Un pago solo reactiva suspensiones **por impago** (`payment_*`); reembolso/contracargo requieren decisión del administrador.
Suspender/cancelar = `license_plans.is_active=false`. **Nunca** se borra una empresa (FK `ON DELETE RESTRICT`).

## Tablas (migración aditiva e idempotente `commerce/migration.ts`)
`commerce_capture_requests, commerce_products, commerce_customers, commerce_orders, commerce_subscriptions, commerce_webhook_events, activation_requests, billing_history, activation_audit_logs (append-only por trigger), commerce_settings`.
`saas_licenses` **no se crea**: se reutiliza `license_plans` (`commerce_subscriptions.license_id`). Reversión: `ROLLBACK_SQL` (solo tablas nuevas).

## Precios del catálogo (confirmados por el propietario, 25-nov-2026; mensual, sin IVA)
Starter 149 € (promo lanzamiento 99 €, `promo_active=false` por defecto) · Professional 249 € · Enterprise 1.000 €.
**Plan Business: no se comercializa.** En código da acceso a todos los módulos igual que Enterprise; a 699 € competiría con Enterprise (1.000 €). Se conserva en BD solo como plan heredado (sin tocar). Los planes en `credit_plans` (Professional 349 €, Business 699 €) son configuración interna de créditos IA y **no** alimentan los precios de la tienda, que salen de `commerce_products`.

Módulos (complementos mensuales, sin IVA, **no se venden sueltos**: los incorpora el administrador según necesidades; `sellable=false`): sin IA relevante **25 €** (OmniTax, Accounting, Security Core, Docs, Diagnostics, Integraciones) · IA ligera **35 €** (Marketing Hub, WhatsApp, Automations, Agent Factory, AI Agents, Analytics) · IA pesada **45 €** (Import AI, OmniLeads, OmniAds, OmniSeller). CRM va incluido en todos los planes (sin precio). Basado en el AI Center real (8 llamadas/mes, solo gpt-4o-mini, 0,004 $): el precio es por valor, no por coste de IA; revisar a los 60–90 días. Editar un precio en BD no lo pisa el arranque.

## Seguridad / RGPD
HMAC en tiempo constante · dominio de tienda validado · idempotencia por webhook-id y por referencia de negocio · el navegador solo pide acciones; el servidor valida rol, estado y pago · secretos solo en entorno (`/integrations` devuelve booleanos) · `customers/redact` anonimiza PII sin borrar pedidos · consentimiento de marketing registrado.

## Variables de entorno
`SHOPIFY_API_SECRET` (obligatoria para recibir), `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` (futuro: sincronización saliente), `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_APP_URL`.

## Frontend
Pantalla `/control-center/commerce` (pestañas: Dashboard, Solicitudes/Activaciones, Pedidos, Clientes, Suscripciones, Facturación, Productos, Integraciones, Auditoría). Licencias: enlace a `/control-center/licenses` existente. Acciones solo SUPER_ADMIN.
