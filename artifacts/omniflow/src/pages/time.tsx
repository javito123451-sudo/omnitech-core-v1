import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Clock, Users, AlertTriangle, CalendarOff, LayoutDashboard,
  LogIn, LogOut, Plus, Check, X, Timer, Loader2, RefreshCw,
  CheckCircle2, UserPlus, ShieldCheck, CalendarDays, ClipboardList,
  ArrowRight, TriangleAlert, ServerCrash, Pencil, Trash2, Wrench, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "panel" | "trabajadores" | "fichajes" | "incidencias" | "solicitudes";

// ── Types ──────────────────────────────────────────────────────────────────

interface DashboardData {
  totalWorkers: number; todayEntries: number; openEntries: number;
  pendingTimeOff: number; openIncidents: number;
  recentEntries: {
    id: number; worker_name: string; clock_in_at: string;
    clock_out_at: string | null; total_minutes: number | null; status: string;
  }[];
}

interface Worker {
  id: number; name: string; position: string | null;
  weekly_hours: number; hourly_rate: number | null; is_active: boolean; user_id: number | null;
}

interface TimeEntry {
  id: number; worker_id: number; worker_name: string;
  clock_in_at: string; clock_out_at: string | null;
  break_minutes: number; total_minutes: number | null;
  overtime_minutes: number; notes: string | null; method: string; status: string;
  incident_count: number;
}

interface Incident {
  id: number; worker_id: number; worker_name: string; entry_id: number | null;
  type: string; severity: string; description: string | null;
  auto_detected: boolean; resolved_at: string | null; created_at: string;
}

interface TimeOffRequest {
  id: number; worker_id: number; worker_name: string;
  type: string; start_date: string; end_date: string;
  days: number; reason: string | null; status: string; created_at: string;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function fmtMins(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmtDatetime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function isoToInputLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ""; }
}

// ── EmptyState ─────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  iconColor?: string;
}

function EmptyState({ icon: Icon, title, description, action, iconColor = "text-slate-500" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className={`w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4`}>
        <Icon className={`w-7 h-7 ${iconColor}`} />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-2">{title}</h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {action.label} <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-900/30 border border-red-700/40 flex items-center justify-center mb-4">
        <ServerCrash className="w-7 h-7 text-red-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-2">Error al cargar los datos</h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">{message ?? "Comprueba la conexión y vuelve a intentarlo."}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      )}
    </div>
  );
}

// ── Badges ─────────────────────────────────────────────────────────────────

function SeverityBadge({ s }: { s: string }) {
  const styles: Record<string, string> = {
    low:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    high:   "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[s] ?? styles["medium"]}`}>
      {labels[s] ?? s}
    </span>
  );
}

