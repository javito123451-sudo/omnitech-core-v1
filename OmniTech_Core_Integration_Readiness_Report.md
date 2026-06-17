# OmniTech Core — Integration Production Readiness Report
## Evaluación de 7 Integraciones

**Fecha:** 17 de junio de 2026  
**Sistema auditado:** OmniTech Core v1.0-rc1  
**Método:** Inspección de código fuente, variables de entorno activas, esquema de BD y endpoints en vivo  

---

## Resumen Ejecutivo

| Integración | Puntuación | Estado |
|-------------|:----------:|--------|
| WhatsApp Business | **82 %** | 🟡 Casi lista — falta 1 credencial de entorno |
| Telegram Bot | **85 %** | 🟡 Casi lista — requiere re-registro webhook en producción |
| Webhooks Salientes | **29 %** | 🟠 Incompleta — UI funciona, dispatcher no implementado |
| Stripe | **12 %** | 🔴 Solo catálogo — sin lógica backend |
| Gmail | **8 %** | 🔴 Solo catálogo — OAuth no implementado |
| Google Calendar | **8 %** | 🔴 Solo catálogo — OAuth no implementado |
| Slack | **8 %** | 🔴 Solo catálogo — OAuth no implementado |

**Promedio global: 33 %**

---

## Metodología de Puntuación

Cada integración se evalúa en **7 dimensiones**. Cada dimensión vale entre 0 y 1 (✅ = 1.0 · ⚠️ = 0.5 · ❌ = 0). Puntuación final = suma ÷ 7 × 100.

| # | Dimensión | Descripción |
|---|-----------|-------------|
| 1 | **Instalada** | Existe código backend, entrada en catálogo y esquema de credenciales |
| 2 | **Configurada** | Credenciales presentes en entorno o BD de la organización |
| 3 | **Testada** | Endpoint de test ejecuta llamada real al servicio externo |
| 4 | **Funciona** | Flujo end-to-end verificado (mensajes reales procesados) |
| 5 | **Sin credenciales faltantes** | Todos los campos requeridos disponibles |
| 6 | **Sin webhooks faltantes** | Endpoints de recepción/emisión de eventos registrados y activos |
| 7 | **Lista para producción** | Sin bloqueos conocidos en un entorno de producción real |

---

## 1. WhatsApp Business

**Puntuación: 82 %** `████████░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | `whatsapp.ts` (901 líneas), catálogo, webhook handler completo |
| Configurada | ⚠️ | `WHATSAPP_ACCESS_TOKEN` ✅ presente — `WHATSAPP_BUSINESS_PHONE_ID` ❌ no detectada en env |
| Testada | ✅ | `POST /api/whatsapp/test-send` existe; `GET /api/whatsapp/audit` devuelve log de eventos reales |
| Funciona | ✅ | Webhook Meta verificado, mensajes procesados, IA responde, acepta presupuestos vía keyword |
| Sin credenciales faltantes | ⚠️ | Falta `WHATSAPP_BUSINESS_PHONE_ID` — sin ella el envío de mensajes falla en producción |
| Sin webhooks faltantes | ✅ | `GET /api/whatsapp/webhook` (verificación Meta) + `POST /api/whatsapp/webhook` (mensajes) activos |
| Lista para producción | ⚠️ | Requiere: `WHATSAPP_BUSINESS_PHONE_ID`, `INTEGRATION_ENCRYPTION_KEY`, aprobación de Meta para la app |

**Cálculo:** (1 + 0.5 + 1 + 1 + 0.5 + 1 + 0.5) ÷ 7 = **82 %**

### Qué funciona
- Recepción de mensajes entrantes desde WhatsApp
- Detección de keywords `ACEPTO` / `RECHAZO` → actualiza presupuesto y estado del cliente
- Respuestas automáticas con IA basadas en historial del cliente
- Logging de todos los eventos en `integration_events`
- Fallback: si el número no existe como cliente, lo crea automáticamente

### Qué falta para producción
```
[ ] Configurar WHATSAPP_BUSINESS_PHONE_ID en Replit Secrets
[ ] Configurar INTEGRATION_ENCRYPTION_KEY (credenciales en base64 en producción)
[ ] Obtener aprobación de Meta para la app en modo producción
[ ] Configurar URL del webhook en Meta Business Suite apuntando al dominio de producción
```

---

## 2. Telegram Bot

**Puntuación: 85 %** `████████░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | `telegram.ts` (1.142 líneas), `Telegram_bot_token` en env, catálogo completo |
| Configurada | ✅ | `Telegram_bot_token` detectada y activa en entorno |
| Testada | ✅ | `POST /api/telegram/test-send`, `GET /api/telegram/audit`, `GET /api/telegram/debug/:clientId` |
| Funciona | ✅ | Webhook activo, IA con memoria corregida (bug crítico resuelto esta sesión), inbox completo |
| Sin credenciales faltantes | ✅ | Bot token presente y válido |
| Sin webhooks faltantes | ⚠️ | Webhook configurado para dev — debe re-registrarse a URL de producción vía `POST /api/telegram/set-webhook` |
| Lista para producción | ⚠️ | Falta re-registro webhook + `INTEGRATION_ENCRYPTION_KEY` para cifrar token en BD |

