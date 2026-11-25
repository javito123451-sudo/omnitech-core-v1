# OMNI REVIEW BOT — Arquitectura del módulo y esquema de base de datos (propuesta para aprobación)

Base: `omnitech-core-v1` @ `dc668ef`. Rama de trabajo: `claude/omni-review-bot-saas-1qbo2j`.
Estado: **solo diseño. No se ha ejecutado ninguna migración ni modificado ningún módulo existente.**

## 0. Línea base medida (antes de tocar nada)

| Comprobación | Resultado |
|---|---|
| `tsc` api-server | **185 errores preexistentes** (lista en `baseline-tsc-api.txt`) |
| `tsc` omniflow | **8 errores preexistentes** (`baseline-tsc-web.txt`) |
| Vitest api-server (sin BD) | 332 pasan, 429 omitidos (los que necesitan `DATABASE_URL`) |

Criterio de aceptación: mis cambios no añaden ningún error a esas listas y los tests con BD se ejecutan contra la rama Neon de pruebas.

## 1. Entorno de pruebas (ya creado)

Neon, proyecto `OmniTech Core TEST` (`weathered-glitter-98387444`), rama **`omni-review-dev`** (`br-solitary-lake-b9nz82o8`), hija de `test`. Contiene el esquema actual (90 tablas) y **0 organizaciones / 0 clientes**: no hay datos personales reales. Producción (`Omnitech-core` / `production`) no se toca.

## 2. Principios

1. Módulo **aditivo** con slug propio `omni_review`, desactivado por defecto; lo activa un SUPER_ADMIN por workspace (patrón de `a_medida` y `omni_seller`).
2. **No se modifican planes comerciales**: `omni_review` no se añade a ninguna plantilla de plan.
3. Reutilizar, no duplicar: `org_integrations` + `integrationCreds` (credenciales cifradas), `outreach_suppressions` (lista de bajas), `logAudit`, `emitAieEvent`, `ai-gateway`, `notificationService`, `credits/`.
4. Todo lo que se muestra como resultado sale de la BD y de proveedores reales. Los contadores se **derivan** de `review_messages`/`review_reviews`; no se guardan cifras estimadas.
5. Cumplimiento como regla del motor, no como convención (ver §6).

## 3. Esquema (`lib/db/src/schema/review.ts`, migración Drizzle `0018_omni_review.sql`)

Todas las tablas llevan `org_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` y un índice que empieza por `org_id`.

| Tabla | Propósito | Claves/Restricciones relevantes |
|---|---|---|
| `review_locations` | Establecimiento del workspace | `google_place_id`, `google_review_url` (derivada: `https://search.google.com/local/writereview?placeid=…`), `gbp_account_id`/`gbp_location_id` (nulos hasta conectar Google), `status` |
| `review_import_batches` | Cada importación CSV/XLSX/CRM | contadores total/válidos/inválidos/duplicados, `error_report jsonb`, `source` |
| `review_contacts` | Destinatarios | `email_norm`, `phone_e164`, `client_id` (CRM, opcional), `service`, `service_date`, `status` (active/unsubscribed/invalid/bounced). **Únicos parciales** `(org_id,email_norm)` y `(org_id,phone_e164)` = deduplicación a nivel BD |
| `review_consents` | Registro append-only de base jurídica por contacto y canal | `channel`, `legal_basis`, `evidence`, `granted_at`, `revoked_at`, `source` |
| `review_templates` | Plantillas por canal | `channel`, `body`, `variables`, `wa_template_name`, `wa_language`, `wa_status` (sincronizado desde Meta), validación anti-incentivo |
| `review_campaigns` | Campañas | `location_id`, `channel`, `template_id`, `status` (draft/scheduled/running/paused/completed/cancelled), `schedule_at`, `send_window`, `rate_per_minute`, `max_reminders` (0–1), `reminder_after_days`, `audience_filter jsonb` (solo establecimiento/servicio/fechas/origen) |
| `review_messages` | **Cola + registro de entregas** | estado `queued→sending→sent→delivered→read` / `failed` / `skipped`(+`skip_reason`), `attempts`, `next_attempt_at`, `locked_at`/`locked_by` (lease), `provider_message_id`, `error_code`, `tracking_token` único, **clave de idempotencia única** `(campaign_id, contact_id, kind, seq)` = protección frente a duplicados |
| `review_events` | Log append-only de eventos (estado de proveedor, clic, baja, error) | `message_id`, `type`, `payload jsonb` |
| `review_reviews` | Reseñas leídas **solo de la API de Google** | `google_review_id` único por org, `rating`, `comment`, `published_at`, `sentiment`, `topics jsonb`, `reply_status` (none/draft/approved/published/failed), `suggested_reply`, `approved_by` |
| `review_usage` | Consumo por org/mes/canal | `sent`, `delivered`, `failed`, `provider_cost` (nulo si el proveedor no lo informa; nunca se inventan precios) |
| `review_settings` | Configuración por empresa | límites propios, horario de silencio, retención de datos (días), zona horaria |

