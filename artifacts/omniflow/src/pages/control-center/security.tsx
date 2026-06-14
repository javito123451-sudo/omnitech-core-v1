import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState, useCallback } from "react";
import {
  Lock, AlertTriangle, Info, ShieldAlert, Clock, Loader2, Filter,
  Search, Download, ChevronLeft, ChevronRight, X, Calendar,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditLog {
  id: number; actorClerkId: string | null; actorEmail: string | null;
  action: string; resource: string | null; resourceId: string | null;
  orgId: number | null; ipAddress: string | null; details: Record<string, unknown> | null;
  severity: string; createdAt: string;
}

interface AuditResponse {
  logs: AuditLog[]; total: number; limit: number; offset: number;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ElementType }> = {
  info:     { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/20",   icon: Info },
  warning:  { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20",  icon: AlertTriangle },
  critical: { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20",    icon: ShieldAlert },
};

const ACTION_LABELS: Record<string, string> = {
  workspace_created:      "Workspace creado",
  workspace_updated:      "Workspace actualizado",
  workspace_deleted:      "Workspace eliminado",
  workspace_suspended:    "Workspace suspendido",
  workspace_activated:    "Workspace activado",
  module_enabled:         "Módulo activado",
  module_disabled:        "Módulo desactivado",
  license_assigned:       "Licencia asignada",
  platform_role_granted:  "Rol de plataforma concedido",
  platform_role_revoked:  "Rol de plataforma revocado",
  user_role_changed:      "Rol de usuario cambiado",
  user_suspended:         "Usuario suspendido",
  user_activated:         "Usuario activado",
  client_created:         "Cliente creado",
  client_updated:         "Cliente actualizado",
  quote_created:          "Presupuesto creado",
  import_completed:       "Importación completada",
};

const PAGE_SIZE = 50;

export default function SecurityPage() {
  const [severity,  setSeverity]  = useState("all");
  const [action,    setAction]    = useState("");
  const [actor,     setActor]     = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [page,      setPage]      = useState(0);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set("limit",  String(PAGE_SIZE));
    p.set("offset", String(page * PAGE_SIZE));
    if (severity !== "all") p.set("severity",  severity);
    if (action)              p.set("action",    action);
    if (actor)               p.set("actor",     actor);
    if (startDate)           p.set("startDate", startDate);
    if (endDate)             p.set("endDate",   endDate);
    return p.toString();
  }, [severity, action, actor, startDate, endDate, page]);

  const { data, isLoading, isFetching } = useQuery<AuditResponse>({
    queryKey: ["cc-audit", severity, action, actor, startDate, endDate, page],
    queryFn:  () => authFetch(`${BASE}/api/control-center/audit?${buildParams()}`).then(r => r.json()),
    refetchInterval: 15_000,
  });

  const logs       = data?.logs    ?? [];
  const total      = data?.total   ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = severity !== "all" || action || actor || startDate || endDate;

  const resetFilters = () => { setSeverity("all"); setAction(""); setActor(""); setStartDate(""); setEndDate(""); setPage(0); };

  const handleExport = async () => {
    const p = new URLSearchParams();
    if (severity !== "all") p.set("severity",  severity);
    if (action)              p.set("action",    action);
    if (actor)               p.set("actor",     actor);
    if (startDate)           p.set("startDate", startDate);
    if (endDate)             p.set("endDate",   endDate);
    const resp = await authFetch(`${BASE}/api/control-center/audit/export?${p.toString()}`);
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count by severity (from current page for stat cards — use totals from backend when available)
  const infoCount    = logs.filter(l => l.severity === "info").length;
  const warnCount    = logs.filter(l => l.severity === "warning").length;
  const critCount    = logs.filter(l => l.severity === "critical").length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Lock size={24} className="text-violet-400" /> Security Center
          </h1>
          <p className="text-slate-500 mt-1">
            {total.toLocaleString()} eventos registrados
            {isFetching && <span className="ml-2 text-violet-400 text-xs animate-pulse">actualizando…</span>}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all"
        >
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {/* Severity quick-filter cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {(["info", "warning", "critical"] as const).map(sev => {
          const style = SEVERITY_STYLES[sev];
          const Icon  = style.icon;
          const cnt   = sev === "info" ? infoCount : sev === "warning" ? warnCount : critCount;
          return (
            <button
              key={sev}
              onClick={() => { setSeverity(severity === sev ? "all" : sev); setPage(0); }}
              className={`${style.bg} border rounded-2xl p-5 text-left transition-all hover:brightness-125 ${severity === sev ? `${style.border}` : "border-transparent"}`}
            >
              <Icon size={20} className={`${style.text} mb-2`} />
              <p className={`text-2xl font-bold ${style.text}`}>{cnt}</p>
              <p className="text-slate-500 text-xs mt-1 capitalize">
                {sev === "info" ? "Informativos" : sev === "warning" ? "Advertencias" : "Críticos"}
              </p>
              <p className="text-slate-600 text-xs mt-0.5">en esta página</p>
            </button>
          );
        })}
      </div>

      {/* Search / filter bar */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text" value={action} onChange={e => { setAction(e.target.value); setPage(0); }}
              placeholder="Filtrar por acción..."
              className="w-full bg-white/5 border border-white/[0.06] rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
            />
          </div>
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text" value={actor} onChange={e => { setActor(e.target.value); setPage(0); }}
              placeholder="Filtrar por actor..."
              className="w-full bg-white/5 border border-white/[0.06] rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
            />
          </div>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0); }}
              className="w-full bg-white/5 border border-white/[0.06] rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm [color-scheme:dark]"
            />
          </div>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0); }}
              className="w-full bg-white/5 border border-white/[0.06] rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm [color-scheme:dark]"
            />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.04]">
            <span className="text-xs text-slate-500 flex items-center gap-1.5"><Filter size={12} /> Filtros activos:</span>
            {severity !== "all" && <Chip label={`Severidad: ${severity}`} onRemove={() => setSeverity("all")} />}
            {action    && <Chip label={`Acción: ${action}`}              onRemove={() => setAction("")} />}
            {actor     && <Chip label={`Actor: ${actor}`}                onRemove={() => setActor("")} />}
            {startDate && <Chip label={`Desde: ${startDate}`}            onRemove={() => setStartDate("")} />}
            {endDate   && <Chip label={`Hasta: ${endDate}`}              onRemove={() => setEndDate("")} />}
            <button onClick={resetFilters} className="text-xs text-violet-400 hover:text-violet-300 ml-2">Limpiar todo</button>
          </div>
        )}
      </div>

      {/* Log list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {logs.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Lock size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay eventos que coincidan con los filtros</p>
              {hasFilters && <button onClick={resetFilters} className="text-violet-400 text-sm mt-3 hover:text-violet-300">Limpiar filtros</button>}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {logs.map(log => {
                const style = SEVERITY_STYLES[log.severity] ?? SEVERITY_STYLES.info;
                const Icon  = style.icon;
                return (
                  <div key={log.id} className="px-6 py-4 flex items-start gap-4 hover:bg-white/[0.01] transition-colors">
                    <div className={`w-8 h-8 rounded-lg ${style.bg} border ${style.border} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon size={14} className={style.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-medium">{ACTION_LABELS[log.action] ?? log.action.replace(/_/g, " ")}</p>
                        {log.resource && <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{log.resource}</span>}
                        {log.resourceId && <span className="text-xs text-slate-600 font-mono">#{log.resourceId}</span>}
                        {log.orgId && <span className="text-xs text-slate-600 bg-white/5 px-2 py-0.5 rounded-full">org:{log.orgId}</span>}
                      </div>
                      <p className="text-slate-500 text-xs mt-1">{log.actorEmail ?? log.actorClerkId ?? "Sistema"}</p>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <p className="text-slate-600 text-xs mt-1 font-mono truncate max-w-lg">{JSON.stringify(log.details)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-right">
                      {log.ipAddress && <span className="text-slate-700 text-xs font-mono hidden lg:block">{log.ipAddress}</span>}
                      <div className="text-slate-600 text-xs">
                        <Clock size={11} className="inline mr-1" />
                        {new Date(log.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
              <p className="text-xs text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total.toLocaleString()} eventos
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-slate-400">Página {page + 1} / {totalPages}</span>
                <button
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 text-xs bg-white/5 border border-white/10 text-slate-300 px-2.5 py-1 rounded-full">
      {label}
      <button onClick={onRemove} className="text-slate-500 hover:text-white"><X size={10} /></button>
    </span>
  );
}
