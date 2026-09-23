/**
 * outreach_followups — OmniSeller Fase 6 (Follow-up Engine).
 *
 * "Sibling tick" de OmniSeller para secuencias automáticas de seguimiento
 * sobre leads (NO clientes CRM) — deliberadamente NO reutiliza
 * autopilot_tasks/autopilot_runs (Autopilot de clientes, ver auditoría de
 * Fase 6): ese motor está acoplado en código a columnas de clientsTable
 * (dolorPrincipal, commercialStatus, followup1/2/3At, ...) que no existen
 * para leads, y su guard de concurrencia es un SELECT→INSERT con una
 * ventana de carrera real. Esta tabla es una infraestructura propia,
 * aislada, con idempotencia real a nivel de Postgres.
 *
 * MODELO DE DATOS — decisiones (ver informe Fase 6, §1):
 *
 *  - `lead_message_id` es el ANCLA de la secuencia: SIEMPRE apunta al mismo
 *    lead_message (el mensaje original ya "sent" que disparó el follow-up),
 *    compartido por las filas de attempt=1, 2 y 3 de esa secuencia. Esto es
 *    lo que permite "múltiples seguimientos asociados a un mismo
 *    lead_message" (requisito explícito). FK real posible aquí (a
 *    diferencia de lead_messages.contact_id / outreach_confirmations.lead_message_id)
 *    porque este archivo se importa DESDE leads.ts en sentido único — nunca
 *    al revés — así que no hay riesgo de import circular.
 *
 *  - `generated_lead_message_id` (añadido más allá del mínimo literal, ver
 *    comentario más abajo): el NUEVO lead_message que este intento concreto
 *    creó y envió (o intentó enviar). Necesario para cumplir la trazabilidad
 *    exigida en el punto 7 del mandato ("mensaje anterior, intento") sin
 *    tocar el esquema de lead_messages (prohibido explícitamente en el
 *    punto 22 — no se añade columna `origin` ni ninguna otra a esa tabla).
 *    Nullable: solo se rellena cuando el intento llega a crear/enviar su
 *    mensaje (no en 'scheduled').
 *
 *  - Estados (punto 2 del mandato) — la lista mínima exigida se respeta
 *    íntegra, incluyendo dos que NO se materializan como parada persistente
 *    en el ciclo de vida normal, documentado aquí para que quede explícito
 *    y no parezca un olvido:
 *      · "due" es CONCEPTUAL, no un paso de escritura propio: el tick
 *        identifica "vencido" como `status='scheduled' AND next_run_at <= now()`
 *        y reclama la fila con una ÚNICA UPDATE condicional directa
 *        scheduled→processing (mismo patrón atómico que ya usa
 *        outreachService.confirmAndSendMessage). Añadir un paso intermedio
 *        scheduled→due→processing sería una ronda extra sin beneficio de
 *        concurrencia real (la protección la da el WHERE status=... de la
 *        propia UPDATE, no un estado adicional) y un instante más de
 *        ventana para una condición de carrera de doble lectura. Se
 *        audita `outreach.followup_due` en el instante en que la
 *        reclamación tiene éxito.
 *      · "pending_confirmation" queda reservado sin usar en esta fase: el
 *        modelo B aprobado (punto 6) aprueba la SECUENCIA una sola vez, no
 *        cada intento — por diseño no hay confirmación humana por intento.
 *        Se mantiene en el enum por completitud de esquema y compatibilidad
 *        futura (un eventual modelo A/C de confirmación por intento no
 *        requeriría migración), documentado explícitamente en el informe
 *        final para no ocultar que hoy no se alcanza.
 *    "skipped" SÍ se persiste y se re-evalúa: se usa exclusivamente para un
 *    cooldown activo detectado en el momento de procesar (Outreach cooldown,
 *    5 min) — la fila vuelve a 'scheduled'/'skipped' con next_run_at
 *    reprogramado poco después, SIN consumir un intento de la secuencia
 *    (ver followupEngine.ts). "failed" es SOLO el fallo definitivo (se
 *    agotó OUTREACH_MAX_ATTEMPTS del propio lead_message, contador ya
 *    existente de Fase 4 — no se inventa un segundo contador); un fallo de
 *    proveedor con intentos restantes reprograma el MISMO intento
 *    (status vuelve a 'scheduled', reason documenta el motivo) — no crea
 *    attempt+1. "blocked" cubre supresión/estado de contacto inválido/
 *    créditos insuficientes/kill switch de envío activo — terminal para
 *    ESTE intento; salvo el caso de kill switch de envío (que se reintenta
 *    más tarde sin avanzar de intento, ver followupEngine.ts), ninguno de
 *    estos crea el siguiente intento. "cancelled" es el disparador
 *    explícito de cancelación de secuencia completa (bounce/queja/inbound/
 *    desactivación manual) — cancela también cualquier otra fila
 *    scheduled/skipped de la MISMA secuencia (mismo lead_message_id).
 *
 *  - Idempotencia real de Postgres (punto 1, exigencia explícita: "NO
 *    utilizar SELECT→INSERT como único mecanismo"): UNIQUE(lead_message_id,
 *    attempt). Tanto la activación de la secuencia (attempt=1) como la
 *    creación automática de cada siguiente intento usan
 *    `insert(...).onConflictDoNothing({target:[...]})` — si dos ticks (o dos
 *    llamadas de activación) compiten por crear la MISMA fila, solo una
 *    inserta; la otra recibe undefined de `.returning()` y no hace nada más
 *    (mismo patrón ya usado en outreach/webhooks/eventProcessor.ts,
 *    Fase 5). La reclamación de una fila YA EXISTENTE para procesarla usa a
 *    su vez una UPDATE condicional (WHERE status=... AND id=...), nunca un
 *    SELECT seguido de un INSERT/UPDATE incondicional.
 */