Bajas: se escriben en **`outreach_suppressions`** (existente) con `source='omni_review'` y se consultan con una función común; así una baja bloquea también OmniSeller y viceversa. Alternativa descartada: tabla propia duplicada.

Conexiones externas (WhatsApp, Google): filas en `org_integrations` (`whatsapp`, `google_business_profile`), credenciales cifradas con `INTEGRATION_ENCRYPTION_KEY`.

## 4. Arquitectura del motor (`artifacts/api-server/src/review/`)

```
review/
  channels/        ChannelProvider (interfaz) + registry
    whatsappProvider.ts   plantillas Meta, estados por webhook (reutiliza getWhatsAppCreds)
    emailProvider.ts      Resend vía lib/email
  engine/
    importer.ts     CSV/XLSX → validar → normalizar → dedupe → lote
    enqueue.ts      campaña → review_messages (aplicando guard)
    guard.ts        consentimiento + bajas + cooldown + ventana horaria + límites + idempotencia
    worker.ts       lease con FOR UPDATE SKIP LOCKED, lotes, rate limit, backoff, recuperación de leases caducados
  google/           enlace de reseña (Place ID) · cliente GBP (OAuth) · sync de reseñas
  ai/               redacción, sentimiento, temas, respuestas sugeridas (ai-gateway) + cola de aprobación
  routes/           API REST /api/review/*  +  /r/:token (redirección con registro de clic)
  usage/            límites por plan, consumo, costes
```

**SMS sin tocar el motor**: el motor solo conoce `ChannelProvider { channel; normalizeAddress(); send(); classifyError(); parseStatus() }`. SMS = un fichero nuevo + una línea de registro + valor nuevo en el enum de canal (es `text` con validación Zod, no enum de Postgres).

**Cola y límites**: tick en proceso (mismo patrón que `autopilotScheduler`) más ruta `/internal/cron/review-tick` con `CRON_SECRET`; *no* se reactiva el workflow de GitHub desactivado. Cada tick reclama N mensajes por (org, canal) según `rate_per_minute` y el límite del proveedor; lease de 5 min para recuperar procesos caídos; reintentos con backoff exponencial solo para errores clasificados como transitorios; máximo 3 intentos.

**Clics vs reseñas**: `/r/:token` registra el clic y redirige 302 a la URL de reseña. Un clic **no** es una reseña: el panel muestra por separado *solicitudes enviadas · entregadas · clics · reseñas recibidas (solo API de Google)*. Si Google no está conectado, el panel lo indica en lugar de mostrar un 0 engañoso.

**Ava**: `ai-gateway` para redacción/sentimiento/temas; respuestas sugeridas entran en `review_reviews.reply_status='draft'` y solo se publican tras aprobación humana. Alertas de negativas por `notificationService`.

