/**
 * Diagnostics — Informes de salud/diagnóstico del workspace (auditoría IA)
 *
 * 1 tabla: diagnostic_reports
 */

import {
  pgTable, serial, integer, text, varchar, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const diagnosticReportsTable = pgTable("diagnostic_reports", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  runBy:           text("run_by"),
  scope:           varchar("scope", { length: 20 }).notNull().default("workspace"),
  score:           integer("score").notNull().default(0),
  status:          varchar("status", { length: 20 }).notNull().default("healthy"),
  summary:         text("summary"),

  modules:         jsonb("modules").notNull().default([]),
  issues:          jsonb("issues").notNull().default([]),
  recommendations: jsonb("recommendations").notNull().default([]),
  actionsTaken:    jsonb("actions_taken").notNull().default([]),

  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("diagnostic_reports_org_id_idx").on(t.orgId),
  index("diagnostic_reports_created_at_idx").on(t.createdAt.desc()),
]);

export const insertDiagnosticReportSchema = createInsertSchema(diagnosticReportsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type DiagnosticReport = typeof diagnosticReportsTable.$inferSelect;
export type InsertDiagnosticReport = z.infer<typeof insertDiagnosticReportSchema>;
