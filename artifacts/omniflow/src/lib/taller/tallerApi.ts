// Omni Taller — cliente del API y hooks (TanStack Query).
// Toda clave de caché incluye el workspace activo. El backend es la autoridad (taller.read / taller.write y aislamiento).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const REPAIR_STAGES = ["received", "diagnosing", "quote_sent", "approved", "in_repair", "waiting_parts", "ready", "delivered", "cancelled"] as const;
export const SERVICE_TYPES = ["revision", "itv", "cambio_aceite", "neumaticos", "reparacion", "presupuesto", "consulta_general"] as const;

export const STAGE_LABEL: Record<string, string> = {
  received: "Recibido", diagnosing: "En diagnóstico", quote_sent: "Presupuesto enviado", approved: "Aprobado",
  in_repair: "En reparación", waiting_parts: "Esperando piezas", ready: "Listo para recoger", delivered: "Entregado", cancelled: "Cancelado",
};
export const SERVICE_LABEL: Record<string, string> = {
  revision: "Revisión", itv: "ITV", cambio_aceite: "Cambio de aceite", neumaticos: "Neumáticos",
  reparacion: "Reparación", presupuesto: "Presupuesto", consulta_general: "Consulta general",
};

export interface RepairOrder {
  id: number; clientId: number; clientName: string | null; clientPhone: string | null;
  appointmentId: number | null; quoteId: number | null;
  vehiclePlate: string | null; vehicleModel: string | null; vehicleMileageKm: number | null;
  serviceType: string; stage: string; notes: string | null; deliveredAt: string | null; createdAt: string; updatedAt: string;
}
export interface TallerClient { id: number; name: string; phone: string | null; email: string | null }
export interface TallerDashboard { totalActive: number; readyForPickup: number; inRepair: number; waitingParts: number; byStage: Record<string, number> }

const ERROR_MESSAGES: Record<string, string> = {
  client_id_required: "Elige el cliente de la orden.",
  client_not_found: "El cliente elegido no existe en tu workspace.",
  invalid_stage: "Fase no válida.",
  invalid_service_type: "Tipo de servicio no válido.",
  invalid_mileage: "Los kilómetros deben ser un número entero positivo.",
  appointment_not_found: "La cita enlazada no existe en tu workspace.",
  quote_not_found: "El presupuesto enlazado no existe en tu workspace.",
  not_found: "No se encontró la orden (puede haberse eliminado).",
  invalid_id: "Identificador no válido.",
  permission_denied: "No tienes permiso para modificar las órdenes del taller.",
  module_disabled: "El módulo Omni Taller no está activado en tu workspace.",
};

export class TallerApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); this.name = "TallerApiError"; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(`${BASE}/api/taller${path}`, {
    ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let code: string | null = null;
    try { const b = await res.json() as { error?: string }; code = typeof b.error === "string" ? b.error : null; } catch { /* sin cuerpo */ }
    const message = (code && ERROR_MESSAGES[code]) ?? (res.status === 403 ? ERROR_MESSAGES["permission_denied"]! : `No se pudo completar la operación (${res.status}).`);
    throw new TallerApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

export function useTallerPermissions() {
  const { hasPermission } = useOrg();
  const { isSuperAdmin } = useSuperAdmin();
  return { canRead: isSuperAdmin || hasPermission("taller.read"), canWrite: isSuperAdmin || hasPermission("taller.write") };
}

const useOrgId = () => useOrg().org?.id ?? null;

export function useTallerDashboard() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ["taller", orgId, "dashboard"], queryFn: () => request<TallerDashboard>("/dashboard"), enabled: orgId !== null, refetchInterval: 30_000 });
}
export function useRepairOrders(filters: { stage?: string; q?: string }) {
  const orgId = useOrgId();
  const qs = new URLSearchParams();
  if (filters.stage) qs.set("stage", filters.stage);
  if (filters.q?.trim()) qs.set("q", filters.q.trim());
  const suffix = qs.toString() ? `?${qs}` : "";
  return useQuery({ queryKey: ["taller", orgId, "orders", filters.stage ?? "", filters.q?.trim() ?? ""], queryFn: () => request<RepairOrder[]>(`/orders${suffix}`), enabled: orgId !== null });
}
export function useTallerClients(q: string, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({ queryKey: ["taller", orgId, "clients", q.trim()], queryFn: () => request<TallerClient[]>(`/clients?q=${encodeURIComponent(q.trim())}`), enabled: enabled && orgId !== null });
}

function useTallerMutation<TIn, TOut>(fn: (input: TIn) => Promise<TOut>) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["taller", orgId] }); } });
}

export type NewOrderInput = { clientId: number; vehiclePlate?: string; vehicleModel?: string; vehicleMileageKm?: number; serviceType?: string; notes?: string };
export type OrderPatch = { stage?: string; vehiclePlate?: string; vehicleModel?: string; vehicleMileageKm?: number; serviceType?: string; notes?: string };

export const useCreateOrder = () => useTallerMutation((b: NewOrderInput) => request<RepairOrder>("/orders", { method: "POST", body: JSON.stringify(b) }));
export const useUpdateOrder = () => useTallerMutation((a: { id: number; patch: OrderPatch }) => request<RepairOrder>(`/orders/${a.id}`, { method: "PATCH", body: JSON.stringify(a.patch) }));
