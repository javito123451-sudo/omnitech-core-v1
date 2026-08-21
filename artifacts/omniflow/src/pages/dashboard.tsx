import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Calendar, Zap, Activity, Clock, ChevronRight, Bell, MapPin, CheckCircle2, Timer, Bot, MessageSquareReply, Send, PauseCircle, Target } from "lucide-react";
import {
  useGetDashboardStats,
  useGetRevenueStats,
  useGetRecentActivity,
  useListAppointments,
} from "@workspace/api-client-react";
import type { Appointment } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO, isToday, isTomorrow, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type ApptEx = Appointment & { reminder?: boolean; location?: string | null; clientCompany?: string | null };

const ACTIVITY_LABELS: Record<string, (clientName?: string | null) => string> = {
  client_added:          (n) => `Nuevo cliente${n ? `: ${n}` : " agregado"}`,
  appointment_scheduled: (n) => `Cita programada${n ? ` con ${n}` : ""}`,
  message_sent:          (n) => `Mensaje enviado${n ? ` a ${n}` : ""}`,
  client_updated:        (n) => `Cliente actualizado${n ? `: ${n}` : ""}`,
  appointment_completed: (n) => `Cita completada${n ? ` con ${n}` : ""}`,
  autopilot_message_drafted: (n) => `🤖 Autopilot generó un mensaje${n ? ` para ${n}` : ""}`,
  autopilot_message_sent:    (n) => `📤 Seguimiento enviado${n ? ` a ${n}` : ""}`,
  autopilot_paused_reply:    (n) => `💬 Cliente respondió${n ? ` (${n})` : ""} — Autopilot pausado`,
  autopilot_message_rejected: (n) => `🚫 Mensaje de Autopilot rechazado${n ? ` (${n})` : ""}`,
};
function activityLabel(type: string, clientName?: string | null) {
  return ACTIVITY_LABELS[type]?.(clientName) ?? type;
}

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  pending:   { label: "Pendiente",  color: "bg-blue-500/15 text-blue-400 border-blue-500/20",     dot: "bg-blue-400" },
  confirmed: { label: "Confirmada", color: "bg-violet-500/15 text-violet-400 border-violet-500/20", dot: "bg-violet-400" },
  completed: { label: "Completada", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  cancelled: { label: "Cancelada",  color: "bg-red-500/15 text-red-400 border-red-500/20",         dot: "bg-red-400" },
  scheduled: { label: "Pendiente",  color: "bg-blue-500/15 text-blue-400 border-blue-500/20",     dot: "bg-blue-400" },
  no_show:   { label: "No asistió", color: "bg-amber-500/15 text-amber-400 border-amber-500/20",  dot: "bg-amber-400" },
};

function apptDayLabel(iso: string) {
  const d = parseISO(iso);
  if (isToday(d))    return "Hoy";
  if (isTomorrow(d)) return "Mañana";
  return format(d, "EEE d MMM", { locale: es });
}

function isUpcoming(a: Appointment) {
  return (a.status === "pending" || a.status === "scheduled" || a.status === "confirmed") &&
    new Date(a.startTime) >= new Date();
}

