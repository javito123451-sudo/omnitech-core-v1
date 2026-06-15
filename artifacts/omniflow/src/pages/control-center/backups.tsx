import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  HardDrive, Play, RefreshCw, Download, Trash2, ShieldCheck,
  RotateCcw, Database, Settings, ClipboardList, Building2,
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  ChevronDown, ChevronUp, Calendar, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type BackupType   = "full_db" | "workspace" | "config" | "audit";
type BackupStatus = "running" | "completed" | "failed" | "corrupted" | "restored" | "pending";

interface BackupJob {
  id: number; type: BackupType; status: BackupStatus;
  org_id: number | null; file_name: string | null; size_bytes: string | null;
  checksum: string | null; row_count: number | null; error: string | null;
  triggered_by: string | null; metadata: Record<string, unknown> | null;
  started_at: string; completed_at: string | null; expires_at: string | null;
  fileExists?: boolean;
}

interface BackupListResponse {
  jobs: BackupJob[]; total: number; limit: number; offset: number;
  diskBytes: number; backupsDir: string; retentionDays: number;
}

const TYPE_META: Record<BackupType, { label: string; icon: React.ElementType; color: string; desc: string }> = {
  full_db:   { label: "BD Completa",    icon: Database,     color: "text-blue-400",   desc: "pg_dump completo — restauración total" },
  workspace: { label: "Workspace",      icon: Building2,    color: "text-violet-400", desc: "Clientes, presupuestos, citas de una org" },
  config:    { label: "Configuración",  icon: Settings,     color: "text-amber-400",  desc: "Orgs, módulos, licencias, roles" },
  audit:     { label: "Auditoría",      icon: ClipboardList,color: "text-emerald-400",desc: "Registros de auditoría completos" },
};

const STATUS_META: Record<BackupStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: "Pendiente",   color: "text-slate-400",   icon: Clock },
  running:   { label: "Ejecutando",  color: "text-blue-400",    icon: Loader2 },
  completed: { label: "Completado",  color: "text-emerald-400", icon: CheckCircle2 },
  failed:    { label: "Fallido",     color: "text-red-400",     icon: XCircle },
  corrupted: { label: "Corrupto",    color: "text-red-400",     icon: XCircle },
  restored:  { label: "Restaurado",  color: "text-amber-400",   icon: RotateCcw },
};

