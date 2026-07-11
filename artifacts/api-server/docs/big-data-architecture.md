# OmniTech Core — Arquitectura Big Data Ready

**Versión:** 1.0  
**Fecha:** Julio 2026  
**Estado:** Event Bus activo. Big Data (Kafka/Spark) no implementado — preparado para integración futura sin modificar el código de negocio.

---

## 1. Visión General

OmniTech Core ha sido preparado para escalar a millones de registros y usuarios manteniendo PostgreSQL como base de datos principal y añadiendo una capa de eventos que puede conectarse a Apache Kafka, Apache Spark, Elasticsearch o cualquier sistema de Big Data sin modificar la lógica de negocio.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OmniTech Core                               │
│                                                                     │
│  Módulos de Negocio                                                 │
│  ┌──────┐ ┌───────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ CRM  │ │Ventas │ │Factura-  │ │Marketing │ │    IA    │  ...   │
│  │      │ │Quotes │ │  ción    │ │   Ads    │ │          │        │
│  └──┬───┘ └───┬───┘ └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│     │         │          │            │             │               │
│     └─────────┴──────────┴────────────┴─────────────┘               │
│                              │ emit()                                │
│                    ┌─────────▼─────────┐                            │
│                    │    Event Bus      │  ← InternalEventBus hoy   │
│                    │  (IEventBus API)  │  ← KafkaEventBus mañana   │
│                    └─────────┬─────────┘                            │
│                              │                                      │
│              ┌───────────────┼────────────────┐                     │
│              │               │                │                     │
│    ┌─────────▼──────┐ ┌──────▼──────┐ ┌──────▼─────────┐           │
│    │ system_events  │ │ In-Process  │ │  Future         │           │
│    │  (PostgreSQL)  │ │ Subscribers │ │  Kafka Topics   │           │
│    └────────────────┘ └─────────────┘ └────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Componentes Implementados

### 2.1 Event Bus (`src/events/`)

| Archivo | Propósito |
|---------|-----------|
| `types.ts` | Tipos TypeScript: `OmniEvent`, `OmniEventType`, `IEventBus`, `OmniModule` |
| `eventBus.ts` | `InternalEventBus` — implementación con Node.js EventEmitter |
| `index.ts` | Singleton `eventBus` + función `emit()` (fire-and-forget) |

**Interfaz `IEventBus`** (el único contrato que Kafka deberá implementar):

```typescript
interface IEventBus {
  publish(event: OmniEvent): void | Promise<void>;
  subscribe(eventType: OmniEventType | "*", handler: EventHandler): void;
  unsubscribe(eventType: OmniEventType | "*", handler: EventHandler): void;
}
```

### 2.2 Tabla `system_events` (PostgreSQL)

```sql
CREATE TABLE system_events (
  id          BIGSERIAL     PRIMARY KEY,        -- ID secuencial eficiente
  event_id    UUID          NOT NULL,           -- UUID estable para deduplicación Kafka
  org_id      INTEGER       NOT NULL,           -- Workspace que generó el evento
  user_id     TEXT,                             -- Clerk user ID (null = sistema)
  event_type  TEXT          NOT NULL,           -- "crm.client.created"
  module      TEXT          NOT NULL,           -- "crm", "billing", "ai", ...
  payload     JSONB         NOT NULL,           -- Datos de negocio (<1 KB recomendado)
  created_at  TIMESTAMPTZ   NOT NULL            -- Timestamp UTC
);
```

**Índices para millones de registros:**

| Índice | Columnas | Caso de uso |
|--------|----------|-------------|
| `sys_evt_org_created` | `(org_id, created_at DESC)` | Dashboard por workspace (más común) |
| `sys_evt_type` | `(event_type)` | Filtrar por tipo de evento |
| `sys_evt_module` | `(module)` | Análisis por módulo |
| `sys_evt_created` | `(created_at DESC)` | Time-series global / Data Lake export |
| `sys_evt_payload_gin` | `USING gin(payload)` | Búsqueda en payload JSON (Elasticsearch bridge) |

---

## 3. Catálogo de Eventos

### Módulo: CRM
| Evento | Descripción |
|--------|-------------|
| `crm.client.created` | Nuevo cliente creado |
| `crm.client.updated` | Datos del cliente modificados |
| `crm.client.deleted` | Cliente eliminado |
| `crm.client.status_changed` | Cambio de estado (lead → activo) |

### Módulo: Ventas
| Evento | Descripción |
|--------|-------------|
| `sales.quote.created` | Presupuesto creado |
| `sales.quote.sent` | Presupuesto enviado al cliente |
| `sales.quote.accepted` | Cliente aceptó el presupuesto |
| `sales.quote.rejected` | Cliente rechazó el presupuesto |
| `sales.quote.expired` | Presupuesto caducado |

