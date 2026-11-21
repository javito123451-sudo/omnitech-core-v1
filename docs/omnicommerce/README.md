# OmniCommerce Bridge — Shopify ↔ OmniTech Core

Canal comercial de OmniTech Core. Shopify cobra; OmniTech Core decide y activa.
**Ninguna compra activa una licencia sin la aprobación de un SUPER_ADMIN.**

## 1. Arquitectura

```
Shopify ──webhook firmado (HMAC)──▶ POST /api/commerce/webhooks/shopify
                                       │  verifica firma + dominio de tienda
                                       ▼
                              commerce_webhook_events   (idempotencia: source + X-Shopify-Webhook-Id)
                                       │
                                       ▼  commerce/bridge.ts (1 transacción por evento)
   commerce_customers · commerce_orders · commerce_subscriptions · billing_history
                                       │
                                       ▼
                              activation_requests  ── estado máx. automático: pending_review
                                       │
                 Omni Control Center → OmniCommerce → Solicitudes (SUPER_ADMIN)
                                       │  aprobar / rechazar / pedir información
                                       ▼  commerce/activation.ts
   organizations (crea o vincula) · license_plans · module_configs · org_invitations (bienvenida)
```

Lo que se reutiliza del sistema existente (no se ha duplicado):

| Necesidad | Se reutiliza |
|---|---|
| Empresa / workspace | `organizations`, `org_members` |
| Licencia | `license_plans` (no se ha creado `saas_licenses`) |
| Módulos del plan | `module_configs` + `lib/planModules.ts` (antes inline en `/auth/me`) |
| Precios | `credit_plans` (migración 0008): **Starter 149 €, Professional 349 €, Business 699 €, Enterprise a medida** |
| Auditoría | `audit_logs` + `activation_audit_logs` (detalle por solicitud) |
| Email de bienvenida | `org_invitations` + Resend (`lib/invitationDelivery.ts`) |
| Permisos | `requireSuperAdmin` del Control Center; acciones solo `SUPER_ADMIN` |
| Suspensión | `organizations.status = 'suspended'` (igual que `/workspaces/:id/suspend`) |
| Cron | `/internal/cron/commerce-policies` con `CRON_SECRET` |

### Estados

- **Pedido** (`commerce_orders.financial_status`): `pending · authorized · paid · partially_refunded · refunded · voided`. Solo `paid` cuenta como pago.
- **Suscripción** (`commerce_subscriptions.status`): `pending · active · grace · past_due · suspended · cancelled · expired`. Independiente del pedido.
- **Solicitud** (`activation_requests.status`): `pending_payment → pending_review ⇄ info_requested → activated` o `rejected`.

### Reglas de seguridad

- La firma HMAC se calcula sobre el cuerpo crudo y se compara con `timingSafeEqual`; también se exige el dominio de la tienda.
- El navegador solo envía «apruebo la solicitud N». Plan, módulos y estado del pago se leen del servidor.
- Si la Admin API está configurada, al aprobar se vuelve a preguntar a Shopify si el pedido está pagado.
- Los pedidos de prueba no se activan salvo con `COMMERCE_ALLOW_TEST_ORDERS=true` (solo en staging).
- Un pedido → una solicitud (`UNIQUE(order_id)`). Aprobar dos veces devuelve 409.
- Los pedidos de renovación (`source_name=subscription_contract`) se registran como `renewal` y nunca abren solicitud.
- RGPD: el payload del webhook se borra al procesarse (solo se guarda el hash). `customers/redact` anonimiza al cliente y conserva la facturación (obligación legal). `customers/data_request` y `shop/redact` quedan en `audit_logs` como `warning` para atenderlos a mano.
- Nada se borra en cascada desde `organizations`: al terminar una suscripción la empresa se suspende y sus datos se conservan.

### Reintentos

- Si falla el procesado se marca `failed` y se responde 500, con lo que Shopify reintenta.
- Superado `COMMERCE_MAX_WEBHOOK_ATTEMPTS` se responde 200 para cortar los reintentos. El evento queda en Control Center → Integraciones con su botón **Reintentar**.

## 2. Variables de entorno (Render, backend)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `SHOPIFY_SHOP_DOMAIN` | sí | `tu-tienda.myshopify.com` |
| `SHOPIFY_WEBHOOK_SECRET` | sí | Secreto de firma de webhooks de la app |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | recomendable | Token de la Admin API (`read_orders`) para re-verificar pagos |
| `SHOPIFY_API_VERSION` | con el token | Versión estable vigente de la Admin API (consúltala en shopify.dev) |
| `COMMERCE_*` | no | Políticas; ver `.env.example` |

Ninguna se expone al frontend.

## 3. Endpoints

Webhook público (firmado): `POST /api/commerce/webhooks/shopify`

Control Center (`/api/control-center/commerce`; consultar = SUPER_ADMIN/STAFF, actuar = SUPER_ADMIN):

- `GET /dashboard`
- `GET /activation-requests?status=`
- `GET /activation-requests/:id`
- `POST /activation-requests/:id/approve`, `/reject`, `/request-info`
- `GET /orders`, `/customers`, `/subscriptions`, `/billing`, `/activations`
- `GET /products` y `PATCH /products/:id` (solo vincula IDs de Shopify; el precio no se edita aquí)
- `GET /webhook-events` y `POST /webhook-events/:id/retry`

Políticas: scheduler residente cada hora (`node-cron`, igual que el resto de tareas en Render). También se puede disparar con `POST /api/internal/cron/commerce-policies` (cabecera `x-cron-secret`).

