import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format, addDays, addWeeks, addMonths, subWeeks, subMonths,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, isToday, parseISO, differenceInMinutes,
  startOfDay, getHours, getMinutes, isAfter, isBefore,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, LayoutGrid, Rows3,
  X, Trash2, CheckCircle2, XCircle, AlertCircle, FileText, Phone,
  Video, Users, Handshake, RefreshCw, HelpCircle, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Badge }  from "@/components/ui/badge";
import {
  useListAppointments, useListClients,
  useCreateAppointment, useUpdateAppointment, useDeleteAppointment,
  getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import type { Appointment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const HOURS     = Array.from({ length: 14 }, (_, i) => i + 7); // 7–20
const CELL_H    = 64; // px per hour
const DAY_START = 7;

const STATUS_CFG: Record<string, { label: string; ring: string; dot: string; badge: string }> = {
  scheduled: { label: "Programada", ring: "ring-blue-500/30",   dot: "bg-blue-400",    badge: "bg-blue-500/15 text-blue-300 border-blue-500/25" },
  completed: { label: "Completada", ring: "ring-emerald-500/30",dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" },
  cancelled: { label: "Cancelada",  ring: "ring-red-500/20",    dot: "bg-red-400",     badge: "bg-red-500/10 text-red-300 border-red-500/20" },
  no_show:   { label: "No asistió", ring: "ring-amber-500/25",  dot: "bg-amber-400",   badge: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
};

const TYPE_CFG: Record<string, { label: string; color: string; bar: string; icon: React.ReactNode }> = {
  demo:        { label: "Demo",        color: "from-violet-500/30 to-violet-500/10",  bar: "bg-violet-400",  icon: <Video className="w-3 h-3"/> },
  llamada:     { label: "Llamada",     color: "from-sky-500/30 to-sky-500/10",        bar: "bg-sky-400",     icon: <Phone className="w-3 h-3"/> },
  "reunión":   { label: "Reunión",     color: "from-blue-500/30 to-blue-500/10",      bar: "bg-blue-400",    icon: <Users className="w-3 h-3"/> },
  propuesta:   { label: "Propuesta",   color: "from-emerald-500/30 to-emerald-500/10",bar: "bg-emerald-400", icon: <Handshake className="w-3 h-3"/> },
  onboarding:  { label: "Onboarding",  color: "from-amber-500/30 to-amber-500/10",    bar: "bg-amber-400",   icon: <CheckCircle2 className="w-3 h-3"/> },
  seguimiento: { label: "Seguimiento", color: "from-indigo-500/30 to-indigo-500/10",  bar: "bg-indigo-400",  icon: <RefreshCw className="w-3 h-3"/> },
  otro:        { label: "Otro",        color: "from-slate-500/30 to-slate-500/10",    bar: "bg-slate-400",   icon: <HelpCircle className="w-3 h-3"/> },
};
const TYPES = Object.keys(TYPE_CFG);

function getTypeCfg(type?: string | null) {
  return TYPE_CFG[type ?? ""] ?? TYPE_CFG["otro"];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekDays(anchor: Date): Date[] {
  const mon = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

function apptTopPx(iso: string) {
  const d = parseISO(iso);
  return ((getHours(d) - DAY_START) * 60 + getMinutes(d)) * (CELL_H / 60);
}
function apptHeightPx(start: string, end: string) {
  return Math.max(differenceInMinutes(parseISO(end), parseISO(start)), 30) * (CELL_H / 60);
}

function toDateStr(iso: string)  { return format(parseISO(iso), "yyyy-MM-dd"); }
function toTimeStr(iso: string)  { return format(parseISO(iso), "HH:mm"); }
function toISO(date: string, time: string) { return new Date(`${date}T${time}`).toISOString(); }

const blankForm = (date = new Date()) => ({
  title: "", clientId: "",
  date:      format(date, "yyyy-MM-dd"),
  startTime: "09:00", endTime: "10:00",
  type: "reunión", status: "scheduled", description: "",
});

function nowMinuteOffset() {
  const now = new Date();
  return ((getHours(now) - DAY_START) * 60 + getMinutes(now)) * (CELL_H / 60);
}

// ─── Appointment block (week grid) ────────────────────────────────────────────

function ApptBlock({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const top    = apptTopPx(appt.startTime);
  const height = apptHeightPx(appt.startTime, appt.endTime);
  const tc     = getTypeCfg(appt.type);
  const sc     = STATUS_CFG[appt.status] ?? STATUS_CFG.scheduled;
  const compact = height < 42;
  const mini    = height < 28;

  return (
    <button onClick={onClick}
      style={{ top, height, position: "absolute", left: 2, right: 2 }}
      className={cn(
        "rounded-lg border border-white/10 overflow-hidden text-left transition-all z-[1]",
        "hover:z-10 hover:shadow-xl hover:scale-[1.01] hover:border-white/20",
        "bg-gradient-to-r", tc.color,
        appt.status === "cancelled" && "opacity-50 grayscale-[40%]"
      )}>
      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", tc.bar)} />

      <div className="pl-2.5 pr-1.5 py-1 h-full flex flex-col justify-start min-h-0">
        {mini ? (
          <p className="text-[9px] font-semibold text-white truncate leading-tight">{appt.title}</p>
        ) : compact ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-white truncate flex-1">{appt.title}</span>
            <span className="text-[9px] text-white/50 shrink-0">{format(parseISO(appt.startTime), "HH:mm")}</span>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-1 mb-0.5">
              <span className={cn("shrink-0 mt-0.5 opacity-70", tc.bar.replace("bg-", "text-"))}>{tc.icon}</span>
              <p className="text-xs font-semibold text-white leading-snug line-clamp-2">{appt.title}</p>
            </div>
            {appt.clientName && (
              <p className="text-[10px] text-white/60 truncate mt-0.5 pl-0.5">{appt.clientName}</p>
            )}
            <p className="text-[9px] text-white/45 mt-auto pt-0.5 pl-0.5">
              {format(parseISO(appt.startTime), "HH:mm")}–{format(parseISO(appt.endTime), "HH:mm")}
            </p>
          </>
        )}
      </div>

      {/* Status dot */}
      <div className={cn("absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full", sc.dot)} />
    </button>
  );
}

// ─── Month day cell ───────────────────────────────────────────────────────────

function MonthCell({ day, currentMonth, appts, selected, onSelect, onAppt }: {
  day: Date; currentMonth: Date; appts: Appointment[];
  selected: boolean; onSelect: () => void; onAppt: (a: Appointment) => void;
}) {
  const today   = isToday(day);
  const inMonth = isSameMonth(day, currentMonth);

  return (
    <div onClick={onSelect}
      className={cn(
        "group min-h-[90px] md:min-h-[110px] p-1.5 border-b border-r border-white/[0.05] cursor-pointer transition-all relative",
        inMonth ? "hover:bg-white/[0.025]" : "bg-black/10",
        selected && "bg-primary/[0.06]",
      )}>
      {/* Day number */}
      <div className={cn(
        "w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold mx-auto mb-1 transition-all",
        today         ? "bg-primary text-white shadow-lg shadow-primary/40"  :
        selected      ? "bg-white/15 text-white"                             :
        inMonth       ? "text-slate-300 group-hover:bg-white/10"             :
                        "text-slate-600",
      )}>
        {day.getDate()}
      </div>

      {/* Appointment chips */}
      <div className="space-y-0.5 px-0.5">
        {appts.slice(0, 3).map(a => {
          const tc = getTypeCfg(a.type);
          return (
            <button key={a.id} onClick={e => { e.stopPropagation(); onAppt(a); }}
              className="w-full text-left flex items-center gap-1 rounded-md px-1 py-0.5 hover:brightness-125 transition-all overflow-hidden">
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", tc.bar)} />
              <span className="text-[10px] text-slate-300 truncate leading-tight">{a.title}</span>
            </button>
          );
        })}
        {appts.length > 3 && (
          <p className="text-[9px] text-slate-500 pl-1">+{appts.length - 3} más</p>
        )}
      </div>

      {/* Today glow */}
      {today && <div className="absolute inset-0 ring-1 ring-inset ring-primary/20 rounded-sm pointer-events-none"/>}
    </div>
  );
}

// ─── Appointment detail drawer ────────────────────────────────────────────────

function ApptDetail({ appt, onEdit, onDelete, onClose, onStatusChange }: {
  appt: Appointment; onEdit: () => void; onDelete: () => void;
  onClose: () => void; onStatusChange: (s: string) => void;
}) {
  const sc = STATUS_CFG[appt.status] ?? STATUS_CFG.scheduled;
  const tc = getTypeCfg(appt.type);
  const dur = differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime));

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Backdrop */}
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}/>

      {/* Panel */}
      <motion.div className="relative w-full md:max-w-md bg-[#0f1825] border border-white/[0.08] md:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden"
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 380 }}>

        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 pb-0 md:hidden">
          <div className="w-8 h-1 rounded-full bg-white/20"/>
        </div>

        {/* Type banner */}
        <div className={cn("px-5 pt-4 pb-3 bg-gradient-to-r", tc.color, "border-b border-white/[0.06]")}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="opacity-70">{tc.icon}</span>
                <span className="text-xs font-medium text-white/60 capitalize">{tc.label}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 font-medium", sc.badge)}>
                  {sc.label}
                </Badge>
              </div>
              <h3 className="text-lg font-bold text-white leading-snug">{appt.title}</h3>
            </div>
            <button onClick={onClose}
              className="ml-2 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0">
              <X className="w-4 h-4"/>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-2.5">
          {/* Date/time */}
          <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <CalendarDays className="w-4 h-4 text-primary shrink-0"/>
            <div>
              <p className="text-sm font-medium text-white capitalize">
                {format(parseISO(appt.startTime), "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {format(parseISO(appt.startTime), "HH:mm")} – {format(parseISO(appt.endTime), "HH:mm")}
                <span className="ml-2 text-slate-500">{dur} min</span>
              </p>
            </div>
          </div>

          {/* Client */}
          {appt.clientName && (
            <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <User className="w-4 h-4 text-slate-400 shrink-0"/>
              <p className="text-sm text-white">{appt.clientName}</p>
            </div>
          )}

          {/* Notes */}
          {appt.description && (
            <div className="flex gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5"/>
              <p className="text-sm text-slate-300 leading-relaxed">{appt.description}</p>
            </div>
          )}

          {/* Status picker */}
          <div>
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Estado</p>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(STATUS_CFG).map(([key, s]) => (
                <button key={key} onClick={() => onStatusChange(key)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                    appt.status === key
                      ? cn(s.badge, "ring-1 ring-inset ring-current shadow-sm")
                      : "bg-white/[0.03] border-white/[0.07] text-slate-400 hover:bg-white/[0.06] hover:text-white"
                  )}>
                  <div className={cn("w-2 h-2 rounded-full shrink-0", s.dot)}/>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-6 pt-1">
          <Button variant="outline" size="sm" onClick={onEdit}
            className="flex-1 h-10 text-sm font-medium">
            Editar cita
          </Button>
          <button onClick={onDelete}
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-red-500/25 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40 transition-all">
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Appointment form modal ────────────────────────────────────────────────────

function ApptModal({ initial, editId, onClose }: {
  initial: ReturnType<typeof blankForm>; editId?: number; onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { data: clients = [] } = useListClients();

  const inv = { mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); onClose(); } } };
  const createMut = useCreateAppointment(inv);
  const updateMut = useUpdateAppointment(inv);
  const saving    = createMut.isPending || updateMut.isPending;

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!form.title.trim()) { setError("El título es obligatorio"); return; }
    if (!form.clientId)     { setError("Selecciona un cliente"); return; }
    const s = toISO(form.date, form.startTime);
    const e = toISO(form.date, form.endTime);
    if (e <= s) { setError("La hora de fin debe ser posterior al inicio"); return; }
    setError("");
    const data = {
      title:       form.title.trim(),
      clientId:    Number(form.clientId),
      startTime:   s,
      endTime:     e,
      status:      form.status as "scheduled" | "completed" | "cancelled" | "no_show",
      type:        form.type,
      description: form.description.trim() || undefined,
    };
    if (editId) updateMut.mutate({ id: editId, data });
    else        createMut.mutate({ data });
  };

  const tc = getTypeCfg(form.type);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>

      <motion.div className="relative w-full md:max-w-lg bg-[#0f1825] border border-white/[0.08] md:rounded-2xl rounded-t-2xl shadow-2xl"
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 380 }}>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 md:hidden">
          <div className="w-8 h-1 rounded-full bg-white/20"/>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-bold text-white">{editId ? "Editar cita" : "Nueva cita"}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{editId ? "Modifica los datos de la cita" : "Completa los datos para agendar"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 max-h-[68vh] overflow-y-auto">

          {/* Title */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Título <span className="text-red-400">*</span>
            </label>
            <Input value={form.title} onChange={f("title")} autoFocus
              placeholder="Ej. Demo de la plataforma"
              className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 placeholder:text-slate-600"/>
          </div>

          {/* Client */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Cliente <span className="text-red-400">*</span>
            </label>
            <select value={form.clientId} onChange={f("clientId")}
              className="w-full h-10 rounded-lg border border-white/[0.08] bg-white/[0.04] text-white text-sm px-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors">
              <option value="" className="bg-[#0f1825]">Seleccionar cliente…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id} className="bg-[#0f1825]">
                  {c.name}{c.company ? ` · ${c.company}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Type selector — visual pills */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Tipo</label>
            <div className="grid grid-cols-4 gap-1.5">
              {TYPES.map(t => {
                const cfg = TYPE_CFG[t];
                const active = form.type === t;
                return (
                  <button key={t} type="button" onClick={() => setForm(p => ({ ...p, type: t }))}
                    className={cn(
                      "flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-[10px] font-medium transition-all",
                      active
                        ? cn("border-white/20 bg-gradient-to-b", cfg.color, "text-white shadow-sm")
                        : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"
                    )}>
                    <span className={active ? "opacity-100" : "opacity-50"}>{cfg.icon}</span>
                    <span className="capitalize truncate w-full text-center">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Fecha <span className="text-red-400">*</span>
            </label>
            <Input type="date" value={form.date} onChange={f("date")}
              className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 [color-scheme:dark]"/>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Inicio</label>
              <Input type="time" value={form.startTime} onChange={f("startTime")}
                className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 [color-scheme:dark]"/>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Fin</label>
              <Input type="time" value={form.endTime} onChange={f("endTime")}
                className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 [color-scheme:dark]"/>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(STATUS_CFG).map(([key, s]) => (
                <button key={key} type="button" onClick={() => setForm(p => ({ ...p, status: key }))}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                    form.status === key
                      ? cn(s.badge, "ring-1 ring-inset ring-current")
                      : "bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                  )}>
                  <div className={cn("w-2 h-2 rounded-full shrink-0", s.dot)}/>{s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Notas</label>
            <textarea value={form.description} onChange={f("description")} rows={3}
              placeholder="Agenda, objetivos, información relevante…"
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] text-white text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-slate-600 transition-colors"/>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0"/>{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-5 pb-6 pt-3 border-t border-white/[0.06]">
          <Button variant="outline" onClick={onClose} className="h-10 px-5">Cancelar</Button>
          <Button onClick={submit} disabled={saving}
            className="flex-1 h-10 bg-gradient-to-r from-primary to-violet-600 hover:opacity-90 text-white font-medium">
            {saving ? "Guardando…" : editId ? "Guardar cambios" : "Crear cita"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [view,        setView]       = useState<"week" | "month">("week");
  const [anchor,      setAnchor]     = useState(new Date());
  const [selDay,      setSelDay]     = useState(startOfDay(new Date()));
  const [detailAppt,  setDetail]     = useState<Appointment | null>(null);
  const [showModal,   setShowModal]  = useState(false);
  const [editAppt,    setEditAppt]   = useState<Appointment | null>(null);
  const [initForm,    setInitForm]   = useState(() => blankForm());
  const gridRef = useRef<HTMLDivElement>(null);

  const qc = useQueryClient();
  const { data: allAppts = [], isLoading } = useListAppointments();

  const deleteMut = useDeleteAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetail(null); } },
  });
  const updateMut = useUpdateAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetail(null); } },
  });

  // Scroll week grid to current time on mount
  useEffect(() => {
    if (view === "week" && gridRef.current) {
      const offset = Math.max(nowMinuteOffset() - CELL_H * 2, 0);
      gridRef.current.scrollTop = offset;
    }
  }, [view]);

  // Re-scroll when switching to week view
  const switchView = (v: "week" | "month") => {
    setView(v);
    if (v === "week") setTimeout(() => {
      if (gridRef.current) gridRef.current.scrollTop = Math.max(nowMinuteOffset() - CELL_H * 2, 0);
    }, 50);
  };

  const weekDays  = useMemo(() => getWeekDays(anchor), [anchor]);
  const calCells  = useMemo(() => {
    const s = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const e = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }), 6);
    return eachDayOfInterval({ start: s, end: e });
  }, [anchor]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    allAppts.forEach(a => {
      const k = toDateStr(a.startTime);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    });
    return m;
  }, [allAppts]);

  const openCreate = useCallback((day?: Date) => {
    setEditAppt(null);
    setInitForm(blankForm(day ?? anchor));
    setShowModal(true);
  }, [anchor]);

  const openEdit = useCallback((a: Appointment) => {
    setDetail(null);
    setEditAppt(a);
    setInitForm({
      title:       a.title,
      clientId:    String(a.clientId),
      date:        toDateStr(a.startTime),
      startTime:   toTimeStr(a.startTime),
      endTime:     toTimeStr(a.endTime),
      type:        a.type ?? "reunión",
      status:      a.status,
      description: a.description ?? "",
    });
    setShowModal(true);
  }, []);

  const nav = (d: 1 | -1) => {
    if (view === "week") setAnchor(d === 1 ? addWeeks(anchor, 1)  : subWeeks(anchor, 1));
    else                 setAnchor(d === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1));
  };

  const selAppts = (byDay.get(format(selDay, "yyyy-MM-dd")) ?? [])
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Stats
  const todayAppts    = (byDay.get(format(new Date(), "yyyy-MM-dd")) ?? []).length;
  const weekAppts     = weekDays.reduce((n, d) => n + (byDay.get(format(d, "yyyy-MM-dd"))?.length ?? 0), 0);

  const periodLabel = view === "week"
    ? `${format(weekDays[0], "d MMM", { locale: es })} – ${format(weekDays[6], "d MMM", { locale: es })}`
    : format(anchor, "MMMM yyyy", { locale: es });

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] animate-in fade-in duration-300">

      {/* ═══ Toolbar ═══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 mb-3">
        {/* Top row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Calendario</h1>
          </div>

          {/* View toggle */}
          <div className="hidden md:flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl p-1 gap-1">
            {(["week","month"] as const).map(v => (
              <button key={v} onClick={() => switchView(v)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  view === v ? "bg-white/10 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                )}>
                {v === "week" ? <Rows3 className="w-3.5 h-3.5"/> : <LayoutGrid className="w-3.5 h-3.5"/>}
                {v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center">
            <button onClick={() => nav(-1)}
              className="p-2 rounded-l-xl border border-r-0 border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <button onClick={() => { setAnchor(new Date()); setSelDay(startOfDay(new Date())); }}
              className="px-3 py-2 border-y border-white/[0.08] text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors hidden sm:block">
              Hoy
            </button>
            <button onClick={() => nav(1)}
              className="p-2 rounded-r-xl border border-l-0 border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>

          {/* Period label */}
          <span className="text-sm font-semibold text-white capitalize hidden lg:block min-w-[150px] text-center">
            {periodLabel}
          </span>

          <Button onClick={() => openCreate()}
            className="h-9 bg-gradient-to-r from-primary to-violet-600 hover:opacity-90 text-white font-medium shrink-0 gap-1.5">
            <Plus className="w-4 h-4"/> <span className="hidden sm:inline">Nueva cita</span>
          </Button>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="capitalize text-slate-300 font-medium hidden md:block">{periodLabel}</span>
          <span className="hidden md:block text-slate-600">·</span>
          <span><span className="text-white font-semibold">{todayAppts}</span> citas hoy</span>
          <span className="text-slate-600">·</span>
          <span><span className="text-white font-semibold">{weekAppts}</span> esta semana</span>
          <span className="text-slate-600">·</span>
          <span><span className="text-white font-semibold">{allAppts.length}</span> en total</span>
        </div>
      </div>

      {/* ═══ Mobile view toggle ════════════════════════════════════════════════ */}
      <div className="md:hidden flex gap-1 mb-3 shrink-0">
        {(["week","month"] as const).map(v => (
          <button key={v} onClick={() => switchView(v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
              view === v
                ? "bg-primary/15 border-primary/30 text-primary"
                : "border-white/[0.08] text-slate-500 hover:text-slate-300"
            )}>
            {v === "week" ? <Rows3 className="w-3.5 h-3.5"/> : <LayoutGrid className="w-3.5 h-3.5"/>}
            {v === "week" ? "Semana" : "Mes"}
          </button>
        ))}
      </div>

      {/* ═══ Week view ══════════════════════════════════════════════════════════ */}
      {view === "week" && (
        <div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a1120]">

          {/* Day header strip */}
          <div className="flex border-b border-white/[0.07] shrink-0 bg-[#0d1525]">
            <div className="w-12 shrink-0 border-r border-white/[0.07]"/>
            {weekDays.map((d, i) => {
              const hasAppts = (byDay.get(format(d, "yyyy-MM-dd")) ?? []).length;
              return (
                <div key={i} onClick={() => { setSelDay(d); openCreate(d); }}
                  className={cn(
                    "flex-1 flex flex-col items-center py-2.5 gap-0.5 cursor-pointer transition-colors hover:bg-white/[0.03]",
                    isSameDay(d, selDay) && "bg-primary/[0.06]",
                  )}>
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {format(d, "EEE", { locale: es })}
                  </span>
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                    isToday(d)                          ? "bg-primary text-white shadow-md shadow-primary/40"
                    : isSameDay(d, selDay)              ? "bg-white/10 text-white"
                                                        : "text-slate-300"
                  )}>
                    {format(d, "d")}
                  </div>
                  {hasAppts > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {Array.from({ length: Math.min(hasAppts, 3) }).map((_, n) => (
                        <div key={n} className="w-1 h-1 rounded-full bg-primary/60"/>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={gridRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="flex" style={{ minHeight: CELL_H * HOURS.length }}>
              {/* Hour axis */}
              <div className="w-12 shrink-0 border-r border-white/[0.07] relative">
                {HOURS.map(h => (
                  <div key={h} style={{ height: CELL_H }}
                    className="flex items-start justify-end pr-2 pt-1">
                    <span className="text-[9px] text-slate-600">{h}:00</span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((d, i) => {
                const key  = format(d, "yyyy-MM-dd");
                const appt = (byDay.get(key) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
                const isTd = isToday(d);
                return (
                  <div key={i} onClick={() => { setSelDay(d); openCreate(d); }}
                    className={cn(
                      "flex-1 relative border-r border-white/[0.05] cursor-pointer",
                      isTd && "bg-primary/[0.02]",
                    )}>
                    {/* Hour lines */}
                    {HOURS.map(h => (
                      <div key={h} style={{ height: CELL_H }}
                        className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"/>
                    ))}

                    {/* Half-hour subtle lines */}
                    {HOURS.map(h => (
                      <div key={`h-${h}`}
                        style={{ top: (h - DAY_START) * CELL_H + CELL_H / 2, position: "absolute", left: 0, right: 0, height: 1 }}
                        className="border-b border-dashed border-white/[0.03] pointer-events-none"/>
                    ))}

                    {/* Current time line */}
                    {isTd && (
                      <div style={{ top: nowMinuteOffset(), position: "absolute", left: 0, right: 0, zIndex: 20 }}
                        className="pointer-events-none flex items-center">
                        <div className="w-2 h-2 rounded-full bg-red-400 -ml-1 shrink-0 shadow-sm shadow-red-400/50"/>
                        <div className="flex-1 h-px bg-red-400/70"/>
                      </div>
                    )}

                    {/* Appointments */}
                    <div className="absolute inset-0 pointer-events-none px-0.5">
                      {appt.map(a => (
                        <div key={a.id} className="pointer-events-auto">
                          <ApptBlock appt={a} onClick={e => { (e as unknown as React.MouseEvent).stopPropagation?.(); setDetail(a); }}/>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Month view ════════════════════════════════════════════════════════ */}
      {view === "month" && (
        <div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a1120]">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-white/[0.07] shrink-0 bg-[#0d1525]">
            {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
              <div key={d} className="py-2.5 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 flex-1 overflow-y-auto">
            {calCells.map((day, i) => (
              <MonthCell key={i} day={day} currentMonth={anchor}
                appts={byDay.get(format(day, "yyyy-MM-dd")) ?? []}
                selected={isSameDay(day, selDay)}
                onSelect={() => setSelDay(day)}
                onAppt={a => setDetail(a)}
              />
            ))}
          </div>

          {/* Selected day panel */}
          <div className="border-t border-white/[0.07] bg-[#0d1525] shrink-0">
            <div className="flex items-center justify-between px-4 py-2.5">
              <p className="text-sm font-semibold text-white capitalize">
                {format(selDay, "EEEE d 'de' MMMM", { locale: es })}
                {isToday(selDay) && <span className="ml-2 text-xs font-normal text-primary">Hoy</span>}
              </p>
              <button onClick={() => openCreate(selDay)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium">
                <Plus className="w-3.5 h-3.5"/> Añadir
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto px-4 pb-3 space-y-1.5">
              {selAppts.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">Sin citas este día.</p>
              ) : selAppts.map(a => {
                const tc = getTypeCfg(a.type);
                const sc = STATUS_CFG[a.status] ?? STATUS_CFG.scheduled;
                return (
                  <button key={a.id} onClick={() => setDetail(a)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.09] transition-all text-left">
                    <div className={cn("w-2 h-2 rounded-full shrink-0", tc.bar)}/>
                    <span className="text-xs font-medium text-white truncate flex-1">{a.title}</span>
                    {a.clientName && <span className="text-[10px] text-slate-500 truncate hidden sm:block">{a.clientName}</span>}
                    <span className="text-[10px] text-slate-500 shrink-0">{format(parseISO(a.startTime), "HH:mm")}</span>
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", sc.dot)}/>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modals ════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {detailAppt && (
          <ApptDetail key="detail"
            appt={detailAppt}
            onClose={() => setDetail(null)}
            onEdit={() => openEdit(detailAppt)}
            onDelete={() => deleteMut.mutate({ id: detailAppt.id })}
            onStatusChange={s => updateMut.mutate({ id: detailAppt.id, data: { status: s as "scheduled" | "completed" | "cancelled" | "no_show" } })}
          />
        )}
        {showModal && (
          <ApptModal key="modal"
            initial={initForm}
            editId={editAppt?.id}
            onClose={() => { setShowModal(false); setEditAppt(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
