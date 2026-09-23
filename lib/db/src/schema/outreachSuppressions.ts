/**
 * outreach_suppressions — OmniSeller Fase 4.
 *
 * Lista de supresión FORMAL para Outreach — deliberadamente NO se apoya
 * únicamente en clients.commercial_status = 'no_contactar' (esa columna es
 * un estado comercial de una ficha de cliente CRM ya existente; no cubre
 * bounces, quejas ni bloqueos legales de contactos que ni siquiera son
 * clientes todavía — que es exactamente el caso de un lead_contact recién
 * encontrado por Contact Finder). No existía ninguna entidad equivalente en
 * el repo (comprobado antes de crear esta tabla).
 *
 * Cada fila es un registro de POR QUÉ no se puede contactar a un
 * email/teléfono — es un log append-only de eventos de supresión, no un
 * "perfil" por contacto; puede haber varias filas para el mismo destino con
 * distintos motivos/fuentes a lo largo del tiempo. La comprobación
 * (outreach/outreachGuard.ts → isSuppressed) es "¿existe ALGUNA fila que
 * coincida?", no una fila única por destino.
 *
 * `channel` nulo significa "aplica a todos los canales" (p. ej. un
 * "no_contactar" legal); con un canal concreto solo bloquea ese canal (p.
 * ej. un bounce de email no debería bloquear WhatsApp).
 */
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const OUTREACH_SUPPRESSION_REASONS = [
  "opt_out", "no_contactar", "bounced", "complaint", "manual_block", "legal_block",
] as const;
export type OutreachSuppressionReason = (typeof OUTREACH_SUPPRESSION_REASONS)[number];

export const outreachSuppressionsTable = pgTable("outreach_suppressions", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  // Al menos uno de los dos debe venir informado — se valida en aplicación,
  // no con un CHECK de Postgres (mismo criterio que el resto del repo: sin
  // constraints exóticas si una validación de aplicación basta).
  email: text("email"),
  phone: text("phone"),

  // null = todos los canales. "email" | "whatsapp" | "telegram" = solo ese.
  channel: text("channel"),

  reason:    text("reason").notNull(), // ver OUTREACH_SUPPRESSION_REASONS
  source:    text("source"),           // libre: "manual" | "client_request" | ... (bounce/complaint automáticos son Fase 5+, webhooks todavía no implementados)
  createdBy: integer("created_by"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("outreach_suppressions_org_idx").on(t.orgId),
  index("outreach_suppressions_org_email_idx").on(t.orgId, t.email),
  index("outreach_suppressions_org_phone_idx").on(t.orgId, t.phone),
]);

export type OutreachSuppression = typeof outreachSuppressionsTable.$inferSelect;
export type NewOutreachSuppression = typeof outreachSuppressionsTable.$inferInsert;
