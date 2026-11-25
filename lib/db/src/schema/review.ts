/**
 * Omni Review Bot — esquema (módulo `omni_review`).
 *
 * Captación legítima de reseñas y gestión de reputación. Ver
 * docs/omni-review-bot/01-arquitectura-y-esquema.md para el diseño completo.
 *
 * Reglas de diseño:
 *  - TODAS las tablas llevan org_id NOT NULL con FK a organizations (ON DELETE
 *    CASCADE) y un índice que empieza por org_id: el aislamiento multiempresa
 *    es por fila y cada consulta del módulo DEBE filtrar por org_id.
 *  - Los contadores del panel (enviadas, entregadas, clics, reseñas) NO se
 *    guardan: se derivan de review_messages / review_events / review_reviews,
 *    para no presentar estimaciones como resultados confirmados.
 *  - Las bajas NO tienen tabla propia: se escriben en outreach_suppressions
 *    (existente) con source='omni_review', para que una baja valga para todo
 *    el ecosistema.
 *  - Conexiones externas (WhatsApp, Google): org_integrations (credenciales
 *    cifradas). Aquí solo se guarda el mapeo de establecimiento.
 *  - Los valores de estado se validan con CHECK (no enum de Postgres) para
 *    poder añadir canales/estados (p. ej. SMS) sin migración de tipo.
 */
import {
  pgTable, serial, integer, text, boolean, timestamp, jsonb, numeric, date, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

const orgId = () =>
  integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" });

export const REVIEW_CHANNELS = ["whatsapp", "email"] as const; // SMS: añadir aquí + un ChannelProvider, sin migración
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

export const REVIEW_MESSAGE_STATUSES = [
  "queued", "sending", "sent", "delivered", "read", "failed", "skipped",
] as const;
export type ReviewMessageStatus = (typeof REVIEW_MESSAGE_STATUSES)[number];

export const REVIEW_CAMPAIGN_STATUSES = [
  "draft", "scheduled", "running", "paused", "completed", "cancelled",
] as const;

export const REVIEW_REPLY_STATUSES = ["none", "draft", "approved", "published", "failed"] as const;
export const REVIEW_SENTIMENTS = ["positive", "neutral", "negative"] as const;

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);