### Módulo: Facturación
| Evento | Descripción |
|--------|-------------|
| `billing.invoice.created` | Factura creada |
| `billing.invoice.sent` | Factura enviada |
| `billing.invoice.paid` | Factura cobrada |
| `billing.invoice.overdue` | Factura vencida |
| `billing.payment.received` | Pago registrado |
| `billing.recurring.generated` | Factura recurrente generada automáticamente |

### Módulo: Calendario
| Evento | Descripción |
|--------|-------------|
| `calendar.appointment.created` | Cita agendada |
| `calendar.appointment.updated` | Cita modificada |
| `calendar.appointment.cancelled` | Cita cancelada |
| `calendar.appointment.completed` | Cita marcada como completada |

### Módulo: WhatsApp / Telegram
| Evento | Descripción |
|--------|-------------|
| `whatsapp.message.received` | Mensaje recibido |
| `whatsapp.message.sent` | Mensaje enviado |
| `whatsapp.quote.accepted` | Presupuesto aceptado por WhatsApp |
| `telegram.message.received` | Mensaje de Telegram recibido |
| `telegram.appointment.created` | Cita creada desde Telegram |

### Módulo: IA
| Evento | Descripción |
|--------|-------------|
| `ai.chat.interaction` | Interacción de chat con IA (tokens, modelo, coste) |
| `ai.content.generated` | Contenido generado (anuncio, email, post) |
| `ai.tool.called` | Herramienta de IA ejecutada |
| `ai.memory.saved` | Hecho guardado en memoria organizacional |
| `ai.budget.alert` | Alerta de presupuesto de IA |

### Módulo: Documentos
| Evento | Descripción |
|--------|-------------|
| `documents.file.uploaded` | Fichero subido |
| `documents.contract.signed` | Contrato firmado |

### Módulo: Marketing / Ads / Leads
| Evento | Descripción |
|--------|-------------|
| `marketing.campaign.created` | Campaña creada |
| `marketing.campaign.sent` | Campaña enviada |
| `ads.campaign.created` | Campaña de anuncios creada |
| `ads.creative.generated` | Creativo generado con IA |
| `leads.lead.discovered` | Lead encontrado (Google Places, etc.) |
| `leads.lead.converted` | Lead convertido a cliente |

### Módulo: Sistema
| Evento | Descripción |
|--------|-------------|
| `system.user.login` | Inicio de sesión |
| `system.user.logout` | Cierre de sesión |
| `system.import.completed` | Importación de datos completada |

---

## 4. Flujo de Datos

```
Usuario/API Request
       │
       ▼
Lógica de Negocio (skill / route)
       │
       ├──► DB (PostgreSQL) — escritura principal, síncrona
       │
       └──► emit({ type, orgId, module, payload })   ← fire-and-forget, no bloquea
                 │
                 ├──► EventBus.publish(event)
                 │         │
                 │         └──► In-process subscribers (sync, <1ms)
                 │
                 └──► persistToDb(event)  [async, no bloquea al caller]
                           │
                           └──► INSERT INTO system_events ...
```

**Garantías de la implementación actual:**
- `emit()` es siempre fire-and-forget — nunca bloquea la respuesta HTTP
- Los errores de persistencia se loguean pero no se propagan
- Los suscriptores in-process son síncronos (EventEmitter)
- El UUID (`event_id`) permite deduplicación cuando se añada Kafka

---

## 5. Índices de Base de Datos (Optimización)

Además de `system_events`, la migración **FIX-AC** añade índices en las tablas de alto volumen:

| Tabla | Índice | Columnas |
|-------|--------|----------|
| `clients` | `idx_clients_org_id` | `org_id` |
| `clients` | `idx_clients_status` | `(org_id, status)` |
| `clients` | `idx_clients_created_at` | `(org_id, created_at DESC)` |
| `appointments` | `idx_appts_org_id` | `org_id` |
| `appointments` | `idx_appts_client_id` | `client_id` |
| `appointments` | `idx_appts_start_time` | `(org_id, start_time)` |
| `quotes` | `idx_quotes_org_id` | `org_id` |
| `quotes` | `idx_quotes_status` | `(org_id, status)` |
| `activity` | `idx_activity_org_created` | `(org_id, created_at DESC)` |
| `activity` | `idx_activity_type` | `(org_id, type)` |
| `audit_logs` | `idx_audit_org_created` | `(org_id, created_at DESC)` |
| `ai_usage_logs` | `idx_ai_usage_org_created` | `(org_id, created_at DESC)` |

---

## 6. Cómo Añadir un Nuevo Evento

### En el backend (skills / routes):

```typescript
import { emit } from "../events";

// Después de completar la operación de negocio:
emit({
  type:    "billing.invoice.paid",   // Tipo del catálogo (tipos.ts)
  orgId:   orgId,
  userId:  clerkUserId ?? null,      // null si es sistema/scheduler
  module:  "billing",
  payload: {
    invoiceId: invoice.id,
    amount:    invoice.total,
    clientId:  invoice.clientId,
  },
});
```

### Para suscribirse a eventos (módulo de analytics, notificaciones, etc.):

