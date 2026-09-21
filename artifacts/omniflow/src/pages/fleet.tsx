import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Route as RouteIcon, Truck, Users, Package, CheckCircle2, AlertTriangle,
  ServerCrash, RefreshCw, Link2, Copy, Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrg } from "@/lib/orgContext";
import { useFleetDrivers, useFleetPermissions, useFleetVehicles } from "@/lib/fleet/fleetApi";
import { DriversPanel } from "@/components/fleet/DriversPanel";
import { VehiclesPanel } from "@/components/fleet/VehiclesPanel";
import { RoutesPanel } from "@/components/fleet/RoutesPanel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  activeDrivers: number;
  driversOnRoute: number;
  activeVehicles: number;
  vehiclesOnRoute: number;
  routesInProgress: number;
  routesToday: number;
  deliveriesToday: { assigned: number; delivered: number; incidents: number };
  routes: Array<{
    id: number; name: string; status: string;
    driverId: number | null; vehicleId: number | null;
    totalStops: number; completedStops: number; incidentStops: number;
  }>;
}

interface ProviderInfo {
  connected: boolean;
  providerSlug?: string | null;
  webhookUrl?: string | null;
  status?: string;
}
interface ProviderOption { slug: string; displayName: string; }

const EMPTY_DASHBOARD: DashboardData = {
  activeDrivers: 0, driversOnRoute: 0, activeVehicles: 0, vehiclesOnRoute: 0,
  routesInProgress: 0, routesToday: 0,
  deliveriesToday: { assigned: 0, delivered: 0, incidents: 0 },
  routes: [],
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Sin iniciar", in_progress: "En curso", completed: "Completada", cancelled: "Cancelada",
};
const STATUS_STYLE: Record<string, string> = {
  pending:     "bg-slate-500/20 text-slate-400 border-slate-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cancelled:   "bg-red-500/20 text-red-400 border-red-500/30",
};

