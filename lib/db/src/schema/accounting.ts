import {
  pgTable, serial, integer, text, numeric, boolean,
  timestamp, varchar, index, uniqueIndex, jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { quotesTable } from "./quotes";

// ── invoices ──────────────────────────────────────────────────────────────────
export const invoicesTable = pgTable("invoices", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId:      integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  quoteId:       integer("quote_id").references(() => quotesTable.id, { onDelete: "set null" }),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  status:        varchar("status", { length: 30 }).notNull().default("draft"),
  currency:      varchar("currency", { length: 10 }).notNull().default("EUR"),
  subtotal:      numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate:       numeric("tax_rate",  { precision: 5,  scale: 2 }).notNull().default("21"),
  taxAmount:     numeric("tax_amount",{ precision: 12, scale: 2 }).notNull().default("0"),
  total:         numeric("total",     { precision: 12, scale: 2 }).notNull().default("0"),
  notes:               text("notes"),
  dueDate:             timestamp("due_date"),
  paidAt:              timestamp("paid_at"),
  recurringInvoiceId:  integer("recurring_invoice_id"),
  // ── Cobro / pago ──────────────────────────────────────────────────────────
  paymentNotificationPending: boolean("payment_notification_pending").notNull().default(false),
  paymentNotifiedAt:   timestamp("payment_notified_at"),
  paymentReference:    text("payment_reference"),
  // ── Portal cliente (enlace público de consulta) ──────────────────────────
  shareToken:          varchar("share_token", { length: 128 }),
  shareTokenExpiresAt: timestamp("share_token_expires_at"),
  // ── VeriFactu (AEAT) ──────────────────────────────────────────────────────
  verifactuHash:         text("verifactu_hash"),
  verifactuHashAnterior: text("verifactu_hash_anterior"),
  verifactuQrUrl:        text("verifactu_qr_url"),
  verifactuRegisteredAt: timestamp("verifactu_registered_at"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("invoices_org_id_idx").on(t.orgId),
  index("invoices_client_id_idx").on(t.clientId),
  index("invoices_status_idx").on(t.status),
  index("invoices_recurring_invoice_id_idx").on(t.recurringInvoiceId),
  uniqueIndex("invoices_share_token_idx").on(t.shareToken).where(sql`${t.shareToken} IS NOT NULL`),
]);

// ── invoice_items ─────────────────────────────────────────────────────────────
export const invoiceItemsTable = pgTable("invoice_items", {
  id:          serial("id").primaryKey(),
  invoiceId:   integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity:    numeric("quantity",   { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice:   numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  total:       numeric("total",      { precision: 12, scale: 2 }).notNull().default("0"),
  orderIndex:  integer("order_index").notNull().default(0),
}, (t) => [
  index("invoice_items_invoice_id_idx").on(t.invoiceId),
]);

// ── payments ──────────────────────────────────────────────────────────────────
export const paymentsTable = pgTable("accounting_payments", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  clientId:  integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  amount:    numeric("amount",   { precision: 12, scale: 2 }).notNull(),
  currency:  varchar("currency", { length: 10 }).notNull().default("EUR"),
  method:    varchar("method",   { length: 50 }).notNull().default("transfer"),
  reference: varchar("reference",{ length: 200 }),
  notes:     text("notes"),
  paidAt:    timestamp("paid_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("payments_org_id_idx").on(t.orgId),
  index("payments_invoice_id_idx").on(t.invoiceId),
]);

// ── credit_notes ──────────────────────────────────────────────────────────────
export const creditNotesTable = pgTable("credit_notes", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  clientId:  integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  noteNumber:varchar("note_number", { length: 50 }).notNull(),
  amount:    numeric("amount",  { precision: 12, scale: 2 }).notNull(),
  currency:  varchar("currency",{ length: 10 }).notNull().default("EUR"),
  reason:    text("reason"),
  status:    varchar("status",  { length: 30 }).notNull().default("issued"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("credit_notes_org_id_idx").on(t.orgId),
]);

// ── expenses ──────────────────────────────────────────────────────────────────
export const expensesTable = pgTable("expenses", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  category:    varchar("category",   { length: 100 }).notNull().default("general"),
  description: text("description").notNull(),
  amount:      numeric("amount",     { precision: 12, scale: 2 }).notNull(),
  currency:    varchar("currency",   { length: 10 }).notNull().default("EUR"),
  vendor:      varchar("vendor",     { length: 200 }),
  expenseDate: timestamp("expense_date").notNull().defaultNow(),
  receiptUrl:  text("receipt_url"),
  taxDeductible: boolean("tax_deductible").notNull().default(false),
  taxRate:     numeric("tax_rate",   { precision: 5,  scale: 2 }).notNull().default("0"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("expenses_org_id_idx").on(t.orgId),
  index("expenses_category_idx").on(t.category),
]);

// ── recurring_invoices ──────────────────────────────────────────────────────
// Plantillas de facturación recurrente que generan `invoices` periódicamente
// (ver invoices.recurring_invoice_id — sin FK real en producción, solo referencia lógica).
export const recurringInvoicesTable = pgTable("recurring_invoices", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId:      integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  description:   text("description").notNull(),
  frequency:     varchar("frequency", { length: 20 }).notNull().default("monthly"), // monthly, quarterly, annual
  currency:      varchar("currency", { length: 10 }).notNull().default("EUR"),
  // NOTA: default sin comillas (`DEFAULT 21`, no `DEFAULT '21'`) para reflejar exactamente
  // el valor de producción (creado vía SQL crudo).
  taxRate:       numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default(sql`21`),
  items:         jsonb("items").notNull().default([]), // [{ description, quantity, unitPrice }]
  isActive:      boolean("is_active").notNull().default(true),
  sendOnCreate:  boolean("send_on_create").notNull().default(false),
  nextRunAt:     timestamp("next_run_at").notNull(),
  lastRunAt:     timestamp("last_run_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("recurring_invoices_org_id_idx").on(t.orgId),
  index("recurring_invoices_next_run_at_idx").on(t.nextRunAt).where(sql`${t.isActive} = true`),
]);
