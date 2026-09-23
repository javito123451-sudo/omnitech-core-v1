import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { leadContactsTable } from "./leadContacts";
import { missionsTable } from "./missions";

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .default(1)
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  // ── Client (nullable): appointments can belong to a CRM client OR a guest ──
  clientId: integer("client_id")
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  // ── Guest contact info (used when clientId is null — no CRM client created) ──
  guestName: text("guest_name"),
  guestPhone: text("guest_phone"),
  guestEmail: text("guest_email"),
  status: text("status").notNull().default("pending"),
  type: text("type"),
  reminder: boolean("reminder").notNull().default(false),
  tags: text("tags"),
  location: text("location"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // ── OmniSeller Fase 8 — trazabilidad opcional (nullable) hacia el lead que
  // originó la reserva. NUNCA obligatoria: una cita tradicional del CRM (o
  // una de invitado creada fuera de OmniSeller) sigue funcionando exactamente
  // igual con estas dos columnas en null. onDelete "set null" (no "cascade"):
  // borrar el lead_contact o la mission no debe borrar la cita ya creada.
  leadContactId: integer("lead_contact_id")
    .references(() => leadContactsTable.id, { onDelete: "set null" }),
  missionId: integer("mission_id")
    .references(() => missionsTable.id, { onDelete: "set null" }),
}, (t) => [
  index("appointments_lead_contact_id_idx").on(t.leadContactId),
  index("appointments_mission_id_idx").on(t.missionId),
]);

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
