/**
 * outreach_events — OmniSeller Fase 5.
 *
 * Registro idempotente de eventos ENTRANTES de los proveedores de Outreach
 * (Resend, WhatsApp Cloud API, Telegram) — delivery status (delivered/
 * bounced/complained/opened/clicked), status callbacks de WhatsApp e inbound
 * correlacionado con una conversación de OmniSeller.
 *
 * DELIBERADAMENTE separada de `integration_events` (Hub genérico, compartida
 * con Fleet/Autopilot y otros sistemas ajenos a OmniSeller — ver
 * lib/db/src/schema/integrations.ts): esa tabla no tiene columna de id de
 * evento externo ni ningún constraint único, así que no es apta para
 * idempotencia de webhooks sin un ALTER que afectaría a sistemas que no
 * tienen nada que ver con OmniSeller. Decisión ya tomada explícitamente para
 * esta fase (no reutilizar integration_events para esto) — mismo patrón que
 * ya se siguió en Fase 3/4 (outreach_suppressions, outreach_confirmations,
 * lead_contacts): una tabla propia y estrecha en vez de forzar una
 * infraestructura compartida a una forma que no encaja.
 *
 * Idempotencia — UNIQUE(provider, external_event_id). Un mismo evento
 * reenviado por el proveedor (retry) intenta insertar la misma clave y
 * choca contra el índice único; el código (outreach/webhooks/eventProcessor.ts)
 * detecta el conflicto, mira el estado de la fila ya existente y decide si
 * es un duplicado real (ya "processed") o un reintento legítimo de un
 * intento anterior que quedó en "received"/"error" (nunca se pierde un
 * evento por un fallo de proceso a mitad de camino — Paso 19).
 *
 * `external_event_id` se deriva de forma determinista y documentada por
 * proveedor — nunca inventado:
 *  - email (Resend): el header `svix-id` — estable entre reintentos del
 *    mismo evento lógico (documentado por Svix: "unique across all
 *    messages, but will be the same when the same webhook is being
 *    resent").
 *  - whatsapp: `${wamid}:${status}:${timestamp}` — Meta no expone un id de
 *    evento propio para los status callbacks; esta clave compuesta se
 *    construye únicamente con campos que el propio payload de Meta ya trae
 *    (ver routes/whatsapp.ts). Para inbound correlacionado se usa el propio
 *    id del mensaje entrante (`msg.id`, el wamid del mensaje entrante).
 *  - telegram: `update_id` (entero único y creciente por bot, documentado
 *    por la Bot API de Telegram).
 *
 * `org_id` es NULLABLE a propósito: hasta que se resuelve el lead_message
 * correspondiente (o, para inbound, el lead_contact) puede que todavía no
 * se sepa con certeza a qué organización pertenece el evento — nunca se
 * confía en un org_id que el propio proveedor pudiera incluir en el payload
 * (Paso 17: la organización SIEMPRE se deriva de nuestra propia fila
 * lead_messages/lead_contacts, nunca de lo que dice el webhook).
 *
 * Sin FK real a lead_messages — mismo criterio ya usado en leads.ts
 * (lead_messages.contact_id) y outreachConfirmations.ts (lead_message_id):
 * evitar un import circular de esquema. Integridad garantizada en
 * aplicación (eventProcessor.ts siempre resuelve y valida la fila antes de
 * escribir aquí su id).
 */
import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// "processing" añadido en Fase 10 (hardening de concurrencia) — reclamación
// atómica transitoria entre "received"/"error" y "processed"/"ignored", ver
// outreach/webhooks/eventProcessor.ts. Columna de texto libre, no un enum de
// Postgres — añadir este valor no requiere migración.
export const OUTREACH_EVENT_STATUSES = ["received", "processing", "processed", "error", "ignored"] as const;
export type OutreachEventStatus = (typeof OUTREACH_EVENT_STATUSES)[number];

export const outreachEventsTable = pgTable("outreach_events", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  provider:        text("provider").notNull(),           // "email" | "whatsapp" | "telegram"
  externalEventId: text("external_event_id").notNull(),
  eventType:       text("event_type").notNull(),
  leadMessageId:   integer("lead_message_id"),
  rawPayload:      jsonb("raw_payload"),
  status:          text("status").notNull().default("received"),
  errorMessage:    text("error_message"),
  receivedAt:      timestamp("received_at").notNull().defaultNow(),
  processedAt:     timestamp("processed_at"),
}, (t) => [
  uniqueIndex("outreach_events_provider_external_id_uidx").on(t.provider, t.externalEventId),
  index("outreach_events_org_idx").on(t.orgId),
  index("outreach_events_lead_message_idx").on(t.leadMessageId),
]);

export type OutreachEvent = typeof outreachEventsTable.$inferSelect;
export type NewOutreachEvent = typeof outreachEventsTable.$inferInsert;
