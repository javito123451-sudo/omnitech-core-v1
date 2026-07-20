import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Clock, Users, AlertTriangle, CalendarOff, LayoutDashboard,
  LogIn, LogOut, Plus, Check, X, ChevronDown, Timer,
  CircleAlert, Coffee, Loader2, RefreshCw, CheckCircle2,
  UserPlus, Briefcase, CalendarDays, MoreHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "panel" | "trabajadores" | "fichajes" | "incidencias" | "solicitudes";

// ── Types ──────────────────────────────────────────────────────────────────
interface DashboardData {
  totalWorkers: number; todayEntries: number; openEntries: number;
  pendingTimeOff: number; openIncidents: number;
  recentEntries: { id: number; worker_name: string; clock_in_at: string; clock_out_at: string | null; total_minutes: number | null; status: string }[];
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

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMins(mins: number | null): string {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function SeverityBadge({ s }: { s: string }) {
  const styles: Record<string, string> = {
    low:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    high:   "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[s] ?? styles.medium}`}>
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

// ── Stat Card ──────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// PANEL TAB
// ─────────────────────────────────────────────────────────────────────────────

function PanelTab({ data, workers, onClockIn, onClockOut, clockLoading }: {
  data: DashboardData;
  workers: Worker[];
  onClockIn: (workerId: number) => void;
  onClockOut: (workerId: number) => void;
  clockLoading: boolean;
}) {
  const [selectedWorker, setSelectedWorker] = useState<number | "">("");

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Users}        label="Trabajadores"    value={data.totalWorkers} />
        <StatCard icon={Timer}        label="Fichajes hoy"    value={data.todayEntries} color="text-emerald-400" />
        <StatCard icon={Clock}        label="Abiertos"        value={data.openEntries}  color="text-blue-400" />
        <StatCard icon={AlertTriangle} label="Incidencias"    value={data.openIncidents} color="text-amber-400" />
        <StatCard icon={CalendarOff}  label="Solicitudes"     value={data.pendingTimeOff} color="text-purple-400" />
      </div>

      {/* Quick clock-in/out */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400" /> Fichaje rápido
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedWorker}
            onChange={e => setSelectedWorker(Number(e.target.value) || "")}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="">Seleccionar trabajador…</option>
            {workers.filter(w => w.is_active).map(w => (
              <option key={w.id} value={w.id}>{w.name}{w.position ? ` · ${w.position}` : ""}</option>
            ))}
          </select>
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
      </div>

      {/* Recent entries */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300">Fichajes recientes</h3>
        </div>
        {data.recentEntries.length === 0 ? (
          <p className="text-center text-slate-500 py-10 text-sm">Sin fichajes todavía</p>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {data.recentEntries.map(e => (
              <div key={e.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-200">{e.worker_name}</p>
                  <p className="text-xs text-slate-500">{fmtDatetime(e.clock_in_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {e.total_minutes !== null && (
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

function TrabajadoresTab({ workers, refetch }: { workers: Worker[]; refetch: () => void }) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", position: "", weekly_hours: "40", hourly_rate: "" });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      authFetch(`${BASE}/api/time/workers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:         data.name,
          position:     data.position || undefined,
          weekly_hours: Number(data.weekly_hours),
          hourly_rate:  data.hourly_rate ? Number(data.hourly_rate) : undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Trabajador creado" });
      qc.invalidateQueries({ queryKey: ["time-workers"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      setShowForm(false);
      setForm({ name: "", position: "", weekly_hours: "40", hourly_rate: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

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
        <h3 className="text-sm font-semibold text-slate-300">Trabajadores ({workers.length})</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Nuevo
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Nuevo trabajador</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: "name", label: "Nombre *", placeholder: "María García" },
              { key: "position", label: "Cargo", placeholder: "Comercial" },
              { key: "weekly_hours", label: "Horas/semana", placeholder: "40" },
              { key: "hourly_rate", label: "€/hora", placeholder: "12.50" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs text-slate-400 mb-1">{label}</label>
                <input
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              disabled={!form.name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
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
        {workers.length === 0 ? (
          <p className="text-center text-slate-500 py-10 text-sm">No hay trabajadores. Crea el primero.</p>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {workers.map(w => (
              <div key={w.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-emerald-400">{w.name[0]?.toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{w.name}</p>
                    <p className="text-xs text-slate-500">{w.position ?? "Sin cargo"} · {w.weekly_hours}h/semana{w.hourly_rate ? ` · ${w.hourly_rate}€/h` : ""}</p>
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
// FICHAJES TAB
// ─────────────────────────────────────────────────────────────────────────────

function FichajesTab({ workers }: { workers: Worker[] }) {
  const [filters, setFilters] = useState({ worker_id: "", status: "", date_from: "", date_to: "" });

  const { data: entries = [], isLoading, refetch } = useQuery<TimeEntry[]>({
    queryKey: ["time-entries", filters],
    queryFn:  () => {
      const params = new URLSearchParams();
      if (filters.worker_id) params.set("worker_id", filters.worker_id);
      if (filters.status)    params.set("status",    filters.status);
      if (filters.date_from) params.set("date_from", filters.date_from);
      if (filters.date_to)   params.set("date_to",   filters.date_to);
      return authFetch(`${BASE}/api/time/entries?${params}`).then(r => r.json());
    },
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <select
          value={filters.worker_id}
          onChange={e => setFilters(f => ({ ...f, worker_id: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="">Todos los trabajadores</option>
          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
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
        <input
          type="date"
          value={filters.date_from}
          onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
        />
        <input
          type="date"
          value={filters.date_to}
          onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
        />
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-300">{entries.length} fichaje(s)</span>
          <button onClick={() => refetch()} className="text-slate-500 hover:text-slate-300">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <p className="text-center text-slate-500 py-10 text-sm">Sin fichajes en el rango seleccionado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2 text-left">Trabajador</th>
                  <th className="px-4 py-2 text-left">Entrada</th>
                  <th className="px-4 py-2 text-left">Salida</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Extra</th>
                  <th className="px-4 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-200">{e.worker_name}</td>
                    <td className="px-4 py-3 text-slate-400">{fmtDatetime(e.clock_in_at)}</td>
                    <td className="px-4 py-3 text-slate-400">{fmtDatetime(e.clock_out_at)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmtMins(e.total_minutes)}</td>
                    <td className="px-4 py-3 text-right">
                      {e.overtime_minutes > 0 ? (
                        <span className="text-amber-400">{fmtMins(e.overtime_minutes)}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge s={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  const [form, setForm] = useState({ worker_id: "", type: "manual", severity: "medium", description: "" });

  const { data: incidents = [], isLoading, refetch } = useQuery<Incident[]>({
    queryKey: ["time-incidents", showResolved],
    queryFn:  () => authFetch(`${BASE}/api/time/incidents?resolved=${showResolved}`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (d: typeof form) =>
      authFetch(`${BASE}/api/time/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: Number(d.worker_id), type: d.type, severity: d.severity, description: d.description || undefined }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Incidencia creada" });
      qc.invalidateQueries({ queryKey: ["time-incidents"] });
      setShowForm(false);
      setForm({ worker_id: "", type: "manual", severity: "medium", description: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
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
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${showResolved ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" : "border-slate-600 text-slate-500 hover:border-slate-500"}`}
          >
            {showResolved ? "Mostrando resueltas" : "Mostrar resueltas"}
          </button>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Nueva incidencia manual</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trabajador *</label>
              <select
                value={form.worker_id}
                onChange={e => setForm(f => ({ ...f, worker_id: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="">Seleccionar…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
              >
                {Object.entries(incidentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Severidad</label>
              <select
                value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Descripción</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detalle de la incidencia…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              disabled={!form.worker_id || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
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
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
        ) : incidents.length === 0 ? (
          <p className="text-center text-slate-500 py-10 text-sm">
            {showResolved ? "No hay incidencias resueltas" : "🎉 Sin incidencias abiertas"}
          </p>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {incidents.map(inc => (
              <div key={inc.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-slate-200">{inc.worker_name}</p>
                    <SeverityBadge s={inc.severity} />
                    {inc.auto_detected && (
                      <span className="text-xs text-purple-400 border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 rounded-full">Auto</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{incidentTypes[inc.type] ?? inc.type}</p>
                  {inc.description && <p className="text-xs text-slate-500 mt-1">{inc.description}</p>}
                  <p className="text-xs text-slate-600 mt-1">{fmtDatetime(inc.created_at)}</p>
                </div>
                {!inc.resolved_at && (
                  <button
                    onClick={() => resolveMutation.mutate(inc.id)}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-400/50 px-2 py-1 rounded-lg transition-colors shrink-0"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Resolver
                  </button>
                )}
                {inc.resolved_at && (
                  <span className="text-xs text-slate-500">✓ {fmtDatetime(inc.resolved_at)}</span>
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
  const [form, setForm] = useState({ worker_id: "", type: "vacation", start_date: "", end_date: "", reason: "" });

  const { data: requests = [], isLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["time-off"],
    queryFn:  () => authFetch(`${BASE}/api/time/time-off`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (d: typeof form) =>
      authFetch(`${BASE}/api/time/time-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: Number(d.worker_id), type: d.type, start_date: d.start_date, end_date: d.end_date, reason: d.reason || undefined }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Solicitud creada" });
      qc.invalidateQueries({ queryKey: ["time-off"] });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      setShowForm(false);
      setForm({ worker_id: "", type: "vacation", start_date: "", end_date: "", reason: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Solicitudes de ausencia</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva solicitud
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Nueva solicitud</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trabajador *</label>
              <select value={form.worker_id} onChange={e => setForm(f => ({ ...f, worker_id: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500">
                <option value="">Seleccionar…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500">
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Desde *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Hasta *</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Motivo</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Opcional…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" />
          </div>
          <div className="flex gap-2">
            <button
              disabled={!form.worker_id || !form.start_date || !form.end_date || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Crear
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
        ) : requests.length === 0 ? (
          <p className="text-center text-slate-500 py-10 text-sm">Sin solicitudes registradas</p>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {requests.map(r => (
              <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-slate-200">{r.worker_name}</p>
                    <span className="text-xs text-slate-500 border border-slate-600 px-1.5 py-0.5 rounded">{typeLabels[r.type] ?? r.type}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(r.start_date).toLocaleDateString("es-ES")} → {new Date(r.end_date).toLocaleDateString("es-ES")} · {r.days} día(s)
                  </p>
                  {r.reason && <p className="text-xs text-slate-500 mt-0.5">{r.reason}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge s={r.status} />
                  {r.status === "pending" && (
                    <>
                      <button
                        onClick={() => reviewMutation.mutate({ id: r.id, status: "approved" })}
                        className="text-emerald-400 hover:text-emerald-300 p-1 rounded hover:bg-emerald-500/10 transition-colors"
                        title="Aprobar"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => reviewMutation.mutate({ id: r.id, status: "rejected" })}
                        className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors"
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

export default function TimePage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [tab, setTab] = useState<Tab>("panel");
  const [clockLoading, setClockLoading] = useState(false);

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["time-dashboard"],
    queryFn:  () => authFetch(`${BASE}/api/time/dashboard`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["time-workers"],
    queryFn:  () => authFetch(`${BASE}/api/time/workers`).then(r => r.json()),
  });

  const handleClockIn = async (workerId: number) => {
    setClockLoading(true);
    try {
      const res  = await authFetch(`${BASE}/api/time/clock-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
      const data = await res.json() as { error?: string; id?: number };
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast({ title: "Fichaje de entrada registrado ✓" });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Error al fichar", variant: "destructive" });
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
      const data = await res.json() as { error?: string; totalMinutes?: number; overtimeMinutes?: number };
      if (!res.ok) throw new Error(data.error ?? "Error");
      const msg = `Salida registrada · ${data.totalMinutes !== undefined ? `${Math.floor(data.totalMinutes / 60)}h ${data.totalMinutes % 60}m trabajadas` : ""}`;
      toast({ title: msg });
      qc.invalidateQueries({ queryKey: ["time-dashboard"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Error al fichar salida", variant: "destructive" });
    } finally {
      setClockLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "panel",         label: "Panel",         icon: LayoutDashboard },
    { id: "trabajadores",  label: "Trabajadores",  icon: Users },
    { id: "fichajes",      label: "Fichajes",      icon: Clock },
    { id: "incidencias",   label: "Incidencias",   icon: AlertTriangle },
    { id: "solicitudes",   label: "Solicitudes",   icon: CalendarOff },
  ];

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
              <Clock className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">OmniTime</h1>
              <p className="text-xs text-slate-500">Control de presencia y fichajes</p>
            </div>
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

        {/* Tab content */}
        {dashLoading && tab === "panel" ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
          </div>
        ) : (
          <>
            {tab === "panel" && dashboard && (
              <PanelTab
                data={dashboard}
                workers={workers}
                onClockIn={handleClockIn}
                onClockOut={handleClockOut}
                clockLoading={clockLoading}
              />
            )}
            {tab === "trabajadores" && <TrabajadoresTab workers={workers} refetch={() => qc.invalidateQueries({ queryKey: ["time-workers"] })} />}
            {tab === "fichajes"     && <FichajesTab workers={workers} />}
            {tab === "incidencias"  && <IncidenciasTab workers={workers} />}
            {tab === "solicitudes"  && <SolicitudesTab workers={workers} />}
          </>
        )}
      </div>
    </div>
  );
}
