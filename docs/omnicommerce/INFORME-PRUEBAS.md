# Informe de pruebas — OmniCommerce Bridge (2026-11-25)

Entorno: PostgreSQL 16 local desechable con las migraciones Drizzle del proyecto (0000–0017) + migración comercial. Webhooks firmados con HMAC de **prueba**. Sin Shopify real, sin cobros, email simulado.
Comando: `DATABASE_URL=postgres://… pnpm --filter @workspace/api-server exec vitest run src/commerce` → **21/21 correctos**, repetido 3 veces seguidas sobre la misma BD (idempotencia de migración y de pruebas). Suite existente sin BD real: 332 correctos, 0 fallos. `tsc`: sin errores nuevos (base previa de 185).

| # | Escenario | Resultado |
|---|---|---|
| 1 | Compra satisfactoria → solicitud `pending`, sin empresa ni licencia | ✅ |
| 2 | Pedido duplicado (otro webhook-id) → 1 pedido/1 solicitud/1 cobro | ✅ |
| 3 | Pago pendiente → `pending_payment`, sin solicitud | ✅ |
| 4 | Pago confirmado → `paid` + solicitud | ✅ |
| 5 | Solicitud visible en Control Center (filtros + dashboard) | ✅ |
| 6–8 | Aprobación → empresa, workspace, licencia activa, módulos, invitación owner, email, auditoría; doble aprobación 409 | ✅ |
| 9 | Renovación mensual (+ reenvío del intento sin duplicar) | ✅ |
| 10 | Pago fallido → `past_due` + gracia; 3 fallos → suspendida; barrido de gracia vencida | ✅ |
| 11 | Cancelación → licencia inactiva, empresa conservada | ✅ |
| 12 | Reembolso parcial/total (+ reenvío idempotente) | ✅ |
| 13 | Reactivación tras pago; contracargo NO se reactiva solo | ✅ |
| 14 | HMAC inválido/ausente 401, sin secreto 503, sin rol 401, rol ajeno/STAFF 403, pago no confirmado 409, estado no inyectable por cuerpo | ✅ |
| 15 | Reenvío del mismo webhook-id → `duplicate`, sin efectos dobles | ✅ |
| + | Evento desordenado antiguo, fallo→reintento→`dead`, producto no mapeado, precios de módulos por grupo (25/35/45 €) sin pisar ediciones, precios del catálogo, promo conmutable, auditoría inmutable, RGPD redact | ✅ |

## Errores encontrados y corregidos durante las pruebas
1. La restricción `sellable` dejaba vender módulos "a presupuesto" sin precio → endurecida (`NOT sellable OR list_price_cents IS NOT NULL`).
2. Mis pruebas usaban referencias fijas y fallaban en la 2.ª ejecución: la idempotencia funcionaba correctamente; referencias ahora únicas por ejecución.

## NO probado (requiere accesos reales)
Entrega real de webhooks de Shopify, suscripciones/Selling Plans reales, Resend con dominio verificado, frontend de Control Center (pendiente), tema Shopify (pendiente), carga/concurrencia, Neon/Render.