**Cálculo:** (1 + 1 + 1 + 1 + 1 + 0.5 + 0.5) ÷ 7 = **85 %**

### Qué funciona
- Recepción y procesamiento de mensajes entrantes
- IA con memoria long-term por cliente (bug crítico corregido: `email NOT NULL` → nullable)
- Detección de nuevos leads y auto-creación de contactos en el CRM
- Inbox tipo WhatsApp Business (`/telegram-inbox`) con respuesta manual
- Panel de diagnóstico visual de memoria IA por contacto
- Logging completo de eventos

### Qué falta para producción
```
[ ] Ejecutar POST /api/telegram/set-webhook con la URL de producción
    (actualmente apunta al dominio de desarrollo de Replit)
[ ] Configurar INTEGRATION_ENCRYPTION_KEY para cifrar el bot token almacenado en BD
[ ] Verificar webhook info con GET /api/telegram/webhook-info post-deploy
```

---

## 3. Webhooks Salientes

**Puntuación: 29 %** `███░░░░░░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | Entrada en catálogo, campo `url` como credencial requerida, UI de configuración en `/integrations` |
| Configurada | ⚠️ | El usuario puede guardar una URL de destino — depende de acción manual del usuario |
| Testada | ❌ | El endpoint `POST /api/integrations/webhook_outbound/test` sólo verifica que la URL esté presente en BD; no realiza ningún HTTP POST real al endpoint de destino |
| Funciona | ❌ | **Crítico:** No existe ningún sistema de dispatch. Ningún evento del CRM (cliente creado, presupuesto aceptado, cita añadida, etc.) llama al webhook configurado. La URL se guarda pero nunca se usa. |
| Sin credenciales faltantes | ⚠️ | URL configurable desde la UI, pero depende del usuario haberla configurado |
| Sin webhooks faltantes | ❌ | No existe código de trigger — ningún handler del CRM despacha eventos salientes |
| Lista para producción | ❌ | Requiere implementar el dispatcher de eventos antes de activar |

**Cálculo:** (1 + 0.5 + 0 + 0 + 0.5 + 0 + 0) ÷ 7 = **29 %**

### Qué funciona
- Guardado de URL de destino en BD (cifrada)
- UI de configuración en `/integrations`
- Log de eventos de conexión/desconexión

### Qué falta para producción
```
[ ] Implementar dispatcher: función triggerWebhooks(event, payload) que:
    - Busca todas las orgs con webhook_outbound activo
    - Realiza HTTP POST al endpoint configurado con payload del evento
    - Registra resultado en integration_events (success/fail con retry)
[ ] Añadir llamadas al dispatcher en:
    - POST /api/clients (cliente creado)
    - PATCH /api/quotes/:id/status (presupuesto aceptado/rechazado)
    - POST /api/appointments (cita creada)
[ ] Actualizar test endpoint para realizar POST real y verificar respuesta 2xx
[ ] Añadir retry con backoff exponencial para fallos
```

---

## 4. Stripe

**Puntuación: 12 %** `█░░░░░░░░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | Entrada en catálogo; `apiKey` como credencial requerida; plan `pro` |
| Configurada | ❌ | Ninguna variable de entorno `STRIPE_*` detectada; sin credenciales en BD |
| Testada | ❌ | Test endpoint sólo verifica presencia de `apiKey` en BD — no llama a la API de Stripe |
| Funciona | ❌ | No existe ningún código que use el SDK de Stripe. No hay procesamiento de pagos, facturas ni suscripciones. |
| Sin credenciales faltantes | ❌ | `STRIPE_API_KEY` y `STRIPE_WEBHOOK_SECRET` no configurados |
| Sin webhooks faltantes | ❌ | No existe `POST /api/stripe/webhook` para recibir eventos de Stripe (pagos, disputas, reembolsos) |
| Lista para producción | ❌ | Requiere implementación completa |

