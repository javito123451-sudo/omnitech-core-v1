import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { authFetch } from "@/lib/authFetch";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  Brain, AlertTriangle, Target, Lightbulb, TrendingUp,
  ArrowRight, RefreshCw, Users, FileText, CalendarDays,
  ChevronRight, Zap, ShieldAlert, CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface Kpis {
  pipeline_value: number; confirmed_value: number;
  active_clients: number; leads: number; at_risk: number;
  total_clients: number; conversion_rate: number | null;
  total_quotes: number; activity_30d: number;
}
interface MonthPoint { label: string; actual: number | null; forecast: number | null; type: string; }
interface Forecast {
  confirmed: number; pipeline_conservative: number; pipeline_base: number;
  pipeline_optimistic: number; total_addressable: number; monthly: MonthPoint[];
}
interface RiskItem {
  severity: string; type: string; title: string; description: string;
  client?: string; company?: string | null; value?: number | null;
  action: string; action_href: string;
}
interface PriorityItem {
  score: number; urgency: string; title: string; description: string;
  client?: string; value?: number | null; action: string; action_href: string; due?: string;
}
interface OpportunityItem {
  type: string; title: string; description: string;
  client?: string; company?: string | null; action: string; action_href: string;
  confidence: string;
}
interface Insight { icon: string; title: string; body: string; }
interface IntelligenceData {
  generated_at: string; kpis: Kpis; forecast: Forecast;
  risks: RiskItem[]; priorities: PriorityItem[]; opportunities: OpportunityItem[]; insights: Insight[];
}

// ── Fetch ────────────────────────────────────────────────────────────────────
async function fetchIntelligence(): Promise<IntelligenceData> {
  const r = await authFetch(`${BASE}/api/executive`);
  if (!r.ok) throw new Error("Error cargando intelligence layer");
  return r.json() as Promise<IntelligenceData>;
}

// ── Badges ───────────────────────────────────────────────────────────────────
const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  low:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: "Crítico", high: "Alto", medium: "Medio", low: "Bajo",
};
const URGENCY_STYLES: Record<string, string> = {
  urgente: "bg-red-500/15 text-red-400 border-red-500/30",
  alta:    "bg-orange-500/15 text-orange-400 border-orange-500/30",
  media:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  baja:    "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const CONFIDENCE_STYLES: Record<string, string> = {
  "muy alta": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  alta:       "bg-green-500/15 text-green-400 border-green-500/30",
  media:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
  baja:       "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const CONFIDENCE_LABELS: Record<string, string> = {
  "muy alta": "Confianza muy alta", alta: "Confianza alta",
  media: "Confianza media", baja: "Confianza baja",
};

