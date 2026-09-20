// Conocimiento de un agente: reutiliza la tabla knowledge_base existente (no hay
// un segundo sistema de documentos). Toda lectura filtra por la org del agente,
// así que un agente nunca puede usar conocimiento de otro workspace aunque su
// configuración liste ids ajenos.

import { db, knowledgeBaseTable, type AgentConfig } from "@workspace/db";
import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";

const MAX_ENTRIES = 50;

export async function loadKnowledge(orgId: number, cfg: AgentConfig["knowledge"], maxChars = 6000): Promise<string> {
  if (!cfg.workspace && cfg.entryIds.length === 0 && cfg.categories.length === 0) return "";

  const scope: SQL | undefined = cfg.workspace
    ? undefined
    : or(
        cfg.entryIds.length ? inArray(knowledgeBaseTable.id, cfg.entryIds) : undefined,
        cfg.categories.length ? inArray(knowledgeBaseTable.category, cfg.categories) : undefined,
      );

  const rows = await db.select({ title: knowledgeBaseTable.title, content: knowledgeBaseTable.content })
    .from(knowledgeBaseTable)
    .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true), scope))
    .orderBy(asc(knowledgeBaseTable.sortOrder), asc(knowledgeBaseTable.id))
    .limit(MAX_ENTRIES);

  let out = "";
  for (const r of rows) {
    const block = `## ${r.title}\n${r.content}\n\n`;
    if (out.length + block.length > maxChars) { out += block.slice(0, Math.max(0, maxChars - out.length)); break; }
    out += block;
  }
  return out.trim();
}

/** Ids listados en la configuración que NO pertenecen a la org, no existen o están inactivas (loadKnowledge solo lee las activas). */
export async function findUnavailableKnowledgeIds(orgId: number, entryIds: number[]): Promise<number[]> {
  if (entryIds.length === 0) return [];
  const own = await db.select({ id: knowledgeBaseTable.id }).from(knowledgeBaseTable)
    .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true), inArray(knowledgeBaseTable.id, entryIds)));
  const ownIds = new Set(own.map((r) => r.id));
  return entryIds.filter((id) => !ownIds.has(id));
}
