// Vista previa (SOLO LECTURA) de lo que un agente podría hacer realmente para el usuario autenticado.
//
// No ejecuta ninguna herramienta, no llama a la IA, no consume créditos, no escribe audit de ejecución y no modifica datos.
// El usuario evaluado es SIEMPRE el autenticado (su rol real en el workspace activo): el cliente no puede elegir otro,
// así que no hay impersonación. El agente se carga por (orgId de la sesión, id): uno de otro workspace da 404.

import { AgentError, getAgentDetail, readConfig } from "./agentService";
import { resolveEffectiveToolAccess, type EffectiveToolAccess } from "./authorization";

export interface EffectiveAccessActor {
  orgId:        number;
  orgRole:      string;
  platformRole: string | null;
}

export interface EffectiveAccessResponse {
  agentId:     number;
  agentStatus: string;
  /** Versión evaluada: el borrador si existe (lo que se publicaría), si no la activa, si no la más reciente. */
  version:     { id: number; versionNumber: number; isDraft: boolean; isActive: boolean };
  /** Rol del usuario autenticado con el que se ha calculado (informativo). */
  role:        string;
  tools:       EffectiveToolAccess[];
  summary:     { declared: number; allowed: number; denied: number; requireConfirmation: number };
}

export interface EffectiveAccessDeps {
  moduleEnabled?: (orgId: number, slug: string) => Promise<boolean>;
}

export async function previewEffectiveAccess(actor: EffectiveAccessActor, agentId: number, deps: EffectiveAccessDeps = {}): Promise<EffectiveAccessResponse> {
  const { agent, versions } = await getAgentDetail(actor.orgId, agentId);          // 404 si es de otro workspace
  const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const version = sorted.find((v) => v.publishedAt === null) ?? sorted.find((v) => v.id === agent.activeVersionId) ?? sorted[0];
  if (!version) throw new AgentError(404, "El agente no tiene versiones.");

  const tools = await resolveEffectiveToolAccess({
    config: readConfig(version), orgId: actor.orgId, orgRole: actor.orgRole, platformRole: actor.platformRole, moduleEnabled: deps.moduleEnabled,
  });
  const allowed = tools.filter((t) => t.allowed).length;
  return {
    agentId: agent.id,
    agentStatus: agent.status,
    version: { id: version.id, versionNumber: version.versionNumber, isDraft: version.publishedAt === null, isActive: version.id === agent.activeVersionId },
    role: actor.orgRole,
    tools,
    summary: { declared: tools.length, allowed, denied: tools.length - allowed, requireConfirmation: tools.filter((t) => t.requiresConfirmation).length },
  };
}