## 5. Cambios en código existente (requieren tu aprobación)

Son los **únicos** puntos donde se toca algo ya operativo; todos aditivos:

| # | Fichero | Cambio |
|---|---|---|
| 1 | `middlewares/permissions.ts` | añadir permisos `review.read/write/admin` a los roles (patrón `omniseller.*`) |
| 2 | `routes/auth.ts` | añadir `omni_review` a `ALL_MODULE_SLUGS` (sin añadirlo a ningún plan) |
| 3 | `routes/control-center.ts` | entrada en `CATALOG` (aparece en el catálogo de módulos) |
| 4 | `utils/startupMigrations.ts` | sembrar `module_configs` para `omni_review` con `is_enabled=false` (FIX-BC) |
| 5 | `routes/index.ts` | montar `/review` con `requireModule("omni_review")` y la ruta pública `/r/:token` con rate limit |
| 6 | `index.ts` | registrar el tick del worker tras las migraciones |
| 7 | `routes/whatsapp.ts` (webhook público) | pasar los **estados** (sent/delivered/read/failed) al módulo cuando el `wamid` corresponda a un `review_messages`; sin efecto en el resto |
| 8 | `outreach/webhooks/resend…` | ídem para eventos de email (entregado/rebote/queja) |
| 9 | `omniflow`: `MainLayout.tsx`, `App.tsx`, `ModuleGuard.tsx` | entrada de menú, rutas y nombre del módulo |
| 10 | `ava-core/tools/crmTools.ts` y `ava-core/actions/` | registrar las herramientas de solo lectura de reseñas y la acción `approve_review_reply` en Ava (ver §9). Sin tocar el motor `engine.ts` |

**Despliegue**: `lib/db/drizzle/0018` y el FIX-BC se ejecutarán en producción solo cuando se fusione la PR y se despliegue. Eso lo decides tú; hasta entonces solo corren en la rama Neon de pruebas.

## 6. Cumplimiento aplicado por el motor

- **Sin consentimiento/base jurídica registrada no se encola** (`guard.ts`). La base jurídica la declara el administrador del workspace al importar y queda en `review_consents` con evidencia. *Esto no es asesoramiento legal*: conviene validar con un DPO/abogado si la relación con el cliente permite el envío bajo el art. 21 LSSI y el RGPD; WhatsApp además exige opt-in según la política de Meta.
- Todo mensaje incluye vía de baja; la baja por respuesta ("BAJA"/"STOP") o enlace se aplica de inmediato y es global (suprime también otros canales si el cliente lo pide).
- **Sin filtrar por satisfacción**: `audience_filter` solo admite establecimiento, servicio, fechas y origen; no existe ningún campo de NPS/valoración previa. La API rechaza cualquier otro filtro.
- **Sin incentivos**: validador de plantillas que rechaza fórmulas de recompensa (descuento, sorteo, regalo, "a cambio de", etc.) — es una heurística, la responsabilidad del texto sigue siendo del cliente; se documenta.
- Retención configurable (por defecto propongo 24 meses para contactos sin actividad; **a confirmar**), exportación y borrado por contacto, auditoría de todas las acciones.

## 7. Qué se podrá y qué no se podrá probar de verdad

| Pieza | Verificable ahora | Requiere de ti |
|---|---|---|
| Esquema, migración, aislamiento multiempresa, permisos, importación, dedupe, cola, concurrencia, reintentos, bajas, límites | ✅ Vitest contra la rama Neon real | — |
| Rendimiento 5.000+ contactos | ✅ contra la rama Neon | — |
| Redirección y registro de clics | ✅ HTTP real | — |
| Envío WhatsApp real y estados | ❌ | cuenta WABA de prueba, número de destino autorizado, plantilla aprobada, `META_APP_SECRET` |
| Envío email real | ❌ | `RESEND_API_KEY` y dominio verificado (según la memoria del repo está sin configurar) |
| Lectura de reseñas de Google | ❌ | proyecto Google Cloud con acceso aprobado a Business Profile API + OAuth del propietario de la ficha |
| IA (Ava) | ❌ para texto real | clave de proveedor de IA en el gateway |