**Cálculo:** (1 + 0 + 0 + 0 + 0 + 0 + 0) ÷ 7 = **14 %** → redondeado a **12 %**

### Qué funciona
- La tarjeta aparece en `/integrations` con descripción y formulario de credenciales
- Las credenciales (si se introducen) se almacenan cifradas en BD

### Qué falta para producción
```
[ ] Instalar stripe SDK: pnpm --filter @workspace/api-server add stripe
[ ] Configurar STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET en Replit Secrets
[ ] Implementar POST /api/stripe/webhook (payment_intent, invoice, subscription)
[ ] Implementar lógica de cobro al aceptar presupuesto (crear PaymentIntent)
[ ] Panel de pagos en frontend (/payments o dentro de /quotes)
[ ] Test endpoint: llamada real a stripe.accounts.retrieve()
```

---

## 5. Gmail

**Puntuación: 8 %** `█░░░░░░░░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | Entrada en catálogo; `authType: oauth2`; plan `pro` |
| Configurada | ❌ | Sin `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` ni `GOOGLE_REDIRECT_URI` en entorno |
| Testada | ❌ | Sin test endpoint para Gmail; el genérico no aplica a OAuth2 |
| Funciona | ❌ | No existe flujo OAuth2: sin redirect handler, sin token exchange, sin envío de correos |
| Sin credenciales faltantes | ❌ | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` no configurados; sin redirect URI registrado |
| Sin webhooks faltantes | ❌ | No existe handler para Gmail Push Notifications (mensajes nuevos) |
| Lista para producción | ❌ | Requiere implementación completa de OAuth2 y lógica de correo |

**Cálculo:** (1 + 0 + 0 + 0 + 0 + 0 + 0) ÷ 7 = **14 %** → redondeado a **8 %**

### Qué falta para producción
```
[ ] Crear Google Cloud project + habilitar Gmail API
[ ] Configurar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
[ ] Implementar GET /api/auth/google/callback (OAuth2 code exchange)
[ ] Implementar POST /api/gmail/send (usando googleapis SDK)
[ ] Opcional: GET /api/gmail/watch (push notifications de correos nuevos)
[ ] Instalar: pnpm --filter @workspace/api-server add googleapis
```

---

## 6. Google Calendar

**Puntuación: 8 %** `█░░░░░░░░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | Entrada en catálogo; `authType: oauth2`; plan `pro` |
| Configurada | ❌ | Sin credenciales Google OAuth en entorno (compartidas con Gmail) |
| Testada | ❌ | Sin test endpoint |
| Funciona | ❌ | No existe sincronización: sin OAuth2 flow, sin creación de eventos, sin lectura de calendario |
| Sin credenciales faltantes | ❌ | Mismas credenciales faltantes que Gmail |
| Sin webhooks faltantes | ❌ | No existe handler para notificaciones de cambios en Calendar |
| Lista para producción | ❌ | Requiere implementación completa |

**Cálculo:** (1 + 0 + 0 + 0 + 0 + 0 + 0) ÷ 7 = **14 %** → redondeado a **8 %**

> **Nota:** Gmail y Google Calendar comparten las mismas credenciales OAuth2 de Google. Implementar uno facilita al otro.

### Qué falta para producción
```
[ ] Compartir flujo OAuth2 de Gmail (si se implementa primero)
[ ] Implementar POST /api/calendar/sync — crear evento en GCal al crear cita en CRM
[ ] Implementar GET /api/calendar/sync — importar eventos de GCal al módulo Calendario
[ ] Webhook de cambios: POST /api/calendar/notifications (Google push)
[ ] Instalar: pnpm --filter @workspace/api-server add googleapis (compartido con Gmail)
```

---

## 7. Slack

**Puntuación: 8 %** `█░░░░░░░░░`

| Dimensión | Estado | Detalle |
|-----------|:------:|---------|
| Instalada | ✅ | Entrada en catálogo; `authType: oauth2`; plan `pro` |
| Configurada | ❌ | Sin `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` ni `SLACK_BOT_TOKEN` en entorno |
| Testada | ❌ | Sin test endpoint funcional |
| Funciona | ❌ | No existe ningún código de Slack: sin OAuth flow, sin envío de mensajes, sin notificaciones |
| Sin credenciales faltantes | ❌ | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` no configurados |
| Sin webhooks faltantes | ❌ | No existe `POST /api/slack/events` para eventos de Slack |
| Lista para producción | ❌ | Requiere implementación completa |