function fmtBytes(b: string | number | null): string {
  if (!b) return "—";
  const n = Number(b);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function JobRow({ job, onVerify, onRestore, onDownload, onDelete, verifying, restoring }:{
  job: BackupJob;
  onVerify: (id: number) => void; onRestore: (id: number) => void;
  onDownload: (id: number) => void; onDelete: (id: number) => void;
  verifying: number | null; restoring: number | null;
}) {
  const [open, setOpen] = useState(false);
  const tm  = TYPE_META[job.type] ?? TYPE_META.full_db;
  const sm  = STATUS_META[job.status] ?? STATUS_META.pending;
  const TIcon = tm.icon;
  const SIcon = sm.icon;
  const isRunning  = job.status === "running";
  const canRestore = job.status === "completed" && (job.type === "full_db" || job.type === "workspace");
  const canVerify  = job.status === "completed" || job.status === "corrupted";

  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.01] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
          <TIcon size={15} className={tm.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-medium">{tm.label}</span>
            {job.org_id && (
              <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">org:{job.org_id}</span>
            )}
            {job.file_name && (
              <span className="text-xs text-slate-600 font-mono truncate max-w-[220px]">{job.file_name}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`flex items-center gap-1 text-xs ${sm.color}`}>
              <SIcon size={11} className={isRunning ? "animate-spin" : ""} />
              {sm.label}
            </span>
            {job.size_bytes && <span className="text-xs text-slate-600">{fmtBytes(job.size_bytes)}</span>}
            {job.row_count != null && <span className="text-xs text-slate-600">{job.row_count.toLocaleString()} registros</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-slate-600 whitespace-nowrap">
            <Clock size={11} className="inline mr-1" />{fmtDate(job.started_at)}
          </span>
          {open ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-4 ml-12 space-y-3">
          {/* Detail grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><p className="text-slate-600 mb-0.5">Disparado por</p><p className="text-slate-400 font-mono">{job.triggered_by ?? "—"}</p></div>
            <div><p className="text-slate-600 mb-0.5">Completado</p><p className="text-slate-400">{fmtDate(job.completed_at)}</p></div>
            <div><p className="text-slate-600 mb-0.5">Expira</p><p className="text-slate-400">{fmtDate(job.expires_at)}</p></div>
            <div><p className="text-slate-600 mb-0.5">Checksum (SHA-256)</p><p className="text-slate-500 font-mono truncate">{job.checksum ? job.checksum.slice(0, 16) + "…" : "—"}</p></div>
          </div>
          {job.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <p className="text-red-400 text-xs font-mono">{job.error}</p>
            </div>
          )}
          {/* Actions */}
          {!isRunning && (
            <div className="flex items-center gap-2 flex-wrap">
              {canVerify && (
                <button
                  onClick={() => onVerify(job.id)}
                  disabled={verifying === job.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-lg transition-all disabled:opacity-50"
                >
                  {verifying === job.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                  Verificar integridad
                </button>
              )}
              {canRestore && (
                <button
                  onClick={() => { if (confirm(`¿Restaurar este backup? Esta acción sobrescribirá datos actuales.`)) onRestore(job.id); }}
                  disabled={restoring === job.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 rounded-lg transition-all disabled:opacity-50"
                >
                  {restoring === job.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Restaurar
                </button>
              )}
              {job.status === "completed" && (
                <button
                  onClick={() => onDownload(job.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg transition-all"
                >
                  <Download size={12} /> Descargar
                </button>
              )}
              <button
                onClick={() => { if (confirm("¿Eliminar este backup permanentemente?")) onDelete(job.id); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg transition-all ml-auto"
              >
                <Trash2 size={12} /> Eliminar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BackupsPage() {
  const qc             = useQueryClient();
  const { toast }      = useToast();
  const [typeFilter, setTypeFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage]               = useState(0);
  const [verifying, setVerifying]     = useState<number | null>(null);
  const [restoring, setRestoring]     = useState<number | null>(null);
  const [wsOrgId, setWsOrgId]         = useState("");

  const PAGE = 20;

  const buildQ = useCallback(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
    if (typeFilter !== "all")   p.set("type",   typeFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    return p.toString();
  }, [typeFilter, statusFilter, page]);

  const { data, isLoading, isFetching, refetch } = useQuery<BackupListResponse>({
    queryKey: ["cc-backups", typeFilter, statusFilter, page],
    queryFn:  () => authFetch(`${BASE}/api/backups?${buildQ()}`).then(r => r.json()),
    refetchInterval: 8000,
  });

  const triggerBackup = useMutation({
    mutationFn: (vars: { type: BackupType; orgId?: number }) =>
      authFetch(`${BASE}/api/backups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Backup iniciado", description: "Se ejecuta en segundo plano." }); setTimeout(() => refetch(), 3000); },
    onError:   () => toast({ title: "Error", description: "No se pudo iniciar el backup", variant: "destructive" }),
  });

  const applyRetention = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/backups/retention`, { method: "POST" }).then(r => r.json()),
    onSuccess: (d) => { toast({ title: "Retención aplicada", description: `${d.deleted} backup(s) eliminados.` }); refetch(); },
  });

  const handleVerify = async (id: number) => {
    setVerifying(id);
    try {
      const r: { valid: boolean; error?: string } = await authFetch(`${BASE}/api/backups/${id}/verify`, { method: "POST" }).then(r => r.json());
      toast({
        title: r.valid ? "✅ Integridad verificada" : "⚠️ Backup corrupto",
        description: r.valid ? "El checksum SHA-256 coincide." : (r.error ?? "Checksum no coincide."),
        variant: r.valid ? "default" : "destructive",
      });
      refetch();
    } catch { toast({ title: "Error", description: "No se pudo verificar el backup", variant: "destructive" }); }
    finally { setVerifying(null); }
  };

  const handleRestore = async (id: number) => {
    setRestoring(id);
    try {
      const r: { ok?: boolean; error?: string } = await authFetch(`${BASE}/api/backups/${id}/restore`, { method: "POST" }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      toast({ title: "✅ Restauración completada", description: "Los datos han sido restaurados." });
      refetch();
    } catch (err) {
      toast({ title: "Error en restauración", description: String(err), variant: "destructive" });
    } finally { setRestoring(null); }
  };

  const handleDownload = async (id: number) => {
    const a = document.createElement("a");
    a.href  = `${BASE}/api/backups/${id}/download`;
    a.click();
  };

  const handleDelete = async (id: number) => {
    await authFetch(`${BASE}/api/backups/${id}`, { method: "DELETE" });
    refetch();
  };

  const jobs         = data?.jobs ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.max(1, Math.ceil(total / PAGE));
  const diskBytes    = data?.diskBytes ?? 0;
  const retentionDays = data?.retentionDays ?? 30;

  const statsCompleted = jobs.filter(j => j.status === "completed").length;
  const statsFailed    = jobs.filter(j => j.status === "failed" || j.status === "corrupted").length;
  const lastBackup     = jobs.find(j => j.status === "completed");

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <HardDrive size={24} className="text-violet-400" /> Backups y Recuperación
          </h1>
          <p className="text-slate-500 mt-1">
            {total.toLocaleString()} registros — {fmtBytes(diskBytes)} en disco
            {isFetching && <span className="ml-2 text-violet-400 text-xs animate-pulse">actualizando…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => applyRetention.mutate()}
            disabled={applyRetention.isPending}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white rounded-xl text-sm transition-all"
          >
            <RefreshCw size={14} className={applyRetention.isPending ? "animate-spin" : ""} />
            Aplicar retención ({retentionDays}d)
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <p className="text-3xl font-bold text-white">{statsCompleted}</p>
          <p className="text-slate-500 text-sm mt-1">Completados (esta página)</p>
          <CheckCircle2 size={18} className="text-emerald-400 mt-2" />
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <p className="text-3xl font-bold text-white">{statsFailed}</p>
          <p className="text-slate-500 text-sm mt-1">Fallidos / Corruptos</p>
          <XCircle size={18} className="text-red-400 mt-2" />
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <p className="text-lg font-bold text-white truncate">{lastBackup ? fmtDate(lastBackup.started_at) : "Nunca"}</p>
          <p className="text-slate-500 text-sm mt-1">Último backup exitoso</p>
          <Calendar size={18} className="text-blue-400 mt-2" />
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <p className="text-3xl font-bold text-white">{fmtBytes(diskBytes)}</p>
          <p className="text-slate-500 text-sm mt-1">Almacenamiento usado</p>
          <HardDrive size={18} className="text-violet-400 mt-2" />
        </div>
      </div>

      {/* Trigger Backups */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 mb-6">
        <p className="text-white font-semibold mb-4">Crear backup manual</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.entries(TYPE_META) as [BackupType, typeof TYPE_META[BackupType]][]).map(([t, m]) => {
            const Icon = m.icon;
            return (
              <div key={t} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={m.color} />
                  <span className="text-white text-sm font-medium">{m.label}</span>
                </div>
                <p className="text-slate-500 text-xs">{m.desc}</p>
                {t === "workspace" && (
                  <input
                    type="number" placeholder="Org ID" value={wsOrgId}
                    onChange={e => setWsOrgId(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                  />
                )}
                <button
                  onClick={() => triggerBackup.mutate({ type: t, orgId: t === "workspace" ? Number(wsOrgId) : undefined })}
                  disabled={triggerBackup.isPending || (t === "workspace" && !wsOrgId)}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    ${t === "full_db"   ? "bg-blue-600 hover:bg-blue-500 text-white" :
                      t === "workspace" ? "bg-violet-600 hover:bg-violet-500 text-white" :
                      t === "config"    ? "bg-amber-600 hover:bg-amber-500 text-white" :
                                          "bg-emerald-600 hover:bg-emerald-500 text-white"}`}
                >
                  {triggerBackup.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Iniciar
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <Filter size={14} className="text-slate-500" />
        <select
          value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
          className="bg-white/5 border border-white/[0.06] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
        >
          <option value="all">Todos los tipos</option>
          <option value="full_db">BD Completa</option>
          <option value="workspace">Workspace</option>
          <option value="config">Configuración</option>
          <option value="audit">Auditoría</option>
        </select>
        <select
          value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-white/5 border border-white/[0.06] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
        >
          <option value="all">Todos los estados</option>
          <option value="completed">Completados</option>
          <option value="running">En ejecución</option>
          <option value="failed">Fallidos</option>
          <option value="corrupted">Corruptos</option>
          <option value="restored">Restaurados</option>
        </select>
        <span className="text-xs text-slate-600 ml-auto">{total} resultado(s)</span>
      </div>

      {/* Jobs list */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-violet-400" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <HardDrive size={40} className="mx-auto mb-3 opacity-30" />
            <p>No hay backups. Crea el primero con los botones de arriba.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {jobs.map(job => (
              <JobRow
                key={job.id} job={job}
                onVerify={handleVerify} onRestore={handleRestore}
                onDownload={handleDownload} onDelete={handleDelete}
                verifying={verifying} restoring={restoring}
              />
            ))}
          </div>
        )}

        {total > PAGE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total}</p>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all">← Anterior</button>
              <span className="text-xs text-slate-500 py-1.5">Pág {page + 1}/{totalPages}</span>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all">Siguiente →</button>
            </div>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="mt-4 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
        <p className="text-blue-400 text-xs font-medium mb-1">ℹ️ Backup automático diario</p>
        <p className="text-slate-500 text-xs">
          El sistema realiza backups automáticos cada 24h (BD completa + configuración + auditoría).
          Retención: <strong className="text-slate-400">{retentionDays} días</strong>.
          Los backups se almacenan en: <code className="text-slate-400 font-mono">{data?.backupsDir ?? "…/backups"}</code>
        </p>
      </div>
    </div>
  );
}