export default function Dashboard() {
  const { data: stats,        isLoading: statsLoading } = useGetDashboardStats();
  const { data: revenueData }   = useGetRevenueStats();
  const { data: activityData }  = useGetRecentActivity();
  const { data: allAppts = [] } = useListAppointments();
  const [, setLocation] = useLocation();

  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");

  const todayAppts = (allAppts as ApptEx[])
    .filter(a => format(parseISO(a.startTime), "yyyy-MM-dd") === todayStr)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const upcoming = (allAppts as ApptEx[])
    .filter(isUpcoming)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 5);

  const nextAppt = todayAppts.find(a => new Date(a.startTime) >= now);
  const minsToNext = nextAppt ? differenceInMinutes(parseISO(nextAppt.startTime), now) : null;

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in zoom-in duration-500">
      <div>
        <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Panel</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5">Esto es lo que está pasando hoy.</p>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4">
        <KpiCard
          title="Ingresos Totales"
          value={stats ? `$${(stats.totalRevenue / 1000).toFixed(0)}k` : "—"}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          trend={stats?.revenueGrowth ? `+${stats.revenueGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard
          title="Clientes Activos"
          value={stats ? stats.activeClients.toString() : "—"}
          icon={<Users className="w-4 h-4 text-primary" />}
          trend={stats?.clientGrowth ? `+${stats.clientGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard
          title="Citas Hoy"
          value={stats ? stats.appointmentsToday.toString() : "—"}
          icon={<Calendar className="w-4 h-4 text-primary" />}
          loading={statsLoading}
        />
        <KpiCard
          title="Conversión"
          value={stats ? `${(stats.conversionRate * 100).toFixed(0)}%` : "—"}
          icon={<Zap className="w-4 h-4 text-primary" />}
          loading={statsLoading}
        />
      </div>

      {/* ── Today's appointments widget ── */}
      <TodayWidget
        todayAppts={todayAppts}
        nextAppt={nextAppt as ApptEx | undefined}
        minsToNext={minsToNext}
        onNavigate={() => setLocation("/calendar")}
      />

      {/* ── OMNITECH AUTOPILOT ── */}
      <AutopilotSummaryCard onNavigate={() => setLocation("/clients")} />

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-3 md:gap-4">
        <Card className="lg:col-span-5 bg-card border-border">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm md:text-base">Resumen de Ingresos</CardTitle>
          </CardHeader>
          <CardContent className="px-1 pb-3">
            <div className="h-[155px] md:h-[260px] w-full">
              {revenueData && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={9} tickLine={false} axisLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "#1A202C", borderColor: "#2D3748", color: "#fff", fontSize: 11, borderRadius: 8 }}
                      itemStyle={{ color: "#60A5FA" }}
                      formatter={(v: number) => [`$${v.toLocaleString()}`, "Ingresos"]}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2}
                      dot={{ r: 2.5, fill: "#3B82F6", strokeWidth: 0 }} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary shrink-0" />
              Actividad Reciente
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-2.5">
              {activityData?.slice(0, 5).map((activity, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary ring-4 ring-primary/20 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug line-clamp-2">
                      {activityLabel(activity.type, activity.clientName)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(activity.createdAt).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                </div>
              ))}
              {!activityData?.length && (
                <div className="text-xs text-muted-foreground py-3 text-center">Sin actividad reciente</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Upcoming Appointments ── */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-3 pt-3 px-4 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary shrink-0" />
              Próximas Citas
              {upcoming.length > 0 && (
                <span className="ml-1 text-[10px] bg-primary/15 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-semibold">
                  {upcoming.length}
                </span>
              )}
            </CardTitle>
            <button onClick={() => setLocation("/calendar")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors touch-manipulation py-1">
              Ver todo <ChevronRight className="w-3.5 h-3.5"/>
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <Calendar className="w-8 h-8 opacity-20"/>
              <p className="text-sm">No hay citas próximas</p>
              <button onClick={() => setLocation("/calendar")}
                className="text-xs text-primary hover:underline touch-manipulation py-1">
                Programar una cita →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {upcoming.map((appt) => {
                const sm       = STATUS_META[appt.status] ?? STATUS_META.pending;
                const dayLabel = apptDayLabel(appt.startTime);
                const isHoy    = dayLabel === "Hoy";
                return (
                  <div key={appt.id}
                    onClick={() => setLocation("/calendar")}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] active:bg-white/[0.05] cursor-pointer transition-colors group touch-manipulation">
                    <div className={cn(
                      "flex flex-col items-center justify-center w-10 h-10 rounded-xl border shrink-0",
                      isHoy ? "bg-primary/15 border-primary/30" : "bg-white/[0.03] border-white/[0.07]"
                    )}>
                      <span className={cn("text-[9px] font-semibold uppercase tracking-wide leading-none",
                        isHoy ? "text-primary" : "text-muted-foreground")}>
                        {format(parseISO(appt.startTime), "EEE", { locale: es })}
                      </span>
                      <span className={cn("text-base font-bold leading-none mt-0.5",
                        isHoy ? "text-primary" : "text-white")}>
                        {format(parseISO(appt.startTime), "d")}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{appt.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5 shrink-0"/>
                          {format(parseISO(appt.startTime), "HH:mm")}–{format(parseISO(appt.endTime), "HH:mm")}
                        </span>
                        {appt.clientName && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[100px]">
                            {appt.clientName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className={cn("text-[9px] h-5 px-1.5 border", sm.color)}>
                        {sm.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {isHoy
                          ? formatDistanceToNow(parseISO(appt.startTime), { locale: es, addSuffix: true })
                          : format(parseISO(appt.startTime), "d MMM", { locale: es })
                        }
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Today Widget ─────────────────────────────────────────────────────────────

function TodayWidget({ todayAppts, nextAppt, minsToNext, onNavigate }: {
  todayAppts: ApptEx[];
  nextAppt?: ApptEx;
  minsToNext: number | null;
  onNavigate: () => void;
}) {
  if (todayAppts.length === 0) return null;

  const completed  = todayAppts.filter(a => a.status === "completed").length;
  const remaining  = todayAppts.filter(a => a.status !== "completed" && a.status !== "cancelled").length;
  const confirmed  = todayAppts.filter(a => a.status === "confirmed").length;
  const pct        = todayAppts.length > 0 ? Math.round((completed / todayAppts.length) * 100) : 0;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-3 pt-3 px-4 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Calendar className="w-3 h-3 text-primary"/>
            </div>
            Citas de Hoy
            <span className="text-[10px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded-full font-semibold text-slate-300">
              {todayAppts.length}
            </span>
          </CardTitle>
          <button onClick={onNavigate}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors touch-manipulation py-1">
            Ver calendario <ChevronRight className="w-3.5 h-3.5"/>
          </button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pt-3 pb-4">
        {/* Progress + stats row */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-500">{completed} de {todayAppts.length} completadas</span>
              <span className="text-[11px] font-semibold text-white">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex gap-3 text-center shrink-0">
            <div>
              <p className="text-sm font-bold text-emerald-400">{completed}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Hecho</p>
            </div>
            <div>
              <p className="text-sm font-bold text-blue-400">{remaining}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Quedan</p>
            </div>
            {confirmed > 0 && (
              <div>
                <p className="text-sm font-bold text-violet-400">{confirmed}</p>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Confirm.</p>
              </div>
            )}
          </div>
        </div>

        {/* Next appointment banner */}
        {nextAppt && minsToNext !== null && minsToNext <= 120 && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-primary/[0.08] border border-primary/20 mb-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
              <Timer className="w-4 h-4 text-primary"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{nextAppt.title}</p>
              <p className="text-[10px] text-primary mt-0.5">
                En {minsToNext < 60 ? `${minsToNext} min` : `${Math.floor(minsToNext / 60)}h ${minsToNext % 60}m`}
                {nextAppt.clientName && ` · ${nextAppt.clientName}`}
              </p>
            </div>
            {nextAppt.reminder && <Bell className="w-3.5 h-3.5 text-amber-400 shrink-0"/>}
          </div>
        )}

        {/* Appointment list (compact) */}
        <div className="space-y-1.5">
          {todayAppts.slice(0, 4).map(appt => {
            const sm  = STATUS_META[appt.status] ?? STATUS_META.pending;
            const isPast = new Date(appt.endTime) < new Date();
            return (
              <button key={appt.id} onClick={onNavigate}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left",
                  appt.status === "completed"
                    ? "bg-emerald-500/[0.05] border-emerald-500/15 opacity-70"
                    : appt.status === "cancelled"
                    ? "bg-red-500/[0.04] border-red-500/10 opacity-50"
                    : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.10]"
                )}>
                <div className={cn("w-2 h-2 rounded-full shrink-0", sm.dot)}/>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-xs font-medium truncate", appt.status === "completed" ? "text-slate-400 line-through" : "text-white")}>
                    {appt.title}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {appt.clientName && (
                    <span className="text-[10px] text-slate-500 truncate hidden sm:block max-w-[80px]">{appt.clientName}</span>
                  )}
                  {appt.reminder && <Bell className="w-2.5 h-2.5 text-amber-400/70"/>}
                  <span className="text-[10px] text-slate-500">{format(parseISO(appt.startTime), "HH:mm")}</span>
                  {appt.status === "completed" && <CheckCircle2 className="w-3 h-3 text-emerald-500"/>}
                </div>
              </button>
            );
          })}
          {todayAppts.length > 4 && (
            <button onClick={onNavigate}
              className="w-full text-center text-[11px] text-slate-500 hover:text-primary py-1 transition-colors">
              +{todayAppts.length - 4} más citas hoy
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── OMNITECH AUTOPILOT — resumen del Client Autopilot ──────────────────────────
interface AutopilotSummary {
  autopilotsActivos: number;
  seguimientosParaHoy: number;
  respuestasRecibidas: number;
  mensajesEnviados: number;
  autopilotsPausados: number;
  oportunidadesActivas: number;
  accionesDeHoy: { clientId: number | null; clientName: string | null; step: number; nextRunAt: string | null }[];
}

function AutopilotSummaryCard({ onNavigate }: { onNavigate: () => void }) {
  const { data, isLoading, isError } = useQuery<AutopilotSummary>({
    queryKey: ["autopilot-summary"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/autopilot/summary`);
      if (!r.ok) throw new Error("No se pudo cargar el resumen de Autopilot");
      return r.json();
    },
    retry: false,
  });

  // Módulo "automations" no habilitado para este workspace, u otro error —
  // no mostrar la tarjeta en vez de quedar en skeleton infinito.
  if (isError) return null;

  if (isLoading || !data) {
    return <Card className="bg-card border-border h-24 animate-pulse" />;
  }

  const stats = [
    { label: "Autopilots activos", value: data.autopilotsActivos, icon: Bot, color: "text-emerald-400" },
    { label: "Seguimientos hoy", value: data.seguimientosParaHoy, icon: Target, color: "text-blue-400" },
    { label: "Respuestas recibidas", value: data.respuestasRecibidas, icon: MessageSquareReply, color: "text-cyan-400" },
    { label: "Mensajes enviados", value: data.mensajesEnviados, icon: Send, color: "text-violet-400" },
    { label: "Pausados", value: data.autopilotsPausados, icon: PauseCircle, color: "text-slate-400" },
    { label: "Oportunidades activas", value: data.oportunidadesActivas, icon: Zap, color: "text-amber-400" },
  ];

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-3 pt-3 px-4 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Bot className="w-3 h-3 text-primary" />
            </div>
            OmniTech Autopilot
          </CardTitle>
          <button onClick={onNavigate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors touch-manipulation py-1">
            Ver clientes <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pt-3 pb-4">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5 mb-3">
          {stats.map((s) => (
            <div key={s.label} className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
              <s.icon className={cn("w-3.5 h-3.5 mx-auto mb-1", s.color)} />
              <p className="text-sm font-bold text-white leading-none">{s.value}</p>
              <p className="text-[9px] text-slate-500 mt-1 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>

        {data.accionesDeHoy.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Acciones de hoy</p>
            {data.accionesDeHoy.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <span className="text-[10px] text-slate-500 shrink-0">
                  {a.nextRunAt ? format(parseISO(a.nextRunAt), "HH:mm") : "—"}
                </span>
                <span className="text-xs text-white truncate flex-1">{a.clientName ?? "Cliente"}</span>
                <span className="text-[10px] text-primary shrink-0">Seguimiento {a.step}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ title, value, icon, trend, loading }: {
  title: string; value: string; icon: React.ReactNode; trend?: string; loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] md:text-xs font-medium text-muted-foreground leading-tight pr-1">{title}</p>
          <div className="shrink-0">{icon}</div>
        </div>
        {loading ? (
          <div className="h-7 w-16 bg-border/50 animate-pulse rounded" />
        ) : (
          <div>
            <div className="text-xl md:text-2xl font-bold text-white leading-none">{value}</div>
            {trend && <p className="text-[10px] text-green-400 mt-1">{trend}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
