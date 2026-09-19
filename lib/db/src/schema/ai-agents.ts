/**
 * Fábrica de Agentes IA — modelo de datos.
 *
 * Dos tablas, deliberadamente:
 *
 *  - ai_agents: lo que NO cambia de versión a versión — identidad, estado,
 *    workspace, cuál es la versión activa y los topes operativos (límites y
 *    créditos). Cambiar un tope no debería obligar a publicar una versión.
 *
 *  - ai_agent_versions: todo el comportamiento (instrucciones, modelo/proveedor,
 *    herramientas, permisos, canales) en un JSON validado. Una versión con
 *    published_at != NULL está congelada: nunca se modifica, solo se crean
 *    versiones nuevas. Así lo que corre en producción no puede cambiar en
 *    silencio mientras alguien edita.
 *
 * Los estados son solo draft/published/paused/archived. SIMULATION y TESTING
 * no son estados persistentes: son modos de ejecución sobre una versión.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, unique, index, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const AGENT_STATUSES = ["draft", "published", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_CHANNELS = ["web", "whatsapp", "telegram", "email"] as const;

export const aiAgentsTable = pgTable("ai_agents", {
  id:                 serial("id").primaryKey(),
  orgId:              integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),

  name:               text("name").notNull(),
  description:        text("description"),
  avatarUrl:          text("avatar_url"),

  status:             text("status").notNull().default("draft"),
  activeVersionId:    integer("active_version_id").references((): AnyPgColumn => aiAgentVersionsTable.id, { onDelete: "set null" }),

  // Topes operativos, independientes de la versión. NULL = sin tope.
  limits:             jsonb("limits").notNull().default({}),
  monthlyCreditLimit: integer("monthly_credit_limit"),

  createdBy:          text("created_by"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_agents_org").on(t.orgId),
  index("idx_ai_agents_org_status").on(t.orgId, t.status),
]);

export const aiAgentVersionsTable = pgTable("ai_agent_versions", {
  id:            serial("id").primaryKey(),
  agentId:       integer("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  // Redundante con agents.org_id a propósito: toda consulta filtra por org sin
  // depender de un JOIN que alguien podría olvidar.
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),

  config:        jsonb("config").notNull().default({}),
  notes:         text("notes"),

  // NULL = borrador editable. NOT NULL = congelada (inmutable).
  publishedAt:   timestamp("published_at"),
  createdBy:     text("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("ai_agent_versions_agent_number_unique").on(t.agentId, t.versionNumber),
  index("idx_ai_agent_versions_agent").on(t.agentId),
  index("idx_ai_agent_versions_org").on(t.orgId),
]);

export type AiAgent        = typeof aiAgentsTable.$inferSelect;
export type AiAgentVersion = typeof aiAgentVersionsTable.$inferSelect;

// ── Configuración de una versión ─────────────────────────────────────────────

export const agentConfigSchema = z.object({
  objective: z.object({
    what:            z.string(),
    audience:        z.string(),
    expectedOutcome: z.string(),
  }),
  personality: z.object({
    tone:      z.string(),
    style:     z.string(),
    language:  z.string(),
    formality: z.string(),
  }),
  behavior: z.object({
    instructions: z.string(),
    rules:        z.array(z.string()),
    restrictions: z.array(z.string()),
    avoid:        z.array(z.string()),
  }),
  businessContext: z.string(),
  // routing por complejidad queda para más adelante; hoy el modelo es fijo.
  model: z.object({
    provider: z.string().optional(),
    model:    z.string().optional(),
  }),
  // "Puede leer" y "puede hacer" son listas separadas: que una herramienta
  // exista no da permiso de escritura.
  tools: z.object({
    read:  z.array(z.string()),
    write: z.array(z.string()),
  }),
  permissions: z.object({
    writesRequireConfirmation: z.boolean(),
  }),
  channels: z.array(z.enum(AGENT_CHANNELS)),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function defaultAgentConfig(): AgentConfig {
  return {
    objective:   { what: "", audience: "", expectedOutcome: "" },
    personality: { tone: "cercano y profesional", style: "claro y conciso", language: "es", formality: "medio" },
    behavior:    { instructions: "", rules: [], restrictions: [], avoid: [] },
    businessContext: "",
    model:       {},
    tools:       { read: [], write: [] },
    permissions: { writesRequireConfirmation: true },
    channels:    [],
  };
}
