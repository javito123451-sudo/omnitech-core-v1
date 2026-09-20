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
import { getAgentTool } from "./toolRegistry";
import { findUnavailableKnowledgeIds } from "./knowledge";
import { PROVIDER_CONFIG } from "../ai-gateway/providerRouter";
import { loadModelCatalog, type ModelCatalog } from "./catalogService";
import {
  dedupeProblems, modelNeedsValidation, problemMessages, validateModelForPublish, type PublishProblem,
} from "./publishValidation";

export class AgentError extends Error {
  /** `problems` son los textos (contrato histórico); `details` los mismos problemas con campo y código, para la UI. */
  constructor(public readonly status: 404 | 409 | 422, message: string, public readonly problems: string[] = [], public readonly details: PublishProblem[] = []) {
    super(message);
    this.name = "AgentError";
  }
}

export function readConfig(version: Pick<AiAgentVersion, "config">): AgentConfig {
  return agentConfigSchema.parse({ ...defaultAgentConfig(), ...(version.config as object) });
}

/**
 * Comprobaciones SÍNCRONAS de publicación (nombre, objetivo, instrucciones, herramientas y confirmación), con campo y código.
 * Las herramientas se validan contra el registro real (TOOL_REGISTRY ∩ Skill Engine): permiso, módulo y tipo salen SIEMPRE
 * del registro, la configuración solo guarda ids, así que ni el cliente ni la versión pueden cambiarlos. El modelo y el
 * proveedor se validan aparte (validateModelForPublish) porque necesitan el catálogo real.
 */
export function validateForPublishDetailed(agent: Pick<AiAgent, "name">, config: AgentConfig, knownToolIds: Set<string>): PublishProblem[] {
  const problems: PublishProblem[] = [];
  const add = (field: string, code: PublishProblem["code"], message: string) => problems.push({ field, code, message });

  if (!agent.name.trim()) add("name", "MISSING_NAME", "El agente necesita un nombre.");
  if (!config.objective.what.trim()) add("config.objective.what", "MISSING_OBJECTIVE", "Falta el objetivo: qué hace el agente.");
  if (!config.behavior.instructions.trim()) add("config.behavior.instructions", "MISSING_INSTRUCTIONS", "Faltan las instrucciones del agente.");

  const exists = (id: string) => knownToolIds.has(id) && getAgentTool(id) !== undefined;
  for (const id of config.tools.read) {
    if (!exists(id)) add("config.tools.read", "UNKNOWN_TOOL", `Herramienta desconocida: ${id}`);
    else if (!isReadTool(id)) add("config.tools.read", "TOOL_KIND_MISMATCH", `'${id}' modifica datos: va en "puede hacer", no en "puede leer".`);
  }
  for (const id of config.tools.write) {
    if (!exists(id)) add("config.tools.write", "UNKNOWN_TOOL", `Herramienta desconocida: ${id}`);
    else if (isReadTool(id)) add("config.tools.write", "TOOL_KIND_MISMATCH", `'${id}' es de solo lectura: va en "puede leer".`);
  }
  const dup = config.tools.read.filter((id) => config.tools.write.includes(id));
  for (const id of new Set(dup)) add("config.tools", "DUPLICATE_TOOL", `'${id}' está en lectura y en escritura a la vez.`);

  // Las acciones siempre pasan por confirmación humana en esta fase.
  if (!config.permissions.writesRequireConfirmation) {
    add("config.permissions.writesRequireConfirmation", "CONFIRMATION_REQUIRED", "Ejecutar acciones sin confirmación humana todavía no está soportado.");
  }
  // Un proveedor que ni siquiera existe se detecta sin catálogo; los no implementados o sin clave y los modelos, con él.
  const providerFields: Array<[string | undefined, string]> = [
    [config.model.provider, "config.model.provider"],
    ...(config.model.fallbacks ?? []).map((f, i): [string | undefined, string] => [f.provider, `config.model.fallbacks[${i}].provider`]),
  ];
  for (const [p, field] of providerFields) {
    if (p && !PROVIDER_CONFIG[p]) add(field, "UNKNOWN_PROVIDER", `Proveedor de IA desconocido: ${p}`);
  }
  return problems;
}

/** Mismos problemas que validateForPublishDetailed, solo los textos (contrato histórico de los tests y de la API). */
export function validateForPublish(agent: Pick<AiAgent, "name">, config: AgentConfig, knownToolIds: Set<string>): string[] {
  return problemMessages(validateForPublishDetailed(agent, config, knownToolIds));
}

/** Error 422 de publicación/borrador con los problemas como texto (histórico) y estructurados (campo + código). */
function invalid(message: string, problems: PublishProblem[]): AgentError {
  return new AgentError(422, message, problemMessages(problems), problems);
}

/** Ids de conocimiento que no son de este workspace, no existen o están inactivos (el runtime solo carga los activos). */
async function knowledgeProblems(orgId: number, entryIds: number[]): Promise<PublishProblem[]> {
  const bad = await findUnavailableKnowledgeIds(orgId, entryIds);
  return bad.map((id) => ({
    field: "config.knowledge.entryIds", code: "UNKNOWN_KNOWLEDGE_ENTRY" as const,
    message: `El conocimiento #${id} no existe en este workspace o no está activo.`,
  }));
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

export interface SaveDraftOptions {
  /**
   * Valida que los entryIds de conocimiento pertenezcan a ESTE workspace y estén activos (por defecto sí). Solo se
   * desactiva al restaurar una versión propia: copiarla no introduce ids nuevos y la publicación los vuelve a validar.
   */
  validateKnowledge?: boolean;
}

export async function saveDraft(orgId: number, agentId: number, userClerkId: string | null,
  patch: Partial<AgentConfig>, notes?: string | null, options: SaveDraftOptions = {}) {
  const validPatch = agentConfigSchema.partial().parse(patch);

  // Antes de tocar nada: si algún id no es válido no se guarda NADA (ni esa sección ni el resto del parche).
  if (validPatch.knowledge && options.validateKnowledge !== false) {
    const problems = await knowledgeProblems(orgId, validPatch.knowledge.entryIds);
    if (problems.length > 0) throw invalid("El conocimiento seleccionado no es válido.", problems);
  }

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
  return saveDraft(orgId, agentId, userClerkId, readConfig(source), `Restaurada desde la versión ${source.versionNumber}`, { validateKnowledge: false });
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

export interface PublishDeps {
  /** El catálogo real de modelos (el mismo de GET /catalog/models). Inyectable en tests. */
  loadModelCatalog: () => Promise<ModelCatalog>;
}
const defaultPublishDeps: PublishDeps = { loadModelCatalog };

export async function publishAgent(orgId: number, agentId: number, knownToolIds: Set<string>, deps: PublishDeps = defaultPublishDeps) {
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
    const problems = validateForPublishDetailed(agent, draftConfig, knownToolIds);
    // Modelo y proveedor contra el catálogo real; un agente sin modelo fijo ni fallbacks no consulta nada.
    if (modelNeedsValidation(draftConfig.model)) problems.push(...validateModelForPublish(draftConfig.model, await deps.loadModelCatalog()));
    problems.push(...await knowledgeProblems(orgId, draftConfig.knowledge.entryIds));
    const unique = dedupeProblems(problems);
    if (unique.length > 0) throw invalid("El agente no está listo para publicarse.", unique);

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
