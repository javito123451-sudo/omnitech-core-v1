/**
 * Missions — OmniSeller Fase 1.
 *
 * Una Mission ORQUESTA el trabajo de prospección (objetivo, criterios de
 * búsqueda, presupuesto de créditos, proveedor); NO duplica lead_results.
 * El registro real de cada prospecto sigue viviendo en lead_results
 * (ver lib/db/src/schema/leads.ts). lead_searches.missionId asocia cada
 * búsqueda concreta a la misión que la originó.
 *
 * creditBudget se guarda aquí pero NO se hace cumplir todavía (Fase 1) —
 * la aplicación real de límites de crédito por misión es trabajo de
 * Fase 9 (OmniCredits / tarificación definitiva), una vez medido el coste
 * real de las operaciones. Documentado explícitamente para no simular una
 * protección que hoy no existe.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, numeric, index,
} from "drizzle-orm/pg-core";
import { organizationsTable, usersTable } from "./organizations";

// Valores posibles de status — texto libre (mismo patrón que el resto del
// repo: triggerType/actionType/status en autopilotEngine.ts, status en
// deals, etc.), no un enum de Postgres.
export const MISSION_STATUSES = ["active", "paused", "completed", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const missionsTable = pgTable("missions", {
  id:      serial("id").primaryKey(),
  orgId:   integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  name:      text("name").notNull(),
  objective: text("objective"),
  sector:    text("sector"),
  location:  text("location"),

  // Criterios de búsqueda por defecto para las búsquedas que se lancen dentro
  // de esta misión (ciudad, radio, sector, filtros futuros). Cada búsqueda
  // individual puede seguir pasando sus propios parámetros — esto es solo
  // la plantilla/objetivo de la misión.
  searchCriteria: jsonb("search_criteria"),

  targetProspectCount: integer("target_prospect_count"),
  // Presupuesto de créditos — informativo en Fase 1, no forzado todavía (ver comentario arriba).
  creditBudget: numeric("credit_budget", { precision: 16, scale: 4 }),

  status: text("status").notNull().default("active"),

  ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),

  // Configuración de proveedor(es) de prospección para esta misión (Contact
  // Finder, Fase 3). Vacío hasta que exista un ProspectingProvider real.
  providerConfig: jsonb("provider_config"),

  // Resumen agregado cacheado (opcional). La fuente de verdad sigue siendo
  // lead_searches/lead_results — esto es solo una foto para listados rápidos.
  resultSummary: jsonb("result_summary"),

  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Toda tabla nueva de OmniSeller lleva índice sobre org_id desde el día uno.
  index("missions_org_id_idx").on(t.orgId),
]);

export type Mission = typeof missionsTable.$inferSelect;
export type NewMission = typeof missionsTable.$inferInsert;