Los tests de proveedores externos sin credenciales usarán dobles HTTP **etiquetados como tales** y el informe final marcará cada integración como "preparada técnicamente, no verificada" hasta que se pruebe con credenciales reales.

## 8. Orden de entrega

1. Esquema + migración `0018` en la rama Neon + tests de aislamiento y permisos.
2. Importador + dedupe + consentimientos + guard.
3. Cola/worker + canales (WhatsApp, email) + webhooks de estado.
4. API REST + redirección de clics + límites/consumo.
5. Frontend (panel, campañas, reseñas).
6. Google (enlaces primero; API tras aprobación) + Ava.
7. Documentación (OpenAPI, guía de configuración, credenciales pendientes) e informe de cambios.

Cada paso termina con typecheck frente a la línea base y tests antes de seguir.


## 9. IA: Ava Omni sobre la infraestructura existente (sin proveedor nuevo)

### 9.1 Auditoría de cómo está conectada la IA hoy

- **Punto único de entrada: `callAI()`** en `ai-gateway/gateway.ts`. Lo usan Agent Factory (`agents/agentRunner.ts`) y Ava Core (`ava-core/engine.ts`). Ningún consumidor construye un proveedor propio.
- **Flujo de `callAI`**: rechaza simulación → precios → ruta de proveedor (agente → workspace → plan → `AI_PROVIDER`) → caché opcional (clave con `orgId`) → **presupuesto USD del workspace** (`checkBudgetBlocked`, `ai_budgets`) → **reserva atómica de OmniCredits** (opt-in con `billing.ledger`) → llamada con timeout/reintento/fallback → Cost Engine → fila en **`ai_usage_logs`** (por org) → liquidación en el ledger.
- **Proveedor**: OpenAI (`gpt-4o-mini` por defecto), credencial en la variable de entorno `OPENAI_API_KEY` del servicio desplegado. Claude y Gemini existen como adaptadores pero figuran `implemented: false`. El módulo **no leerá ni guardará ninguna clave**: solo llama a `callAI`.
- **Ava**: `ava-core` ya ofrece el patrón *herramientas de solo lectura → `present_findings` → `propose_action` → token de confirmación de un solo uso → ejecutar con permisos revalidados*; las herramientas reciben `orgId` solo del contexto verificado por el backend, nunca de los argumentos del modelo. Agent Factory añade propuestas persistentes (`ai_agent_proposals`, token con hash SHA-256, consumo atómico).
- Nota de la memoria del repo: el chat de Ava (`POST /api/chat`) es determinista sin LLM; solo Ava Core y los agentes usan el gateway. Omni Review usará el gateway solo en las tareas que de verdad necesitan un modelo.

### 9.2 Cómo se integra Omni Review

