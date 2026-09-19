// ═══════════════════════════════════════════════════════════════════════════
//  Fábrica de Agentes IA — servicio de definiciones y versiones
//
//  Toda función recibe orgId y filtra por él en la consulta: el llamador
//  nunca puede alcanzar un agente de otra organización aunque conozca su id.
//  Una versión con publishedAt != null está congelada y nunca se actualiza.
// ═══════════════════════════════════════════════════════════════════════════

import {
  db, aiAgentsTable, aiAgentVersionsTable, agentConfigSchema, defaultAgentConfig,
  type AiAgent, type AiAgentVersion, type AgentConfig,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { isReadTool } from "./toolClassification";
import { findUnavailableKnowledgeIds } from "./knowledge";
import { PROVIDER_CONFIG } from "../ai-gateway/providerRouter";

export class AgentError extends Error {
  constructor(public readonly status: 404 | 409 | 422, message: string, public readonly problems: string[] = []) {
    super(message);
    this.name = "AgentError";
  }
}

export function readConfig(version: Pick<AiAgentVersion, "config">): AgentConfig {
  return agentConfigSchema.parse({ ...defaultAgentConfig(), ...(version.config as object) });
}

export function validateForPublish(agent: Pick<AiAgent, "name">, config: AgentConfig, knownToolIds: Set<string>): string[] {
  const problems: string[] = [];
  if (!agent.name.trim()) problems.push("El agente necesita un nombre.");
  if (!config.objective.what.trim()) problems.push("Falta el objetivo: qué hace el agente.");
  if (!config.behavior.instructions.trim()) problems.push("Faltan las instrucciones del agente.");

  for (const id of config.tools.read) {
    if (!knownToolIds.has(id)) problems.push(`Herramienta desconocida: ${id}`);
    else if (!isReadTool(id)) problems.push(`'${id}' modifica datos: va en "puede hacer", no en "puede leer".`);
  }
  for (const id of config.tools.write) {
    if (!knownToolIds.has(id)) problems.push(`Herramienta desconocida: ${id}`);
    else if (isReadTool(id)) problems.push(`'${id}' es de solo lectura: va en "puede leer".`);
  }
  const dup = config.tools.read.filter((id) => config.tools.write.includes(id));
  for (const id of new Set(dup)) problems.push(`'${id}' está en lectura y en escritura a la vez.`);

  // Las acciones siempre pasan por confirmación humana en esta fase.
  if (!config.permissions.writesRequireConfirmation) {
    problems.push("Ejecutar acciones sin confirmación humana todavía no está soportado.");
  }
  for (const p of [config.model.provider, ...(config.model.fallbacks ?? []).map((f) => f.provider)]) {
    if (p && !PROVIDER_CONFIG[p]) problems.push(`Proveedor de IA desconocido: ${p}`);
  }
  return problems;
}

async function requireAgent(orgId: number, agentId: number): Promise<AiAgent> {
  const [agent] = await db.select().from(aiAgentsTable)
    .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.orgId, orgId)));
  if (!agent) throw new AgentError(404, "Agente no encontrado.");
  return agent;
}

