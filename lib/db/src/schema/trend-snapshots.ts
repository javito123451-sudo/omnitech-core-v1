/**
 * Trend Snapshots — Caché de métricas de tendencias externas (TikTok/social)
 *
 * 1 tabla: trend_snapshots — clave/valor con PK simple en `key` (no autoincremental,
 * no multi-tenant: no tiene org_id, es una caché global compartida).
 */

import { pgTable, text, bigint } from "drizzle-orm/pg-core";

export const trendSnapshotsTable = pgTable("trend_snapshots", {
  key:            text("key").primaryKey(),
  ts:             bigint("ts", { mode: "number" }).notNull(),

  viewCount:      bigint("view_count", { mode: "number" }),
  userCount:      bigint("user_count", { mode: "number" }),
  videoCount:     bigint("video_count", { mode: "number" }),
  followerCount:  bigint("follower_count", { mode: "number" }),
});

export type TrendSnapshot = typeof trendSnapshotsTable.$inferSelect;