// ── review_locations ─────────────────────────────────────────────────────────
export const reviewLocationsTable = pgTable("review_locations", {
  id:             serial("id").primaryKey(),
  orgId:          orgId(),
  name:           text("name").notNull(),
  address:        text("address"),
  googlePlaceId:  text("google_place_id"),
  /** Derivada de google_place_id; la fija el servidor, nunca el cliente. */
  googleReviewUrl: text("google_review_url"),
  gbpAccountId:   text("gbp_account_id"),   // nulo hasta conectar Business Profile API
  gbpLocationId:  text("gbp_location_id"),  // nulo hasta conectar Business Profile API
  status:         text("status").notNull().default("active"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("review_locations_org_idx").on(t.orgId),
  uniqueIndex("review_locations_org_place_uq").on(t.orgId, t.googlePlaceId).where(sql`google_place_id IS NOT NULL`),
  check("review_locations_status_chk", inList("status", ["active", "archived"])),
]);

// ── review_import_batches ────────────────────────────────────────────────────
export const reviewImportBatchesTable = pgTable("review_import_batches", {
  id:            serial("id").primaryKey(),
  orgId:         orgId(),
  locationId:    integer("location_id").references(() => reviewLocationsTable.id, { onDelete: "set null" }),
  source:        text("source").notNull(),            // csv | xlsx | crm
  fileName:      text("file_name"),
  legalBasis:    text("legal_basis").notNull(),       // declarada por el administrador al importar
  legalBasisNote: text("legal_basis_note"),
  totalRows:     integer("total_rows").notNull().default(0),
  validRows:     integer("valid_rows").notNull().default(0),
  invalidRows:   integer("invalid_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  errorReport:   jsonb("error_report"),
  createdBy:     integer("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("review_import_batches_org_idx").on(t.orgId, t.createdAt),
  check("review_import_batches_source_chk", inList("source", ["csv", "xlsx", "crm"])),
]);

// ── review_contacts ──────────────────────────────────────────────────────────
export const reviewContactsTable = pgTable("review_contacts", {
  id:             serial("id").primaryKey(),
  orgId:          orgId(),
  locationId:     integer("location_id").references(() => reviewLocationsTable.id, { onDelete: "set null" }),
  batchId:        integer("batch_id").references(() => reviewImportBatchesTable.id, { onDelete: "set null" }),
  /** Referencia lógica al CRM (sin FK dura: no se acopla el borrado del cliente). */
  clientId:       integer("client_id"),
  name:           text("name"),
  email:          text("email"),
  emailNorm:      text("email_norm"),   // minúsculas, sin espacios
  phoneE164:      text("phone_e164"),   // +34600111222
  service:        text("service"),
  serviceDate:    date("service_date"),
  source:         text("source").notNull(),
  status:         text("status").notNull().default("active"),
  /** Última actividad (alta, envío, respuesta): base de la retención de 24 meses. */
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  erasureRequestedAt: timestamp("erasure_requested_at"),
  anonymizedAt:   timestamp("anonymized_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("review_contacts_org_idx").on(t.orgId, t.status),
  index("review_contacts_org_activity_idx").on(t.orgId, t.lastActivityAt),
  // Deduplicación a nivel de base de datos, por empresa.
  uniqueIndex("review_contacts_org_email_uq").on(t.orgId, t.emailNorm).where(sql`email_norm IS NOT NULL`),
  uniqueIndex("review_contacts_org_phone_uq").on(t.orgId, t.phoneE164).where(sql`phone_e164 IS NOT NULL`),
  check("review_contacts_status_chk", inList("status", ["active", "unsubscribed", "invalid", "bounced", "erased"])),
  check("review_contacts_source_chk", inList("source", ["csv", "xlsx", "crm", "manual"])),
]);

// ── review_consents (append-only) ────────────────────────────────────────────
export const reviewConsentsTable = pgTable("review_consents", {
  id:         serial("id").primaryKey(),
  orgId:      orgId(),
  contactId:  integer("contact_id").notNull().references(() => reviewContactsTable.id, { onDelete: "cascade" }),
  channel:    text("channel").notNull(),
  legalBasis: text("legal_basis").notNull(),  // consent | existing_customer_relationship | other (con nota)
  evidence:   text("evidence"),
  source:     text("source"),
  grantedAt:  timestamp("granted_at").notNull().defaultNow(),
  revokedAt:  timestamp("revoked_at"),
  createdBy:  integer("created_by"),
}, (t) => [
  index("review_consents_org_contact_idx").on(t.orgId, t.contactId, t.channel),
  check("review_consents_channel_chk", inList("channel", REVIEW_CHANNELS)),
  check("review_consents_basis_chk", inList("legal_basis", ["consent", "existing_customer_relationship", "other"])),
]);

// ── review_templates ─────────────────────────────────────────────────────────
export const reviewTemplatesTable = pgTable("review_templates", {
  id:            serial("id").primaryKey(),
  orgId:         orgId(),
  channel:       text("channel").notNull(),
  name:          text("name").notNull(),
  subject:       text("subject"),             // email
  body:          text("body").notNull(),
  variables:     jsonb("variables").notNull().default(sql`'[]'::jsonb`),
  waTemplateName: text("wa_template_name"),   // plantilla aprobada en Meta
  waLanguage:    text("wa_language"),
  waStatus:      text("wa_status"),           // sincronizado desde Meta: pending|approved|rejected
  createdBy:     integer("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("review_templates_org_idx").on(t.orgId, t.channel),
  check("review_templates_channel_chk", inList("channel", REVIEW_CHANNELS)),
]);

// ── review_campaigns ─────────────────────────────────────────────────────────
export const reviewCampaignsTable = pgTable("review_campaigns", {
  id:               serial("id").primaryKey(),
  orgId:            orgId(),
  locationId:       integer("location_id").notNull().references(() => reviewLocationsTable.id, { onDelete: "restrict" }),
  templateId:       integer("template_id").references(() => reviewTemplatesTable.id, { onDelete: "set null" }),
  name:             text("name").notNull(),
  channel:          text("channel").notNull(),
  status:           text("status").notNull().default("draft"),
  scheduleAt:       timestamp("schedule_at"),
  /** { startHour, endHour, timezone } — ventana de envío permitida. */
  sendWindow:       jsonb("send_window"),
  ratePerMinute:    integer("rate_per_minute").notNull().default(30),
  maxReminders:     integer("max_reminders").notNull().default(0),
  reminderAfterDays: integer("reminder_after_days"),
  /** SOLO establecimiento/servicio/fechas/origen. Prohibido filtrar por satisfacción (validado en la API). */
  audienceFilter:   jsonb("audience_filter").notNull().default(sql`'{}'::jsonb`),
  createdBy:        integer("created_by"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("review_campaigns_org_idx").on(t.orgId, t.status),
  check("review_campaigns_channel_chk", inList("channel", REVIEW_CHANNELS)),
  check("review_campaigns_status_chk", inList("status", REVIEW_CAMPAIGN_STATUSES)),
  check("review_campaigns_reminders_chk", sql`max_reminders BETWEEN 0 AND 1 AND rate_per_minute BETWEEN 1 AND 600`),
]);

// ── review_messages: cola + registro de entregas ─────────────────────────────
export const reviewMessagesTable = pgTable("review_messages", {
  id:                serial("id").primaryKey(),
  orgId:             orgId(),
  campaignId:        integer("campaign_id").notNull().references(() => reviewCampaignsTable.id, { onDelete: "cascade" }),
  contactId:         integer("contact_id").notNull().references(() => reviewContactsTable.id, { onDelete: "cascade" }),
  channel:           text("channel").notNull(),
  kind:              text("kind").notNull().default("request"), // request | reminder
  seq:               integer("seq").notNull().default(0),
  status:            text("status").notNull().default("queued"),
  skipReason:        text("skip_reason"),
  attempts:          integer("attempts").notNull().default(0),
  nextAttemptAt:     timestamp("next_attempt_at").notNull().defaultNow(),
  lockedAt:          timestamp("locked_at"),
  lockedBy:          text("locked_by"),
  provider:          text("provider"),
  providerMessageId: text("provider_message_id"),
  errorCode:         text("error_code"),
  errorMessage:      text("error_message"),
  trackingToken:     text("tracking_token").notNull(),
  sentAt:            timestamp("sent_at"),
  deliveredAt:       timestamp("delivered_at"),
  readAt:            timestamp("read_at"),
  firstClickedAt:    timestamp("first_clicked_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Protección frente a envíos duplicados: una solicitud/recordatorio por contacto y campaña.
  uniqueIndex("review_messages_idem_uq").on(t.campaignId, t.contactId, t.kind, t.seq),
  uniqueIndex("review_messages_token_uq").on(t.trackingToken),
  index("review_messages_org_campaign_idx").on(t.orgId, t.campaignId, t.status),
  // Reclamación de la cola (FOR UPDATE SKIP LOCKED).
  index("review_messages_claim_idx").on(t.nextAttemptAt).where(sql`status = 'queued'`),
  index("review_messages_provider_id_idx").on(t.providerMessageId).where(sql`provider_message_id IS NOT NULL`),
  check("review_messages_status_chk", inList("status", REVIEW_MESSAGE_STATUSES)),
  check("review_messages_channel_chk", inList("channel", REVIEW_CHANNELS)),
  check("review_messages_kind_chk", inList("kind", ["request", "reminder"])),
]);

// ── review_events (append-only) ──────────────────────────────────────────────
export const reviewEventsTable = pgTable("review_events", {
  id:        serial("id").primaryKey(),
  orgId:     orgId(),
  messageId: integer("message_id").references(() => reviewMessagesTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => reviewContactsTable.id, { onDelete: "set null" }),
  type:      text("type").notNull(),    // status_update | click | unsubscribe | error | retry
  payload:   jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("review_events_org_idx").on(t.orgId, t.type, t.createdAt),
  index("review_events_message_idx").on(t.messageId),
]);

// ── review_reviews: SOLO reseñas leídas de la API de Google ──────────────────
export const reviewReviewsTable = pgTable("review_reviews", {
  id:              serial("id").primaryKey(),
  orgId:           orgId(),
  locationId:      integer("location_id").notNull().references(() => reviewLocationsTable.id, { onDelete: "cascade" }),
  googleReviewId:  text("google_review_id").notNull(),
  rating:          integer("rating").notNull(),
  comment:         text("comment"),
  reviewerName:    text("reviewer_name"),
  publishedAt:     timestamp("published_at").notNull(),
  sentiment:       text("sentiment"),
  topics:          jsonb("topics"),
  needsHuman:      boolean("needs_human").notNull().default(false),
  needsHumanReason: text("needs_human_reason"),
  aiAnalyzedAt:    timestamp("ai_analyzed_at"),
  replyStatus:     text("reply_status").notNull().default("none"),
  suggestedReply:  text("suggested_reply"),
  approvedBy:      integer("approved_by"),
  approvedAt:      timestamp("approved_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("review_reviews_org_google_uq").on(t.orgId, t.googleReviewId),
  index("review_reviews_org_loc_idx").on(t.orgId, t.locationId, t.publishedAt),
  index("review_reviews_flagged_idx").on(t.orgId).where(sql`needs_human = true`),
  check("review_reviews_rating_chk", sql`rating BETWEEN 1 AND 5`),
  check("review_reviews_sentiment_chk", sql.raw(`sentiment IS NULL OR sentiment IN (${REVIEW_SENTIMENTS.map((s) => `'${s}'`).join(", ")})`)),
  check("review_reviews_reply_chk", inList("reply_status", REVIEW_REPLY_STATUSES)),
]);

// ── review_usage ─────────────────────────────────────────────────────────────
export const reviewUsageTable = pgTable("review_usage", {
  id:           serial("id").primaryKey(),
  orgId:        orgId(),
  period:       text("period").notNull(),          // YYYY-MM
  channel:      text("channel").notNull(),
  sent:         integer("sent").notNull().default(0),
  delivered:    integer("delivered").notNull().default(0),
  failed:       integer("failed").notNull().default(0),
  /** Coste informado por el proveedor; nulo si no lo informa. Nunca se inventan precios. */
  providerCost: numeric("provider_cost", { precision: 14, scale: 6 }),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("review_usage_org_period_channel_uq").on(t.orgId, t.period, t.channel),
]);

// ── review_settings (una fila por empresa) ───────────────────────────────────
export const reviewSettingsTable = pgTable("review_settings", {
  orgId:           integer("org_id").primaryKey().references(() => organizationsTable.id, { onDelete: "cascade" }),
  timezone:        text("timezone").notNull().default("Europe/Madrid"),
  quietHours:      jsonb("quiet_hours"),                 // { startHour, endHour }
  monthlyContactLimit: integer("monthly_contact_limit"), // null = sin límite propio
  monthlyMessageLimit: integer("monthly_message_limit"),
  maxActiveCampaigns:  integer("max_active_campaigns"),
  retentionMonths: integer("retention_months").notNull().default(24),
  /** Qué acciones de IA requieren aprobación humana. Por defecto: todo. */
  aiApproval:      jsonb("ai_approval").notNull().default(sql`'{"reply_publish":"always_approve","alert_notify":"always_approve"}'::jsonb`),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  check("review_settings_retention_chk", sql`retention_months BETWEEN 1 AND 120`),
]);

export type ReviewLocation = typeof reviewLocationsTable.$inferSelect;
export type ReviewContact = typeof reviewContactsTable.$inferSelect;
export type ReviewCampaign = typeof reviewCampaignsTable.$inferSelect;
export type ReviewMessage = typeof reviewMessagesTable.$inferSelect;
export type ReviewReview = typeof reviewReviewsTable.$inferSelect;
export type ReviewSettings = typeof reviewSettingsTable.$inferSelect;
