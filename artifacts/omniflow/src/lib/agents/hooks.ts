// Hooks de Agent Factory (TanStack Query).
//
// REGLA: toda clave de caché incluye el workspace activo. Al cambiar de workspace la clave cambia, así que
// nunca se reutilizan (ni se muestran mientras carga lo nuevo) datos del workspace anterior. Sin workspace
// activo la consulta no se lanza.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { agentsApi } from "./agentsApi";
import { AgentsApiError } from "./agentErrors";
import type { AgentVersion, CreateAgentInput, SimulateAgentInput, SaveDraftInput, UpdateAgentMetaInput } from "./types";

export const agentKeys = {
  list:     (ws: number | null)             => ["agents", ws] as const,
  detail:   (ws: number | null, id: number) => ["agent", ws, id] as const,
  credits:  (ws: number | null)             => ["credits", ws] as const,
  balance:  (ws: number | null)             => ["credits-balance", ws] as const,
  defaults: (ws: number | null)             => ["agent-defaults", ws] as const,
};

/** Workspace activo (el que ya usa el resto de la app vía OrgProvider). */
export function useActiveWorkspaceId(): number | null {
  const { org } = useOrg();
  return org?.id ?? null;
}

/**
 * Permisos de la pantalla de agentes. Usa hasPermission() de OrgContext (permisos del rol, que vienen del
 * backend). El backend deja pasar a SUPER_ADMIN en cualquier permiso, y aquí se refleja igual.
 */
export function useAgentPermissions() {
  const { hasPermission } = useOrg();
  const { isSuperAdmin } = useSuperAdmin();
  return {
    canRead:    isSuperAdmin || hasPermission("agents.read"),
    canWrite:   isSuperAdmin || hasPermission("agents.write"),
    canPublish: isSuperAdmin || hasPermission("agents.publish"),
  };
}

export function useAgents() {
  const ws = useActiveWorkspaceId();
  return useQuery({ queryKey: agentKeys.list(ws), queryFn: ({ signal }) => agentsApi.list(signal), enabled: ws !== null });
}

export function useAgent(agentId: number | null) {
  const ws = useActiveWorkspaceId();
  return useQuery({
    queryKey: agentKeys.detail(ws, agentId ?? -1),
    queryFn: ({ signal }) => agentsApi.get(agentId as number, signal),
    enabled: ws !== null && agentId !== null && Number.isInteger(agentId) && agentId > 0,
  });
}

export function useCreditsBalance() {
  const ws = useActiveWorkspaceId();
  return useQuery({ queryKey: agentKeys.balance(ws), queryFn: ({ signal }) => agentsApi.creditsBalance(signal), enabled: ws !== null });
}

export function useCreditsDashboard() {
  const ws = useActiveWorkspaceId();
  return useQuery({ queryKey: agentKeys.credits(ws), queryFn: ({ signal }) => agentsApi.credits(signal), enabled: ws !== null });
}

export function useDefaultAgents() {
  const ws = useActiveWorkspaceId();
  return useQuery({ queryKey: agentKeys.defaults(ws), queryFn: ({ signal }) => agentsApi.defaults(signal), enabled: ws !== null });
}

/** Crear agente. Invalida la lista del workspace en el que se creó (no la de otro). */
export function useCreateAgent() {
  const ws = useActiveWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => agentsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.list(ws) }),
  });
}

/**
 * Publicar la versión borrador (agents.publish). Cambia el estado del agente y su versión activa, así que
 * invalida solo la lista y el detalle de ESTE agente en este workspace. No toca créditos ni defaults.
 */
export function usePublishAgent(agentId: number) {
  const ws = useActiveWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => agentsApi.publish(agentId),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: agentKeys.list(ws) }),
      qc.invalidateQueries({ queryKey: agentKeys.detail(ws, agentId) }),
    ]),
  });
}

/** Simulación (gratis, sin proveedor, sin créditos): no modifica nada, por eso no invalida ninguna consulta. */
export function useSimulateAgent(agentId: number) {
  return useMutation({ mutationFn: (input: SimulateAgentInput) => agentsApi.simulate(agentId, input) });
}

export interface SaveAgentInput {
  /** PATCH /:id — null si no cambió nada de nombre/descripción/avatar. */
  meta:   UpdateAgentMetaInput | null;
  /** PUT /:id/draft — null si no cambió ninguna sección de la configuración. */
  config: SaveDraftInput | null;
}

/** El primer paso se guardó y el segundo falló: se dice qué quedó guardado para no perder información. */
export class PartialSaveError extends Error {
  constructor(readonly saved: "config", readonly cause: AgentsApiError) {
    super(cause.message);
    this.name = "PartialSaveError";
  }
}

/**
 * Guardar el Builder. Usa solo los endpoints confirmados: PUT /:id/draft (configuración) y PATCH /:id (nombre,
 * descripción, avatar), en ese orden y solo si hay algo que enviar. Devuelve la versión guardada (o null). Tanto si
 * sale bien como mal se invalida el detalle de ESTE agente y la lista de ESTE workspace: no se toca nada más.
 */
export function useSaveAgent(agentId: number) {
  const ws = useActiveWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveAgentInput): Promise<{ version: AgentVersion | null }> => {
      let version: AgentVersion | null = null;
      if (input.config) version = await agentsApi.updateDraft(agentId, input.config);
      if (input.meta) {
        try { await agentsApi.updateMeta(agentId, input.meta); }
        catch (err) {
          if (version && err instanceof AgentsApiError) throw new PartialSaveError("config", err);
          throw err;
        }
      }
      return { version };
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: agentKeys.detail(ws, agentId) }),
      qc.invalidateQueries({ queryKey: agentKeys.list(ws) }),
    ]),
  });
}