function SeverityDot({ s }: { s: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",  high: "bg-orange-500",
    medium: "bg-yellow-500", low: "bg-blue-500",
  };
  return <span className={cn("inline-block w-2 h-2 rounded-full shrink-0 mt-1.5", colors[s] ?? "bg-slate-500")} />;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string;
  color: string; icon: React.ElementType;
}) {
  return (
    <div className={cn("rounded-xl border p-4 flex flex-col gap-2 bg-card", color)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold text-foreground leading-none">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Tooltip personalizado ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-foreground mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">€{p.value.toLocaleString("es-ES")}</span>
        </div>
      ))}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-white/5", className)} />;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExecutivePage() {
  const [, navigate] = useLocation();
  const { data, isLoading, isFetching, refetch, error, dataUpdatedAt } = useQuery<IntelligenceData>({
    queryKey: ["executive-intelligence"],
    queryFn:  fetchIntelligence,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <AlertTriangle className="w-10 h-10 text-red-400" />
        <p className="text-sm">Error cargando Intelligence Layer. Verifica la conexión.</p>
        <button
          onClick={() => void refetch()}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Reintentar
        </button>
      </div>
    );
  }

  // ── Format helpers ────────────────────────────────────────────────────────
  const fmt = (n: number) => {
    if (n >= 1000) {
      const v = n / 1000;
      return "€" + (Number.isInteger(v) ? v : v.toFixed(1)) + "k";
    }
    return "€" + n;
  };

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Executive Intelligence</h1>
            {isFetching && !isLoading && (
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Decisiones estratégicas en tiempo real · {lastUpdated ? `Actualizado ${lastUpdated}` : "Cargando…"}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border bg-card hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
          Actualizar
        </button>
      </div>

      {/* KPI Strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data && (
        <motion.div
          className="grid grid-cols-2 md:grid-cols-5 gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <KpiCard
            label="Pipeline" icon={TrendingUp}
            value={fmt(data.kpis.pipeline_value)}
            sub={`${data.kpis.total_quotes} presupuesto${data.kpis.total_quotes !== 1 ? "s" : ""}`}
            color="border-amber-500/20"
          />
          <KpiCard
            label="Confirmado" icon={Target}
            value={fmt(data.kpis.confirmed_value)}
            sub="Ingresos cerrados"
            color="border-emerald-500/20"
          />
          <KpiCard
            label="Activos" icon={Users}
            value={String(data.kpis.active_clients)}
            sub={`${data.kpis.leads} leads`}
            color="border-blue-500/20"
          />
          <KpiCard
            label="En riesgo" icon={ShieldAlert}
            value={String(data.kpis.at_risk)}
            sub={`de ${data.kpis.total_clients} clientes`}
            color="border-red-500/20"
          />
          <KpiCard
            label="Conversión" icon={Zap}
            value={data.kpis.conversion_rate !== null ? `${data.kpis.conversion_rate}%` : "—"}
            sub="Presupuestos aceptados"
            color="border-violet-500/20"
          />
        </motion.div>
      )}

      {/* Forecast + Priorities */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Revenue Forecast Chart */}
        <div className="lg:col-span-3 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Forecast de Ingresos</h2>
            <span className="text-xs text-muted-foreground ml-1">— 6 meses</span>
          </div>

          {isLoading ? (
            <Skeleton className="h-52" />
          ) : data ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Conservador", v: data.forecast.pipeline_conservative, color: "text-yellow-400" },
                  { label: "Base",        v: data.forecast.pipeline_base,         color: "text-blue-400" },
                  { label: "Optimista",   v: data.forecast.pipeline_optimistic,   color: "text-emerald-400" },
                ].map(({ label, v, color }) => (
                  <div key={label} className="text-center">
                    <div className={cn("text-lg font-bold", color)}>{fmt(v)}</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.forecast.monthly} barGap={4} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Legend
                    iconType="circle" iconSize={7}
                    formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 11 }}>{v}</span>}
                  />
                  <Bar dataKey="actual" name="Real" radius={[4,4,0,0]}>
                    {data.forecast.monthly.map((m, i) => (
                      <Cell key={i} fill={m.type === "actual" ? "#3b82f6" : "transparent"} />
                    ))}
                  </Bar>
                  <Bar dataKey="forecast" name="Forecast" radius={[4,4,0,0]}>
                    {data.forecast.monthly.map((m, i) => (
                      <Cell key={i} fill={m.type === "forecast" ? "rgba(16,185,129,0.6)" : "transparent"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : null}
        </div>

        {/* Priority Queue */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-sm">Prioridades</h2>
            {data && <span className="text-xs text-muted-foreground ml-1">— top {data.priorities.length}</span>}
          </div>

          {isLoading ? (
            <div className="space-y-3 flex-1">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : data?.priorities.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-sm gap-2">
              <CircleDot className="w-8 h-8 opacity-40" />
              <p>Sin prioridades detectadas</p>
            </div>
          ) : (
            <ul className="space-y-2 flex-1 overflow-y-auto">
              {data?.priorities.map((p, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="group cursor-pointer"
                  onClick={() => navigate(p.action_href)}
                >
                  <div className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-border">
                    <span className="text-xs font-mono text-muted-foreground mt-0.5 w-4 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-medium text-foreground leading-snug">{p.title}</span>
                        <span className={cn("text-[10px] px-1.5 py-0 rounded border font-medium shrink-0",
                          URGENCY_STYLES[p.urgency] ?? URGENCY_STYLES.baja)}>
                          {p.urgency}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{p.description}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Risks + Opportunities + Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* Commercial Risks */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="font-semibold text-sm">Riesgos Comerciales</h2>
            {data && data.risks.length > 0 && (
              <span className="ml-auto text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                {data.risks.length}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : data?.risks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Sin riesgos detectados</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data?.risks.map((r, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="group cursor-pointer"
                  onClick={() => navigate(r.action_href)}
                >
                  <div className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-border">
                    <SeverityDot s={r.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-medium text-foreground line-clamp-1">{r.title}</span>
                        <span className={cn("text-[10px] px-1.5 py-0 rounded border font-medium shrink-0",
                          SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.low)}>
                          {SEVERITY_LABELS[r.severity]}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{r.description}</p>
                      <span className="text-[10px] text-primary/70 flex items-center gap-0.5 mt-1 group-hover:text-primary transition-colors">
                        {r.action} <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {/* Opportunities */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-emerald-400" />
            <h2 className="font-semibold text-sm">Oportunidades</h2>
            {data && data.opportunities.length > 0 && (
              <span className="ml-auto text-xs font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                {data.opportunities.length}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : data?.opportunities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Sin oportunidades detectadas</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data?.opportunities.map((o, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="group cursor-pointer"
                  onClick={() => navigate(o.action_href)}
                >
                  <div className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-border">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-medium text-foreground line-clamp-1">{o.title}</span>
                        <span className={cn("text-[10px] px-1.5 py-0 rounded border font-medium shrink-0",
                          CONFIDENCE_STYLES[o.confidence] ?? CONFIDENCE_STYLES.media)}>
                          {CONFIDENCE_LABELS[o.confidence] ?? o.confidence}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{o.description}</p>
                      <span className="text-[10px] text-emerald-500/70 flex items-center gap-0.5 mt-1 group-hover:text-emerald-400 transition-colors">
                        {o.action} <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {/* Strategic Insights */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-4 h-4 text-violet-400" />
            <h2 className="font-semibold text-sm">Análisis Estratégico</h2>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <ul className="space-y-3">
              {data?.insights.map((ins, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/15"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-base leading-none mt-0.5 shrink-0">{ins.icon}</span>
                    <div>
                      <div className="text-xs font-semibold text-foreground mb-1">{ins.title}</div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{ins.body}</p>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Quick Actions Footer */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/clients",   icon: Users,        label: "Clientes",      sub: `${data.kpis.total_clients} registrados` },
            { href: "/quotes",    icon: FileText,      label: "Presupuestos",  sub: `${data.kpis.total_quotes} en total` },
            { href: "/calendar",  icon: CalendarDays,  label: "Calendario",    sub: "Ver citas" },
            { href: "/assistant", icon: Brain,         label: "Asistente IA",  sub: "Análisis conversacional" },
          ].map(({ href, icon: Icon, label, sub }) => (
            <button
              key={href}
              onClick={() => navigate(href)}
              className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-white/5 hover:border-primary/30 transition-all group text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{label}</div>
                <div className="text-[11px] text-muted-foreground">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
