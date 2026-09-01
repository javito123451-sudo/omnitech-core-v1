/**
 * OmniTime — Control horario / fichaje de trabajadores
 *
 * 4 tablas:
 *   time_workers      — trabajadores dados de alta para fichaje
 *   time_entries       — fichajes (entrada/salida)
 *   time_incidents      — incidencias detectadas sobre fichajes
 *   time_off_requests  — solicitudes de ausencia/vacaciones
 *
 * NOTA: creadas originalmente vía SQL crudo en startupMigrations.ts.
 * org_id y user_id/reviewed_by NO tienen FK real en producción (verificado),
 * aunque referencian lógicamente organizations.id / users.id. Las FKs entre
 * las propias tablas de time_* (worker_id, entry_id) sí son reales, sin
 * ON DELETE explícito (NO ACTION).
 */

import {
  pgTable, serial, integer, text, numeric, boolean, date, timestamp, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── time_workers ──────────────────────────────────────────────────────────────

export const timeWorkersTable = pgTable("time_workers", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull(),
  userId:      integer("user_id"),

  name:        text("name").notNull(),
  position:    text("position"),
  // NOTA: default sin comillas (`DEFAULT 40`, no `DEFAULT '40'`) para reflejar exactamente
  // el valor de producción (creado vía SQL crudo).
  weeklyHours: numeric("weekly_hours", { precision: 5, scale: 2 }).notNull().default(sql`40`),
  hourlyRate:  numeric("hourly_rate", { precision: 10, scale: 2 }),
  isActive:    boolean("is_active").notNull().default(true),

  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const insertTimeWorkerSchema = createInsertSchema(timeWorkersTable).omit({
  id: true, createdAt: true,
});

export type TimeWorker = typeof timeWorkersTable.$inferSelect;
export type InsertTimeWorker = z.infer<typeof insertTimeWorkerSchema>;

// ── time_entries ──────────────────────────────────────────────────────────────

export const timeEntriesTable = pgTable("time_entries", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull(),
  workerId:         integer("worker_id").notNull().references(() => timeWorkersTable.id),

  clockInAt:        timestamp("clock_in_at").notNull(),
  clockOutAt:       timestamp("clock_out_at"),
  breakMinutes:     integer("break_minutes").notNull().default(0),
  totalMinutes:     integer("total_minutes"),
  overtimeMinutes:  integer("overtime_minutes").notNull().default(0),
  notes:            text("notes"),
  method:           text("method").notNull().default("manual"), // manual, biometric, geo, ai
  status:           text("status").notNull().default("open"),   // open, closed

  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_time_entries_open").on(t.orgId, t.status).where(sql`${t.status} = 'open'`),
  index("idx_time_entries_worker").on(t.orgId, t.workerId, t.clockInAt.desc()),
]);

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({
  id: true, createdAt: true,
});

export type TimeEntry = typeof timeEntriesTable.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

// ── time_incidents ────────────────────────────────────────────────────────────

export const timeIncidentsTable = pgTable("time_incidents", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull(),
  workerId:      integer("worker_id").notNull().references(() => timeWorkersTable.id),
  entryId:       integer("entry_id").references(() => timeEntriesTable.id),

  type:          text("type").notNull(), // missed_clock_out, overtime, late, ...
  severity:      text("severity").notNull().default("low"),
  description:   text("description"),
  autoDetected:  boolean("auto_detected").notNull().default(false),
  resolvedAt:    timestamp("resolved_at"),

  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_time_incidents_open").on(t.orgId, t.resolvedAt).where(sql`${t.resolvedAt} IS NULL`),
]);

export const insertTimeIncidentSchema = createInsertSchema(timeIncidentsTable).omit({
  id: true, createdAt: true,
});

export type TimeIncident = typeof timeIncidentsTable.$inferSelect;
export type InsertTimeIncident = z.infer<typeof insertTimeIncidentSchema>;

// ── time_off_requests ─────────────────────────────────────────────────────────

export const timeOffRequestsTable = pgTable("time_off_requests", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull(),
  workerId:    integer("worker_id").notNull().references(() => timeWorkersTable.id),

  type:        text("type").notNull().default("vacation"), // vacation, sick, personal, ...
  startDate:   date("start_date").notNull(),
  endDate:     date("end_date").notNull(),
  days:        integer("days").notNull().default(1),
  reason:      text("reason"),
  status:      text("status").notNull().default("pending"), // pending, approved, rejected
  reviewedBy:  integer("reviewed_by"),
  reviewedAt:  timestamp("reviewed_at"),

  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_time_off_pending").on(t.orgId, t.status).where(sql`${t.status} = 'pending'`),
]);

export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequestsTable).omit({
  id: true, createdAt: true,
});

export type TimeOffRequest = typeof timeOffRequestsTable.$inferSelect;
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;
