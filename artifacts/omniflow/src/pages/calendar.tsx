import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format, addDays, addWeeks, addMonths, subWeeks, subMonths,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, isToday, parseISO, differenceInMinutes,
  startOfDay, getHours, getMinutes,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, LayoutGrid, Rows3,
  X, Trash2, CheckCircle2, XCircle, AlertCircle, FileText, Phone,
  Video, Users, Handshake, RefreshCw, HelpCircle, CalendarDays,
  Sparkles, Bell, BellOff, MapPin, Tag, Loader2, List,
  Building2, Copy, Check, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useListAppointments, useListClients,
  useCreateAppointment, useUpdateAppointment, useDeleteAppointment,
  getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import type { Appointment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

// ─── Extended type for new fields ─────────────────────────────────────────────

type ApptEx = Appointment & {
  reminder?: boolean;
  tags?: string | null;
  location?: string | null;
  clientCompany?: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const HOURS     = Array.from({ length: 14 }, (_, i) => i + 7);
const CELL_H    = 64;
const DAY_START = 7;

const STATUS_CFG: Record<string, { label: string; ring: string; dot: string; badge: string; bg: string }> = {
  pending:   { label: "Pendiente",  ring: "ring-blue-500/30",    dot: "bg-blue-400",    badge: "bg-blue-500/15 text-blue-300 border-blue-500/25",    bg: "bg-blue-500/10" },
  confirmed: { label: "Confirmada", ring: "ring-violet-500/30",  dot: "bg-violet-400",  badge: "bg-violet-500/15 text-violet-300 border-violet-500/25", bg: "bg-violet-500/10" },
  completed: { label: "Completada", ring: "ring-emerald-500/30", dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", bg: "bg-emerald-500/10" },
  cancelled: { label: "Cancelada",  ring: "ring-red-500/20",     dot: "bg-red-400",     badge: "bg-red-500/10 text-red-300 border-red-500/20",        bg: "bg-red-500/8" },
  scheduled: { label: "Pendiente",  ring: "ring-blue-500/30",    dot: "bg-blue-400",    badge: "bg-blue-500/15 text-blue-300 border-blue-500/25",    bg: "bg-blue-500/10" },
  no_show:   { label: "No asistió", ring: "ring-amber-500/25",   dot: "bg-amber-400",   badge: "bg-amber-500/10 text-amber-300 border-amber-500/20", bg: "bg-amber-500/8" },
};
const ACTIVE_STATUSES = ["pending", "confirmed", "completed", "cancelled"];

const TYPE_CFG: Record<string, { label: string; color: string; bar: string; icon: React.ReactNode }> = {
  demo:        { label: "Demo",        color: "from-violet-500/30 to-violet-500/10",   bar: "bg-violet-400",  icon: <Video className="w-3 h-3"/> },
  llamada:     { label: "Llamada",     color: "from-sky-500/30 to-sky-500/10",         bar: "bg-sky-400",     icon: <Phone className="w-3 h-3"/> },
  "reunión":   { label: "Reunión",     color: "from-blue-500/30 to-blue-500/10",       bar: "bg-blue-400",    icon: <Users className="w-3 h-3"/> },
  propuesta:   { label: "Propuesta",   color: "from-emerald-500/30 to-emerald-500/10", bar: "bg-emerald-400", icon: <Handshake className="w-3 h-3"/> },
  onboarding:  { label: "Onboarding",  color: "from-amber-500/30 to-amber-500/10",     bar: "bg-amber-400",   icon: <CheckCircle2 className="w-3 h-3"/> },
  seguimiento: { label: "Seguimiento", color: "from-indigo-500/30 to-indigo-500/10",   bar: "bg-indigo-400",  icon: <RefreshCw className="w-3 h-3"/> },
  otro:        { label: "Otro",        color: "from-slate-500/30 to-slate-500/10",     bar: "bg-slate-400",   icon: <HelpCircle className="w-3 h-3"/> },
};
const TYPES = Object.keys(TYPE_CFG);

const DURATION_PRESETS = [
  { label: "30m", minutes: 30 },
  { label: "45m", minutes: 45 },
  { label: "1h",  minutes: 60 },
  { label: "1.5h",minutes: 90 },
  { label: "2h",  minutes: 120 },
];

function getTypeCfg(type?: string | null) {
  return TYPE_CFG[type ?? ""] ?? TYPE_CFG["otro"];
}
function getSC(status?: string | null) {
  return STATUS_CFG[status ?? ""] ?? STATUS_CFG.pending;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekDays(anchor: Date): Date[] {
  const mon = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
// ── Timezone helpers: all display in Europe/Madrid ───────────────────────────
// Rule 1: API returns real UTC ISO strings (stored correctly in DB).
// Rule 2: All display uses Europe/Madrid.
// Rule 3: Form inputs ("15:00") are treated as Madrid local → converted to UTC on save.
const MADRID_TZ = "Europe/Madrid";

function getMadridHM(iso: string): { h: number; m: number } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  return {
    h: parseInt(parts.find(p => p.type === "hour")!.value,   10),
    m: parseInt(parts.find(p => p.type === "minute")!.value, 10),
  };
}

// Convert form date+time (expressed in Madrid local) → real UTC ISO string.
function madridLocalToUTCFE(date: string, time: string): string {
  const [yr, mo, dy] = date.split("-").map(Number);
  const [h,  m_]     = time.split(":").map(Number);
  const probe = new Date(Date.UTC(yr!, mo! - 1, dy!, h!, m_!, 0));
  const fmt   = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts    = fmt.formatToParts(probe);
  const mh       = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const mmVal    = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMin = (h! * 60 + m_!) - (mh * 60 + mmVal);
  const utc = new Date(probe.getTime() + shiftMin * 60_000);
  console.log(`[TZ calendar] form_input="${date}T${time}" tz=Europe/Madrid → utc="${utc.toISOString()}"`);
  return utc.toISOString();
}

function apptTopPx(iso: string) {
  const { h, m } = getMadridHM(iso);
  console.log(`[TZ calendar] render | utc="${iso}" → Madrid="${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}"`);
  return ((h - DAY_START) * 60 + m) * (CELL_H / 60);
}
function apptHeightPx(start: string, end: string) {
  return Math.max(differenceInMinutes(parseISO(end), parseISO(start)), 30) * (CELL_H / 60);
}
function toDateStr(iso: string): string {
  // Return YYYY-MM-DD in Madrid timezone
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: MADRID_TZ });
}
function toTimeStr(iso: string): string {
  const { h, m } = getMadridHM(iso);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function toISO(date: string, time: string): string {
  return madridLocalToUTCFE(date, time);
}
function nowMinuteOffset() {
  const { h, m } = getMadridHM(new Date().toISOString());
  return ((h - DAY_START) * 60 + m) * (CELL_H / 60);
}
function addMinutesToISO(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}
function snapToQuarter(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map(t => t.trim()).filter(Boolean);
}

const blankForm = (date = new Date()) => ({
  title: "", clientId: "",
  date:      format(date, "yyyy-MM-dd"),
  startTime: "09:00", endTime: "10:00",
  type: "reunión", status: "pending", description: "",
  reminder: false, tags: "", location: "",
});

// ─── Appointment block (week/day grid) ────────────────────────────────────────

function ApptBlock({
  appt, onClick, onDragStart,
}: {
  appt: ApptEx;
  onClick: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const top    = apptTopPx(appt.startTime);
  const height = apptHeightPx(appt.startTime, appt.endTime);
  const tc     = getTypeCfg(appt.type);
  const sc     = getSC(appt.status);
  const compact = height < 42;
  const mini    = height < 28;

  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{ top, height, position: "absolute", left: 2, right: 2 }}
      className={cn(
        "rounded-lg border border-white/10 overflow-hidden text-left transition-all z-[1] cursor-grab active:cursor-grabbing select-none",
        "hover:z-10 hover:shadow-xl hover:scale-[1.01] hover:border-white/20",
        "bg-gradient-to-r", tc.color,
        (appt.status === "cancelled") && "opacity-50 grayscale-[40%]"
      )}>
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
              <span className={cn("shrink-0 mt-0.5 opacity-70")}>{tc.icon}</span>
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
      <div className={cn("absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full", sc.dot)} />
      {appt.reminder && (
        <div className="absolute bottom-1 right-1">
          <Bell className="w-2.5 h-2.5 text-white/40"/>
        </div>
      )}
    </button>
  );
}

// ─── Month day cell ───────────────────────────────────────────────────────────

function MonthCell({ day, currentMonth, appts, selected, onSelect, onAppt, onDrop }: {
  day: Date; currentMonth: Date; appts: ApptEx[];
  selected: boolean; onSelect: () => void; onAppt: (a: ApptEx) => void;
  onDrop?: (dayStr: string) => void;
}) {
  const today   = isToday(day);
  const inMonth = isSameMonth(day, currentMonth);
  const [dragOver, setDragOver] = useState(false);
  const dayStr = format(day, "yyyy-MM-dd");

  return (
    <div
      onClick={onSelect}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop?.(dayStr); }}
      className={cn(
        "group min-h-[90px] md:min-h-[110px] p-1.5 border-b border-r border-white/[0.05] cursor-pointer transition-all relative",
        inMonth ? "hover:bg-white/[0.025]" : "bg-black/10",
        selected && "bg-primary/[0.06]",
        dragOver && "bg-primary/[0.08] ring-1 ring-inset ring-primary/30",
      )}>
      <div className={cn(
        "w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold mx-auto mb-1 transition-all",
        today    ? "bg-primary text-white shadow-lg shadow-primary/40" :
        selected ? "bg-white/15 text-white" :
        inMonth  ? "text-slate-300 group-hover:bg-white/10" : "text-slate-600",
      )}>
        {day.getDate()}
      </div>
      <div className="space-y-0.5 px-0.5">
        {appts.slice(0, 3).map(a => {
          const tc = getTypeCfg(a.type);
          const sc = getSC(a.status);
          return (
            <button key={a.id} onClick={e => { e.stopPropagation(); onAppt(a); }}
              className="w-full text-left flex items-center gap-1 rounded-md px-1 py-0.5 hover:brightness-125 transition-all overflow-hidden">
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", sc.dot)} />
              <span className="text-[10px] text-slate-300 truncate leading-tight">{a.title}</span>
            </button>
          );
        })}
        {appts.length > 3 && (
          <p className="text-[9px] text-slate-500 pl-1">+{appts.length - 3} más</p>
        )}
      </div>
      {today && <div className="absolute inset-0 ring-1 ring-inset ring-primary/20 rounded-sm pointer-events-none"/>}
    </div>
  );
}

