/**
 * Fábrica de Agentes IA — estado de ejecución LIVE que debe sobrevivir a reinicios y a varias instancias.
 *
 *  - ai_agent_proposals: propuestas de acción del agente pendientes de confirmación humana. Reemplaza al almacén en
 *    memoria: el token nunca se guarda (solo su hash SHA-256), y se consume con un UPDATE condicional atómico.
 *
 *  - ai_agent_run_requests: una fila por ejecución de /run. Sirve para tres cosas a la vez: la idempotencia
 *    (Idempotency-Key ligado a org + usuario + agente + modo, guardado como hash), el resultado que se devuelve al
 *    reintentar, y el conteo del límite de uso por usuario y por workspace.
 *
 * Los valores de un Idempotency-Key y los tokens de confirmación NO se guardan en claro.
 */

import { pgTable, serial, integer, text, timestamp, jsonb, boolean, uuid, unique, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { aiAgentsTable } from "./ai-agents";

export const PROPOSAL_STATUSES = ["pending", "consumed", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const aiAgentProposalsTable = pgTable("ai_agent_proposals", {
  id:             serial("id").primaryKey(),
  /** SHA-256 (hex) del token que se entrega al usuario. El token en claro no se almacena. */
  tokenHash:      text("token_hash").notNull().unique(),
  orgId:          integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId:         integer("user_id").notNull(),
  agentId:        integer("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  agentVersionId: integer("agent_version_id").notNull(),
  toolId:         text("tool_id").notNull(),
  /** Parámetros que propuso el modelo; el cliente no puede cambiarlos al confirmar. */
  args:           jsonb("args").notNull().default({}),
  /** true = propuesta de una prueba (testing): nunca se ejecuta. */
  testOnly:       boolean("test_only").notNull().default(false),
  /** Ejecución (ai_agent_run_requests.run_id) que la generó, para trazabilidad. */
  runId:          uuid("run_id"),
  status:         text("status").notNull().default("pending"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  expiresAt:      timestamp("expires_at").notNull(),
  consumedAt:     timestamp("consumed_at"),
}, (t) => [
  index("idx_ai_agent_proposals_org").on(t.orgId, t.createdAt),
  index("idx_ai_agent_proposals_expires").on(t.status, t.expiresAt),
]);

export const RUN_REQUEST_STATUSES = ["in_progress", "completed", "failed"] as const;
export type RunRequestStatus = (typeof RUN_REQUEST_STATUSES)[number];

export const aiAgentRunRequestsTable = pgTable("ai_agent_run_requests", {
  id:                serial("id").primaryKey(),
  /** Identidad INTERNA de la ejecución (la genera el servidor; nunca la envía el cliente). */
  runId:             uuid("run_id").notNull().unique(),
  orgId:             integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId:            integer("user_id").notNull(),
  agentId:           integer("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  mode:              text("mode").notNull(),
  /** SHA-256 (hex) del Idempotency-Key del cliente. NULL = la petición no lo envió (sin idempotencia). */
  idempotencyKeyHash: text("idempotency_key_hash"),
  /** SHA-256 (hex) del contenido de la petición: la misma clave con otro contenido es un conflicto. */
  requestHash:       text("request_hash").notNull(),
  status:            text("status").notNull().default("in_progress"),
  httpStatus:        integer("http_status"),
  /** Resultado que se repite al reintentar (solo si terminó con un resultado determinista). */
  response:          jsonb("response"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  completedAt:       timestamp("completed_at"),
}, (t) => [
  // Un mismo Idempotency-Key solo puede existir una vez por org + usuario + agente + modo. Las filas sin clave (NULL) no chocan.
  unique("ai_agent_run_requests_idem_unique").on(t.orgId, t.userId, t.agentId, t.mode, t.idempotencyKeyHash),
  index("idx_ai_agent_run_requests_org_time").on(t.orgId, t.mode, t.createdAt),
  index("idx_ai_agent_run_requests_user_time").on(t.userId, t.mode, t.createdAt),
]);

export type AiAgentProposal = typeof aiAgentProposalsTable.$inferSelect;
export type AiAgentRunRequest = typeof aiAgentRunRequestsTable.$inferSelect;
