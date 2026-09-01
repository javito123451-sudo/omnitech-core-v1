/**
 * OmniAds — Publicidad / Ads Manager
 *
 * 2 tablas:
 *   ads_campaigns  — campañas publicitarias (IA + multi-plataforma)
 *   ads_creatives  — creatividades generadas por campaña
 *
 * NOTA: creadas originalmente vía SQL crudo en startupMigrations.ts.
 * ads_creatives.org_id NO tiene FK real en producción (verificado).
 */

import {
  pgTable, serial, integer, text, numeric, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// ── ads_campaigns ────────────────────────────────────────────────────────────

export const adsCampaignsTable = pgTable("ads_campaigns", {
  id:             serial("id").primaryKey(),
  orgId:          integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  name:           text("name").notNull(),
  status:         text("status").notNull().default("draft"),

  businessName:   text("business_name"),
  businessType:   text("business_type"),
  product:        text("product"),
  targetAudience: text("target_audience"),
  goal:           text("goal"),
  budget:         numeric("budget", { precision: 12, scale: 2 }),

  platforms:      jsonb("platforms").notNull().default([]),
  aiContent:      jsonb("ai_content"),

  // Métricas
  impressions:    integer("impressions").notNull().default(0),
  clicks:         integer("clicks").notNull().default(0),
  leads:          integer("leads").notNull().default(0),
  conversions:    integer("conversions").notNull().default(0),
  // NOTA: default sin comillas (`DEFAULT 0`, no `DEFAULT '0'`) para reflejar exactamente
  // el valor de producción (creado vía SQL crudo).
  roi:            numeric("roi", { precision: 10, scale: 2 }).notNull().default(sql`0`),
  spend:          numeric("spend", { precision: 12, scale: 2 }).notNull().default(sql`0`),

  createdBy:      text("created_by"),
  scheduledAt:    timestamp("scheduled_at"),
  launchedAt:     timestamp("launched_at"),

  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ads_campaigns_org_id_idx").on(t.orgId),
]);

export const insertAdsCampaignSchema = createInsertSchema(adsCampaignsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type AdsCampaign = typeof adsCampaignsTable.$inferSelect;
export type InsertAdsCampaign = z.infer<typeof insertAdsCampaignSchema>;

// ── ads_creatives ─────────────────────────────────────────────────────────────

export const adsCreativesTable = pgTable("ads_creatives", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").notNull().references(() => adsCampaignsTable.id, { onDelete: "cascade" }),
  // NOTA: sin FK real en producción, aunque referencia lógicamente organizations.id
  orgId:            integer("org_id").notNull(),

  type:             text("type").notNull(), // image, video, copy, ...
  platform:         text("platform"),
  title:            text("title"),
  content:          jsonb("content").notNull().default({}),
  status:           text("status").notNull().default("draft"),

  // Generación IA
  generationStatus: text("generation_status").notNull().default("idle"),
  previewUrl:       text("preview_url"),
  downloadUrl:      text("download_url"),
  thumbnail:        text("thumbnail"),
  providerName:     text("provider_name"),
  requestParams:    jsonb("request_params"),
  errorMessage:     text("error_message"),

  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ads_creatives_campaign_id_idx").on(t.campaignId),
  index("ads_creatives_org_id_idx").on(t.orgId),
]);

export const insertAdsCreativeSchema = createInsertSchema(adsCreativesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type AdsCreative = typeof adsCreativesTable.$inferSelect;
export type InsertAdsCreative = z.infer<typeof insertAdsCreativeSchema>;
