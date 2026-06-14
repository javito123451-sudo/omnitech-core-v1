import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { Lock, AlertTriangle, Info, ShieldAlert, Clock, Loader2, Filter } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditLog {
  id: number;
  actorClerkId: string | null;
  actorEmail: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  orgId: number | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  severity: string;
  createdAt: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  info:    { bg: "bg-blue-500/10",   text: "text-blue-400",   icon: Info },
  warning: { bg: "bg-amber-500/10",  text: "text-amber-400",  icon: AlertTriangle },
  critical:{ bg: "bg-red-500/10",    text: "text-red-400",    icon: ShieldAlert },
};

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    workspace_created:    "Workspace creado",
    workspace_updated:    "Workspace actualizado",
    workspace_deleted:    "Workspace eliminado",
    module_enabled:       "Módulo activado",
    module_disabled:      "Módulo desactivado",
    license_assigned:     "Licencia asignada",
    platform_role_granted:"Rol de plataforma concedido",
    platform_role_revoked:"Rol de plataforma revocado",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

export default function SecurityPage() {
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["cc-audit"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/audit`).then(r => r.json()),
    refetchInterval: 15_000,
  });

  const filtered = filterSeverity === "all" ? logs : logs.filter(l => l.severity === filterSeverity);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Lock size={24} className="text-violet-400" /> Security Center
          </h1>
          <p className="text-slate-500 mt-1">{logs.length} eventos registrados</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {(["info", "warning", "critical"] as const).map(sev => {
          const style = SEVERITY_STYLES[sev];
          const Icon  = style.icon;
          const count = logs.filter(l => l.severity === sev).length;
          return (
            <button
              key={sev}
              onClick={() => setFilterSeverity(filterSeverity === sev ? "all" : sev)}
              className={`${style.bg} border rounded-2xl p-5 text-left transition-all hover:brightness-125 ${filterSeverity === sev ? "border-white/20" : "border-transparent"}`}
            >
              <Icon size={20} className={`${style.text} mb-2`} />
              <p className={`text-2xl font-bold ${style.text}`}>{count}</p>
              <p className="text-slate-500 text-xs mt-1 capitalize">{sev === "info" ? "Informativos" : sev === "warning" ? "Advertencias" : "Críticos"}</p>
            </button>
          );
        })}
      </div>

      {/* Filter Indicator */}
      {filterSeverity !== "all" && (
        <div className="flex items-center gap-2 mb-4 text-sm text-slate-400">
          <Filter size={14} />
          <span>Filtrando por: <span className="capitalize text-white font-medium">{filterSeverity}</span></span>
          <button onClick={() => setFilterSeverity("all")} className="text-violet-400 hover:text-violet-300 ml-2">Limpiar</button>
        </div>
      )}

      {/* Audit Log Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Lock size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay eventos de auditoría</p>
              <p className="text-xs mt-2">Los eventos aparecerán aquí cuando realices acciones en el Control Center</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filtered.map(log => {
                const style = SEVERITY_STYLES[log.severity] ?? SEVERITY_STYLES.info;
                const Icon  = style.icon;
                return (
                  <div key={log.id} className="px-6 py-4 flex items-start gap-4 hover:bg-white/[0.01] transition-colors">
                    <div className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon size={15} className={style.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-medium">{actionLabel(log.action)}</p>
                        {log.resource && <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{log.resource}</span>}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">{log.actorEmail ?? log.actorClerkId ?? "Sistema"}</p>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <p className="text-slate-600 text-xs mt-1 font-mono">{JSON.stringify(log.details)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 text-xs flex-shrink-0">
                      <Clock size={12} />
                      <span>{new Date(log.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