function assertEditable(agent: AiAgent) {
  if (agent.status === "archived") throw new AgentError(409, "El agente está archivado y no se puede modificar.");
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function listAgents(orgId: number) {
  const agents = await db.select().from(aiAgentsTable)
    .where(eq(aiAgentsTable.orgId, orgId)).orderBy(desc(aiAgentsTable.updatedAt));
  const versions = await db.select({
    id: aiAgentVersionsTable.id, versionNumber: aiAgentVersionsTable.versionNumber,
  }).from(aiAgentVersionsTable).where(eq(aiAgentVersionsTable.orgId, orgId));
  const numberById = new Map(versions.map((v) => [v.id, v.versionNumber]));
  return agents.map((a) => ({ ...a, activeVersionNumber: a.activeVersionId ? numberById.get(a.activeVersionId) ?? null : null }));
}

export async function getAgentDetail(orgId: number, agentId: number) {
  const agent = await requireAgent(orgId, agentId);
  const versions = await db.select().from(aiAgentVersionsTable)
    .where(and(eq(aiAgentVersionsTable.agentId, agentId), eq(aiAgentVersionsTable.orgId, orgId)))
    .orderBy(desc(aiAgentVersionsTable.versionNumber));
  return { agent, versions };
}

// ── Creación y edición ───────────────────────────────────────────────────────

export async function createAgent(orgId: number, userClerkId: string | null, input: {
  name: string; description?: string | null; avatarUrl?: string | null; config?: Partial<AgentConfig>;
}) {
  const config = agentConfigSchema.parse({ ...defaultAgentConfig(), ...input.config });
  return db.transaction(async (tx) => {
    const [agent] = await tx.insert(aiAgentsTable).values({
      orgId, name: input.name, description: input.description ?? null, avatarUrl: input.avatarUrl ?? null,
      createdBy: userClerkId,
    }).returning();
    const [version] = await tx.insert(aiAgentVersionsTable).values({
      agentId: agent!.id, orgId, versionNumber: 1, config, createdBy: userClerkId,
    }).returning();
    return { agent: agent!, version: version! };
  });
}

export async function updateAgentMeta(orgId: number, agentId: number, patch: {
  name?: string; description?: string | null; avatarUrl?: string | null;
  limits?: Record<string, unknown>;
  /** Presupuestos de créditos del agente (NULL = sin tope): mensual, diario y por ejecución. */
  monthlyCreditLimit?: number | null; dailyCreditLimit?: number | null; perExecutionCreditLimit?: number | null;
}) {
  assertEditable(await requireAgent(orgId, agentId));
  const [updated] = await db.update(aiAgentsTable).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.orgId, orgId))).returning();
  return updated!;
}

export async function saveDraft(orgId: number, agentId: number, userClerkId: string | null,
  patch: Partial<AgentConfig>, notes?: string | null) {
  const validPatch = agentConfigSchema.partial().parse(patch);

  return db.transaction(async (tx) => {
    const [agent] = await tx.select().from(aiAgentsTable)
      .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.orgId, orgId))).for("update");
    if (!agent) throw new AgentError(404, "Agente no encontrado.");
    assertEditable(agent);

    const versions = await tx.select().from(aiAgentVersionsTable)
      .where(and(eq(aiAgentVersionsTable.agentId, agentId), eq(aiAgentVersionsTable.orgId, orgId)))
      .orderBy(desc(aiAgentVersionsTable.versionNumber));
    const draft = versions.find((v) => v.publishedAt === null);
    const base = draft ?? versions[0];

    const merged = agentConfigSchema.parse({ ...(base ? readConfig(base) : defaultAgentConfig()), ...validPatch });

    let saved: AiAgentVersion;
    if (draft) {
      [saved] = await tx.update(aiAgentVersionsTable)
        .set({ config: merged, ...(notes !== undefined ? { notes } : {}) })
        .where(and(eq(aiAgentVersionsTable.id, draft.id), isNull(aiAgentVersionsTable.publishedAt))).returning() as [AiAgentVersion];
    } else {
      [saved] = await tx.insert(aiAgentVersionsTable).values({
        agentId, orgId, versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
        config: merged, notes: notes ?? null, createdBy: userClerkId,
      }).returning() as [AiAgentVersion];
    }
    await tx.update(aiAgentsTable).set({ updatedAt: new Date() }).where(eq(aiAgentsTable.id, agentId));
    return saved;
  });
}

export async function restoreVersion(orgId: number, agentId: number, versionId: number, userClerkId: string | null) {
  const { agent, versions } = await getAgentDetail(orgId, agentId);
  assertEditable(agent);
  const source = versions.find((v) => v.id === versionId);
  if (!source) throw new AgentError(404, "Versión no encontrada.");
  // Restaurar nunca toca la versión origen: su contenido pasa al borrador.
  return saveDraft(orgId, agentId, userClerkId, readConfig(source), `Restaurada desde la versión ${source.versionNumber}`);
}

// ── Ejecución ────────────────────────────────────────────────────────────────

export type RunTargetMode = "testing" | "live";

