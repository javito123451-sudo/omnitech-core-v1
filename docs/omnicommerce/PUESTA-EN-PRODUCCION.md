# Puesta en producción (Render + Neon + Shopify)

**Pendiente de accesos externos — nada de esto está hecho aún.**
1. Neon: crear rama de staging; desplegar esta rama allí; el arranque ejecuta la migración aditiva y siembra el catálogo. Verificar `\dt commerce_*`.
2. Variables en Render: `SHOPIFY_API_SECRET`, `SHOPIFY_SHOP_DOMAIN`, `RESEND_API_KEY` (dominio verificado), `EMAIL_FROM`, `PUBLIC_APP_URL`.
3. Shopify (Dev Dashboard → app personalizada): scopes `read_orders, read_customers, read_products, read_own_subscription_contracts`; webhooks → `https://<api>/api/commerce/webhooks/shopify` para: `orders/create, orders/updated, orders/paid, orders/cancelled, refunds/create, disputes/create, subscription_contracts/create, subscription_contracts/update, subscription_billing_attempts/success, subscription_billing_attempts/failure, customers/create, customers/update, customers/redact, customers/data_request, shop/redact`.
4. Productos Shopify: SKU = `commerce_products.code` (`plan_starter`, `plan_professional`, `plan_enterprise`) con plan de suscripción mensual; precios sin IVA. Los módulos no se venden hasta tener precio (`UPDATE commerce_products SET list_price_cents=…, sellable=TRUE`).
5. Pedido de prueba (modo test/Bogus Gateway) → comprobar solicitud `pending` en `/api/commerce-control/activation-requests` → aprobar → comprobar empresa, licencia y correo.
6. Rollback: `ROLLBACK_SQL` (`commerce/migration.ts`) o desactivar el webhook en Shopify; el resto del SaaS no depende de estas tablas.
