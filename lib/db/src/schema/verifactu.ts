/**
 * VeriFactu — Registro de Facturación (Fase 2: módulo de backend completo)
 *
 * Una única tabla nueva. Todo lo demás se reutiliza de entidades existentes:
 *   - invoicesTable / invoiceItemsTable (accounting.ts) — la factura y sus líneas
 *   - clientsTable                      (clients.ts)     — destinatario
 *   - organizationsTable.taxId          (organizations.ts) — NIF emisor
 *   - auditLogsTable + logAudit()       (platform-admin.ts / utils/auditLogger.ts) — auditoría
 *
 * verifactu_records almacena el artefacto de cumplimiento en sí — huella SHA-256
 * encadenada, XML canónico, QR y estado de envío a AEAT — que no tiene equivalente
 * en ninguna tabla existente. Relación 1:1 con invoices (una factura genera como
 * mucho un registro VeriFactu).
 */

import {
  pgTable, serial, integer, text, timestamp, varchar, numeric, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { invoicesTable } from "./accounting";

export const verifactuRecordsTable = pgTable("verifactu_records", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  invoiceId:     integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),

  // Encadenamiento (RRSIF) — huella SHA-256 de este registro y del anterior en la cadena del org
  hash:          varchar("hash", { length: 64 }).notNull(),
  previousHash:  varchar("previous_hash", { length: 64 }),

  // Artefactos generados
  xml:           text("xml").notNull(),
  qrPayload:     text("qr_payload").notNull(),
  qrUrl:         text("qr_url").notNull(),

  // Totales (snapshot en el momento de generar el registro — la factura puede cambiar después, el registro no)
  taxBase:       numeric("tax_base",   { precision: 12, scale: 2 }).notNull(),
  taxAmount:     numeric("tax_amount", { precision: 12, scale: 2 }).notNull(),
  total:         numeric("total",      { precision: 12, scale: 2 }).notNull(),

  // Modo y envío a AEAT
  mode:          varchar("mode", { length: 20 }).notNull().default("no_verifactu"), // verifactu_activo | no_verifactu
  submitted:     text("submitted").notNull().default("false"), // "true"/"false" — evita boolean+null ambiguo en queries de auditoría
  aeatStatus:    varchar("aeat_status", { length: 30 }), // correcto | aceptado_con_errores | rechazado | null (no enviado)
  aeatCsv:       varchar("aeat_csv", { length: 100 }),
  submittedAt:   timestamp("submitted_at"),
  submitError:   text("submit_error"),

  generatedAt:   timestamp("generated_at").notNull().defaultNow(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("verifactu_records_org_id_idx").on(t.orgId),
  index("verifactu_records_invoice_id_idx").on(t.invoiceId),
  index("verifactu_records_generated_at_idx").on(t.generatedAt),
  // Un org solo puede tener un registro VeriFactu por factura — evita cadenas duplicadas por doble click/reintento.
  uniqueIndex("verifactu_records_org_invoice_unique").on(t.orgId, t.invoiceId),
]);

export const insertVerifactuRecordSchema = createInsertSchema(verifactuRecordsTable).omit({
  id: true, createdAt: true,
});

export type VerifactuRecord = typeof verifactuRecordsTable.$inferSelect;
export type InsertVerifactuRecord = z.infer<typeof insertVerifactuRecordSchema>;
