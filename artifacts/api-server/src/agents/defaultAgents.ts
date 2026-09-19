// Agente por defecto de un workspace y, opcionalmente, de un canal concreto.
// Resolución: el del canal, y si no hay, el de "all" (todo el workspace).
//
// Solo PREPARA el concepto. Los bots actuales de Telegram y WhatsApp no
// consultan esto todavía: siguen con su lógica propia hasta que exista una
// sustitución validada (ver legacyAdapter.ts).

import { and, eq } from "drizzle-orm";
import {
  db, aiAgentDefaultsTable, aiAgentsTable, AGENT_CHANNELS, DEFAULT_AGENT_ALL_CHANNELS, type AgentChannel,
} from "@workspace/db";
import { AgentError, getAgentDetail, readConfig } from "./agentService";

export type DefaultKey = AgentChannel | typeof DEFAULT_AGENT_ALL_CHANNELS;

export function isDefaultKey(value: string): value is DefaultKey {
  return value === DEFAULT_AGENT_ALL_CHANNELS || (AGENT_CHANNELS as readonly string[]).includes(value);
}

export async function listDefaults(orgId: number) {
  return db.select().from(aiAgentDefaultsTable).where(eq(aiAgentDefaultsTable.orgId, orgId));
}

/** Solo un agente PUBLICADO de esta org puede ser el de por defecto; para un canal concreto, además debe declarar ese canal. */
export async function setDefaultAgent(orgId: number, key: DefaultKey, agentId: number, userClerkId: string | null) {
  const { agent, versions } = await getAgentDetail(orgId, agentId); // 404 si es de otra org
  if (agent.status !== "published" || !agent.activeVersionId) {
    throw new AgentError(409, "Solo un agente publicado puede ser el agente por defecto.");
  }
  if (key !== DEFAULT_AGENT_ALL_CHANNELS) {
    const active = versions.find((v) => v.id === agent.activeVersionId);
    if (!active || !readConfig(active).channels.includes(key)) {
      throw new AgentError(422, `El agente no tiene habilitado el canal '${key}'.`);
    }
  }
  const [row] = await db.insert(aiAgentDefaultsTable)
    .values({ orgId, channel: key, agentId, updatedBy: userClerkId })
    .onConflictDoUpdate({
      target: [aiAgentDefaultsTable.orgId, aiAgentDefaultsTable.channel],
      set: { agentId, updatedBy: userClerkId, updatedAt: new Date() },
    }).returning();
  return row!;
}

export async function clearDefaultAgent(orgId: number, key: DefaultKey): Promise<boolean> {
  const removed = await db.delete(aiAgentDefaultsTable)
    .where(and(eq(aiAgentDefaultsTable.orgId, orgId), eq(aiAgentDefaultsTable.channel, key))).returning({ id: aiAgentDefaultsTable.id });
  return removed.length > 0;
}

/** El agente por defecto vigente para un canal (solo si sigue publicado), o null. */
export async function resolveDefaultAgent(orgId: number, channel: AgentChannel) {
  for (const key of [channel, DEFAULT_AGENT_ALL_CHANNELS]) {
    const [row] = await db.select({ agentId: aiAgentDefaultsTable.agentId, status: aiAgentsTable.status })
      .from(aiAgentDefaultsTable)
      .innerJoin(aiAgentsTable, eq(aiAgentsTable.id, aiAgentDefaultsTable.agentId))
      .where(and(eq(aiAgentDefaultsTable.orgId, orgId), eq(aiAgentDefaultsTable.channel, key), eq(aiAgentsTable.orgId, orgId)));
    if (row && row.status === "published") return { agentId: row.agentId, resolvedFrom: key };
  }
  return null;
}
