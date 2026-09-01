/**
 * Import Jobs — Importación asistida por IA (CSV/Excel/texto libre → registros)
 *
 * 1 tabla: import_jobs
 *
 * NOTA: creada originalmente vía SQL crudo en startupMigrations.ts.
 * org_id NO tiene FK real en producción (verificado), aunque referencia
 * lógicamente organizations.id.
 */

import {
  pgTable, serial, integer, text, jsonb, timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importJobsTable = pgTable("import_jobs", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull(),
  userClerkId:     text("user_clerk_id"),

  status:          text("status").notNull().default("completed"),
  fileName:        text("file_name"),
  fileType:        text("file_type"),
  detectedType:    text("detected_type"),
  confidencePct:   integer("confidence_pct"),
  rawText:         text("raw_text"),
  extractedData:   jsonb("extracted_data"),
  suggestedDest:   text("suggested_dest"),
  recordsCreated:  integer("records_created").default(0),
  errors:          text("errors"),

  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export const insertImportJobSchema = createInsertSchema(importJobsTable).omit({
  id: true, createdAt: true,
});

export type ImportJob = typeof importJobsTable.$inferSelect;
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;
