import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format, addDays, addWeeks, addMonths, subWeeks, subMonths,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, isToday, parseISO, differenceInMinutes, startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, Calendar as CalIcon,
  LayoutGrid, Rows3, X, Trash2, CheckCircle2, XCircle, AlertCircle,
  MapPin, FileText, Tag,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  useListAppointments, useListClients,
  useCreateAppointment, useUpdateAppointment, useDeleteAppointment,
  getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import type { Appointment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOURS     = Array.from({ length: 13 }, (_, i) => i + 8); // 8–20
const CELL_H    = 56; // px per hour
const DAY_START = 8;  // grid starts at 8:00

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  scheduled: { label: "Programada", color: "bg-blue-500/15 text-blue-400 border-blue-500/20",   icon: <Clock className="w-3 h-3"/> },
  completed: { label: "Completada", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="w-3 h-3"/> },
  cancelled: { label: "Cancelada",  color: "bg-red-500/15 text-red-400 border-red-500/20",       icon: <XCircle className="w-3 h-3"/> },
  no_show:   { label: "No asistió", color: "bg-amber-500/15 text-amber-400 border-amber-500/20", icon: <AlertCircle className="w-3 h-3"/> },
};
const APPT_BG: Record<string, string> = {
  scheduled: "bg-blue-500/20  border-blue-500/40  text-blue-100",
  completed: "bg-emerald-500/20 border-emerald-500/40 text-emerald-100",
  cancelled: "bg-red-500/10   border-red-500/30   text-red-200 opacity-60",
  no_show:   "bg-amber-500/15 border-amber-500/35 text-amber-100",
};
const TYPES = ["demo","llamada","reunión","propuesta","onboarding","seguimiento","otro"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekDays(anchor: Date): Date[] {
  const mon = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
function apptStyle(appt: Appointment): React.CSSProperties {
  const start   = parseISO(appt.startTime);
  const end     = parseISO(appt.endTime);
  const topMin  = (start.getHours() - DAY_START) * 60 + start.getMinutes();
  const durMin  = Math.max(differenceInMinutes(end, start), 30);
  return {
    top:    `${topMin * (CELL_H / 60)}px`,
    height: `${durMin * (CELL_H / 60)}px`,
  };
}
function toLocalInput(iso: string, part: "date" | "time") {
  const d = parseISO(iso);
  if (part === "date") return format(d, "yyyy-MM-dd");
  return format(d, "HH:mm");
}

// ── Blank form ────────────────────────────────────────────────────────────────
const blankForm = (date: Date) => ({
  title: "", clientId: "", date: format(date, "yyyy-MM-dd"),
  startTime: "09:00", endTime: "10:00",
  type: "reunión", status: "scheduled", description: "",
});

// ── Appointment chip (week grid) ──────────────────────────────────────────────
function ApptBlock({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const dur = differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime));
  const compact = dur < 45;
  return (
    <button onClick={onClick}
      style={apptStyle(appt)}
      className={cn(
        "absolute left-0.5 right-0.5 rounded-md border px-1.5 py-1 text-left overflow-hidden transition-all hover:brightness-125 hover:z-10 hover:shadow-lg z-[1]",
        APPT_BG[appt.status]
      )}>
      <p className={cn("font-semibold leading-tight truncate", compact ? "text-[10px]" : "text-xs")}>
        {appt.title}
      </p>
      {!compact && appt.clientName && (
        <p className="text-[10px] opacity-70 truncate mt-0.5">{appt.clientName}</p>
      )}
      {!compact && (
        <p className="text-[10px] opacity-60 mt-0.5">
          {format(parseISO(appt.startTime), "HH:mm")}–{format(parseISO(appt.endTime), "HH:mm")}
        </p>
      )}
    </button>
  );
}

// ── Month day cell ─────────────────────────────────────────────────────────────
function MonthCell({
  day, currentMonth, appts, selected, onSelect, onAppt,
}: {
  day: Date; currentMonth: Date; appts: Appointment[];
  selected: boolean; onSelect: () => void; onAppt: (a: Appointment) => void;
}) {
  const today   = isToday(day);
  const inMonth = isSameMonth(day, currentMonth);
  return (
    <div onClick={onSelect}
      className={cn(
        "min-h-[80px] md:min-h-[100px] p-1.5 border-b border-r border-border/30 cursor-pointer transition-colors",
        inMonth ? "bg-transparent hover:bg-white/[0.02]" : "bg-white/[0.01]",
        selected && "bg-primary/5 ring-1 ring-inset ring-primary/20",
      )}>
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium mb-1 mx-auto",
        today      ? "bg-primary text-white"       :
        inMonth    ? "text-white"                  :
                     "text-muted-foreground/40",
        !today && selected && "bg-white/10",
      )}>
        {day.getDate()}
      </div>
      <div className="space-y-0.5">
        {appts.slice(0, 3).map(a => (
          <button key={a.id} onClick={e => { e.stopPropagation(); onAppt(a); }}
            className={cn(
              "w-full text-left rounded px-1 py-0.5 text-[10px] truncate border transition-all hover:brightness-125",
              APPT_BG[a.status]
            )}>
            {a.title}
          </button>
        ))}
        {appts.length > 3 && (
          <p className="text-[9px] text-muted-foreground text-center">+{appts.length - 3} más</p>
        )}
      </div>
    </div>
  );
}