function StatusBadge({ s }: { s: string }) {
  const styles: Record<string, string> = {
    open:     "bg-emerald-500/20 text-emerald-400",
    closed:   "bg-slate-500/20 text-slate-400",
    adjusted: "bg-purple-500/20 text-purple-400",
    pending:  "bg-amber-500/20 text-amber-400",
    approved: "bg-emerald-500/20 text-emerald-400",
    rejected: "bg-red-500/20 text-red-400",
  };
  const labels: Record<string, string> = {
    open: "Abierto", closed: "Cerrado", adjusted: "Ajustado",
    pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[s] ?? "bg-slate-500/20 text-slate-400"}`}>
      {labels[s] ?? s}
    </span>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────

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

// ── WorkerSelect helper ────────────────────────────────────────────────────

function WorkerSelect({
  workers,
  value,
  onChange,
  placeholder = "Seleccionar trabajador…",
  onlyActive = false,
  accentColor = "emerald",
}: {
  workers: Worker[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onlyActive?: boolean;
  accentColor?: string;
}) {
  const list = onlyActive ? workers.filter(w => w.is_active) : workers;
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-${accentColor}-500`}
    >
      <option value="">{list.length === 0 ? "— Sin trabajadores —" : placeholder}</option>
      {list.map(w => (
        <option key={w.id} value={w.id}>
          {w.name}{w.position ? ` · ${w.position}` : ""}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL TAB
// ─────────────────────────────────────────────────────────────────────────────

function PanelTab({
  data,
  workers,
  onClockIn,
  onClockOut,
  clockLoading,
  onGoToWorkers,
}: {
  data: DashboardData;
  workers: Worker[];
  onClockIn: (workerId: number) => void;
  onClockOut: (workerId: number) => void;
  clockLoading: boolean;
  onGoToWorkers: () => void;
}) {
  const [selectedWorker, setSelectedWorker] = useState<string>("");
  const activeWorkers = workers.filter(w => w.is_active);
  const noWorkers     = activeWorkers.length === 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Users}         label="Trabajadores"  value={data.totalWorkers}   />
        <StatCard icon={Timer}         label="Fichajes hoy"  value={data.todayEntries}   color="text-emerald-400" />
        <StatCard icon={Clock}         label="Abiertos"      value={data.openEntries}    color="text-blue-400" />
        <StatCard icon={AlertTriangle} label="Incidencias"   value={data.openIncidents}  color="text-amber-400" />
        <StatCard icon={CalendarOff}   label="Solicitudes"   value={data.pendingTimeOff} color="text-purple-400" />
      </div>

      {/* Quick clock-in/out */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400" /> Fichaje rápido
        </h3>

        {noWorkers ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-slate-700/40 rounded-lg px-4 py-3">
            <TriangleAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-sm text-slate-400 flex-1">
              Para fichar necesitas al menos un trabajador activo.
            </p>
            <button
              onClick={onGoToWorkers}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" /> Crear trabajador
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <WorkerSelect
                workers={workers}
                value={selectedWorker}
                onChange={setSelectedWorker}
                onlyActive
              />
            </div>
            <button
              disabled={!selectedWorker || clockLoading}
              onClick={() => selectedWorker && onClockIn(Number(selectedWorker))}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {clockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Fichar entrada
            </button>
            <button
              disabled={!selectedWorker || clockLoading}
              onClick={() => selectedWorker && onClockOut(Number(selectedWorker))}
              className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              <LogOut className="w-4 h-4" /> Fichar salida
            </button>
          </div>
        )}
      </div>

      {/* Recent entries */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300">Fichajes recientes</h3>
        </div>
        {data.recentEntries.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Aún no hay jornadas registradas"
            description="Los fichajes aparecerán aquí en tiempo real cuando los trabajadores empiecen a fichar."
          />
        ) : (
          <div className="divide-y divide-slate-700/30">
            {data.recentEntries.map(e => (
              <div key={e.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-200">{e.worker_name}</p>
                  <p className="text-xs text-slate-500">{fmtDatetime(e.clock_in_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {e.total_minutes !== null && e.total_minutes !== undefined && (
                    <span className="text-xs text-slate-400">{fmtMins(e.total_minutes)}</span>
                  )}
                  <StatusBadge s={e.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRABAJADORES TAB
// ─────────────────────────────────────────────────────────────────────────────

function CreateWorkerForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [form, setForm] = useState({ name: "", position: "", weekly_hours: "40", hourly_rate: "" });

  const mutation = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/time/workers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:         form.name.trim(),
          position:     form.position.trim() || undefined,
          weekly_hours: Number(form.weekly_hours) || 40,
          hourly_rate:  form.hourly_rate ? Number(form.hourly_rate) : undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Trabajador creado" });
      qc.invalidateQueries({ queryKey: ["time-workers"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      onSuccess();
    },
    onError: () => toast({ title: "No se pudo crear el trabajador", variant: "destructive" }),
  });

  const fields: { key: keyof typeof form; label: string; placeholder: string }[] = [
    { key: "name",         label: "Nombre *",       placeholder: "María García" },
    { key: "position",     label: "Cargo",           placeholder: "Comercial" },
    { key: "weekly_hours", label: "Horas/semana",    placeholder: "40" },
    { key: "hourly_rate",  label: "€/hora (opcional)", placeholder: "12.50" },
  ];

  return (
    <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-4">
      <h4 className="text-sm font-semibold text-slate-200">Nuevo trabajador</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-slate-400 mb-1">{label}</label>
            <input
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          disabled={!form.name.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Crear trabajador
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TrabajadoresTab({ workers }: { workers: Worker[] }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      authFetch(`${BASE}/api/time/workers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-workers"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">
          Trabajadores{workers.length > 0 ? ` (${workers.length})` : ""}
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Nuevo trabajador
        </button>
      </div>

      {showForm && (
        <CreateWorkerForm
          onSuccess={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        {workers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Empieza creando tu primer trabajador"
            description="Los trabajadores son las personas cuya presencia y jornada laboral vas a controlar desde OmniTime."
            action={{ label: "Crear primer trabajador", onClick: () => setShowForm(true) }}
            iconColor="text-emerald-400"
          />
        ) : (
          <div className="divide-y divide-slate-700/30">
            {workers.map(w => (
              <div key={w.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-emerald-400">
                      {(w.name[0] ?? "?").toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{w.name}</p>
                    <p className="text-xs text-slate-500">
                      {w.position ?? "Sin cargo"} · {w.weekly_hours}h/semana
                      {w.hourly_rate ? ` · ${w.hourly_rate}€/h` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge s={w.is_active ? "open" : "closed"} />
                  <button
                    onClick={() => toggleMutation.mutate({ id: w.id, is_active: !w.is_active })}
                    className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                  >
                    {w.is_active ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT ENTRY MODAL
// ─────────────────────────────────────────────────────────────────────────────

function EditEntryModal({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    clock_in_at:   isoToInputLocal(entry.clock_in_at),
    clock_out_at:  isoToInputLocal(entry.clock_out_at),
    break_minutes: String(entry.break_minutes ?? 0),
    notes:         entry.notes ?? "",
    status:        entry.status,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/time/entries/${entry.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clock_in_at:   form.clock_in_at  ? new Date(form.clock_in_at).toISOString()  : undefined,
          clock_out_at:  form.clock_out_at ? new Date(form.clock_out_at).toISOString() : undefined,
          break_minutes: Number(form.break_minutes) || 0,
          notes:         form.notes.trim() || undefined,
          status:        form.status,
        }),
      }).then(r => { if (!r.ok) throw new Error("Error"); }),
    onSuccess: () => {
      toast({ title: "Fichaje actualizado ✓" });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      onClose();
    },
    onError: () => toast({ title: "Error al guardar los cambios", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Pencil className="w-4 h-4 text-emerald-400" /> Editar fichaje #{entry.id}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-slate-400">
            Trabajador: <span className="text-slate-200 font-medium">{entry.worker_name}</span>
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entrada</label>
              <input type="datetime-local" value={form.clock_in_at}
                onChange={e => setForm(f => ({ ...f, clock_in_at: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Salida</label>
              <input type="datetime-local" value={form.clock_out_at}
                onChange={e => setForm(f => ({ ...f, clock_out_at: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pausa (min)</label>
              <input type="number" min={0} value={form.break_minutes}
                onChange={e => setForm(f => ({ ...f, break_minutes: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Estado</label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500">
                <option value="open">Abierto</option>
                <option value="closed">Cerrado</option>
                <option value="adjusted">Ajustado</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Observaciones</label>
            <input value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Nota opcional…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
            Cancelar
          </button>
          <button
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FICHAJES TAB
// ─────────────────────────────────────────────────────────────────────────────

function FichajesTab({ workers }: { workers: Worker[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({
    worker_id: "", status: "", date_from: "", date_to: "", search: "",
  });
  const [editEntry, setEditEntry]         = useState<TimeEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const hasFilters = !!(filters.worker_id || filters.status || filters.date_from || filters.date_to || filters.search);

  const { data: entries = [], isLoading, isError, error: entriesError, refetch } = useQuery<TimeEntry[]>({
    queryKey: ["time-entries", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.worker_id) params.set("worker_id", filters.worker_id);
      if (filters.status)    params.set("status",    filters.status);
      if (filters.date_from) params.set("date_from", filters.date_from);
      if (filters.date_to)   params.set("date_to",   filters.date_to);
      if (filters.search)    params.set("search",    filters.search);
      const url = `${BASE}/api/time/entries?${params}`;
      const r = await authFetch(url);
      const bodyText = await r.text();
      if (!r.ok) {
        const err = new Error(
          `HTTP ${r.status} ${r.statusText}\nURL: ${url}\nResponse: ${bodyText}`
        );
        (err as Error & { httpStatus: number; responseBody: string; endpoint: string }).httpStatus = r.status;
        (err as Error & { httpStatus: number; responseBody: string; endpoint: string }).responseBody = bodyText;
        (err as Error & { httpStatus: number; responseBody: string; endpoint: string }).endpoint = url;
        throw err;
      }
      try {
        return JSON.parse(bodyText) as TimeEntry[];
      } catch (parseErr) {
        const err = new Error(
          `JSON parse failed\nURL: ${url}\nStatus: ${r.status}\nBody: ${bodyText}\nParseError: ${String(parseErr)}`
        );
        throw err;
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      authFetch(`${BASE}/api/time/entries/${id}`, { method: "DELETE" }).then(r => {
        if (!r.ok) throw new Error("Error");
      }),
    onSuccess: () => {
      toast({ title: "Fichaje eliminado" });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      setConfirmDelete(null);
    },
    onError: () => toast({ title: "Error al eliminar el fichaje", variant: "destructive" }),
  });

  const resetFilters = () =>
    setFilters({ worker_id: "", status: "", date_from: "", date_to: "", search: "" });

  return (
    <div className="space-y-4">
      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <WorkerSelect
          workers={workers}
          value={filters.worker_id}
          onChange={v => setFilters(f => ({ ...f, worker_id: v }))}
          placeholder="Todos los trabajadores"
        />
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="">Todos los estados</option>
          <option value="open">Abierto</option>
          <option value="closed">Cerrado</option>
          <option value="adjusted">Ajustado</option>
        </select>
        <input type="date" value={filters.date_from}
          onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
        <input type="date" value={filters.date_to}
          onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Buscar trabajador…"
            className="w-full pl-9 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {hasFilters && (
        <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          × Limpiar filtros
        </button>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-300">
            {isLoading ? "Cargando…" : `${entries.length} fichaje(s)`}
          </span>
          <button onClick={() => refetch()} title="Actualizar"
            className="text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : isError ? (
          <div className="p-4 space-y-3">
            <div className="text-red-400 font-bold text-sm">⛔ ERROR — volcado diagnóstico</div>
            <pre className="bg-black/60 border border-red-700/50 rounded-xl p-4 text-xs text-red-300 whitespace-pre-wrap break-all overflow-x-auto font-mono">
{String((entriesError as Error)?.message ?? entriesError)}

--- Stack trace ---
{(entriesError as Error)?.stack ?? "(sin stack)"}
            </pre>
            <button onClick={() => refetch()} className="text-xs text-slate-400 hover:text-slate-200 underline">
              Reintentar
            </button>
          </div>
        ) : entries.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={ClipboardList}
              title="Sin resultados para este filtro"
              description="No hay fichajes que coincidan con los criterios seleccionados."
              action={{ label: "Limpiar filtros", onClick: resetFilters }}
            />
          ) : (
            <EmptyState
              icon={Clock}
              title="No existen fichajes registrados"
              description="Cuando un trabajador fiche entrada desde el Panel, su jornada aparecerá aquí automáticamente."
              iconColor="text-blue-400"
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Trabajador</th>
                  <th className="px-4 py-2 text-left">Entrada</th>
                  <th className="px-4 py-2 text-left">Salida</th>
                  <th className="px-4 py-2 text-right">Horas</th>
                  <th className="px-4 py-2 text-right">Extra</th>
                  <th className="px-4 py-2 text-center">Estado</th>
                  <th className="px-4 py-2 text-center">Incid.</th>
                  <th className="px-4 py-2 text-left">Observaciones</th>
                  <th className="px-4 py-2 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-slate-700/20 transition-colors group">
                    <td className="px-4 py-3 font-medium text-slate-200 whitespace-nowrap">{e.worker_name}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDatetime(e.clock_in_at)}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDatetime(e.clock_out_at)}</td>
                    <td className="px-4 py-3 text-right text-slate-300 whitespace-nowrap">{fmtMins(e.total_minutes)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(e.overtime_minutes ?? 0) > 0
                        ? <span className="text-amber-400">{fmtMins(e.overtime_minutes)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge s={e.status} /></td>
                    <td className="px-4 py-3 text-center">
                      {e.incident_count > 0 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30">
                          {e.incident_count}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[160px]">
                      {e.notes
                        ? <span className="block text-xs truncate" title={e.notes}>{e.notes}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        {/* Editar */}
                        <button onClick={() => setEditEntry(e)} title="Editar"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Corregir */}
                        <button onClick={() => setEditEntry(e)} title="Corregir"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                          <Wrench className="w-3.5 h-3.5" />
                        </button>
                        {/* Eliminar */}
                        {confirmDelete === e.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteMutation.mutate(e.id)}
                              disabled={deleteMutation.isPending}
                              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded font-medium transition-colors disabled:opacity-50"
                            >
                              {deleteMutation.isPending ? "…" : "¿Confirmar?"}
                            </button>
                            <button onClick={() => setConfirmDelete(null)}
                              className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(e.id)} title="Eliminar"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editEntry && (
        <EditEntryModal entry={editEntry} onClose={() => setEditEntry(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENCIAS TAB
// ─────────────────────────────────────────────────────────────────────────────

function IncidenciasTab({ workers }: { workers: Worker[] }) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm] = useState({
    worker_id: "", type: "manual", severity: "medium", description: "",
  });

  const { data: incidents = [], isLoading, isError, refetch } = useQuery<Incident[]>({
    queryKey: ["time-incidents", showResolved],
    queryFn: () =>
      authFetch(`${BASE}/api/time/incidents?resolved=${showResolved}`).then(r => {
        if (!r.ok) throw new Error("Error");
        return r.json() as Promise<Incident[]>;
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/time/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id:   Number(form.worker_id),
          type:        form.type,
          severity:    form.severity,
          description: form.description.trim() || undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Incidencia creada" });
      qc.invalidateQueries({ queryKey: ["time-incidents"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      setShowForm(false);
      setForm({ worker_id: "", type: "manual", severity: "medium", description: "" });
    },
    onError: () => toast({ title: "Error al crear la incidencia", variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) =>
      authFetch(`${BASE}/api/time/incidents/${id}/resolve`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Incidencia resuelta" });
      qc.invalidateQueries({ queryKey: ["time-incidents"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
    },
  });

  const incidentTypes: Record<string, string> = {
    manual: "Manual", late_clock_in: "Entrada tardía", missed_clock_in: "Sin fichar",
    missed_clock_out: "Sin salida", overtime: "Horas extra", pattern: "Patrón detectado",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-300">Incidencias</h3>
          <button
            onClick={() => setShowResolved(!showResolved)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              showResolved
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-slate-600 text-slate-500 hover:border-slate-500"
            }`}
          >
            {showResolved ? "Mostrando resueltas" : "Ver resueltas"}
          </button>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={workers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/80 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva incidencia
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Nueva incidencia manual</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trabajador *</label>
              <WorkerSelect
                workers={workers}
                value={form.worker_id}
                onChange={v => setForm(f => ({ ...f, worker_id: v }))}
                accentColor="amber"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500">
                {Object.entries(incidentTypes).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Severidad</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500">
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Descripción</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detalle de la incidencia…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500" />
          </div>
          <div className="flex gap-2">
            <button
              disabled={!form.worker_id || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Crear
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : incidents.length === 0 ? (
          showResolved ? (
            <EmptyState
              icon={ClipboardList}
              title="No hay incidencias resueltas"
              description="Las incidencias que se resuelvan quedarán registradas aquí para su seguimiento."
            />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No existen incidencias"
              description="No hay incidencias abiertas. El equipo está al día."
              iconColor="text-emerald-400"
            />
          )
        ) : (
          <div className="divide-y divide-slate-700/30">
            {incidents.map(inc => (
              <div key={inc.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <p className="text-sm font-medium text-slate-200">{inc.worker_name}</p>
                    <SeverityBadge s={inc.severity} />
                    {inc.auto_detected && (
                      <span className="text-xs text-purple-400 border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 rounded-full">Auto</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{incidentTypes[inc.type] ?? inc.type}</p>
                  {inc.description && (
                    <p className="text-xs text-slate-500 mt-1">{inc.description}</p>
                  )}
                  <p className="text-xs text-slate-600 mt-1">{fmtDatetime(inc.created_at)}</p>
                </div>
                {!inc.resolved_at ? (
                  <button
                    onClick={() => resolveMutation.mutate(inc.id)}
                    disabled={resolveMutation.isPending}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-400/50 px-2 py-1 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Resolver
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 shrink-0">✓ {fmtDatetime(inc.resolved_at)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLICITUDES TAB
// ─────────────────────────────────────────────────────────────────────────────

function SolicitudesTab({ workers }: { workers: Worker[] }) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    worker_id: "", type: "vacation", start_date: "", end_date: "", reason: "",
  });

  const { data: requests = [], isLoading, isError, refetch } = useQuery<TimeOffRequest[]>({
    queryKey: ["time-off"],
    queryFn: () =>
      authFetch(`${BASE}/api/time/time-off`).then(r => {
        if (!r.ok) throw new Error("Error");
        return r.json() as Promise<TimeOffRequest[]>;
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/time/time-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id:  Number(form.worker_id),
          type:       form.type,
          start_date: form.start_date,
          end_date:   form.end_date,
          reason:     form.reason.trim() || undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Solicitud creada" });
      qc.invalidateQueries({ queryKey: ["time-off"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      setShowForm(false);
      setForm({ worker_id: "", type: "vacation", start_date: "", end_date: "", reason: "" });
    },
    onError: () => toast({ title: "Error al crear la solicitud", variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      authFetch(`${BASE}/api/time/time-off/${id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast({ title: "Solicitud actualizada" });
      qc.invalidateQueries({ queryKey: ["time-off"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
    },
  });

  const typeLabels: Record<string, string> = {
    vacation: "Vacaciones", sick: "Enfermedad", personal: "Personal", other: "Otro",
  };

  const isFormValid = form.worker_id && form.start_date && form.end_date && form.start_date <= form.end_date;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Solicitudes de ausencia</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={workers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva solicitud
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Nueva solicitud de ausencia</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trabajador *</label>
              <WorkerSelect
                workers={workers}
                value={form.worker_id}
                onChange={v => setForm(f => ({ ...f, worker_id: v }))}
                accentColor="purple"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500">
                {Object.entries(typeLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Desde *</label>
              <input type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Hasta *</label>
              <input type="date" value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                min={form.start_date || undefined}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Motivo (opcional)</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Vacaciones de verano, baja médica…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
          </div>
          <div className="flex gap-2">
            <button
              disabled={!isFormValid || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Crear solicitud
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No hay solicitudes pendientes"
            description="Cuando un trabajador solicite días de ausencia, vacaciones o baja, aparecerán aquí para su aprobación."
            action={workers.length > 0 ? { label: "Crear solicitud", onClick: () => setShowForm(true) } : undefined}
            iconColor="text-purple-400"
          />
        ) : (
          <div className="divide-y divide-slate-700/30">
            {requests.map(r => (
              <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-0.5">
                    <p className="text-sm font-medium text-slate-200">{r.worker_name}</p>
                    <span className="text-xs text-slate-500 border border-slate-600 px-1.5 py-0.5 rounded">
                      {typeLabels[r.type] ?? r.type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(r.start_date).toLocaleDateString("es-ES")}
                    {" → "}
                    {new Date(r.end_date).toLocaleDateString("es-ES")}
                    {" · "}{r.days} día(s)
                  </p>
                  {r.reason && <p className="text-xs text-slate-500 mt-0.5 truncate">{r.reason}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge s={r.status} />
                  {r.status === "pending" && (
                    <>
                      <button
                        onClick={() => reviewMutation.mutate({ id: r.id, status: "approved" })}
                        disabled={reviewMutation.isPending}
                        className="text-emerald-400 hover:text-emerald-300 p-1 rounded hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                        title="Aprobar"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => reviewMutation.mutate({ id: r.id, status: "rejected" })}
                        disabled={reviewMutation.isPending}
                        className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        title="Rechazar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_DASHBOARD: DashboardData = {
  totalWorkers: 0, todayEntries: 0, openEntries: 0,
  pendingTimeOff: 0, openIncidents: 0, recentEntries: [],
};

export default function TimePage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [tab, setTab]               = useState<Tab>("panel");
  const [clockLoading, setClockLoading] = useState(false);

  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
    refetch: dashRefetch,
  } = useQuery<DashboardData>({
    queryKey: ["time-dashboard"],
    queryFn: async () => {
      const url = `${BASE}/api/time/dashboard`;
      const r = await authFetch(url);
      const bodyText = await r.text();
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} ${r.statusText}\nURL: ${url}\nResponse: ${bodyText}`);
      }
      try {
        return JSON.parse(bodyText) as DashboardData;
      } catch (pe) {
        throw new Error(`JSON parse error\nURL: ${url}\nStatus: ${r.status}\nBody: ${bodyText}\nParse: ${String(pe)}`);
      }
    },
    refetchInterval: 30_000,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["time-workers"],
    queryFn: () =>
      authFetch(`${BASE}/api/time/workers`).then(r => {
        if (!r.ok) return [] as Worker[];
        return r.json() as Promise<Worker[]>;
      }),
  });

  const handleClockIn = async (workerId: number) => {
    setClockLoading(true);
    try {
      const res  = await authFetch(`${BASE}/api/time/clock-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error al fichar entrada");
      toast({ title: "Fichaje de entrada registrado ✓" });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Error al fichar",
        variant: "destructive",
      });
    } finally {
      setClockLoading(false);
    }
  };

  const handleClockOut = async (workerId: number) => {
    setClockLoading(true);
    try {
      const res  = await authFetch(`${BASE}/api/time/clock-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
      const data = await res.json() as { error?: string; totalMinutes?: number };
      if (!res.ok) throw new Error(data.error ?? "Error al fichar salida");
      const horas = typeof data.totalMinutes === "number"
        ? `${Math.floor(data.totalMinutes / 60)}h ${data.totalMinutes % 60}m trabajadas`
        : "";
      toast({ title: `Salida registrada${horas ? ` · ${horas}` : ""}` });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Error al fichar salida",
        variant: "destructive",
      });
    } finally {
      setClockLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "panel",        label: "Panel",        icon: LayoutDashboard },
    { id: "trabajadores", label: "Trabajadores", icon: Users },
    { id: "fichajes",     label: "Fichajes",     icon: Clock },
    { id: "incidencias",  label: "Incidencias",  icon: AlertTriangle },
    { id: "solicitudes",  label: "Solicitudes",  icon: CalendarOff },
  ];

  // Safe data — never undefined after this point
  const safeData = dashboard ?? EMPTY_DASHBOARD;

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
            <Clock className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">OmniTime</h1>
            <p className="text-xs text-slate-500">Control de presencia y fichajes</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/50 rounded-xl p-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? "bg-emerald-600/90 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Panel tab — three states: loading, error, data (empty or not) */}
        {tab === "panel" && (
          dashLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
              <p className="text-sm text-slate-500">Cargando datos…</p>
            </div>
          ) : dashError ? (
            <div className="bg-slate-800/50 border border-red-700/30 rounded-xl p-4 space-y-3">
              <div className="text-red-400 font-bold text-sm">⛔ ERROR PANEL — volcado diagnóstico</div>
              <pre className="bg-black/60 border border-red-700/50 rounded-xl p-4 text-xs text-red-300 whitespace-pre-wrap break-all overflow-x-auto font-mono">
{String((dashError as Error)?.message ?? dashError)}

--- Stack trace ---
{(dashError as Error)?.stack ?? "(sin stack)"}
              </pre>
              <button onClick={() => dashRefetch()} className="text-xs text-slate-400 hover:text-slate-200 underline">
                Reintentar
              </button>
            </div>
          ) : (
            <PanelTab
              data={safeData}
              workers={workers}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
              clockLoading={clockLoading}
              onGoToWorkers={() => setTab("trabajadores")}
            />
          )
        )}

        {/* Other tabs — always render, each manages its own loading/error/empty */}
        {tab === "trabajadores" && <TrabajadoresTab workers={workers} />}
        {tab === "fichajes"     && <FichajesTab workers={workers} />}
        {tab === "incidencias"  && <IncidenciasTab workers={workers} />}
        {tab === "solicitudes"  && <SolicitudesTab workers={workers} />}
      </div>
    </div>
  );
}
