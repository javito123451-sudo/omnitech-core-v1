// Hooks de Agent Factory (TanStack Query).
//
// REGLA: toda clave de caché incluye el workspace activo. Al cambiar de workspace la clave cambia, así que
// nunca se reutilizan (ni se muestran mientras carga lo nuevo) datos del workspace anterior. Sin workspace
// activo la consulta no se lanza.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { agentsApi } from "./agentsApi";
import type { CreateAgentInput } from "./types";

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