function RouteStatusBadge({ s }: { s: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STATUS_STYLE[s] ?? STATUS_STYLE.pending}`}>
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

// ── StatCard (mismo componente que /time) ────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = "text-white" }: {
  icon: React.ElementType; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-900/30 border border-red-700/40 flex items-center justify-center mb-4">
        <ServerCrash className="w-7 h-7 text-red-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-2">Error al cargar los datos</h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">{message ?? "Comprueba la conexión y vuelve a intentarlo."}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      )}
    </div>
  );
}

// ── Sección de conexión con la app de reparto (adaptador pluggable) ─────────

function DeliveryProviderCard({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState("");

  const { data: provider } = useQuery<ProviderInfo>({
    queryKey: ["fleet", orgId, "provider"],
    enabled: orgId !== null,
    queryFn: () => authFetch(`${BASE}/api/fleet/provider`).then(r => r.json() as Promise<ProviderInfo>),
  });
  const { data: options = [] } = useQuery<ProviderOption[]>({
    queryKey: ["fleet", orgId, "providers"],
    enabled: orgId !== null,
    queryFn: () => authFetch(`${BASE}/api/fleet/providers`).then(r => r.json() as Promise<ProviderOption[]>),
  });

  const connect = async (providerSlug: string) => {
    const res = await authFetch(`${BASE}/api/fleet/provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerSlug }),
    });
    if (!res.ok) {
      toast({ title: "No se pudo conectar el proveedor", variant: "destructive" });
      return;
    }
    toast({ title: "Proveedor de estado de entregas conectado ✓" });
    qc.invalidateQueries({ queryKey: ["fleet", orgId, "provider"] });
  };

  const copyUrl = () => {
    if (!provider?.webhookUrl) return;
    navigator.clipboard.writeText(provider.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-blue-400" /> App de reparto conectada
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        No hacemos tracking GPS propio — recibimos las actualizaciones de estado que ya envía la app de reparto de los conductores.
      </p>

      {provider?.connected && provider.webhookUrl ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Proveedor: <span className="text-slate-200 font-medium">{provider.providerSlug}</span>
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 truncate">
              {provider.webhookUrl}
            </code>
            <button
              onClick={copyUrl}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Configura esta URL como webhook de estado en la app de reparto que ya usa el cliente.
          </p>
        </div>
      ) : !canWrite ? (
        <p className="text-sm text-slate-500">Todavía no hay una app de reparto conectada. Pide a un administrador que la conecte.</p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Elige la app de reparto…</option>
            {options.map((o) => (
              <option key={o.slug} value={o.slug}>{o.displayName}</option>
            ))}
          </select>
          <button
            disabled={!selected}
            onClick={() => connect(selected)}
            className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Conectar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

type Tab = "summary" | "routes" | "drivers" | "vehicles" | "connection";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "summary", label: "Resumen" }, { id: "routes", label: "Rutas" }, { id: "drivers", label: "Conductores" },
  { id: "vehicles", label: "Vehículos" }, { id: "connection", label: "App de reparto" },
];

export default function FleetPage() {
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const { canWrite } = useFleetPermissions();
  const [tab, setTab] = useState<Tab>("summary");
  const {
    data: dashboard, isLoading, isError, refetch,
  } = useQuery<DashboardData>({
    queryKey: ["fleet", orgId, "dashboard"],
    enabled: orgId !== null,
    queryFn: () =>
      authFetch(`${BASE}/api/fleet/dashboard`).then(r => {
        if (!r.ok) throw new Error("Error al cargar el dashboard de flota");
        return r.json() as Promise<DashboardData>;
      }),
    refetchInterval: 30_000,
  });

  const { data: drivers = [] } = useFleetDrivers();
  const { data: vehicles = [] } = useFleetVehicles();

  const driverName = (id: number | null) => drivers.find(d => d.id === id)?.name ?? "Sin asignar";
  const vehiclePlate = (id: number | null) => vehicles.find(v => v.id === id)?.plate ?? "Sin asignar";

  const safeData = dashboard ?? EMPTY_DASHBOARD;

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <RouteIcon className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Omni Fleet</h1>
            <p className="text-xs text-slate-400">Flota, conductores y estado de entregas</p>
          </div>
        </div>

        <div role="tablist" aria-label="Secciones de Omni Fleet" className="flex flex-wrap gap-1 border-b border-slate-700/50">
          {TABS.map((t) => (
            <button
              key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >{t.label}</button>
          ))}
        </div>

        {tab === "routes" && <RoutesPanel canWrite={canWrite} />}
        {tab === "drivers" && <DriversPanel canWrite={canWrite} />}
        {tab === "vehicles" && <VehiclesPanel canWrite={canWrite} />}
        {tab === "connection" && <DeliveryProviderCard canWrite={canWrite} />}

        {tab === "summary" && (isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 h-[68px] animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard icon={Users}         label="Conductores activos" value={safeData.activeDrivers} />
              <StatCard icon={Truck}         label="Vehículos en ruta"   value={safeData.vehiclesOnRoute} color="text-blue-400" />
              <StatCard icon={Package}       label="Entregas asignadas"  value={safeData.deliveriesToday.assigned} color="text-slate-300" />
              <StatCard icon={CheckCircle2}  label="Entregadas"         value={safeData.deliveriesToday.delivered} color="text-emerald-400" />
              <StatCard icon={AlertTriangle} label="Incidencias"        value={safeData.deliveriesToday.incidents} color="text-amber-400" />
            </div>

            {/* Rutas de hoy */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <RouteIcon className="w-4 h-4 text-blue-400" /> Rutas de hoy
              </h3>

              {safeData.routes.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Todavía no hay rutas programadas para hoy.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-slate-500 text-xs">
                        <th className="pb-2 font-medium">Ruta</th>
                        <th className="pb-2 font-medium">Conductor</th>
                        <th className="pb-2 font-medium">Vehículo</th>
                        <th className="pb-2 font-medium">Estado</th>
                        <th className="pb-2 font-medium">Entregas</th>
                        <th className="pb-2 font-medium">Incidencias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeData.routes.map((r) => (
                        <tr key={r.id} className="border-b border-slate-800">
                          <td className="py-3 font-medium text-slate-200">{r.name}</td>
                          <td className="py-3 text-slate-400">{driverName(r.driverId)}</td>
                          <td className="py-3 text-slate-400">{vehiclePlate(r.vehicleId)}</td>
                          <td className="py-3"><RouteStatusBadge s={r.status} /></td>
                          <td className="py-3 text-slate-300">{r.completedStops} / {r.totalStops}</td>
                          <td className="py-3">
                            {r.incidentStops > 0
                              ? <span className="text-amber-400 font-medium">{r.incidentStops}</span>
                              : <span className="text-slate-500">0</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </>
        ))}
      </div>
    </div>
  );
}
