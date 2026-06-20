import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Minus, RefreshCw,
  ShieldCheck, Layout, Globe, Server, Cpu,
  AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ModuleState {
  slug: string; name: string; alwaysOn: boolean; layers: string[];
  configured: boolean; menuVisible: boolean; routeAccessible: boolean;
  apiAccessible: boolean; backendAccessible: boolean; inconsistent: boolean;
  configuredAt: string | null;
}
interface OrgMatrix { org: { id: number; name: string; status: string }; modules: ModuleState[]; issues: ModuleState[]; }
interface MatrixResponse { catalog: { slug: string; name: string }[]; matrix: OrgMatrix[]; generatedAt: string; }

function LayerBadge({ active, label, icon: Icon }: { active: boolean; label: string; icon: React.ElementType }) {
  return (
    <div className={cn(
      "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
      active
        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
        : "bg-red-500/10 border-red-500/20 text-red-400/70",
    )}>
      <Icon size={10} />
      {label}
    </div>
  );
}

function StatusDot({ on, alwaysOn }: { on: boolean; alwaysOn?: boolean }) {
  if (alwaysOn) return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-violet-400">
      <ShieldCheck size={14} className="text-violet-400" />
      Siempre ON
    </span>
  );
  return on
    ? <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400"><CheckCircle2 size={14} />Habilitado</span>
    : <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400"><XCircle size={14} />Desactivado</span>;
}