| Requisito | Implementación |
|---|---|
| Una sola infraestructura de IA | Todo pasa por `callAI` (`mode:"live"`, `orgId` del workspace, `functionName:"review_*"`, `usageKind:"ai_analysis"` / `"ai_content_generation"`). Cero proveedores nuevos, cero claves nuevas, config global intacta |
| Límites de consumo existentes | `callAI` ya aplica el presupuesto USD por workspace y, si se activa, créditos. Los errores `AiBudgetBlockedError`/`InsufficientCreditsError` se traducen a un estado "IA bloqueada por límite" en el panel, sin romper el resto del módulo |
| Consumo por empresa | `ai_usage_logs` ya registra cada llamada con `org_id`; el panel de uso del módulo lo lee filtrando por `function_name LIKE 'review_%'` |
| Aislamiento entre workspaces | El contexto que se envía al modelo se construye siempre con `WHERE org_id = :orgId` desde el backend; las herramientas de Ava reciben `orgId` del `AvaContext`. Nunca se mezclan reseñas de dos workspaces en un mismo prompt. Caché del gateway con clave por `orgId` |
| Evitar llamadas innecesarias | (1) Reseñas **sin comentario**: sentimiento por reglas desde las estrellas, sin LLM. (2) Clasificación **por lotes** (varias reseñas por llamada, salida JSON). (3) Resultado **persistido** en `review_reviews` y marca `ai_analyzed_at`: nunca se reanaliza lo ya analizado salvo petición expresa. (4) Informes: se regeneran solo si hay reseñas nuevas desde el último. (5) Sugerencia de respuesta **bajo demanda** o solo para las que el administrador configure (por defecto: negativas y las marcadas para intervención). (6) `cache.ttlSeconds` para peticiones idénticas. (7) `maxTokens` acotado por tarea |
| Permisos / seguridad | `requireModule("omni_review")` + `review.read/write/admin`; las herramientas de Ava comprueban además que el módulo esté activo para ese workspace antes de ejecutar |
| Aprobación humana configurable | `review_settings.ai_approval` (jsonb): por acción `reply_publish`, `reply_edit_auto`, `alert_notify` ∈ `always_approve` (**por defecto**) / `approve_if_negative` / `auto`. Aun en `auto`, nunca se publica sin aprobación una respuesta a reseña ≤3★ o marcada "requiere intervención". Las propuestas se guardan en BD (`reply_status='draft'`), no en memoria |
| Publicar en Google | Hasta tener Business Profile API aprobada, "publicar" no existe: el borrador se aprueba y se copia/abre en Google. No se declara publicación automática |

### 9.3 Funciones de Ava (qué, con qué y cuándo llama al modelo)

1. **Analizar reseñas recibidas** → lote tras cada sincronización con Google (cuando exista); 1 llamada por lote.
2. **Sentimiento** → reglas por estrellas + modelo solo cuando hay texto; resultado persistido.
3. **Quejas/problemas recurrentes** → agrupación por temas (`topics jsonb`) en el mismo lote; agregación posterior **sin modelo** (SQL).
4. **Respuestas personalizadas** → bajo demanda o por política; borrador + revisión + aprobación.
5. **Mejoras de reputación** → recomendaciones derivadas de temas agregados (1 llamada por informe).
6. **Informes y resúmenes** → semanal/mensual; datos agregados por SQL, el modelo solo redacta el resumen.
7. **Intervención humana** → reglas deterministas primero (≤2★, palabras clave de riesgo legal/sanitario/amenaza, datos personales en el texto) y el modelo solo como segunda opinión en dudosos; marca `needs_human=true` y notifica vía `notificationService`.

Herramientas de solo lectura para Ava (contexto CRM): `review_summary`, `review_list_flagged`, `review_top_topics`; acción con confirmación: `approve_review_reply`. Todas devuelven datos del workspace del usuario, nada más.

### 9.4 Prueba real de generación de texto

- Este sandbox **no tiene ninguna credencial de IA** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` y `GEMINI_API_KEY` sin definir), y no voy a extraerlas del servicio desplegado. Por eso **todavía no he podido hacer la prueba real**.
- He añadido una prueba opt-in que usa exactamente la infraestructura existente (`callAI`, `orgId: null` = nivel plataforma, no gasta presupuesto de ningún workspace, ≤40 tokens): `src/ai-gateway/__tests__/gatewayLive.smoke.test.ts`. Se ejecuta donde ya esté configurado el proveedor:

```
AI_LIVE_SMOKE=1 DATABASE_URL=<rama omni-review-dev> OPENAI_API_KEY=<la ya existente> \
  pnpm --filter @workspace/api-server exec vitest run src/ai-gateway/__tests__/gatewayLive.smoke.test.ts
```

Hasta que esa prueba pase, la IA del módulo consta como **"preparada técnicamente, no verificada"**.