// ─── Appointment detail drawer ────────────────────────────────────────────────

function ApptDetail({ appt, onEdit, onDelete, onClose, onStatusChange }: {
  appt: ApptEx; onEdit: () => void; onDelete: () => void;
  onClose: () => void; onStatusChange: (s: string) => void;
}) {
  const [, setLocation] = useLocation();
  const sc  = getSC(appt.status);
  const tc  = getTypeCfg(appt.type);
  const dur = differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime));
  const tags = parseTags(appt.tags);
  const [copied, setCopied] = useState(false);

  const copyDetails = () => {
    const text = `${appt.title}\n${format(parseISO(appt.startTime), "EEEE d MMM yyyy", { locale: es })}\n${format(parseISO(appt.startTime), "HH:mm")}–${format(parseISO(appt.endTime), "HH:mm")}\nCliente: ${appt.clientName ?? "—"}\n${appt.location ? `Lugar: ${appt.location}\n` : ""}${appt.description ?? ""}`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}/>

      <motion.div className="relative w-full md:max-w-md bg-[#0f1825] border border-white/[0.08] md:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden"
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 380 }}>

        <div className="flex justify-center pt-3 pb-0 md:hidden">
          <div className="w-8 h-1 rounded-full bg-white/20"/>
        </div>

        {/* Type banner */}
        <div className={cn("px-5 pt-4 pb-3 bg-gradient-to-r", tc.color, "border-b border-white/[0.06]")}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="opacity-70">{tc.icon}</span>
                <span className="text-xs font-medium text-white/60 capitalize">{tc.label}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 font-medium", sc.badge)}>
                  {sc.label}
                </Badge>
                {appt.reminder && (
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 font-medium bg-amber-500/10 text-amber-300 border-amber-500/20">
                    <Bell className="w-2.5 h-2.5 mr-0.5"/> Recordatorio
                  </Badge>
                )}
              </div>
              <h3 className="text-lg font-bold text-white leading-snug">{appt.title}</h3>
            </div>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              <button onClick={copyDetails}
                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400"/> : <Copy className="w-3.5 h-3.5"/>}
              </button>
              <button onClick={onClose}
                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors">
                <X className="w-4 h-4"/>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-2.5 max-h-[55vh] overflow-y-auto">
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
            <button
              onClick={() => { onClose(); setLocation("/clients"); }}
              className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] hover:border-white/[0.10] transition-all text-left group">
              <User className="w-4 h-4 text-slate-400 shrink-0"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{appt.clientName}</p>
                {appt.clientCompany && (
                  <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                    <Building2 className="w-2.5 h-2.5"/> {appt.clientCompany}
                  </p>
                )}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors"/>
            </button>
          )}

          {/* Location */}
          {appt.location && (
            <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0"/>
              <p className="text-sm text-slate-300">{appt.location}</p>
            </div>
          )}

          {/* Notes */}
          {appt.description && (
            <div className="flex gap-3 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5"/>
              <p className="text-sm text-slate-300 leading-relaxed">{appt.description}</p>
            </div>
          )}

          {/* Tags */}
          {parseTags(appt.tags).length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0"/>
              {parseTags(appt.tags).map(t => (
                <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Status picker */}
          <div>
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Estado</p>
            <div className="grid grid-cols-2 gap-1.5">
              {ACTIVE_STATUSES.map(key => {
                const s = STATUS_CFG[key];
                return (
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
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-6 pt-1">
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1 h-10 text-sm font-medium">
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

// ─── AI Assistant Panel ───────────────────────────────────────────────────────

function AiPanel({ onClose, onFillForm, selectedAppt }: {
  onClose: () => void;
  onFillForm?: (data: { title?: string; type?: string; description?: string; suggestedStartTime?: string; suggestedDuration?: number }) => void;
  selectedAppt?: ApptEx | null;
}) {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [resultJson, setResultJson] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const call = async (action: string, context: Record<string, unknown>) => {
    setLoading(true);
    setResult(null);
    setResultJson(null);
    setError("");
    try {
      const r = await authFetch(`${BASE}/api/calendar-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, context }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error del servidor");
      if (typeof data.result === "object" && data.result !== null) {
        setResultJson(data.result as Record<string, unknown>);
      } else {
        setResult(String(data.result));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const actions = [
    { key: "create",       icon: <Sparkles className="w-4 h-4"/>,    label: "Crear con IA",      color: "text-violet-400", desc: "Describe la cita en texto libre" },
    { key: "summary",      icon: <FileText className="w-4 h-4"/>,     label: "Resumen",           color: "text-blue-400",   desc: "Resumen inteligente de la cita" },
    { key: "follow-up",    icon: <RefreshCw className="w-4 h-4"/>,    label: "Seguimiento",       color: "text-emerald-400",desc: "Mensaje de seguimiento para el cliente" },
    { key: "suggest-time", icon: <Clock className="w-4 h-4"/>,        label: "Mejor horario",     color: "text-amber-400",  desc: "Sugerencias de horario óptimas" },
  ];

  return (
    <motion.div
      className="fixed inset-y-0 right-0 z-40 flex"
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}>
      <div className="absolute inset-0 md:relative w-screen md:w-[380px] bg-[#0a1120] border-l border-white/[0.07] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-violet-400"/>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Asistente IA</p>
              <p className="text-[10px] text-slate-500">Calendario inteligente</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Action buttons */}
        <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.07] shrink-0">
          {actions.map(a => (
            <button key={a.key}
              onClick={() => { setActiveAction(a.key); setResult(null); setResultJson(null); setError(""); setInput(""); }}
              className={cn(
                "flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl border text-left transition-all",
                activeAction === a.key
                  ? "border-white/20 bg-white/[0.07]"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10]"
              )}>
              <span className={cn("transition-colors", a.color)}>{a.icon}</span>
              <span className="text-[11px] font-semibold text-white">{a.label}</span>
              <span className="text-[10px] text-slate-500 leading-tight">{a.desc}</span>
            </button>
          ))}
        </div>

        {/* Action area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {!activeAction && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-violet-400"/>
              </div>
              <p className="text-sm font-medium text-white">Selecciona una acción</p>
              <p className="text-xs text-slate-500 max-w-[200px] leading-relaxed">Elige una de las herramientas IA de arriba para comenzar</p>
            </div>
          )}

          {activeAction === "create" && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                  Describe la cita
                </label>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  rows={4}
                  placeholder="Ej: 'Llamada de ventas con Carlos de TechCorp mañana a las 10, para presentar la propuesta de onboarding...'"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] text-white text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-slate-600 transition-colors"
                />
              </div>
              <Button
                onClick={() => call("create", { description: input })}
                disabled={!input.trim() || loading}
                className="w-full h-9 bg-gradient-to-r from-violet-600 to-primary hover:opacity-90 text-white font-medium">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2"/>}
                Generar cita
              </Button>

              {resultJson && (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-violet-500/20 space-y-3">
                  <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider">Sugerencia IA</p>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-white">{String(resultJson.title ?? "")}</p>
                    <p className="text-xs text-slate-400 capitalize">{String(resultJson.type ?? "")}</p>
                    {!!resultJson.description && <p className="text-xs text-slate-300 leading-relaxed">{String(resultJson.description)}</p>}
                    {!!(resultJson.suggestedStartTime || resultJson.suggestedDuration) && (
                      <p className="text-[11px] text-slate-500">
                        {!!resultJson.suggestedStartTime && `Hora sugerida: ${resultJson.suggestedStartTime}`}
                        {!!resultJson.suggestedDuration && ` · ${resultJson.suggestedDuration} min`}
                      </p>
                    )}
                  </div>
                  {onFillForm && (
                    <Button size="sm" onClick={() => { onFillForm(resultJson as Parameters<typeof onFillForm>[0]); onClose(); }}
                      className="w-full h-8 text-xs bg-violet-600 hover:bg-violet-500">
                      <Plus className="w-3 h-3 mr-1"/> Usar esta cita
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeAction === "summary" && (
            <div className="space-y-3">
              {!selectedAppt ? (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  Selecciona una cita del calendario para ver su resumen
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                    <p className="text-sm font-semibold text-white">{selectedAppt.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {format(parseISO(selectedAppt.startTime), "d MMM, HH:mm", { locale: es })}
                      {selectedAppt.clientName && ` · ${selectedAppt.clientName}`}
                    </p>
                  </div>
                  <Button
                    onClick={() => call("summary", {
                      title: selectedAppt.title,
                      client: selectedAppt.clientName,
                      company: selectedAppt.clientCompany,
                      type: selectedAppt.type,
                      date: format(parseISO(selectedAppt.startTime), "d MMM yyyy HH:mm", { locale: es }),
                      duration: differenceInMinutes(parseISO(selectedAppt.endTime), parseISO(selectedAppt.startTime)) + " min",
                      description: selectedAppt.description,
                      location: selectedAppt.location,
                      status: selectedAppt.status,
                    })}
                    disabled={loading}
                    className="w-full h-9 bg-gradient-to-r from-blue-600 to-blue-500 hover:opacity-90">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <FileText className="w-4 h-4 mr-2"/>}
                    Generar resumen
                  </Button>
                </>
              )}
              {result && (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-blue-500/20 space-y-2">
                  <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">Resumen</p>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result}</p>
                </div>
              )}
            </div>
          )}

          {activeAction === "follow-up" && (
            <div className="space-y-3">
              {!selectedAppt ? (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  Selecciona una cita del calendario para generar el seguimiento
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                    <p className="text-sm font-semibold text-white">{selectedAppt.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {selectedAppt.clientName} · {format(parseISO(selectedAppt.startTime), "d MMM", { locale: es })}
                    </p>
                  </div>
                  <Button
                    onClick={() => call("follow-up", {
                      title: selectedAppt.title,
                      client: selectedAppt.clientName,
                      company: selectedAppt.clientCompany,
                      type: selectedAppt.type,
                      date: format(parseISO(selectedAppt.startTime), "d MMM yyyy", { locale: es }),
                      description: selectedAppt.description,
                      status: selectedAppt.status,
                    })}
                    disabled={loading}
                    className="w-full h-9 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:opacity-90">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <RefreshCw className="w-4 h-4 mr-2"/>}
                    Generar mensaje
                  </Button>
                </>
              )}
              {result && (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-emerald-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Mensaje de seguimiento</p>
                    <button onClick={() => navigator.clipboard.writeText(result)}
                      className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1 transition-colors">
                      <Copy className="w-3 h-3"/> Copiar
                    </button>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result}</p>
                </div>
              )}
            </div>
          )}

          {activeAction === "suggest-time" && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                  Tipo de reunión
                </label>
                <select value={input} onChange={e => setInput(e.target.value)}
                  className="w-full h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] text-white text-sm px-3 focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="" className="bg-[#0f1825]">Seleccionar tipo…</option>
                  {TYPES.map(t => <option key={t} value={t} className="bg-[#0f1825] capitalize">{TYPE_CFG[t].label}</option>)}
                </select>
              </div>
              <Button
                onClick={() => call("suggest-time", {
                  type: input || "reunión",
                  client: selectedAppt?.clientName,
                  company: selectedAppt?.clientCompany,
                  context: "CRM profesional",
                })}
                disabled={loading}
                className="w-full h-9 bg-gradient-to-r from-amber-600 to-amber-500 hover:opacity-90">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Clock className="w-4 h-4 mr-2"/>}
                Sugerir horarios
              </Button>
              {Array.isArray(resultJson?.suggestions) && (
                <div className="space-y-2">
                  {(resultJson.suggestions as Array<{ label: string; reason: string }>).map((s, i) => (
                    <div key={i} className="p-2.5 rounded-xl bg-white/[0.04] border border-amber-500/15">
                      <p className="text-sm font-semibold text-white">{s.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{s.reason}</p>
                    </div>
                  ))}
                  {!!resultJson.tip && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <p className="text-[11px] text-amber-300 leading-relaxed">{String(resultJson.tip)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0"/> {error}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Appointment form modal ────────────────────────────────────────────────────

type FormState = ReturnType<typeof blankForm>;

function ApptModal({ initial, editId, onClose }: {
  initial: FormState; editId?: number; onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { data: clients = [] } = useListClients();

  const inv = { mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); onClose(); } } };
  const createMut = useCreateAppointment(inv);
  const updateMut = useUpdateAppointment(inv);
  const saving    = createMut.isPending || updateMut.isPending;

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const setDuration = (minutes: number) => {
    const [h, m] = form.startTime.split(":").map(Number);
    const totalMins = h * 60 + m + minutes;
    const nh = Math.floor(totalMins / 60) % 24;
    const nm = totalMins % 60;
    setForm(p => ({ ...p, endTime: `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}` }));
  };

  const currentDuration = useMemo(() => {
    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }, [form.startTime, form.endTime]);

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
      status:      form.status as "pending" | "confirmed" | "completed" | "cancelled",
      type:        form.type,
      description: form.description.trim() || undefined,
      reminder:    form.reminder,
      tags:        form.tags.trim() || undefined,
      location:    form.location.trim() || undefined,
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

        <div className="flex justify-center pt-3 md:hidden">
          <div className="w-8 h-1 rounded-full bg-white/20"/>
        </div>

        {/* Header */}
        <div className={cn("px-5 pt-4 pb-3 border-b border-white/[0.07] bg-gradient-to-r", tc.color, "rounded-t-2xl")}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">{editId ? "Editar cita" : "Nueva cita"}</h2>
              <p className="text-xs text-white/50 mt-0.5">{editId ? "Modifica los datos" : "Completa para agendar"}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.07] transition-colors">
              <X className="w-4 h-4"/>
            </button>
          </div>
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

          {/* Type */}
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

          {/* Time range + duration presets */}
          <div className="space-y-2">
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
            {/* Duration quick selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 shrink-0">Duración:</span>
              <div className="flex gap-1 flex-wrap">
                {DURATION_PRESETS.map(p => (
                  <button key={p.minutes} type="button" onClick={() => setDuration(p.minutes)}
                    className={cn(
                      "px-2 py-0.5 rounded-lg text-[10px] font-medium border transition-all",
                      currentDuration === p.minutes
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "border-white/[0.08] text-slate-500 hover:text-white hover:border-white/20"
                    )}>
                    {p.label}
                  </button>
                ))}
                {currentDuration > 0 && !DURATION_PRESETS.find(p => p.minutes === currentDuration) && (
                  <span className="px-2 py-0.5 text-[10px] text-slate-500">{currentDuration} min</span>
                )}
              </div>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ACTIVE_STATUSES.map(key => {
                const s = STATUS_CFG[key];
                return (
                  <button key={key} type="button" onClick={() => setForm(p => ({ ...p, status: key }))}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                      form.status === key
                        ? cn(s.badge, "ring-1 ring-inset ring-current")
                        : "bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                    )}>
                    <div className={cn("w-2 h-2 rounded-full shrink-0", s.dot)}/>{s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
              <MapPin className="w-3 h-3 inline mr-1 opacity-60"/>Lugar / Enlace
            </label>
            <Input value={form.location} onChange={f("location")}
              placeholder="Oficina, Zoom, Google Meet…"
              className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 placeholder:text-slate-600"/>
          </div>

          {/* Tags */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
              <Tag className="w-3 h-3 inline mr-1 opacity-60"/>Etiquetas
            </label>
            <Input value={form.tags} onChange={f("tags")}
              placeholder="urgente, vip, propuesta (separadas por coma)"
              className="bg-white/[0.04] border-white/[0.08] text-white h-10 focus:border-primary/50 placeholder:text-slate-600"/>
            {parseTags(form.tags).length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {parseTags(form.tags).map(t => (
                  <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] border border-white/[0.08] text-slate-300">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Reminder toggle */}
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              {form.reminder ? <Bell className="w-4 h-4 text-amber-400"/> : <BellOff className="w-4 h-4 text-slate-500"/>}
              <div>
                <p className="text-sm font-medium text-white">Recordatorio</p>
                <p className="text-[10px] text-slate-500">{form.reminder ? "Recordatorio activado" : "Sin recordatorio"}</p>
              </div>
            </div>
            <button type="button"
              onClick={() => setForm(p => ({ ...p, reminder: !p.reminder }))}
              className={cn(
                "relative w-10 h-6 rounded-full border transition-all",
                form.reminder
                  ? "bg-amber-500 border-amber-400"
                  : "bg-white/[0.06] border-white/[0.10]"
              )}>
              <div className={cn(
                "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                form.reminder ? "left-4" : "left-0.5"
              )}/>
            </button>
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

// ─── Daily Agenda View ────────────────────────────────────────────────────────

function DayAgendaView({ day, appts, onAppt, onCreateAt }: {
  day: Date;
  appts: ApptEx[];
  onAppt: (a: ApptEx) => void;
  onCreateAt: (date: Date) => void;
}) {
  const sorted = [...appts].sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
          <CalendarDays className="w-7 h-7 text-slate-600"/>
        </div>
        <div>
          <p className="text-base font-semibold text-white">Sin citas</p>
          <p className="text-xs text-slate-500 mt-1 capitalize">
            {format(day, "EEEE d 'de' MMMM", { locale: es })}
          </p>
        </div>
        <Button onClick={() => onCreateAt(day)} size="sm"
          className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-medium">
          <Plus className="w-3.5 h-3.5 mr-1"/> Agregar cita
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-1 py-2 space-y-2">
      {sorted.map((appt) => {
        const tc  = getTypeCfg(appt.type);
        const sc  = getSC(appt.status);
        const dur = differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime));
        const tags = parseTags(appt.tags);

        return (
          <motion.button key={appt.id}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            onClick={() => onAppt(appt)}
            className={cn(
              "w-full text-left flex gap-3 px-4 py-3 rounded-xl border border-white/[0.06]",
              "hover:border-white/[0.12] hover:bg-white/[0.04] transition-all group",
              "bg-gradient-to-r", tc.color,
              appt.status === "cancelled" && "opacity-60 grayscale-[30%]"
            )}>
            {/* Left bar */}
            <div className={cn("w-1 rounded-full shrink-0 self-stretch", tc.bar)}/>

            {/* Time column */}
            <div className="w-14 shrink-0 flex flex-col items-center pt-0.5">
              <p className="text-sm font-bold text-white">{format(parseISO(appt.startTime), "HH:mm")}</p>
              <p className="text-[10px] text-slate-500">{dur}m</p>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 justify-between">
                <p className="text-sm font-semibold text-white leading-snug truncate">{appt.title}</p>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 font-medium shrink-0", sc.badge)}>
                  {sc.label}
                </Badge>
              </div>
              {appt.clientName && (
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <User className="w-3 h-3 text-slate-600"/> {appt.clientName}
                  {appt.clientCompany && <span className="text-slate-600">· {appt.clientCompany}</span>}
                </p>
              )}
              {appt.location && (
                <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5"/> {appt.location}
                </p>
              )}
              {appt.description && (
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{appt.description}</p>
              )}
              {tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {tags.map(t => (
                    <span key={t} className="px-1.5 py-px rounded-full text-[9px] bg-white/[0.06] border border-white/[0.08] text-slate-400">{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Right indicators */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              {appt.reminder && <Bell className="w-3 h-3 text-amber-400"/>}
              <span className="text-[10px] text-slate-600">{format(parseISO(appt.endTime), "HH:mm")}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type ViewType = "week" | "month" | "day";

export default function CalendarPage() {
  const [view,        setView]       = useState<ViewType>("week");
  const [anchor,      setAnchor]     = useState(new Date());
  const [selDay,      setSelDay]     = useState(startOfDay(new Date()));
  const [detailAppt,  setDetail]     = useState<ApptEx | null>(null);
  const [showModal,   setShowModal]  = useState(false);
  const [editAppt,    setEditAppt]   = useState<ApptEx | null>(null);
  const [initForm,    setInitForm]   = useState(() => blankForm());
  const [showAI,      setShowAI]     = useState(false);
  const [dragApptId,  setDragApptId] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const qc = useQueryClient();
  const { data: allAppts = [], isLoading } = useListAppointments();

  const deleteMut = useDeleteAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetail(null); } },
  });
  const updateMut = useUpdateAppointment({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }); setDetail(null); } },
  });

  useEffect(() => {
    if (view === "week" && gridRef.current) {
      const offset = Math.max(nowMinuteOffset() - CELL_H * 2, 0);
      gridRef.current.scrollTop = offset;
    }
  }, [view]);

  const switchView = (v: ViewType) => {
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
    const m = new Map<string, ApptEx[]>();
    (allAppts as ApptEx[]).forEach(a => {
      const k = toDateStr(a.startTime);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    });
    return m;
  }, [allAppts]);

  const openCreate = useCallback((day?: Date, prefill?: Partial<FormState>) => {
    setEditAppt(null);
    setInitForm({ ...blankForm(day ?? anchor), ...prefill });
    setShowModal(true);
  }, [anchor]);

  const openEdit = useCallback((a: ApptEx) => {
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
      reminder:    a.reminder ?? false,
      tags:        a.tags ?? "",
      location:    a.location ?? "",
    });
    setShowModal(true);
  }, []);

  const nav = (d: 1 | -1) => {
    if (view === "week") setAnchor(d === 1 ? addWeeks(anchor, 1)  : subWeeks(anchor, 1));
    else if (view === "day") setAnchor(a => { const n = addDays(a, d); setSelDay(startOfDay(n)); return n; });
    else                 setAnchor(d === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1));
  };

  const today = () => {
    const now = new Date();
    setAnchor(now);
    setSelDay(startOfDay(now));
  };

  const selAppts = (byDay.get(format(selDay, "yyyy-MM-dd")) ?? [])
    .sort((a, b) => a.startTime.localeCompare(b.startTime)) as ApptEx[];

  const todayAppts  = (byDay.get(format(new Date(), "yyyy-MM-dd")) ?? []).length;
  const weekAppts   = weekDays.reduce((n, d) => n + (byDay.get(format(d, "yyyy-MM-dd"))?.length ?? 0), 0);
  const pendingCount = allAppts.filter(a => a.status === "pending" || a.status === "scheduled").length;

  const periodLabel = view === "week"
    ? `${format(weekDays[0], "d MMM", { locale: es })} – ${format(weekDays[6], "d MMM", { locale: es })}`
    : view === "day"
    ? format(selDay, "EEEE d 'de' MMMM", { locale: es })
    : format(anchor, "MMMM yyyy", { locale: es });

  // ── Drag & drop helpers ──────────────────────────────────────────────────────

  const handleDragStart = (appt: ApptEx) => (e: React.DragEvent) => {
    e.dataTransfer.setData("apptId", String(appt.id));
    e.dataTransfer.setData("apptDuration", String(
      differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime))
    ));
    setDragApptId(appt.id);
  };

  const handleDropOnTimeSlot = (dayDate: Date, e: React.DragEvent) => {
    e.preventDefault();
    const apptId   = Number(e.dataTransfer.getData("apptId"));
    const duration = Number(e.dataTransfer.getData("apptDuration")) || 60;
    const rect     = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY     = e.clientY - rect.top;
    const rawMins  = (relY / CELL_H) * 60;
    const snapped  = snapToQuarter(rawMins);
    const totalMinutesFromStart = Math.max(0, snapped);
    const newHour  = DAY_START + Math.floor(totalMinutesFromStart / 60);
    const newMin   = totalMinutesFromStart % 60;

    const newStartISO = new Date(dayDate);
    newStartISO.setHours(newHour, newMin, 0, 0);

    const newEndISO = new Date(newStartISO.getTime() + duration * 60000);

    updateMut.mutate({
      id: apptId,
      data: { startTime: newStartISO.toISOString(), endTime: newEndISO.toISOString() },
    });
    setDragApptId(null);
  };

  const handleDropOnDay = (dayStr: string, apptId: number) => {
    const appt = allAppts.find(a => a.id === apptId) as ApptEx | undefined;
    if (!appt) return;
    const duration = differenceInMinutes(parseISO(appt.endTime), parseISO(appt.startTime));
    const [h, m] = [getHours(parseISO(appt.startTime)), getMinutes(parseISO(appt.startTime))];
    const newStart = new Date(`${dayStr}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`);
    const newEnd   = new Date(newStart.getTime() + duration * 60000);
    updateMut.mutate({ id: apptId, data: { startTime: newStart.toISOString(), endTime: newEnd.toISOString() } });
    setDragApptId(null);
  };

  const handleAiFill = (data: { title?: string; type?: string; description?: string; suggestedStartTime?: string; suggestedDuration?: number }) => {
    const prefill: Partial<FormState> = {};
    if (data.title)       prefill.title = data.title;
    if (data.type)        prefill.type  = data.type;
    if (data.description) prefill.description = data.description;
    if (data.suggestedStartTime) {
      prefill.startTime = data.suggestedStartTime;
      const dur = data.suggestedDuration ?? 60;
      const [h, m] = data.suggestedStartTime.split(":").map(Number);
      const endMins = h * 60 + m + dur;
      prefill.endTime = `${String(Math.floor(endMins / 60) % 24).padStart(2,"0")}:${String(endMins % 60).padStart(2,"0")}`;
    }
    openCreate(anchor, prefill);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] animate-in fade-in duration-300">

      {/* ═══ Toolbar ═══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Calendario</h1>
          </div>

          {/* View toggle */}
          <div className="hidden md:flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl p-1 gap-0.5">
            {([["week","Semana",<Rows3 className="w-3.5 h-3.5"/>],["month","Mes",<LayoutGrid className="w-3.5 h-3.5"/>],["day","Día",<List className="w-3.5 h-3.5"/>]] as const).map(([v, label, icon]) => (
              <button key={v} onClick={() => switchView(v as ViewType)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  view === v ? "bg-white/10 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                )}>
                {icon} {label}
              </button>
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center">
            <button onClick={() => nav(-1)}
              className="p-2 rounded-l-xl border border-r-0 border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <button onClick={today}
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

          {/* AI button */}
          <button onClick={() => setShowAI(s => !s)}
            className={cn(
              "h-9 flex items-center gap-1.5 px-3 rounded-xl border text-xs font-medium transition-all",
              showAI
                ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                : "border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20"
            )}>
            <Sparkles className="w-3.5 h-3.5"/> <span className="hidden sm:inline">IA</span>
          </button>

          <Button onClick={() => openCreate()}
            className="h-9 bg-gradient-to-r from-primary to-violet-600 hover:opacity-90 text-white font-medium shrink-0 gap-1.5">
            <Plus className="w-4 h-4"/> <span className="hidden sm:inline">Nueva cita</span>
          </Button>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
          <span className="capitalize text-slate-300 font-medium hidden md:block">{periodLabel}</span>
          <span className="hidden md:block text-slate-600">·</span>
          <span><span className="text-white font-semibold">{todayAppts}</span> hoy</span>
          <span className="text-slate-600">·</span>
          <span><span className="text-white font-semibold">{weekAppts}</span> esta semana</span>
          <span className="text-slate-600">·</span>
          <span><span className="text-amber-400 font-semibold">{pendingCount}</span> pendientes</span>
        </div>
      </div>

      {/* ═══ Mobile view toggle ════════════════════════════════════════════════ */}
      <div className="md:hidden flex gap-1 mb-3 shrink-0">
        {([["week","Semana",<Rows3 className="w-3.5 h-3.5"/>],["month","Mes",<LayoutGrid className="w-3.5 h-3.5"/>],["day","Día",<List className="w-3.5 h-3.5"/>]] as const).map(([v, label, icon]) => (
          <button key={v} onClick={() => switchView(v as ViewType)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
              view === v
                ? "bg-primary/15 border-primary/30 text-primary"
                : "border-white/[0.08] text-slate-500 hover:text-slate-300"
            )}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ═══ Main content + AI panel ═══════════════════════════════════════════ */}
      <div className="flex-1 flex gap-4 overflow-hidden">

        {/* Calendar views */}
        <div className="flex-1 overflow-hidden min-w-0">

          {/* ── Week view ────────────────────────────────────────────────────── */}
          {view === "week" && (
            <div className="h-full flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a1120]">
              {/* Day header */}
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
                        isToday(d) ? "bg-primary text-white shadow-md shadow-primary/40"
                        : isSameDay(d, selDay) ? "bg-white/10 text-white"
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
                    const appt = (byDay.get(key) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime)) as ApptEx[];
                    const isTd = isToday(d);
                    return (
                      <div key={i}
                        className={cn("flex-1 relative border-r border-white/[0.05]", isTd && "bg-primary/[0.02]")}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => handleDropOnTimeSlot(d, e)}
                        onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setSelDay(d); openCreate(d); }}>
                        {HOURS.map(h => (
                          <div key={h} style={{ height: CELL_H }}
                            className="border-b border-white/[0.04] hover:bg-white/[0.015] transition-colors"/>
                        ))}
                        {HOURS.map(h => (
                          <div key={`hf-${h}`}
                            style={{ top: (h - DAY_START) * CELL_H + CELL_H / 2, position: "absolute", left: 0, right: 0, height: 1 }}
                            className="border-b border-dashed border-white/[0.03] pointer-events-none"/>
                        ))}
                        {isTd && (
                          <div style={{ top: nowMinuteOffset(), position: "absolute", left: 0, right: 0, zIndex: 20 }}
                            className="pointer-events-none flex items-center">
                            <div className="w-2 h-2 rounded-full bg-red-400 -ml-1 shrink-0 shadow-sm shadow-red-400/50"/>
                            <div className="flex-1 h-px bg-red-400/70"/>
                          </div>
                        )}
                        <div className="absolute inset-0 pointer-events-none px-0.5">
                          {appt.map(a => (
                            <div key={a.id} className="pointer-events-auto">
                              <ApptBlock appt={a}
                                onDragStart={handleDragStart(a)}
                                onClick={e => { e.stopPropagation(); setDetail(a); }}/>
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

          {/* ── Month view ───────────────────────────────────────────────────── */}
          {view === "month" && (
            <div className="h-full flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a1120]">
              <div className="grid grid-cols-7 border-b border-white/[0.07] shrink-0 bg-[#0d1525]">
                {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
                  <div key={d} className="py-2.5 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 flex-1 overflow-y-auto">
                {calCells.map((day, i) => (
                  <MonthCell key={i} day={day} currentMonth={anchor}
                    appts={(byDay.get(format(day, "yyyy-MM-dd")) ?? []) as ApptEx[]}
                    selected={isSameDay(day, selDay)}
                    onSelect={() => setSelDay(day)}
                    onAppt={a => setDetail(a)}
                    onDrop={dayStr => {
                      if (dragApptId) handleDropOnDay(dayStr, dragApptId);
                    }}
                  />
                ))}
              </div>

              {/* Selected day strip */}
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
                    const sc = getSC(a.status);
                    return (
                      <button key={a.id} onClick={() => setDetail(a)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.09] transition-all text-left">
                        <div className={cn("w-2 h-2 rounded-full shrink-0", sc.dot)}/>
                        <span className="text-xs font-medium text-white truncate flex-1">{a.title}</span>
                        {a.clientName && <span className="text-[10px] text-slate-500 truncate hidden sm:block">{a.clientName}</span>}
                        <span className="text-[10px] text-slate-500 shrink-0">{format(parseISO(a.startTime), "HH:mm")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Day / Agenda view ────────────────────────────────────────────── */}
          {view === "day" && (
            <div className="h-full flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a1120]">
              {/* Day header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-[#0d1525] shrink-0">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex flex-col items-center justify-center",
                    isToday(selDay) ? "bg-primary text-white shadow-lg shadow-primary/30" : "bg-white/[0.06] text-slate-300"
                  )}>
                    <span className="text-[10px] font-medium leading-none capitalize">{format(selDay, "EEE", { locale: es })}</span>
                    <span className="text-lg font-bold leading-tight">{format(selDay, "d")}</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white capitalize">
                      {format(selDay, "MMMM yyyy", { locale: es })}
                    </p>
                    <p className="text-xs text-slate-500">{selAppts.length} cita{selAppts.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <button onClick={() => openCreate(selDay)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/30 text-primary text-xs font-medium hover:bg-primary/10 transition-all">
                  <Plus className="w-3.5 h-3.5"/> Nueva
                </button>
              </div>

              {/* Week day selector strip */}
              <div className="flex border-b border-white/[0.07] shrink-0 bg-[#0d1525]/50 overflow-x-auto">
                {weekDays.map((d, i) => {
                  const count = (byDay.get(format(d, "yyyy-MM-dd")) ?? []).length;
                  return (
                    <button key={i} onClick={() => setSelDay(d)}
                      className={cn(
                        "flex-1 flex flex-col items-center py-2 gap-0.5 transition-all min-w-[40px]",
                        isSameDay(d, selDay) ? "bg-primary/[0.10]" : "hover:bg-white/[0.03]"
                      )}>
                      <span className="text-[9px] font-medium text-slate-500 uppercase">{format(d, "EEE", { locale: es })}</span>
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                        isToday(d) ? "bg-primary text-white" : isSameDay(d, selDay) ? "bg-white/10 text-white" : "text-slate-400"
                      )}>
                        {format(d, "d")}
                      </div>
                      {count > 0 && <div className="w-1 h-1 rounded-full bg-primary/60"/>}
                    </button>
                  );
                })}
              </div>

              {/* Agenda list */}
              <DayAgendaView
                day={selDay}
                appts={selAppts}
                onAppt={a => setDetail(a)}
                onCreateAt={openCreate}
              />
            </div>
          )}
        </div>

        {/* AI Panel */}
        <AnimatePresence>
          {showAI && (
            <AiPanel
              key="ai-panel"
              onClose={() => setShowAI(false)}
              onFillForm={handleAiFill}
              selectedAppt={detailAppt}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ═══ Modals ════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {detailAppt && (
          <ApptDetail key="detail"
            appt={detailAppt}
            onClose={() => setDetail(null)}
            onEdit={() => openEdit(detailAppt)}
            onDelete={() => deleteMut.mutate({ id: detailAppt.id })}
            onStatusChange={s => updateMut.mutate({
              id: detailAppt.id,
              data: { status: s as "pending" | "confirmed" | "completed" | "cancelled" },
            })}
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
