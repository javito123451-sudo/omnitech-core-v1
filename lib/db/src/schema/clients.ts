import { pgTable, serial, text, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .default(1)
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  status: text("status").notNull().default("lead"),
  tags: text("tags"),
  notes: text("notes"),
  value: real("value"),
  telegramChatId: text("telegram_chat_id"),
  leadScore: text("lead_score").default("cold"),
  leadIntent: text("lead_intent"),
  // ── Security / assignment fields (nullable for backward compat) ───────────
  assignedAdminId:   integer("assigned_admin_id"),     // admin responsible
  assignedSellerId:  integer("assigned_seller_id"),    // vendedor assigned
  assignedBy:        integer("assigned_by"),           // who assigned this client

  // ── Ficha comercial ampliada (todas nullable — no rompen clientes viejos) ──
  // Estado comercial extensible (prospecto/contactado/sin_respuesta/interesado/
  // reunion_pendiente/propuesta_enviada/negociacion/cliente/perdido/no_contactar).
  // Texto libre a propósito (no pgEnum) para poder ampliar la lista sin migrar.
  // NO sustituye a `status` (legado, usado por /my-leads /my-customers) — es un
  // campo nuevo y paralelo; para clientes viejos con commercialStatus=NULL, la
  // UI deriva un valor de solo-lectura a partir de `status`.
  commercialStatus:  text("commercial_status"),

  // Datos de empresa
  sector:            text("sector"),
  contactPerson:     text("contact_person"),
  companyPhone:      text("company_phone"),
  companyEmail:      text("company_email"),
  instagram:         text("instagram"),
  website:           text("website"),
  location:          text("location"),

  // Prospección
  firstContactAt:    timestamp("first_contact_at"),
  dolorPrincipal:    text("dolor_principal"),
  recursoEnviado:    text("recurso_enviado"),
  fuenteLead:        text("fuente_lead"),

  // Seguimiento
  followup1At:       timestamp("followup1_at"),
  followup2At:       timestamp("followup2_at"),
  followup3At:       timestamp("followup3_at"),
  nextFollowupAt:    timestamp("next_followup_at"),
  lastContactAt:     timestamp("last_contact_at"),
  attemptCount:      integer("attempt_count").notNull().default(0),
  preferredChannel:  text("preferred_channel"), // "whatsapp" | "telegram" | "email"

  // Resultado
  resultado:         text("resultado"),
  nextAction:        text("next_action"),
  priority:          text("priority").notNull().default("medium"), // low|medium|high|urgent
  observaciones:     text("observaciones"),

  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
