// Reglas de versionado de Agent Factory, derivadas del backend (agentService.ts):
//  - Una versión con publishedAt = null es el BORRADOR y es lo único editable. Con fecha, está congelada.
//  - Como mucho hay un borrador por agente (saveDraft lo reutiliza; si no existe, crea la versión n+1).
//  - «Versión activa» = agent.activeVersionId (la que ejecutan los modos LIVE).
//  - La simulación usa: borrador → si no hay, versión activa → si no, la más reciente (resolveRunTarget, modo testing).

import type { Agent, AgentConfig, AgentVersion } from "./types";

/** Más reciente primero (el backend ya devuelve este orden; se garantiza aquí por si cambia). */
export const sortVersions = (versions: AgentVersion[]): AgentVersion[] =>
  [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

export const findDraft = (versions: AgentVersion[]): AgentVersion | null =>
  sortVersions(versions).find((v) => v.publishedAt === null) ?? null;

export const findActive = (agent: Pick<Agent, "activeVersionId">, versions: AgentVersion[]): AgentVersion | null =>
  versions.find((v) => v.id === agent.activeVersionId) ?? null;

/** Versión contra la que se revisa el borrador: la activa; si no hay, la publicada más reciente; si no, ninguna. */
export function findReviewBase(agent: Pick<Agent, "activeVersionId">, versions: AgentVersion[]): AgentVersion | null {
  return findActive(agent, versions) ?? sortVersions(versions).find((v) => v.publishedAt !== null) ?? null;
}

/** Versión que ejecutaría una simulación (misma regla que el backend). */
export function findSimulationTarget(agent: Pick<Agent, "activeVersionId">, versions: AgentVersion[]): AgentVersion | null {
  return findDraft(versions) ?? findActive(agent, versions) ?? sortVersions(versions)[0] ?? null;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Identidad de lo que se simularía: versión + contenido de su configuración + nombre/descripción del agente
 * (aparecen en la respuesta simulada). Si cualquiera cambia, una simulación anterior deja de ser válida.
 */
export function simulationKey(agent: Pick<Agent, "id" | "name" | "description">, target: { id: number; versionNumber: number; config: Partial<AgentConfig> } | null): string {
  if (!target) return `${agent.id}|none`;
  return `${agent.id}|v${target.versionNumber}#${target.id}|${hash(JSON.stringify([target.config, agent.name, agent.description ?? null]))}`;
}
