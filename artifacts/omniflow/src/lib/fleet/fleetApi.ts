// Omni Fleet — cliente del API y hooks (TanStack Query).
// Toda clave de caché incluye el workspace activo: al cambiar de workspace nunca se muestran datos del anterior.
// El backend es siempre la autoridad (permisos fleet.read / fleet.write y aislamiento por workspace).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const DRIVER_STATUSES = ["available", "on_route", "leave", "inactive"] as const;
export const VEHICLE_STATUSES = ["available", "on_route", "maintenance", "inactive"] as const;
export const ROUTE_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const DELIVERY_STATUSES = ["pending", "en_route", "delivered", "failed", "incident"] as const;

export const DRIVER_STATUS_LABEL: Record<string, string> = { available: "Disponible", on_route: "En ruta", leave: "De baja", inactive: "Inactivo" };
export const VEHICLE_STATUS_LABEL: Record<string, string> = { available: "Disponible", on_route: "En ruta", maintenance: "En taller", inactive: "Inactivo" };
export const ROUTE_STATUS_LABEL: Record<string, string> = { pending: "Sin iniciar", in_progress: "En curso", completed: "Completada", cancelled: "Cancelada" };
export const DELIVERY_STATUS_LABEL: Record<string, string> = { pending: "Pendiente", en_route: "En camino", delivered: "Entregada", failed: "Fallida", incident: "Incidencia" };

export interface FleetDriver { id: number; name: string; phone: string | null; licenseNumber: string | null; status: string; notes: string | null }
export interface FleetVehicle {
  id: number; plate: string; model: string | null; driverId: number | null; odometerKm: number | null;
  itvExpiresAt: string | null; insuranceExpiresAt: string | null; status: string; notes: string | null;
}
export interface FleetRoute {
  id: number; name: string; date: string; status: string; driverId: number | null; vehicleId: number | null;
  totalStops: number; completedStops: number; incidentStops: number; externalRouteId: string | null;
}
export interface FleetDelivery {
  id: number; routeId: number; externalDeliveryId: string | null; address: string | null; recipientName: string | null;
  recipientPhone: string | null; status: string; sequenceOrder: number; lastStatusNote: string | null;
}

/** Mensajes claros para los códigos de error del backend. */
const ERROR_MESSAGES: Record<string, string> = {
  name_required: "El nombre es obligatorio.",
  plate_required: "La matrícula es obligatoria.",
  plate_already_exists: "Ya existe un vehículo con esa matrícula en tu workspace.",
  name_and_date_required: "La ruta necesita nombre y fecha.",
  invalid_date: "La fecha no es válida (formato AAAA-MM-DD).",
  invalid_status: "Estado no válido.",
  driver_not_found: "El conductor elegido no existe en tu workspace.",
  vehicle_not_found: "El vehículo elegido no existe en tu workspace.",
  client_not_found: "El cliente elegido no existe en tu workspace.",
  address_or_external_id_required: "Indica la dirección o el identificador externo de la entrega.",
  route_not_found: "La ruta no existe.",
  not_found: "No se encontró el elemento (puede haberse eliminado).",
  invalid_id: "Identificador no válido.",
  permission_denied: "No tienes permiso para modificar la flota.",
  module_disabled: "El módulo Omni Fleet no está activado en tu workspace.",
};