// ── Appointment detail panel ───────────────────────────────────────────────────
function ApptDetail({
  appt, onEdit, onDelete, onClose, onStatusChange,
}: {
  appt: Appointment; onEdit: () => void; onDelete: () => void;
  onClose: () => void; onStatusChange: (s: string) => void;
}) {
  const sm = STATUS_META[appt.status];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-[#131929] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h3 className="text-base font-bold text-white">{appt.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={cn("text-[10px] px-2 h-5 flex items-center gap-1", sm.color)}>
                {sm.icon} {sm.label}
              </Badge>
              {appt.type && (
                <span className="text-[10px] text-muted-foreground capitalize">{appt.type}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-primary shrink-0"/>
            <span className="text-white">
              {format(parseISO(appt.startTime), "EEEE d 'de' MMMM", { locale: es })}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Tag className="w-4 h-4 text-muted-foreground shrink-0"/>
            <span className="text-slate-300">
              {format(parseISO(appt.startTime), "HH:mm")} – {format(parseISO(appt.endTime), "HH:mm")}
              <span className="text-muted-foreground ml-2 text-xs">
                ({differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime))} min)
              </span>
            </span>
          </div>
          {appt.clientName && (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-muted-foreground shrink-0"/>
              <span className="text-slate-300">{appt.clientName}</span>
            </div>
          )}
          {appt.description && (
            <div className="flex gap-2">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5"/>
              <p className="text-sm text-slate-400">{appt.description}</p>
            </div>
          )}
        </div>

        {/* Quick status change */}
        <div className="px-5 pb-4">
          <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide">Cambiar estado</p>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(STATUS_META).map(([key, m]) => (
              <button key={key} onClick={() => onStatusChange(key)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all",
                  appt.status === key
                    ? m.color + " ring-1 ring-inset ring-current"
                    : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20"
                )}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1 h-9">
            Editar
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}
            className="h-9 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50">
            <Trash2 className="w-3.5 h-3.5"/>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Appointment form modal ────────────────────────────────────────────────────