```typescript
import { eventBus } from "../events";

// Al arrancar el servidor:
eventBus.subscribe("billing.invoice.paid", async (event) => {
  // Enviar notificación, actualizar dashboard en tiempo real, etc.
  console.log(`Cobro recibido en org ${event.orgId}:`, event.payload);
});

// Suscribirse a todos los eventos:
eventBus.subscribe("*", async (event) => {
  // Analytics, logging externo, etc.
});
```

---

## 7. Plan de Migración a Big Data

### Fase 1 — Actual ✅
- Event Bus interno (Node.js EventEmitter)
- Persistencia en `system_events` (PostgreSQL)
- Índices optimizados para millones de registros
- 40+ tipos de evento catalogados
- Wiring en CRM, Ventas, Calendario, IA

### Fase 2 — Apache Kafka
**Sin tocar el código de negocio:**

1. Crear `KafkaEventBus` que implementa `IEventBus`
2. En `src/events/index.ts`, cambiar una línea:
   ```typescript
   // Antes:
   export const eventBus = new InternalEventBus();
   // Después:
   export const eventBus = new KafkaEventBus({ brokers: [...], ... });
   ```
3. Mapear `OmniModule` → Kafka topics (1 topic por módulo)
4. `system_events` se convierte en la tabla de changelog (Kafka Connect → PostgreSQL Sink)

**Topología Kafka sugerida:**

| Topic | Particiones | Retención |
|-------|-------------|-----------|
| `omnitech.crm` | 12 | 30 días |
| `omnitech.billing` | 12 | 365 días |
| `omnitech.ai` | 6 | 90 días |
| `omnitech.marketing` | 6 | 30 días |
| `omnitech.system` | 3 | 7 días |

### Fase 3 — Apache Spark
- Leer de Kafka topics con Spark Structured Streaming
- Métricas en tiempo real: conversión de leads, MRR, NPS
- `system_events` como tabla de historial para batch analytics

### Fase 4 — Data Lake
- Object Storage (S3/GCS) como destino para documentos y archivos
- Schema Registry (Confluent / AWS Glue) para versionar el esquema de eventos
- `event_id` (UUID) como clave de deduplicación

### Fase 5 — Elasticsearch + ML
- Índice GIN de `payload` ya preparado para migrar a Elasticsearch
- `ai.chat.interaction` eventos como dataset de entrenamiento
- Fine-tuning de modelos propios sobre datos de uso real

---

## 8. Arquitectura Modular — Reglas de Desacoplamiento

Los módulos **nunca** se importan directamente entre sí. Toda comunicación ocurre por:

1. **Eventos** — `emit()` desde el módulo emisor, suscripción desde el receptor
2. **Servicios comunes** — `src/utils/`, `@workspace/db`
3. **Skill Engine** — Skills que coordinan múltiples módulos bajo petición de IA

```
✅ CORRECTO:  quoteSkills.ts  →  emit("sales.quote.accepted")
                                     ↓
              billingRoutes.ts ← subscribe("sales.quote.accepted")

❌ INCORRECTO: quoteSkills.ts  →  import billingRoutes from "./billing"
```

---

## 9. Consultas de Análisis (Ejemplos)

### Volumen de eventos por módulo (último mes)
```sql
SELECT module, event_type, COUNT(*) as total
FROM system_events
WHERE org_id = $1
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY module, event_type
ORDER BY total DESC;
```

### Conversión lead → cliente (funnel)
```sql
SELECT
  DATE_TRUNC('week', created_at) as week,
  COUNT(*) FILTER (WHERE event_type = 'leads.lead.discovered') as leads,
  COUNT(*) FILTER (WHERE event_type = 'leads.lead.converted')  as converted
FROM system_events
WHERE org_id = $1
GROUP BY week ORDER BY week;
```

### Coste IA por función (mes actual)
```sql
SELECT
  payload->>'functionName' as fn,
  SUM((payload->>'costUsd')::numeric) as total_cost,
  COUNT(*) as calls
FROM system_events
WHERE module = 'ai'
  AND event_type = 'ai.chat.interaction'
  AND created_at >= DATE_TRUNC('month', NOW())
GROUP BY fn ORDER BY total_cost DESC;
```

---

## 10. Puntos de Extensión Registrados

| Punto | Archivo | Descripción |
|-------|---------|-------------|
| EventBus swap | `src/events/index.ts` L3 | Cambiar `new InternalEventBus()` por `new KafkaEventBus()` |
| Nuevo evento | `src/events/types.ts` | Añadir a `OmniEventType` union type |
| Nuevo módulo | `src/events/types.ts` | Añadir a `OmniModule` union type |
| Suscriptor global | Cualquier archivo de inicialización | `eventBus.subscribe("*", handler)` |
| Data Lake files | `src/routes/` | Emitir `documents.file.uploaded` con URL del storage |
| Kafka topics | `KafkaEventBus` | Map `OmniModule` → topic name |

---

*Documento generado automáticamente. Actualizar cuando se añadan nuevos tipos de evento o módulos.*