export class FleetApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); this.name = "FleetApiError"; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(`${BASE}/api/fleet${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let code: string | null = null;
    try { const b = await res.json() as { error?: string }; code = typeof b.error === "string" ? b.error : null; } catch { /* sin cuerpo */ }
    const message = (code && ERROR_MESSAGES[code])
      ?? (res.status === 403 ? ERROR_MESSAGES["permission_denied"]! : `No se pudo completar la operación (${res.status}).`);
    throw new FleetApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

const send = <T>(method: "POST" | "PATCH", path: string, body: unknown) => request<T>(path, { method, body: JSON.stringify(body) });

/** Permisos de la vista. El backend los exige siempre; esto solo decide qué se muestra. */
export function useFleetPermissions() {
  const { hasPermission } = useOrg();
  const { isSuperAdmin } = useSuperAdmin();
  return { canRead: isSuperAdmin || hasPermission("fleet.read"), canWrite: isSuperAdmin || hasPermission("fleet.write") };
}

function useKey(...parts: unknown[]) {
  const { org } = useOrg();
  return { orgId: org?.id ?? null, key: ["fleet", org?.id ?? null, ...parts] as const };
}

export function useFleetDrivers() {
  const { orgId, key } = useKey("drivers");
  return useQuery({ queryKey: key, queryFn: () => request<FleetDriver[]>("/drivers"), enabled: orgId !== null });
}
export function useFleetVehicles() {
  const { orgId, key } = useKey("vehicles");
  return useQuery({ queryKey: key, queryFn: () => request<FleetVehicle[]>("/vehicles"), enabled: orgId !== null });
}
export function useFleetRoutes(date?: string) {
  const { orgId, key } = useKey("routes", date ?? "all");
  return useQuery({ queryKey: key, queryFn: () => request<FleetRoute[]>(`/routes${date ? `?date=${encodeURIComponent(date)}` : ""}`), enabled: orgId !== null });
}
export function useFleetDeliveries(routeId: number | null) {
  const { orgId, key } = useKey("deliveries", routeId);
  return useQuery({ queryKey: key, queryFn: () => request<FleetDelivery[]>(`/routes/${routeId}/deliveries`), enabled: orgId !== null && routeId !== null });
}

/** Cualquier cambio refresca todo lo de flota de ESTE workspace (listas, rutas, entregas y el resumen). */
function useFleetMutation<TIn, TOut>(fn: (input: TIn) => Promise<TOut>) {
  const qc = useQueryClient();
  const { org } = useOrg();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fleet", org?.id ?? null] });
      void qc.invalidateQueries({ queryKey: ["fleet-dashboard"] });
    },
  });
}

export type DriverInput = { name: string; phone?: string; licenseNumber?: string; status?: string };
export type VehicleInput = { plate: string; model?: string; driverId?: number | null; odometerKm?: number; itvExpiresAt?: string; insuranceExpiresAt?: string; status?: string };
export type RouteInput = { name: string; date: string; driverId?: number | null; vehicleId?: number | null };
export type DeliveryInput = { address?: string; recipientName?: string; recipientPhone?: string; externalDeliveryId?: string };

export const useCreateDriver = () => useFleetMutation((b: DriverInput) => send<FleetDriver>("POST", "/drivers", b));
export const useUpdateDriver = () => useFleetMutation((a: { id: number; patch: Partial<DriverInput> & { notes?: string } }) => send<FleetDriver>("PATCH", `/drivers/${a.id}`, a.patch));
export const useCreateVehicle = () => useFleetMutation((b: VehicleInput) => send<FleetVehicle>("POST", "/vehicles", b));
export const useUpdateVehicle = () => useFleetMutation((a: { id: number; patch: Partial<Omit<VehicleInput, "plate">> & { notes?: string } }) => send<FleetVehicle>("PATCH", `/vehicles/${a.id}`, a.patch));
export const useCreateRoute = () => useFleetMutation((b: RouteInput) => send<FleetRoute>("POST", "/routes", b));
export const useUpdateRoute = () => useFleetMutation((a: { id: number; patch: { status?: string; driverId?: number | null; vehicleId?: number | null } }) => send<FleetRoute>("PATCH", `/routes/${a.id}`, a.patch));
export const useAddDelivery = () => useFleetMutation((a: { routeId: number; body: DeliveryInput }) => send<FleetDelivery>("POST", `/routes/${a.routeId}/deliveries`, a.body));
export const useUpdateDelivery = () => useFleetMutation((a: { routeId: number; id: number; patch: { status?: string; note?: string } }) => send<FleetDelivery>("PATCH", `/routes/${a.routeId}/deliveries/${a.id}`, a.patch));
