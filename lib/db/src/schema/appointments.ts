import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

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
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