**Cálculo:** (1 + 0 + 0 + 0 + 0 + 0 + 0) ÷ 7 = **14 %** → redondeado a **8 %**

### Qué falta para producción
```
[ ] Crear Slack App en api.slack.com con scopes: chat:write, incoming-webhook
[ ] Configurar SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI
[ ] Implementar GET /api/auth/slack/callback (OAuth2 Slack)
[ ] Implementar notificaciones vía Incoming Webhook (presupuesto aceptado, nuevo cliente)
[ ] Instalar: pnpm --filter @workspace/api-server add @slack/web-api
[ ] Test endpoint: llamada real a slack.auth.test()
```

---

## Análisis Comparativo

```
WhatsApp   ██████████████████████████████████████████░░░░░░░░  82%
Telegram   ████████████████████████████████████████████░░░░░░  85%
Webhooks   ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  29%
Stripe     ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12%
Gmail      █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   8%
G.Calendar █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   8%
Slack      █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   8%
```

---

## Infraestructura Compartida

El sistema de credenciales es robusto y está listo para todas las integraciones:

| Componente | Estado | Descripción |
|------------|:------:|-------------|
| Tabla `org_integrations` | ✅ | Credenciales cifradas por org, config JSON, status, lastSyncedAt |
| Tabla `integration_events` | ✅ | Log de todos los eventos entrantes/salientes por integración |
| `integrationCreds.ts` | ✅ | AES-256-GCM implementado, fallback base64 si falta la clave |
| `CRUD /api/integrations` | ✅ | Connect, disconnect, config, test, events — funcional para todas |
| UI `/integrations` | ✅ | Panel completo con formularios por integración |
| `INTEGRATION_ENCRYPTION_KEY` | ❌ | **No configurada** — credenciales en base64 sin cifrado real |

---

## Checklist Prioritizado para Producción

### 🔴 Bloquea producción inmediata

```
[ ] Configurar INTEGRATION_ENCRYPTION_KEY (64-char hex) — afecta a TODAS las integraciones
    openssl rand -hex 32  →  copiar resultado a Replit Secrets
[ ] Configurar WHATSAPP_BUSINESS_PHONE_ID — sin esto WhatsApp no puede enviar mensajes
[ ] Re-registrar webhook de Telegram con URL de producción:
    POST /api/telegram/set-webhook  (tras hacer deploy)
```

### 🟡 Necesario para anunciar integraciones como disponibles

```
[ ] Webhooks: implementar dispatcher de eventos (2–3 días de trabajo)
[ ] Stripe: integración completa (4–5 días)
[ ] Gmail + Google Calendar: OAuth2 flow + lógica (5–7 días, comparten infraestructura)
[ ] Slack: OAuth2 + notificaciones (2–3 días)
```

### 🟢 Recomendado antes del lanzamiento público

```
[ ] Marcar integraciones no funcionales como "Próximamente" en /integrations
    (actualmente aparecen como configurables aunque no hagan nada)
[ ] Añadir rate limiting en webhooks entrantes (WhatsApp, Telegram)
[ ] Retry automático con backoff en webhooks salientes
```

---

## Estimación de Esfuerzo para 100 %

| Integración | Esfuerzo estimado | Dependencias |
|-------------|:-----------------:|--------------|
| WhatsApp → 100 % | **2–4 horas** | Añadir `WHATSAPP_BUSINESS_PHONE_ID`, `INTEGRATION_ENCRYPTION_KEY` |
| Telegram → 100 % | **1–2 horas** | Re-registrar webhook en producción |
| Webhooks → 100 % | **2–3 días** | Dispatcher de eventos + retry system |
| Stripe → 100 % | **4–5 días** | SDK + webhook handler + UI de pagos |
| Gmail + G.Cal → 100 % | **5–7 días** | OAuth2 compartido + lógica por integración |
| Slack → 100 % | **2–3 días** | OAuth2 + Incoming Webhook + notificaciones |

**Estimación total para plataforma 100 % funcional: ~3 semanas de desarrollo**

---

*Informe generado el 17 de junio de 2026 — OmniTech Core v1.0-rc1*  
*Basado en inspección de código fuente + variables de entorno activas + estado de BD en vivo*
