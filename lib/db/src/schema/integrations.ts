import { pgTable, serial, text, boolean, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// ── Catálogo maestro de integraciones disponibles ─────────────────────────────
export const integrationsTable = pgTable("integrations", {
  id:           serial("id").primaryKey(),
  slug:         text("slug").notNull().unique(),
  name:         text("name").notNull(),
  category:     text("category").notNull(),
  authType:     text("auth_type").notNull(),
  description:  text("description"),
  iconSlug:     text("icon_slug"),
  planRequired: text("plan_required").notNull().default("free"),
  isActive:     boolean("is_active").notNull().default(true),
  sortOrder:    integer("sort_order").notNull().default(0),
});

// ── Conexiones activas por organización ───────────────────────────────────────
export const orgIntegrationsTable = pgTable(
  "org_integrations",
  {
    id:              serial("id").primaryKey(),
    orgId:           integer("org_id").notNull()
                       .references(() => organizationsTable.id, { onDelete: "cascade" }),
    integrationSlug: text("integration_slug").notNull(),
    status:          text("status").notNull().default("inactive"),
    config:          text("config"),           // JSON string — campos no sensibles
    credentialsEnc:  text("credentials_enc"),  // AES-256-GCM cifrado
    displayName:     text("display_name"),     // texto legible: email, número, etc.
    externalId:      text("external_id"),
    lastSyncedAt:    timestamp("last_synced_at"),
    expiresAt:       timestamp("expires_at"),
    errorMessage:    text("error_message"),
    createdAt:       timestamp("created_at").defaultNow().notNull(),
    updatedAt:       timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.orgId, t.integrationSlug)],
);

// ── Log de eventos por integración ────────────────────────────────────────────
export const integrationEventsTable = pgTable("integration_events", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull()
                     .references(() => organizationsTable.id, { onDelete: "cascade" }),
  integrationSlug: text("integration_slug").notNull(),
  direction:       text("direction").notNull().default("inbound"),
  eventType:       text("event_type").notNull(),
  status:          text("status").notNull().default("processed"),
  summary:         text("summary"),
  errorMessage:    text("error_message"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type Integration      = typeof integrationsTable.$inferSelect;
export type OrgIntegration   = typeof orgIntegrationsTable.$inferSelect;
export type IntegrationEvent = typeof integrationEventsTable.$inferSelect;
