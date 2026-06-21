import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { authFetch } from "@/lib/authFetch";
import {
  Zap, Plus, Play, Pause, Trash2, Clock, CheckCircle2,
  XCircle, ChevronRight, X, Loader2, History, Bot,
  RefreshCw, Calendar, Users, FileText, Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
type AutopilotTask = {
  id: number;
  orgId: number;
  name: string;
  enabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

type AutopilotRun = {
  id: number;
  taskId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
};

// ── Label maps ────────────────────────────────────────────────────────────────
const TRIGGER_LABELS: Record<string, string> = {
  daily:                "Diariamente",
  weekly:               "Cada semana",
  monthly:              "Cada mes",
  inactive_clients_30d: "Clientes inactivos 30 días",
  quotes_expiring_7d:   "Presupuestos por vencer (7 días)",
};

const ACTION_LABELS: Record<string, string> = {
  strategic_brief:      "Briefing estratégico",
  notify_owner:         "Notificar al propietario",
  send_whatsapp:        "Enviar WhatsApp",
  update_client_status: "Actualizar estado de cliente",
  log_activity:         "Registrar actividad",
};

const TRIGGERS = Object.entries(TRIGGER_LABELS);
const ACTIONS  = Object.entries(ACTION_LABELS);

// ── Predefined templates ──────────────────────────────────────────────────────
type Template = {
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  icon: React.ElementType;
  color: string;
  description: string;
};

const TEMPLATES: Template[] = [
  {
    name:          "Briefing semanal",
    triggerType:   "weekly",
    triggerConfig: {},
    actionType:    "strategic_brief",
    actionConfig:  {},
    icon:          Brain,
    color:         "text-violet-400 bg-violet-400/10 border-violet-400/25",
    description:   "Genera un resumen estratégico semanal de tu CRM.",
  },
  {
    name:          "Clientes inactivos",
    triggerType:   "inactive_clients_30d",
    triggerConfig: { days: 30 },
    actionType:    "notify_owner",
    actionConfig:  {},
    icon:          Users,
    color:         "text-amber-400 bg-amber-400/10 border-amber-400/25",
    description:   "Alerta cuando clientes llevan 30+ días sin actividad.",
  },
  {
    name:          "Presupuestos por vencer",
    triggerType:   "quotes_expiring_7d",
    triggerConfig: { days: 7 },
    actionType:    "notify_owner",
    actionConfig:  {},
    icon:          FileText,
    color:         "text-rose-400 bg-rose-400/10 border-rose-400/25",
    description:   "Avisa cuando hay presupuestos enviados que vencen en 7 días.",
  },
  {
    name:          "Seguimiento de leads",
    triggerType:   "inactive_clients_30d",
    triggerConfig: { days: 7 },
    actionType:    "log_activity",
    actionConfig:  {},
    icon:          Calendar,
    color:         "text-cyan-400 bg-cyan-400/10 border-cyan-400/25",
    description:   "Registra actividad cuando leads llevan 7 días sin contacto.",
  },
];

// ── TaskModal ─────────────────────────────────────────────────────────────────
function TaskModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Partial<AutopilotTask>;
  onClose: () => void;
  onSaved: (task: AutopilotTask) => void;
}) {
  const isEdit = !!initial?.id;

  const [name,          setName]          = useState(initial?.name          ?? "");
  const [triggerType,   setTriggerType]   = useState(initial?.triggerType   ?? "weekly");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(initial?.triggerConfig ?? {});
  const [actionType,    setActionType]    = useState(initial?.actionType    ?? "strategic_brief");
  const [actionConfig,  setActionConfig]  = useState<Record<string, unknown>>(initial?.actionConfig  ?? {});
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState("");

  const handleSave = async () => {
    if (!name.trim()) { setError("El nombre es requerido."); return; }
    setSaving(true); setError("");
    try {
      const body = { name: name.trim(), triggerType, triggerConfig, actionType, actionConfig };
      const url    = isEdit ? `${API_BASE}/api/autopilot/tasks/${initial!.id}` : `${API_BASE}/api/autopilot/tasks`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? `Error ${res.status}`);
        return;
      }
      const saved = await res.json() as AutopilotTask;
      onSaved(saved);
      onClose();
    } catch {
      setError("Error de conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-card border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-white flex-1">
            {isEdit ? "Editar tarea" : "Nueva tarea Autopilot"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Nombre</label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej: Briefing lunes" className="bg-background/50 border-border" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Disparador</label>
            <select
              value={triggerType}
              onChange={e => { setTriggerType(e.target.value); setTriggerConfig({}); }}
              className="w-full text-sm bg-background/50 border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {TRIGGERS.map(([val, label]) => (
                <option key={val} value={val} className="bg-background">{label}</option>
              ))}
            </select>
          </div>

          {(triggerType === "inactive_clients_30d" || triggerType === "quotes_expiring_7d") && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Días de umbral</label>
              <Input
                type="number"
                min={1}
                value={String(triggerConfig["days"] ?? (triggerType === "quotes_expiring_7d" ? 7 : 30))}
                onChange={e => setTriggerConfig({ days: Number(e.target.value) })}
                className="bg-background/50 border-border"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Acción</label>
            <select
              value={actionType}
              onChange={e => { setActionType(e.target.value); setActionConfig({}); }}
              className="w-full text-sm bg-background/50 border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {ACTIONS.map(([val, label]) => (
                <option key={val} value={val} className="bg-background">{label}</option>
              ))}
            </select>
          </div>

          {(actionType === "notify_owner" || actionType === "strategic_brief") && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Teléfono propietario <span className="text-[10px] opacity-60">(WhatsApp, opcional)</span>
              </label>
              <Input
                value={String(actionConfig["owner_phone"] ?? "")}
                onChange={e => setActionConfig(prev => ({ ...prev, owner_phone: e.target.value }))}
                placeholder="+34600000000"
                className="bg-background/50 border-border"
              />
            </div>
          )}

          {actionType === "send_whatsapp" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Teléfono destino</label>
                <Input
                  value={String(actionConfig["phone"] ?? "")}
                  onChange={e => setActionConfig(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+34600000000"
                  className="bg-background/50 border-border"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Mensaje</label>
                <textarea
                  value={String(actionConfig["message"] ?? "")}
                  onChange={e => setActionConfig(prev => ({ ...prev, message: e.target.value }))}
                  placeholder="Escribe el mensaje que se enviará…"
                  rows={3}
                  className="w-full text-sm bg-background/50 border border-border rounded-lg px-3 py-2.5 text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5 shrink-0">
          <button onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-border text-sm text-muted-foreground hover:text-white hover:border-white/20 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex-1 h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando…</> : isEdit ? "Actualizar" : "Crear tarea"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── RunsDrawer ────────────────────────────────────────────────────────────────
function RunsDrawer({
  task,
  onClose,
}: {
  task: AutopilotTask;
  onClose: () => void;
}) {
  const [runs,    setRuns]    = useState<AutopilotRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    authFetch(`${API_BASE}/api/autopilot/tasks/${task.id}/runs`)
      .then(r => r.json())
      .then(data => { setRuns(data as AutopilotRun[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, [task.id]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 240 }}
        className="w-80 max-w-full bg-card border-l border-border flex flex-col"
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border shrink-0">
          <History className="w-4 h-4 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{task.name}</p>
            <p className="text-[10px] text-muted-foreground">Historial de ejecuciones</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-muted-foreground text-center">
              <History className="w-7 h-7 opacity-20 mb-2" />
              <p className="text-xs">Sin ejecuciones registradas</p>
              <p className="text-[10px] opacity-60 mt-1">La tarea aún no ha corrido</p>
            </div>
          ) : runs.map((run) => (
            <div key={run.id} className="bg-background/40 border border-white/[0.06] rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                {run.status === "success" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : run.status === "error" ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin" />
                )}
                <span className={cn(
                  "text-[10px] font-medium",
                  run.status === "success" ? "text-emerald-400" :
                  run.status === "error"   ? "text-red-400"     : "text-blue-400",
                )}>
                  {run.status === "success" ? "Exitoso" : run.status === "error" ? "Error" : "En progreso"}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(run.startedAt), { locale: es, addSuffix: true })}
                </span>
              </div>
              {run.resultSummary && (
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">
                  {run.resultSummary}
                </p>
              )}
              {run.errorMessage && (
                <p className="text-[11px] text-red-400/80 leading-relaxed line-clamp-3">
                  {run.errorMessage}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/50">
                {format(new Date(run.startedAt), "dd MMM yyyy, HH:mm", { locale: es })}
              </p>
            </div>
          ))}
        </div>
      </motion.aside>
    </div>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onToggle,
  onDelete,
  onHistory,
  onEdit,
}: {
  task: AutopilotTask;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
  onHistory: (task: AutopilotTask) => void;
  onEdit: (task: AutopilotTask) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "group bg-card border rounded-xl p-4 flex flex-col gap-3 transition-colors",
        task.enabled
          ? "border-white/[0.1] hover:border-white/[0.18]"
          : "border-white/[0.05] opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
            task.enabled ? "bg-primary/10 border border-primary/20" : "bg-white/5 border border-white/10",
          )}>
            <Zap className={cn("w-3.5 h-3.5", task.enabled ? "text-primary" : "text-muted-foreground")} />
          </div>
          <h3 className="text-sm font-semibold text-white truncate">{task.name}</h3>
        </div>
        <Switch
          checked={task.enabled}
          onCheckedChange={(v) => onToggle(task.id, v)}
          className="shrink-0"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{TRIGGER_LABELS[task.triggerType] ?? task.triggerType}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Play className="w-3 h-3 shrink-0" />
          <span>{ACTION_LABELS[task.actionType] ?? task.actionType}</span>
        </div>
      </div>

      {task.lastRunAt && (
        <p className="text-[10px] text-muted-foreground/60">
          Última ejecución: {formatDistanceToNow(new Date(task.lastRunAt), { locale: es, addSuffix: true })}
        </p>
      )}

      <div className="flex items-center gap-1 border-t border-white/[0.05] pt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onHistory(task)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
        >
          <History className="w-3 h-3" />
          Historial
        </button>
        <button
          onClick={() => onEdit(task)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
        >
          Editar
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-400/5 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AutomationsPage() {
  const [tasks,       setTasks]       = useState<AutopilotTask[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [modalTask,   setModalTask]   = useState<Partial<AutopilotTask> | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [historyTask, setHistoryTask] = useState<AutopilotTask | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/autopilot/tasks`);
      if (res.ok) setTasks(await res.json() as AutopilotTask[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  const handleSaved = (saved: AutopilotTask) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === saved.id);
      if (idx >= 0) return prev.map(t => t.id === saved.id ? saved : t);
      return [saved, ...prev];
    });
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, enabled } : t));
    try {
      await authFetch(`${API_BASE}/api/autopilot/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, enabled: !enabled } : t));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar esta tarea Autopilot?")) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    await authFetch(`${API_BASE}/api/autopilot/tasks/${id}`, { method: "DELETE" });
  };

  const openNew = (template?: Template) => {
    setModalTask(template
      ? { name: template.name, triggerType: template.triggerType, triggerConfig: template.triggerConfig, actionType: template.actionType, actionConfig: template.actionConfig }
      : {},
    );
    setShowModal(true);
  };

  const activeCount  = tasks.filter(t => t.enabled).length;
  const pausedCount  = tasks.filter(t => !t.enabled).length;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-white">Ava Autopilot</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Tareas autónomas que Ava ejecuta en segundo plano, sin intervención manual.
          </p>
        </div>
        <button
          onClick={() => openNew()}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nueva tarea
        </button>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total",    value: tasks.length,  color: "text-white" },
            { label: "Activas",  value: activeCount,   color: "text-emerald-400" },
            { label: "Pausadas", value: pausedCount,   color: "text-amber-400" },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-white/[0.07] rounded-xl p-3 text-center">
              <div className={cn("text-2xl font-bold", stat.color)}>{stat.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tasks grid ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-center gap-3 bg-card border border-white/[0.06] rounded-2xl">
          <Zap className="w-10 h-10 text-primary/30" />
          <div>
            <p className="text-sm font-medium text-white">Sin tareas Autopilot</p>
            <p className="text-xs text-muted-foreground mt-1">Activa una plantilla o crea tu primera tarea</p>
          </div>
        </div>
      ) : (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">Tareas activas</h2>
          <AnimatePresence>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onHistory={setHistoryTask}
                  onEdit={t => { setModalTask(t); setShowModal(true); }}
                />
              ))}
            </div>
          </AnimatePresence>
        </div>
      )}

      {/* ── Templates ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
          Plantillas predefinidas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <button
                key={tpl.name}
                onClick={() => openNew(tpl)}
                className="group flex items-start gap-3 bg-card border border-white/[0.07] hover:border-white/[0.18] rounded-xl p-4 text-left transition-all"
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border", tpl.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white">{tpl.name}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{tpl.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-muted-foreground/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5">
                      {TRIGGER_LABELS[tpl.triggerType]}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5">
                      {ACTION_LABELS[tpl.actionType]}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Modals / Drawers ────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <TaskModal
            initial={modalTask ?? undefined}
            onClose={() => { setShowModal(false); setModalTask(null); }}
            onSaved={handleSaved}
          />
        )}
        {historyTask && (
          <RunsDrawer task={historyTask} onClose={() => setHistoryTask(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
