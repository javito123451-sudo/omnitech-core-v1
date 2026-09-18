/**
 * Omni Taller — vertical de taller mecánico/automoción.
 *
 * Deliberadamente UNA sola tabla nueva: citas, presupuestos y clientes ya
 * existen en el CRM genérico (appointments, quotes, clients) y se reutilizan
 * tal cual — un "servicio de revisión" es solo un appointment con
 * type="revision"; un presupuesto de reparación es un quote normal. Lo único
 * que el CRM genérico no modela es el vehículo y el avance de una reparación
 * a través de sus fases, así que repair_orders solo añade eso, enlazando
 * opcionalmente a la cita y el presupuesto ya existentes en vez de duplicar
 * ninguno de los dos.
 */

import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";
import { appointmentsTable } from "./appointments";
import { quotesTable } from "./quotes";

export const repairOrdersTable = pgTable("repair_orders", {
  id:               serial("id").primaryKey(),
  orgId:            integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  clientId:         integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  appointmentId:    integer("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  quoteId:          integer("quote_id").references(() => quotesTable.id, { onDelete: "set null" }),

  vehiclePlate:     text("vehicle_plate"),
  vehicleModel:     text("vehicle_model"),
  vehicleMileageKm: integer("vehicle_mileage_km"),

  // revision, itv, cambio_aceite, neumaticos, reparacion, presupuesto, consulta_general
  serviceType:      text("service_type").notNull().default("reparacion"),
  // received -> diagnosing -> quote_sent -> approved -> in_repair -> waiting_parts -> ready -> delivered
  // (o cancelled desde cualquier punto)
  stage:            text("stage").notNull().default("received"),
  notes:            text("notes"),
  deliveredAt:      timestamp("delivered_at"),

  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_repair_orders_org").on(t.orgId),
  index("idx_repair_orders_org_stage").on(t.orgId, t.stage),
]);

export const insertRepairOrderSchema = createInsertSchema(repairOrdersTable).omit({
  id: true, createdAt: true, updatedAt: true, deliveredAt: true,
});
export type RepairOrder = typeof repairOrdersTable.$inferSelect;
export type InsertRepairOrder = z.infer<typeof insertRepairOrderSchema>;

export const SERVICE_TYPES = [
  "revision", "itv", "cambio_aceite", "neumaticos", "reparacion", "presupuesto", "consulta_general",
] as const;

export const REPAIR_STAGES = [
  "received", "diagnosing", "quote_sent", "approved", "in_repair", "waiting_parts", "ready", "delivered", "cancelled",
] as const;