import {
  pgTable, serial, integer, text, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { missionsTable } from "./missions";
import { leadContactsTable } from "./leadContacts";
import { leadMessagesTable } from "./leads";

export const OUTREACH_FOLLOWUP_STATUSES = [
  "scheduled", "due", "processing", "pending_confirmation",
  "sent", "skipped", "cancelled", "failed", "blocked",
] as const;
export type OutreachFollowupStatus = (typeof OUTREACH_FOLLOWUP_STATUSES)[number];

export const outreachFollowupsTable = pgTable("outreach_followups", {
  id:     serial("id").primaryKey(),
  orgId:  integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  // Ancla de la secuencia — ver comentario de cabecera. FK real: este
  // archivo se importa desde ningún archivo que leads.ts importe a su vez,
  // así que no hay ciclo (leads.ts no importa de aquí).
  leadMessageId: integer("lead_message_id").notNull().references(() => leadMessagesTable.id, { onDelete: "cascade" }),
  leadContactId: integer("lead_contact_id").notNull().references(() => leadContactsTable.id, { onDelete: "cascade" }),
  missionId:     integer("mission_id").references(() => missionsTable.id, { onDelete: "set null" }),

  channel:     text("channel").notNull(),
  attempt:     integer("attempt").notNull(),
  maxAttempts: integer("max_attempts").notNull().default(3),

  status:    text("status").notNull().default("scheduled"),
  nextRunAt: timestamp("next_run_at").notNull(),
  reason:    text("reason"),

  // Ver comentario de cabecera — trazabilidad sin tocar lead_messages.
  generatedLeadMessageId: integer("generated_lead_message_id").references(() => leadMessagesTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Idempotencia real de Postgres — ver comentario de cabecera.
  uniqueIndex("outreach_followups_anchor_attempt_uidx").on(t.leadMessageId, t.attempt),
  index("outreach_followups_org_idx").on(t.orgId),
  // Consulta principal del tick: candidatos vencidos por estado.
  index("outreach_followups_status_next_run_idx").on(t.status, t.nextRunAt),
  index("outreach_followups_contact_idx").on(t.leadContactId),
  index("outreach_followups_mission_idx").on(t.missionId),
]);

export type OutreachFollowup = typeof outreachFollowupsTable.$inferSelect;
export type NewOutreachFollowup = typeof outreachFollowupsTable.$inferInsert;
