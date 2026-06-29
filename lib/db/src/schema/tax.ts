/**
 * OmniTax — Fiscal Schema
 *
 * 5 tablas:
 *   tax_obligations    — obligaciones fiscales del workspace
 *   tax_calculations   — cálculos trimestrales/anuales (IVA, IRPF, Renta)
 *   tax_documents      — documentación fiscal adjunta
 *   tax_reminders      — recordatorios configurables
 *   tax_health_score   — puntuación fiscal histórica
 */

import {
  pgTable, serial, integer, text, real, timestamp, boolean, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./organizations";

// ── tax_obligations ──────────────────────────────────────────────────────────────────────────────

export const taxObligationsTable = pgTable("tax_obligations", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  // Descripción
  name:        text("name").notNull(),
  description: text("description"),
  taxType:     text("tax_type").notNull(), // iva, irpf, renta, modelo_130, modelo_303, modelo_349

  // Periodicidad
  period:      text("period").notNull().default("quarterly"), // monthly, quarterly, annual, one_time
  month:       integer("month"), // 1-12 (si aplica)
  quarter:     integer("quarter"), // 1-4 (si aplica)
  year:        integer("year").notNull(),

  // Fechas
  dueDate:     timestamp("due_date").notNull(),
  completedAt: timestamp("completed_at"),

  // Estado
  status:      text("status").notNull().default("pending"), // pending, preparing, ready, filed, not_applicable

  // Meta
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("tax_obligations_org_id_idx").on(t.orgId),
  index("tax_obligations_status_idx").on(t.status),
  index("tax_obligations_due_date_idx").on(t.dueDate),
]);

export const insertTaxObligationSchema = createInsertSchema(taxObligationsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type TaxObligation = typeof taxObligationsTable.$inferSelect;
export type InsertTaxObligation = z.infer<typeof insertTaxObligationSchema>;

// ── tax_calculations ─────────────────────────────────────────────────────────────────────────────

export const taxCalculationsTable = pgTable("tax_calculations", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  // Período
  taxType:         text("tax_type").notNull(), // iva, irpf, renta
  year:            integer("year").notNull(),
  quarter:         integer("quarter"), // null para anual
  month:           integer("month"), // null para trimestral/anual

  // Datos de entrada (auto-calculados desde facturación)
  totalIncome:     real("total_income").notNull().default(0),
  totalExpenses:   real("total_expenses").notNull().default(0),

  // IVA
  ivaRepercutido:  real("iva_repercutido").notNull().default(0),
  ivaSoportado:    real("iva_soportado").notNull().default(0),
  ivaResultado:    real("iva_resultado").notNull().default(0),

  // IRPF
  irpfRetenciones: real("irpf_retenciones").notNull().default(0),
  irpfBase:        real("irpf_base").notNull().default(0),
  irpfEstimate:    real("irpf_estimate").notNull().default(0),

  // Renta
  rentaBeneficio:  real("renta_beneficio").notNull().default(0),
  rentaBase:       real("renta_base").notNull().default(0),
  rentaEstimate:   real("renta_estimate").notNull().default(0),

  // Meta
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("tax_calculations_org_id_idx").on(t.orgId),
  index("tax_calculations_type_period_idx").on(t.taxType, t.year, t.quarter),
]);

export const insertTaxCalculationSchema = createInsertSchema(taxCalculationsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type TaxCalculation = typeof taxCalculationsTable.$inferSelect;
export type InsertTaxCalculation = z.infer<typeof insertTaxCalculationSchema>;

// ── tax_documents ────────────────────────────────────────────────────────────────────────────────────

export const taxDocumentsTable = pgTable("tax_documents", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  name:        text("name").notNull(),
  fileType:    text("file_type").notNull(), // pdf, excel, csv, image
  fileUrl:     text("file_url"),            // path en object storage
  fileSize:    integer("file_size"),        // bytes

  // Clasificación
  category:    text("category").notNull().default("other"), // invoice, expense, bank_statement, tax_form, receipt, other
  fiscalYear:  integer("fiscal_year"),
  quarter:     integer("quarter"),

  // OCR / IA
  ocrText:     text("ocr_text"),            // texto extraído por OCR
  aiCategory:  text("ai_category"),         // categoría sugerida por IA
  aiConfidence: real("ai_confidence"),        // 0-1

  // Estado
  status:      text("status").notNull().default("pending"), // pending, classified, verified, archived

  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("tax_documents_org_id_idx").on(t.orgId),
  index("tax_documents_category_idx").on(t.category),
  index("tax_documents_status_idx").on(t.status),
]);

export const insertTaxDocumentSchema = createInsertSchema(taxDocumentsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type TaxDocument = typeof taxDocumentsTable.$inferSelect;
export type InsertTaxDocument = z.infer<typeof insertTaxDocumentSchema>;

// ── tax_reminders ────────────────────────────────────────────────────────────────────────────────────────────

export const taxRemindersTable = pgTable("tax_reminders", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  // Enlace a obligación (opcional)
  obligationId: integer("obligation_id").references(() => taxObligationsTable.id, { onDelete: "cascade" }),

  // Configuración
  title:       text("title").notNull(),
  message:     text("message"),
  remindAt:    timestamp("remind_at").notNull(),

  // Canales
  notifyEmail:    boolean("notify_email").notNull().default(true),
  notifyWhatsApp: boolean("notify_whatsapp").notNull().default(false),
  notifyTelegram: boolean("notify_telegram").notNull().default(false),
  notifyInApp:    boolean("notify_in_app").notNull().default(true),

  // Estado
  sentAt:      timestamp("sent_at"),
  dismissedAt: timestamp("dismissed_at"),

  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("tax_reminders_org_id_idx").on(t.orgId),
  index("tax_reminders_remind_at_idx").on(t.remindAt),
  index("tax_reminders_sent_at_idx").on(t.sentAt),
]);

export const insertTaxReminderSchema = createInsertSchema(taxRemindersTable).omit({
  id: true, createdAt: true,
});

export type TaxReminder = typeof taxRemindersTable.$inferSelect;
export type InsertTaxReminder = z.infer<typeof insertTaxReminderSchema>;

// ── tax_health_score ─────────────────────────────────────────────────────────────────────────────────────

export const taxHealthScoreTable = pgTable("tax_health_score", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  score:           integer("score").notNull(), // 0-100

  // Dimensiones del score
  complianceScore: integer("compliance_score").notNull().default(0),   // obligaciones cumplidas
  accuracyScore:   integer("accuracy_score").notNull().default(0),     // precisión cálculos
  documentScore:   integer("document_score").notNull().default(0),     // documentación completa
  timelinessScore: integer("timeliness_score").notNull().default(0),   // puntualidad

  // Recomendaciones serializadas
  recommendations: text("recommendations"), // JSON array de strings

  // Snapshot de datos
  snapshot:        text("snapshot"),       // JSON con KPIs del momento

  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("tax_health_score_org_id_idx").on(t.orgId),
  index("tax_health_score_created_idx").on(t.createdAt),
]);

export const insertTaxHealthScoreSchema = createInsertSchema(taxHealthScoreTable).omit({
  id: true, createdAt: true,
});

export type TaxHealthScore = typeof taxHealthScoreTable.$inferSelect;
export type InsertTaxHealthScore = z.infer<typeof insertTaxHealthScoreSchema>;
