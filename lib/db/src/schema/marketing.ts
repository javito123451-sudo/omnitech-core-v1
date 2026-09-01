/**
 * Marketing — Campañas de email/WhatsApp y su registro de envíos
 *
 * 2 tablas:
 *   marketing_campaigns — campañas de marketing (email/WhatsApp/SMS)
 *   campaign_send_logs  — log por-destinatario de cada envío de campaña
 *
 * NOTA: creadas originalmente vía SQL crudo en startupMigrations.ts.
 * marketing_campaigns.org_id SÍ tiene FK real; campaign_send_logs.org_id y
 * .client_id NO tienen FK real en producción (verificado).
 */

import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// ── marketing_campaigns ──────────────────────────────────────────────────────

export const marketingCampaignsTable = pgTable("marketing_campaigns", {
  id:             serial("id").primaryKey(),
  orgId:          integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  name:           text("name").notNull(),
  status:         text("status").notNull().default("draft"),
  channel:        text("channel").notNull().default("email"), // email, whatsapp, sms
  subject:        text("subject"),
  body:           text("body"),
  audienceFilter: text("audience_filter").notNull().default("all"),

  sentCount:      integer("sent_count").notNull().default(0),
  openedCount:    integer("opened_count").notNull().default(0),
  clickedCount:   integer("clicked_count").notNull().default(0),
  failedCount:    integer("failed_count").default(0),
  sendReport:     text("send_report"),

  createdBy:      text("created_by"),
  scheduledAt:    timestamp("scheduled_at"),
  sentAt:         timestamp("sent_at"),

  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertMarketingCampaignSchema = createInsertSchema(marketingCampaignsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type MarketingCampaign = typeof marketingCampaignsTable.$inferSelect;
export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;

// ── campaign_send_logs ───────────────────────────────────────────────────────

export const campaignSendLogsTable = pgTable("campaign_send_logs", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").notNull().references(() => marketingCampaignsTable.id, { onDelete: "cascade" }),
  // NOTA: sin FK real en producción, aunque referencian lógicamente organizations.id / clients.id
  orgId:            integer("org_id").notNull(),
  clientId:         integer("client_id"),

  clientName:       text("client_name"),
  phoneRaw:         text("phone_raw"),
  phoneNormalized:  text("phone_normalized"),
  status:           text("status").notNull().default("pending"),
  messageId:        text("message_id"),
  errorMessage:     text("error_message"),
  metaHttpStatus:   integer("meta_http_status"),
  metaResponse:     text("meta_response"),

  sentAt:           timestamp("sent_at").default(sql`now()`),
}, (t) => [
  index("idx_csl_campaign").on(t.campaignId),
]);

export type CampaignSendLog = typeof campaignSendLogsTable.$inferSelect;
