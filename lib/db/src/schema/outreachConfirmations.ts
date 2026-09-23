/**
 * outreach_confirmations — OmniSeller Fase 4.
 *
 * Confirmación humana de un envío de Outreach concreto. Mismo patrón exacto
 * que ai_agent_proposals (Agent Factory, ver lib/db/src/schema/ai-agent-runtime.ts
 * y artifacts/api-server/src/agents/proposalStore.ts): token de 256 bits
 * entregado una sola vez al usuario, en la base de datos solo se guarda su
 * hash SHA-256; consumo ATÓMICO (un UPDATE condicional: status=pending, no
 * caducado, misma organización, mismo lead_message) — dos confirmaciones
 * simultáneas con el mismo token: solo una se queda la fila.
 *
 * Deliberadamente NO se reutiliza ai_agent_proposals tal cual — esa tabla
 * está atada a (agent_id, agent_version_id, tool_id, args) y a que el mismo
 * usuario que disparó el run sea quien confirma; forzar un envío de
 * Outreach a parecer una "propuesta de herramienta de un agente" mezclaría
 * dos dominios sin necesidad. Aquí la tabla está atada a `lead_message_id`
 * (el propio mensaje ya contiene todo lo que hay que confirmar: canal,
 * contenido, contacto) y el consumo NO exige que sea el mismo usuario que
 * pidió la confirmación — cualquier usuario autorizado (omniseller.write)
 * de la organización puede aprobar un borrador de otro compañero, como en
 * un flujo de revisión de equipo real; queda registrado quién lo aprobó.
 */
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const outreachConfirmationsTable = pgTable("outreach_confirmations", {
  id:            serial("id").primaryKey(),
  tokenHash:     text("token_hash").notNull().unique(),
  orgId:         integer("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  // Sin FK real a lead_messages por el mismo motivo que lead_messages.contact_id
  // no referencia lead_contacts — evitar un import circular de esquema
  // (leads.ts ya no puede importar de un archivo que a su vez lo importe a
  // él). Integridad garantizada en aplicación (outreachService.ts siempre
  // resuelve el lead_message por org_id antes de usar esta fila).
  leadMessageId: integer("lead_message_id").notNull(),
  createdBy:     integer("created_by").notNull(), // quién solicitó la confirmación
  status:        text("status").notNull().default("pending"), // pending | consumed | expired
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  expiresAt:     timestamp("expires_at").notNull(),
  consumedAt:    timestamp("consumed_at"),
  consumedBy:    integer("consumed_by"), // quién aprobó realmente — puede diferir de created_by
}, (t) => [
  index("outreach_confirmations_org_idx").on(t.orgId, t.createdAt),
  index("outreach_confirmations_message_idx").on(t.leadMessageId),
  index("outreach_confirmations_expires_idx").on(t.status, t.expiresAt),
]);

export type OutreachConfirmation = typeof outreachConfirmationsTable.$inferSelect;