function OrgAccordion({ row }: { row: OrgMatrix }) {
  const [open, setOpen] = useState(row.issues.length > 0);
  const disabledCount = row.modules.filter(m => !m.alwaysOn && !m.configured).length;

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden",
      row.issues.length > 0 ? "border-red-500/30" : "border-border/50",
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
      >
        {open ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronRight size={15} className="text-muted-foreground" />}
        <span className="font-semibold text-sm text-white flex-1">{row.org.name}</span>
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium",
          row.org.status === "active" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
          : "bg-red-500/10 border-red-500/20 text-red-400")}>
          {row.org.status}
        </span>
        {disabledCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 font-medium">
            <Minus size={10} />{disabledCount} desactivados
          </span>
        )}
        {row.issues.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/25 text-red-400 font-medium">
            <AlertTriangle size={10} />{row.issues.length} inconsistencia{row.issues.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-t border-border/40 bg-slate-950/40">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-44">Módulo</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Estado</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">
                  <span className="flex items-center justify-center gap-1"><Layout size={11} />Menú</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">
                  <span className="flex items-center justify-center gap-1"><Globe size={11} />Ruta</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">
                  <span className="flex items-center justify-center gap-1"><Server size={11} />API</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">
                  <span className="flex items-center justify-center gap-1"><Cpu size={11} />Backend</span>
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Consistencia</th>
              </tr>
            </thead>
            <tbody>
              {row.modules.map(mod => (
                <tr key={mod.slug} className={cn(
                  "border-t border-border/30",
                  mod.inconsistent ? "bg-red-500/5" : (!mod.configured && !mod.alwaysOn) ? "bg-slate-900/30" : "",
                )}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{mod.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{mod.slug}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusDot on={mod.configured} alwaysOn={mod.alwaysOn} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {mod.layers.includes("menu") ? (
                      mod.menuVisible
                        ? <CheckCircle2 size={14} className="text-emerald-400 mx-auto" />
                        : <XCircle size={14} className="text-red-400 mx-auto" />
                    ) : <Minus size={12} className="text-muted-foreground/30 mx-auto" />}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {mod.layers.includes("route") ? (
                      mod.routeAccessible
                        ? <CheckCircle2 size={14} className="text-emerald-400 mx-auto" />
                        : <XCircle size={14} className="text-red-400 mx-auto" />
                    ) : <Minus size={12} className="text-muted-foreground/30 mx-auto" />}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {mod.layers.includes("api") ? (
                      mod.apiAccessible
                        ? <CheckCircle2 size={14} className="text-emerald-400 mx-auto" />
                        : <XCircle size={14} className="text-red-400 mx-auto" />
                    ) : <Minus size={12} className="text-muted-foreground/30 mx-auto" />}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {mod.layers.includes("backend") ? (
                      mod.backendAccessible
                        ? <CheckCircle2 size={14} className="text-emerald-400 mx-auto" />
                        : <XCircle size={14} className="text-red-400 mx-auto" />
                    ) : <Minus size={12} className="text-muted-foreground/30 mx-auto" />}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {mod.inconsistent
                      ? <span className="flex items-center justify-center gap-1 text-[10px] text-red-400"><AlertTriangle size={11} />Inconsistente</span>
                      : <span className="text-[10px] text-emerald-400/70">✓ OK</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ModuleMatrixPage() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<MatrixResponse>({
    queryKey: ["cc-module-matrix"],
    queryFn: () => authFetch(`${BASE}/api/control-center/module-matrix`).then(r => r.json()) as Promise<MatrixResponse>,
    staleTime: 30_000,
  });

  const lastUpd = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const totalIssues  = data?.matrix.reduce((acc, r) => acc + r.issues.length, 0) ?? 0;
  const totalDisabled = data?.matrix.reduce((acc, r) => acc + r.modules.filter(m => !m.alwaysOn && !m.configured).length, 0) ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Matriz de Acceso de Módulos</h1>
              <p className="text-xs text-slate-400">
                Estado de licencias por workspace en todas las capas del sistema
                {lastUpd && <span className="ml-2 text-emerald-500/70">· Actualizado {lastUpd}</span>}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl border border-border bg-slate-900/60 hover:bg-white/5 text-muted-foreground hover:text-white transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/50 bg-slate-900/60 p-3.5">
            <div className="text-2xl font-bold text-white">{data.matrix.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Workspaces</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-slate-900/60 p-3.5">
            <div className="text-2xl font-bold text-white">{data.catalog.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Módulos en catálogo</div>
          </div>
          <div className={cn("rounded-xl border p-3.5", totalDisabled > 0 ? "border-amber-500/25 bg-amber-500/5" : "border-border/50 bg-slate-900/60")}>
            <div className={cn("text-2xl font-bold", totalDisabled > 0 ? "text-amber-400" : "text-white")}>{totalDisabled}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Módulos desactivados</div>
          </div>
          <div className={cn("rounded-xl border p-3.5", totalIssues > 0 ? "border-red-500/25 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
            <div className={cn("text-2xl font-bold", totalIssues > 0 ? "text-red-400" : "text-emerald-400")}>{totalIssues}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{totalIssues > 0 ? "Inconsistencias" : "Sin inconsistencias"}</div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Leyenda de capas</p>
        <div className="flex flex-wrap gap-3">
          <LayerBadge active={true}  label="Menú visible"      icon={Layout} />
          <LayerBadge active={true}  label="Ruta accesible"    icon={Globe} />
          <LayerBadge active={true}  label="API habilitada"    icon={Server} />
          <LayerBadge active={true}  label="Backend activo"    icon={Cpu} />
          <LayerBadge active={false} label="Menú oculto"       icon={Layout} />
          <LayerBadge active={false} label="Ruta bloqueada"    icon={Globe} />
          <LayerBadge active={false} label="API → 403"         icon={Server} />
          <LayerBadge active={false} label="Backend bloqueado" icon={Cpu} />
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-slate-600/40 text-muted-foreground/40 font-medium">
            <Minus size={10} />N/A — capa no aplicable
          </span>
        </div>
      </div>

      {/* Matrix per workspace */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-border/40 bg-slate-900/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data?.matrix.map(row => (
            <OrgAccordion key={row.org.id} row={row} />
          ))}
          {data?.matrix.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">No hay workspaces registrados.</div>
          )}
        </div>
      )}

      {data && (
        <p className="text-[11px] text-muted-foreground text-right">
          Generado: {new Date(data.generatedAt).toLocaleString("es-ES")}
        </p>
      )}
    </div>
  );
}
