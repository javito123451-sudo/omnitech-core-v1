/**
 * Omni Fleet — Flota, conductores y rutas de reparto (vertical logística)
 *
 * 4 tablas:
 *   fleet_drivers   — conductores de la flota
 *   fleet_vehicles  — vehículos, ITV y seguro
 *   fleet_routes    — rutas del día, agregados de entregas
 *   fleet_deliveries— paradas/entregas individuales dentro de una ruta
 *
 * La actualización de estado de una entrega llega por webhook desde la app
 * de reparto que ya usan los conductores del cliente (no se construye
 * tracking GPS propio) — ver hub/deliveryProviderRegistry.ts y
 * routes/fleet.ts (fleetWebhookRouter). fleet_deliveries.externalDeliveryId
 * es la clave que usa ese webhook para encontrar la entrega correcta.
 */

import {
  pgTable, serial, integer, text, date, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { clientsTable } from "./clients";

// ── fleet_drivers ─────────────────────────────────────────────────────────────

export const fleetDriversTable = pgTable("fleet_drivers", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId:        integer("user_id"), // opcional: si el conductor también es un usuario de la plataforma

  name:          text("name").notNull(),
  phone:         text("phone"),
  licenseNumber: text("license_number"),
  status:        text("status").notNull().default("available"), // available, on_route, leave, inactive
  notes:         text("notes"),

  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fleet_drivers_org").on(t.orgId),
]);

export const insertFleetDriverSchema = createInsertSchema(fleetDriversTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type FleetDriver = typeof fleetDriversTable.$inferSelect;
export type InsertFleetDriver = z.infer<typeof insertFleetDriverSchema>;

// ── fleet_vehicles ────────────────────────────────────────────────────────────

export const fleetVehiclesTable = pgTable("fleet_vehicles", {
  id:                  serial("id").primaryKey(),
  orgId:               integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  driverId:            integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),

  plate:               text("plate").notNull(),
  model:                text("model"),
  odometerKm:           integer("odometer_km"),
  itvExpiresAt:         date("itv_expires_at"),
  insuranceExpiresAt:   date("insurance_expires_at"),
  status:               text("status").notNull().default("available"), // available, on_route, maintenance, inactive
  notes:                text("notes"),

  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fleet_vehicles_org").on(t.orgId),
  unique("fleet_vehicles_org_plate_unique").on(t.orgId, t.plate),
]);

export const insertFleetVehicleSchema = createInsertSchema(fleetVehiclesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type FleetVehicle = typeof fleetVehiclesTable.$inferSelect;
export type InsertFleetVehicle = z.infer<typeof insertFleetVehicleSchema>;

// ── fleet_routes ──────────────────────────────────────────────────────────────

export const fleetRoutesTable = pgTable("fleet_routes", {
  id:              serial("id").primaryKey(),
  orgId:           integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  driverId:        integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  vehicleId:       integer("vehicle_id").references(() => fleetVehiclesTable.id, { onDelete: "set null" }),

  name:            text("name").notNull(),
  date:            date("date").notNull(),
  status:          text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  // ID que usa la app de reparto externa para esta ruta — permite que un
  // webhook de actualización de ruta (no solo de entrega individual) la
  // encuentre sin depender de nuestro id interno.
  externalRouteId: text("external_route_id"),

  totalStops:      integer("total_stops").notNull().default(0),
  completedStops:  integer("completed_stops").notNull().default(0),
  incidentStops:   integer("incident_stops").notNull().default(0),

  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fleet_routes_org_date").on(t.orgId, t.date),
]);

export const insertFleetRouteSchema = createInsertSchema(fleetRoutesTable).omit({
  id: true, createdAt: true, updatedAt: true, totalStops: true, completedStops: true, incidentStops: true,
});
export type FleetRoute = typeof fleetRoutesTable.$inferSelect;
export type InsertFleetRoute = z.infer<typeof insertFleetRouteSchema>;

// ── fleet_deliveries ──────────────────────────────────────────────────────────

export const fleetDeliveriesTable = pgTable("fleet_deliveries", {
  id:                 serial("id").primaryKey(),
  orgId:              integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  routeId:            integer("route_id").notNull().references(() => fleetRoutesTable.id, { onDelete: "cascade" }),
  clientId:           integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }), // enlace opcional al CRM

  // Clave que usa el adaptador de la app de reparto externa para encontrar
  // esta entrega en las actualizaciones de estado entrantes. Única por
  // organización (no globalmente — dos apps de reparto de clientes distintos
  // podrían coincidir en el mismo ID).
  externalDeliveryId: text("external_delivery_id"),

  address:            text("address"),
  recipientName:      text("recipient_name"),
  recipientPhone:     text("recipient_phone"),
  sequenceOrder:      integer("sequence_order").notNull().default(0),
  status:             text("status").notNull().default("pending"), // pending, en_route, delivered, failed, incident
  statusUpdatedAt:    timestamp("status_updated_at"),
  lastStatusNote:     text("last_status_note"),

  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fleet_deliveries_route").on(t.routeId),
  index("idx_fleet_deliveries_org").on(t.orgId),
  unique("fleet_deliveries_org_external_id_unique").on(t.orgId, t.externalDeliveryId),
]);

export const insertFleetDeliverySchema = createInsertSchema(fleetDeliveriesTable).omit({
  id: true, createdAt: true, updatedAt: true, statusUpdatedAt: true,
});
export type FleetDelivery = typeof fleetDeliveriesTable.$inferSelect;
export type InsertFleetDelivery = z.infer<typeof insertFleetDeliverySchema>;