/**
 * Qué versión ejecuta un agente. LIVE solo corre la versión activa de un agente
 * publicado (pausado/archivado/sin publicar → 409). TESTING puede correr un
 * borrador o cualquier versión indicada, pero nunca de un agente archivado.
 */
export async function resolveRunTarget(orgId: number, agentId: number, mode: RunTargetMode, versionId?: number) {
  const { agent, versions } = await getAgentDetail(orgId, agentId);
  if (agent.status === "archived") throw new AgentError(409, "El agente está archivado.");

  if (mode === "live") {
    if (agent.status === "paused") throw new AgentError(409, "El agente está pausado.");
    if (agent.status !== "published" || !agent.activeVersionId) throw new AgentError(409, "El agente no está publicado.");
    const active = versions.find((v) => v.id === agent.activeVersionId);
    if (!active) throw new AgentError(409, "El agente no tiene una versión activa.");
    return { agent, version: active };
  }

  const version = versionId
    ? versions.find((v) => v.id === versionId)
    : versions.find((v) => v.publishedAt === null) ?? versions.find((v) => v.id === agent.activeVersionId) ?? versions[0];
  if (!version) throw new AgentError(404, "Versión no encontrada.");
  return { agent, version };
}

// ── Estado ───────────────────────────────────────────────────────────────────

export async function publishAgent(orgId: number, agentId: number, knownToolIds: Set<string>) {
  return db.transaction(async (tx) => {
    const [agent] = await tx.select().from(aiAgentsTable)
      .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.orgId, orgId))).for("update");
    if (!agent) throw new AgentError(404, "Agente no encontrado.");
    assertEditable(agent);

    const [draft] = await tx.select().from(aiAgentVersionsTable)
      .where(and(eq(aiAgentVersionsTable.agentId, agentId), eq(aiAgentVersionsTable.orgId, orgId), isNull(aiAgentVersionsTable.publishedAt)))
      .orderBy(desc(aiAgentVersionsTable.versionNumber)).limit(1);
    if (!draft) throw new AgentError(409, "No hay ningún borrador que publicar.");

    const draftConfig = readConfig(draft);
    const problems = validateForPublish(agent, draftConfig, knownToolIds);
    const foreign = await findUnavailableKnowledgeIds(orgId, draftConfig.knowledge.entryIds);
    for (const id of foreign) problems.push(`El conocimiento #${id} no existe en este workspace.`);
    if (problems.length > 0) throw new AgentError(422, "El agente no está listo para publicarse.", problems);

    await tx.update(aiAgentVersionsTable).set({ publishedAt: new Date() }).where(eq(aiAgentVersionsTable.id, draft.id));
    const [updated] = await tx.update(aiAgentsTable)
      .set({ status: "published", activeVersionId: draft.id, updatedAt: new Date() })
      .where(eq(aiAgentsTable.id, agentId)).returning();
    return { agent: updated!, publishedVersionNumber: draft.versionNumber };
  });
}

const TRANSITIONS = {
  pause:     { from: ["published"],           to: "paused"    },
  resume:    { from: ["paused"],              to: "published" },
  unpublish: { from: ["published", "paused"], to: "draft"     },
  archive:   { from: ["draft", "published", "paused"], to: "archived" },
} as const;

export type AgentTransition = keyof typeof TRANSITIONS;

export async function transitionAgent(orgId: number, agentId: number, action: AgentTransition) {
  const rule = TRANSITIONS[action];
  const agent = await requireAgent(orgId, agentId);
  if (!(rule.from as readonly string[]).includes(agent.status)) {
    throw new AgentError(409, `No se puede '${action}' un agente en estado '${agent.status}'.`);
  }
  if (action === "resume" && !agent.activeVersionId) {
    throw new AgentError(409, "El agente no tiene versión activa que reanudar.");
  }
  const [updated] = await db.update(aiAgentsTable)
    .set({ status: rule.to, ...(action === "unpublish" ? { activeVersionId: null } : {}), updatedAt: new Date() })
    .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.orgId, orgId))).returning();
  return updated!;
}