Topics de Shopify que hay que suscribir:

- `orders/create`, `orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`
- `customers/create`, `customers/update`
- `disputes/create`, `disputes/update`
- Si la app tiene acceso: `subscription_contracts/create|update` y `subscription_billing_attempts/success|failure`
- Obligatorios RGPD: `customers/data_request`, `customers/redact`, `shop/redact`

## 4. Informe de pruebas (21-11-2026)

Entorno: Postgres 16 desechable, migraciones 0000→0018 aplicadas en limpio y webhooks enviados al endpoint HTTP real con firma HMAC. Simulación controlada, sin cobros reales.

| # | Escenario | Resultado |
|---|---|---|
| 1 | Compra satisfactoria → `pending_review` | ✅ |
| 2 | Pedido duplicado (create/updated/paid) → 1 pedido, 1 solicitud, 1 cobro | ✅ |
| 3 | Pago pendiente → `pending_payment`, aprobar = 409 | ✅ |
| 4 | Pago confirmado → `pending_review` + cobro + auditoría | ✅ |
| 5 | Solicitud pendiente: no se crea empresa ni licencia | ✅ |
| 6 | Aprobación administrativa (y doble aprobación = 409) | ✅ |
| 7 | Creación del workspace (nombre y NIF del checkout) | ✅ |
| 8 | Licencia + 9 módulos de Starter + invitación owner | ✅ |
| 9 | Renovación mensual (billing attempt y pedido de renovación) | ✅ |
| 10 | Pago fallido → gracia → suspensión al vencer (datos intactos) | ✅ |
| 11 | Cancelación → suspensión en el siguiente tick | ✅ |
| 12 | Reembolso total antes de activar → rechazo automático | ✅ |
| 13 | Reactivación tras cobro correcto | ✅ |
| 14 | Firma falsa / otra tienda = 401 · STAFF no aprueba = 403 · pedido de prueba no activable | ✅ |
| 15 | Reenvío del mismo webhook ignorado; evento fallido reintentado desde CC | ✅ |

Además:

- Tests unitarios de HMAC, mapeo y políticas.
- Smoke test con el servidor compilado: firma buena → 200, firma mala → 401, Control Center sin sesión → 401.
- Suite completa: ningún test que pasara antes falla ahora. Los integration tests que ya fallaban en BD vacía siguen igual: dependen de datos sembrados, no de este cambio.

Errores encontrados y corregidos durante el desarrollo:

- **El snapshot de Drizzle estaba desfasado.** Columnas de `organizations` y `org_invitations` existían en producción por startup migrations, pero no en el snapshot. En la 0018 se crean con `ADD COLUMN IF NOT EXISTS`.
- **Las renovaciones habrían abierto solicitudes nuevas.** Ahora se detectan y se registran como `renewal`.
- **Licencias del Control Center con la tarifa antigua.** La pantalla mostraba 99/149/299/1.000 €+ y se ha alineado con la oficial; un test lo protege.

Error previo detectado y no tocado: `POST /control-center/licenses` hace `ON CONFLICT (org_id)`, pero `license_plans` no tiene `UNIQUE(org_id)`, así que fallará en Postgres. La activación de OmniCommerce no usa ese endpoint: hace select + update/insert.

## 5. Puesta en producción

1. Revisar y fusionar la rama `feature/omnicommerce-bridge`.
2. El deploy de Render ejecuta `drizzle-kit migrate`, que aplica la 0018. La reversión está en `0018_omnicommerce_bridge.down.sql`.
3. Crear la tienda Shopify y la app propia. Copiar `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_WEBHOOK_SECRET` y, de forma opcional, `SHOPIFY_ADMIN_ACCESS_TOKEN` + `SHOPIFY_API_VERSION` en Render.
4. Crear en Shopify un producto por plan, con SKU = `omnitech-plan-starter`, `omnitech-plan-professional` y `omnitech-plan-business`, y el precio de `credit_plans`.
5. Pedir en el checkout los campos «Empresa» y «NIF» (atributos del pedido) para crear el workspace con los datos fiscales.
6. Suscribir los webhooks del punto 3 a `https://<api>/api/commerce/webhooks/shopify`.
7. No hace falta cron externo: el scheduler arranca solo con el servidor (log `[OmniCommerce] Policy scheduler started`).
8. Prueba en staging con `COMMERCE_ALLOW_TEST_ORDERS=true` y Bogus Gateway: comprar, aprobar y recibir la invitación. En producción, dejarla en `false`.

## 6. Pendiente / riesgos abiertos

- **Webhooks de suscripción.** Shopify solo entrega `subscription_contracts/*` y `subscription_billing_attempts/*` a la app propietaria de los contratos. Con la app oficial *Shopify Subscriptions*, nuestra app recibirá los pedidos de renovación (cubiertos), pero no los fallos de cobro. Hay que confirmarlo con la tienda creada. Si es así, hay dos opciones:
  - Detectar el impago por ausencia de renovación (no hay pedido nuevo dentro de periodo + gracia).
  - Usar una app de suscripciones que notifique fallos por webhook propio.
- **Hotmart.** El modelo ya tiene `source='hotmart'`; falta su receptor de webhooks (mismo bridge).
- **Packs de OmniCredits** (29/89/199/599 €). Existen en `credit_packs`, pero aún no se venden por la tienda.
- **Tienda Shopify** (diseño, secciones, SEO). Es la fase 3 y requiere la tienda creada.
