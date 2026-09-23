import {
  pgTable, serial, integer, text, timestamp, doublePrecision, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { missionsTable } from "./missions";

export const leadSearchesTable = pgTable("lead_searches", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  createdBy:   integer("created_by"),
  // OmniSeller Fase 1 — opcional: qué Mission orquestó esta búsqueda. NULL para
  // toda búsqueda "suelta" (flujo OmniLeads clásico, sin Mission), y para las
  // búsquedas ya existentes antes de esta columna.
  missionId:   integer("mission_id").references(() => missionsTable.id, { onDelete: "set null" }),
  sector:      text("sector").notNull(),
  city:        text("city").notNull(),
  postalCode:  text("postal_code"),
  radiusKm:    integer("radius_km").notNull().default(20),
  maxResults:  integer("max_results").notNull().default(50),
  status:      text("status").notNull().default("pending"),
  totalFound:  integer("total_found").default(0),
  errorMsg:    text("error_msg"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_searches_org_id_idx").on(t.orgId),
  index("lead_searches_mission_id_idx").on(t.missionId),
]);

export const leadResultsTable = pgTable("lead_results", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  searchId:     integer("search_id").references(() => leadSearchesTable.id, { onDelete: "set null" }),
  createdBy:    integer("created_by"),
  placeId:      text("place_id"),
  name:         text("name").notNull(),
  address:      text("address"),
  phone:        text("phone"),
  website:      text("website"),
  email:        text("email"),
  rating:       doublePrecision("rating"),
  reviewCount:  integer("review_count"),
  lat:          doublePrecision("lat"),
  lng:          doublePrecision("lng"),
  sector:       text("sector"),
  status:       text("status").notNull().default("new"),
  // FK real hacia clients — antes era un integer suelto sin .references().
  // La migración FIX-AV limpia referencias huérfanas y añade la constraint en Postgres.
  crmClientId:  integer("crm_client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_results_org_id_idx").on(t.orgId),
  index("lead_results_search_id_idx").on(t.searchId),
  // Parcial: solo dedupea cuando place_id está presente (Google Places).
  uniqueIndex("lead_results_org_place_id_uidx").on(t.orgId, t.placeId).where(sql`${t.placeId} is not null`),
]);

export const leadAnalysisTable = pgTable("lead_analysis", {
  id:                    serial("id").primaryKey(),
  orgId:                 integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  resultId:              integer("result_id").notNull().references(() => leadResultsTable.id, { onDelete: "cascade" }),
  createdBy:             integer("created_by"),
  hasWebsite:            boolean("has_website"),
  hasHttps:              boolean("has_https"),
  hasForm:               boolean("has_form"),
  hasWhatsapp:           boolean("has_whatsapp"),
  hasFacebook:           boolean("has_facebook"),
  hasInstagram:          boolean("has_instagram"),
  hasGoogleBusiness:     boolean("has_google_business"),
  hasCta:                boolean("has_cta"),
  hasMobileOptimization: boolean("has_mobile_optimization"),
  hasLoadSpeed:          boolean("has_load_speed"),
  hasContactInfo:        boolean("has_contact_info"),
  score:                 integer("score"),
  opportunity:           text("opportunity"),
  improvements:          text("improvements"),
  summary:               text("summary"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_analysis_result_id_idx").on(t.resultId),
]);

// OmniSeller Fase 4 — Outreach. Estados ampliados (además de "draft", que ya
// existía y no cambia de significado): pending_confirmation, approved,
// sending, sent, failed, blocked, suppressed, cancelled. Sigue siendo texto
// libre (mismo patrón que el resto del repo, no un enum de Postgres), así
// que ampliar la lista no requiere migración de datos — ningún mensaje
// existente usa ninguno de estos valores nuevos porque, antes de Fase 4,
// esta tabla no tenía ningún llamador real en producción.
export const LEAD_MESSAGE_STATUSES = [
  "draft", "pending_confirmation", "approved", "sending", "sent", "failed", "blocked", "suppressed", "cancelled",
] as const;
export type LeadMessageStatus = (typeof LEAD_MESSAGE_STATUSES)[number];

export const leadMessagesTable = pgTable("lead_messages", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  resultId:  integer("result_id").notNull().references(() => leadResultsTable.id, { onDelete: "cascade" }),
  createdBy: integer("created_by"),
  channel:   text("channel").notNull().default("email"),
  content:   text("content").notNull(),
  tone:      text("tone"),
  status:    text("status").notNull().default("draft"),
  sentAt:    timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),

  // ── OmniSeller Fase 4 — columnas nuevas, todas nullable (no rompen nada) ──
  // Persona de contacto concreta a la que va dirigido (Contact Finder, Fase
  // 3) — nullable a nivel de esquema por compatibilidad, pero el endpoint de
  // creación de Fase 4 siempre la exige (Mission → Lead → CONTACT → Message).
  // Sin FK real a lead_contacts: leadContacts.ts ya importa de este archivo
  // (leadResultsTable), y una referencia en sentido contrario crearía un
  // import circular entre ambos módulos de esquema. Se deja como entero
  // simple con índice — mismo patrón ya usado en este archivo para otras
  // columnas sueltas (p. ej. created_by), la integridad se garantiza en
  // capa de aplicación (el endpoint de creación verifica el contacto antes
  // de insertar).
  contactId:        integer("contact_id"),
  provider:         text("provider"),           // adapter del Hub que lo envió: "email" | "whatsapp" | "telegram"
  externalMessageId: text("external_message_id"), // id que devuelve el provider real, si lo da
  approvedBy:       integer("approved_by"),      // quién confirmó el envío (puede diferir de created_by)
  approvedAt:       timestamp("approved_at"),
  sendAttemptedAt:  timestamp("send_attempted_at"),
  sendAttempts:     integer("send_attempts").notNull().default(0), // cuenta intentos fallidos — ver outreachGuard.ts exceedsMaxAttempts
  errorMessage:     text("error_message"),
  creditsSpent:     integer("credits_spent"),

  // ── OmniSeller Fase 5 — tracking secundario de delivery, todas nullable ──
  // Eventos de webhook (Resend/WhatsApp) sobre un mensaje YA enviado. "sent"
  // sigue siendo el estado PRINCIPAL de lead_messages.status — estos campos
  // son tracking secundario, deliberadamente NO se convierten en un nuevo
  // valor de LEAD_MESSAGE_STATUSES (que no cambia en esta fase). Ver
  // outreach/webhooks/eventProcessor.ts.
  deliveryStatus: text("delivery_status"), // último label crudo reportado por el proveedor: "delivered"|"bounced"|"complained"|"read"|"failed"|"sent"|... (texto libre, no todos los proveedores usan las mismas palabras)
  deliveredAt:    timestamp("delivered_at"),
  bouncedAt:      timestamp("bounced_at"),
  openedAt:       timestamp("opened_at"),
  clickedAt:      timestamp("clicked_at"),
  lastEventAt:    timestamp("last_event_at"), // se actualiza en CUALQUIER evento de webhook recibido para este mensaje
}, (t) => [
  index("lead_messages_result_id_idx").on(t.resultId),
  index("lead_messages_org_contact_channel_idx").on(t.orgId, t.contactId, t.channel),
]);