function ApptModal({
  initial, editId, onClose,
}: {
  initial: ReturnType<typeof blankForm>;
  editId?: number;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { data: clients = [] } = useListClients();
  const createMut = useCreateAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); onClose(); } },
  });
  const updateMut = useUpdateAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); onClose(); } },
  });
  const saving = createMut.isPending || updateMut.isPending;

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const submit = () => {
    if (!form.title.trim()) { setError("El título es obligatorio"); return; }
    if (!form.clientId)     { setError("Selecciona un cliente"); return; }
    setError("");
    const startISO = new Date(`${form.date}T${form.startTime}`).toISOString();
    const endISO   = new Date(`${form.date}T${form.endTime}`).toISOString();
    if (endISO <= startISO) { setError("La hora de fin debe ser posterior a la de inicio"); return; }

    const data = {
      title:       form.title.trim(),
      clientId:    Number(form.clientId),
      startTime:   startISO,
      endTime:     endISO,
      status:      form.status as "scheduled" | "completed" | "cancelled" | "no_show",
      type:        form.type,
      description: form.description.trim() || undefined,
    };

    if (editId) updateMut.mutate({ id: editId, data });
    else        createMut.mutate({ data });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}
        className="w-full max-w-lg bg-[#131929] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-base font-bold text-white">
            {editId ? "Editar cita" : "Nueva cita"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5">
            <X className="w-4 h-4"/>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Título *</label>
            <Input value={form.title} onChange={f("title")}
              placeholder="Ej. Demo de la plataforma"
              className="bg-background/40 border-white/[0.1] text-white h-9"/>
          </div>

          {/* Client */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Cliente *</label>
            <select value={form.clientId} onChange={f("clientId")}
              className="w-full h-9 rounded-md border border-white/[0.1] bg-background/40 text-white text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary/50">
              <option value="" className="bg-[#131929]">Seleccionar cliente…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id} className="bg-[#131929]">{c.name}{c.company ? ` · ${c.company}` : ""}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Fecha *</label>
            <Input type="date" value={form.date} onChange={f("date")}
              className="bg-background/40 border-white/[0.1] text-white h-9 [color-scheme:dark]"/>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Hora inicio *</label>
              <Input type="time" value={form.startTime} onChange={f("startTime")}
                className="bg-background/40 border-white/[0.1] text-white h-9 [color-scheme:dark]"/>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Hora fin *</label>
              <Input type="time" value={form.endTime} onChange={f("endTime")}
                className="bg-background/40 border-white/[0.1] text-white h-9 [color-scheme:dark]"/>
            </div>
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
              <select value={form.type} onChange={f("type")}
                className="w-full h-9 rounded-md border border-white/[0.1] bg-background/40 text-white text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary/50 capitalize">
                {TYPES.map(t => <option key={t} value={t} className="bg-[#131929] capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Estado</label>
              <select value={form.status} onChange={f("status")}
                className="w-full h-9 rounded-md border border-white/[0.1] bg-background/40 text-white text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary/50">
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <option key={k} value={k} className="bg-[#131929]">{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
            <textarea value={form.description} onChange={f("description")}
              placeholder="Detalles adicionales, agenda, objetivos…"
              rows={3}
              className="w-full rounded-md border border-white/[0.1] bg-background/40 text-white text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none placeholder:text-muted-foreground/50"/>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5"/> {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-2 border-t border-white/[0.07]">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={submit} disabled={saving}
            className="flex-1 h-9 bg-gradient-to-r from-primary to-violet-600 hover:opacity-90 text-white">
            {saving ? "Guardando…" : editId ? "Guardar cambios" : "Crear cita"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main calendar page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [view,         setView]         = useState<"week" | "month">("week");
  const [anchor,       setAnchor]       = useState(new Date());
  const [selectedDay,  setSelectedDay]  = useState<Date>(startOfDay(new Date()));
  const [detailAppt,   setDetailAppt]   = useState<Appointment | null>(null);
  const [showModal,    setShowModal]    = useState(false);
  const [editAppt,     setEditAppt]     = useState<Appointment | null>(null);
  const [initialForm,  setInitialForm]  = useState(() => blankForm(new Date()));

  const qc = useQueryClient();
  const { data: appointments = [], isLoading } = useListAppointments();
  const deleteMut = useDeleteAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetailAppt(null); } },
  });
  const updateMut = useUpdateAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetailAppt(null); } },
  });

  const weekDays   = useMemo(() => getWeekDays(anchor), [anchor]);
  const monthStart = startOfMonth(anchor);
  const monthEnd   = endOfMonth(anchor);
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd     = addDays(startOfWeek(monthEnd, { weekStartsOn: 1 }), 6);
  const monthCells = useMemo(() => eachDayOfInterval({ start: calStart, end: calEnd }), [calStart, calEnd]);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach(a => {
      const key = format(parseISO(a.startTime), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [appointments]);

  const openCreate = (day?: Date) => {
    setEditAppt(null);
    setInitialForm(blankForm(day ?? anchor));
    setShowModal(true);
  };
  const openEdit = (a: Appointment) => {
    setDetailAppt(null);
    setEditAppt(a);
    setInitialForm({
      title:       a.title,
      clientId:    String(a.clientId),
      date:        toLocalInput(a.startTime, "date"),
      startTime:   toLocalInput(a.startTime, "time"),
      endTime:     toLocalInput(a.endTime,   "time"),
      type:        a.type ?? "reunión",
      status:      a.status,
      description: a.description ?? "",
    });
    setShowModal(true);
  };

  const nav = (dir: 1 | -1) => {
    if (view === "week")  setAnchor(dir === 1 ? addWeeks(anchor, 1)  : subWeeks(anchor, 1));
    else                  setAnchor(dir === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1));
  };

  const selectedDayAppts = (apptsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [])
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] gap-0 animate-in fade-in duration-300">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-3xl font-bold text-white tracking-tight">Calendario</h1>
          <p className="text-muted-foreground text-xs mt-0.5 hidden sm:block">Gestiona tu agenda y citas.</p>
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-xl border border-border bg-card p-1 gap-1">
          <button onClick={() => setView("week")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
              view === "week" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-white")}>
            <Rows3 className="w-3.5 h-3.5"/> <span className="hidden sm:inline">Semana</span>
          </button>
          <button onClick={() => setView("month")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
              view === "month" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-white")}>
            <LayoutGrid className="w-3.5 h-3.5"/> <span className="hidden sm:inline">Mes</span>
          </button>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-1">
          <button onClick={() => nav(-1)} className="p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-white/5 transition-colors border border-border">
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => setAnchor(new Date())}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-colors border border-border hidden sm:flex">
            Hoy
          </button>
          <button onClick={() => nav(1)} className="p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-white/5 transition-colors border border-border">
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>

        {/* Current period label */}
        <span className="text-sm font-semibold text-white hidden md:block min-w-[140px] text-center capitalize">
          {view === "week"
            ? `${format(weekDays[0], "d MMM", { locale: es })} – ${format(weekDays[6], "d MMM yyyy", { locale: es })}`
            : format(anchor, "MMMM yyyy", { locale: es })
          }
        </span>

        <Button size="sm" onClick={() => openCreate()}
          className="bg-gradient-to-r from-primary to-violet-600 hover:opacity-90 text-white shrink-0 h-9">
          <Plus className="w-4 h-4 mr-1"/> <span className="hidden sm:inline">Nueva </span>Cita
        </Button>
      </div>

      {/* ── Week View ── */}
      {view === "week" && (
        <div className="flex flex-1 flex-col overflow-hidden bg-card border border-border rounded-xl">
          {/* Day headers */}
          <div className="flex border-b border-border shrink-0">
            <div className="w-12 shrink-0"/>
            {weekDays.map((d, i) => (
              <div key={i} onClick={() => { setSelectedDay(d); setView("week"); }}
                className={cn(
                  "flex-1 py-2.5 text-center cursor-pointer transition-colors",
                  isSameDay(d, selectedDay) && "bg-primary/10",
                  "hover:bg-white/5"
                )}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {format(d, "EEE", { locale: es })}
                </p>
                <p className={cn(
                  "text-sm font-bold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto",
                  isToday(d) && "bg-primary text-white",
                  !isToday(d) && isSameDay(d, selectedDay) && "bg-white/10 text-white",
                  !isToday(d) && !isSameDay(d, selectedDay) && "text-white",
                )}>
                  {format(d, "d")}
                </p>
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div className="flex flex-1 overflow-y-auto">
            {/* Hour labels */}
            <div className="w-12 shrink-0 border-r border-border/50">
              {HOURS.map(h => (
                <div key={h} style={{ height: CELL_H }} className="flex items-start justify-end pr-2 pt-1">
                  <span className="text-[9px] text-muted-foreground/60">{h}:00</span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map((d, i) => {
              const key   = format(d, "yyyy-MM-dd");
              const dayA  = (apptsByDay.get(key) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
              const today = isToday(d);
              return (
                <div key={i} onClick={() => { setSelectedDay(d); openCreate(d); }}
                  className={cn(
                    "flex-1 relative border-r border-border/20 cursor-pointer",
                    today && "bg-primary/[0.03]",
                  )}>
                  {/* Hour lines */}
                  {HOURS.map(h => (
                    <div key={h} style={{ height: CELL_H }}
                      className="border-b border-border/20 hover:bg-white/[0.02] transition-colors"/>
                  ))}

                  {/* Appointments */}
                  <div className="absolute inset-0 pointer-events-none">
                    {dayA.map(a => (
                      <div key={a.id} className="pointer-events-auto" onClick={e => { e.stopPropagation(); setDetailAppt(a); }}>
                        <ApptBlock appt={a} onClick={() => setDetailAppt(a)}/>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Month View ── */}
      {view === "month" && (
        <div className="flex flex-1 flex-col overflow-hidden bg-card border border-border rounded-xl">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-border shrink-0">
            {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
              <div key={d} className="py-2 text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 flex-1 overflow-y-auto">
            {monthCells.map((day, i) => (
              <MonthCell
                key={i} day={day} currentMonth={anchor}
                appts={apptsByDay.get(format(day, "yyyy-MM-dd")) ?? []}
                selected={isSameDay(day, selectedDay)}
                onSelect={() => { setSelectedDay(day); }}
                onAppt={a => setDetailAppt(a)}
              />
            ))}
          </div>

          {/* Selected day appointment list */}
          {selectedDay && (
            <div className="border-t border-border px-4 py-3 bg-background/30 shrink-0 max-h-40 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white capitalize">
                  {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
                </p>
                <button onClick={() => openCreate(selectedDay)}
                  className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3"/> Añadir cita
                </button>
              </div>
              {selectedDayAppts.length === 0
                ? <p className="text-xs text-muted-foreground">Sin citas este día.</p>
                : selectedDayAppts.map(a => (
                  <div key={a.id} onClick={() => setDetailAppt(a)}
                    className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-white/5 rounded-lg px-2 -mx-2 transition-colors">
                    <div className={cn("w-2 h-2 rounded-full shrink-0",
                      a.status === "scheduled" ? "bg-blue-400" :
                      a.status === "completed" ? "bg-emerald-400" : "bg-slate-400")}/>
                    <span className="text-xs text-white font-medium truncate flex-1">{a.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {format(parseISO(a.startTime), "HH:mm")}
                    </span>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      <AnimatePresence>
        {detailAppt && (
          <ApptDetail
            appt={detailAppt}
            onClose={() => setDetailAppt(null)}
            onEdit={() => openEdit(detailAppt)}
            onDelete={() => deleteMut.mutate({ id: detailAppt.id })}
            onStatusChange={status => updateMut.mutate({ id: detailAppt.id, data: { status: status as "scheduled" | "completed" | "cancelled" | "no_show" } })}
          />
        )}
        {showModal && (
          <ApptModal
            initial={initialForm}
            editId={editAppt?.id}
            onClose={() => { setShowModal(false); setEditAppt(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
