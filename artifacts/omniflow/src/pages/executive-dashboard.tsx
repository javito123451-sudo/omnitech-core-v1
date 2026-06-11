import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, TrendingUp, Users, AlertTriangle, Zap, Target,
  RefreshCw, Send, ChevronRight, ArrowRight, CalendarDays,
  FileText, ShieldAlert, Lightbulb, CircleDot, Star,
  DollarSign, Activity, Clock, MessageSquare, X,
  CheckCircle2, Circle, Flame, Crosshair, TriangleAlert,
  TrendingDown, Minus, BarChart2, Lock, ChevronUp, Sparkles,
  ListChecks, BadgeAlert, ArrowUpRight, FilePlus,
} from "lucide-react";
import { AIQuoteModal } from "@/components/ai-quote-modal";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

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

interface StrategicClient {
  id: number; name: string; company?: string | null; status: string;
  value?: number | null; score: number;
  score_breakdown: { economic: number; proximity: number; pipeline: number; urgency: number; };
  recommended_action: string;
  sent_quotes: { title: string; total: number; valid_until?: string; }[];
  upcoming_appointments: { title: string; date: string; time: string; }[];
  overdue_appointments: number;
}
interface StrategicBrief {
  kpis: {
    total_clients: number; active_clients: number; leads: number; at_risk: number;
    pipeline_eur: number; confirmed_eur: number; total_quotes: number; activity_30d: number;
  };
  top_clients_by_score: StrategicClient[];
  main_risks: string[];
}

interface ChatMessage { role: "user" | "assistant"; content: string; }

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchIntelligence(): Promise<IntelligenceData> {
  const r = await fetch(`${BASE}/api/executive`);
  if (!r.ok) throw new Error("Error");
  return r.json() as Promise<IntelligenceData>;
}

async function fetchStrategicBrief(): Promise<StrategicBrief> {
  const r = await fetch(`${BASE}/api/executive`);
  if (!r.ok) throw new Error("Error");
  const d = await r.json() as IntelligenceData;
  return {
    kpis: {
      total_clients: d.kpis.total_clients,
      active_clients: d.kpis.active_clients,
      leads: d.kpis.leads,
      at_risk: d.kpis.at_risk,
      pipeline_eur: d.kpis.pipeline_value,
      confirmed_eur: d.kpis.confirmed_value,
      total_quotes: d.kpis.total_quotes,
      activity_30d: d.kpis.activity_30d,
    },
    top_clients_by_score: [],
    main_risks: d.risks.map(r => r.title),
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return "€" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) {
    const v = n / 1000;
    return "€" + (Number.isInteger(v) ? v : v.toFixed(1)) + "k";
  }
  return "€" + n.toLocaleString("es-ES");
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Sk({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-white/5", className)} />;
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 75 ? "#10b981" : pct >= 50 ? "#3b82f6" : pct >= 30 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct / 100)}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize={size < 44 ? 10 : 12} fontWeight="700" fill={color}>
        {pct}
      </text>
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, accent, icon: Icon, pulse,
}: {
  label: string; value: string; sub?: string;
  accent: string; icon: React.ElementType; pulse?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative rounded-2xl border p-4 flex flex-col gap-2 overflow-hidden",
        "bg-gradient-to-br from-slate-900/80 to-slate-950/80 backdrop-blur-sm",
        accent,
      )}
    >
      {pulse && (
        <span className="absolute top-3 right-3 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      )}
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground leading-none tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </motion.div>
  );
}

// ── Client Score Card ─────────────────────────────────────────────────────────
function ClientCard({ c, rank, onClick }: { c: StrategicClient; rank: number; onClick: () => void }) {
  const rankColors = ["text-amber-400", "text-slate-300", "text-amber-600"];
  const rankBg = ["border-amber-500/30 bg-amber-500/5", "border-slate-500/30 bg-slate-500/5", "border-amber-700/20 bg-amber-700/5"];
  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    lead: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    inactive: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    churned: "bg-red-500/15 text-red-400 border-red-500/25",
  };
  const statusLabel: Record<string, string> = {
    active: "Activo", lead: "Lead", inactive: "Inactivo", churned: "Perdido",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: rank * 0.06 }}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border p-3.5 flex items-center gap-3",
        "hover:border-primary/30 hover:bg-white/[0.03] transition-all duration-200",
        rank < 3 ? rankBg[rank] : "border-border/50 bg-slate-900/40",
      )}
    >
      <div className={cn("text-xl font-black tabular-nums w-5 shrink-0 text-center", rank < 3 ? rankColors[rank] : "text-muted-foreground")}>
        {rank + 1}
      </div>
      <ScoreRing score={c.score} size={42} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{c.name}</span>
          <span className={cn("text-[9px] px-1.5 py-0 rounded border font-semibold shrink-0 uppercase tracking-wider", statusColors[c.status] ?? statusColors.inactive)}>
            {statusLabel[c.status] ?? c.status}
          </span>
          {c.overdue_appointments > 0 && (
            <span className="text-[9px] px-1.5 py-0 rounded border font-semibold shrink-0 bg-red-500/15 text-red-400 border-red-500/25">
              ⚠ Cita vencida
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{c.recommended_action}</div>
        {c.value && c.value > 0 && (
          <div className="text-[11px] text-emerald-400 font-semibold mt-0.5">{fmt(c.value)}</div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </motion.div>
  );
}

// ── Executive Briefing computation ────────────────────────────────────────────
interface BriefingMetric {
  id: string;
  emoji: string;
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: "green" | "yellow" | "red" | "blue";
  pulse?: boolean;
}

function computeBriefing(data: IntelligenceData): BriefingMetric[] {
  const { kpis, forecast, priorities, risks, opportunities, insights } = data;

  // ── 1. Dinero probable 30 días ───────────────────────────────────────────
  const prob30 = forecast.confirmed + forecast.pipeline_conservative;
  const prob30Tone: BriefingMetric["tone"] =
    prob30 >= kpis.pipeline_value * 0.5 ? "green"
    : prob30 >= kpis.pipeline_value * 0.2 ? "yellow"
    : "red";

  // ── 2. Dinero en riesgo ──────────────────────────────────────────────────
  const riskEur = risks
    .filter(r => ["critical", "high"].includes(r.severity))
    .reduce((s, r) => s + (r.value ?? (kpis.pipeline_value / Math.max(kpis.total_clients, 1))), 0);
  const riskPct = kpis.pipeline_value > 0 ? (riskEur / kpis.pipeline_value) * 100 : 0;
  const riskTone: BriefingMetric["tone"] =
    riskPct >= 30 ? "red" : riskPct >= 10 ? "yellow" : "green";

  // ── 3. Cliente prioritario ────────────────────────────────────────────────
  const topP = priorities[0];
  const topClientName = topP?.client ?? "Sin datos";
  const topClientValue = topP?.value ?? null;
  const topClientTone: BriefingMetric["tone"] =
    topP?.urgency === "urgente" ? "red"
    : topP?.urgency === "alta"  ? "yellow"
    : "blue";

  // ── 4. Acción crítica ─────────────────────────────────────────────────────
  const criticalAction = topP?.title ?? (insights[0]?.title ?? "Sin acciones críticas");
  const criticalSub = topP?.description
    ? topP.description.slice(0, 60) + (topP.description.length > 60 ? "…" : "")
    : "Sin detalles";
  const criticalTone: BriefingMetric["tone"] =
    topP?.urgency === "urgente" ? "red"
    : topP?.urgency === "alta"  ? "yellow"
    : "blue";

  // ── 5. Objetivo semanal ───────────────────────────────────────────────────
  const weeklyOpp = opportunities[0];
  const weeklyGoal = weeklyOpp
    ? weeklyOpp.action
    : (insights[0]?.title ?? "Mantener seguimiento de clientes activos");
  const weeklyClient = weeklyOpp?.client ?? (insights[0] ? "Análisis IA" : "General");
  const weeklyTone: BriefingMetric["tone"] = "green";

  return [
    {
      id: "prob30",
      emoji: "💰",
      icon: DollarSign,
      label: "Dinero probable 30 días",
      value: fmt(Math.round(prob30)),
      sub: `Escenario conservador · Pipeline: ${fmt(kpis.pipeline_value)}`,
      tone: prob30Tone,
      pulse: true,
    },
    {
      id: "risk",
      emoji: "⚠️",
      icon: TriangleAlert,
      label: "Dinero en riesgo",
      value: riskEur > 0 ? fmt(Math.round(riskEur)) : "Sin riesgos críticos",
      sub: riskEur > 0
        ? `${kpis.at_risk} cliente${kpis.at_risk !== 1 ? "s" : ""} en riesgo · ${Math.round(riskPct)}% del pipeline`
        : `${kpis.active_clients} clientes activos estables`,
      tone: riskTone,
    },
    {
      id: "top",
      emoji: "🔥",
      icon: Flame,
      label: "Cliente prioritario",
      value: topClientName,
      sub: topClientValue
        ? `${fmt(topClientValue)} · ${topP?.urgency ?? ""}`
        : (topP?.action ?? "Mayor impacto económico"),
      tone: topClientTone,
    },
    {
      id: "critical",
      emoji: "📅",
      icon: Zap,
      label: "Acción crítica",
      value: criticalAction.length > 36 ? criticalAction.slice(0, 36) + "…" : criticalAction,
      sub: criticalSub,
      tone: criticalTone,
      pulse: criticalTone === "red",
    },
    {
      id: "weekly",
      emoji: "🎯",
      icon: Crosshair,
      label: "Objetivo semanal",
      value: weeklyGoal.length > 36 ? weeklyGoal.slice(0, 36) + "…" : weeklyGoal,
      sub: weeklyClient,
      tone: weeklyTone,
    },
  ];
}

// ── Briefing Card ─────────────────────────────────────────────────────────────
const TONE_STYLES: Record<BriefingMetric["tone"], {
  border: string; bg: string; glow: string; label: string; value: string; dot: string;
}> = {
  green:  { border: "border-emerald-500/25", bg: "from-emerald-950/30 to-slate-950/70", glow: "shadow-emerald-500/10", label: "text-emerald-400/70", value: "text-emerald-300", dot: "bg-emerald-500" },
  yellow: { border: "border-amber-500/25",   bg: "from-amber-950/30 to-slate-950/70",   glow: "shadow-amber-500/10",   label: "text-amber-400/70",   value: "text-amber-300",   dot: "bg-amber-500"   },
  red:    { border: "border-red-500/25",      bg: "from-red-950/30 to-slate-950/70",     glow: "shadow-red-500/10",     label: "text-red-400/70",     value: "text-red-300",     dot: "bg-red-500"     },
  blue:   { border: "border-blue-500/25",     bg: "from-blue-950/30 to-slate-950/70",    glow: "shadow-blue-500/10",    label: "text-blue-400/70",    value: "text-blue-300",    dot: "bg-blue-500"    },
};

function BriefingCard({ metric, index }: { metric: BriefingMetric; index: number }) {
  const s = TONE_STYLES[metric.tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.07, ease: "easeOut" }}
      className={cn(
        "relative rounded-2xl border p-4 flex flex-col gap-2.5 overflow-hidden",
        "bg-gradient-to-br backdrop-blur-sm shadow-lg",
        s.border, s.bg, s.glow,
      )}
    >
      {/* Pulse indicator */}
      {metric.pulse && (
        <span className="absolute top-3 right-3 flex h-2 w-2">
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-70", s.dot)} />
          <span className={cn("relative inline-flex rounded-full h-2 w-2", s.dot)} />
        </span>
      )}

      {/* Emoji + label */}
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{metric.emoji}</span>
        <span className={cn("text-[10px] font-semibold uppercase tracking-widest truncate", s.label)}>
          {metric.label}
        </span>
      </div>

      {/* Main value */}
      <div className={cn("text-lg font-black leading-tight tracking-tight", s.value)}>
        {metric.value}
      </div>

      {/* Sub text */}
      <div className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
        {metric.sub}
      </div>

      {/* Bottom glow line */}
      <div className={cn("absolute bottom-0 left-0 right-0 h-[2px] opacity-40", s.dot)} />
    </motion.div>
  );
}

// ── Executive Briefing Section ────────────────────────────────────────────────
function ExecutiveBriefing({ data, isLoading }: { data?: IntelligenceData; isLoading: boolean }) {
  const metrics = useMemo(() => data ? computeBriefing(data) : [], [data]);

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-0.5 h-5 rounded-full bg-gradient-to-b from-primary to-violet-500" />
          <span className="text-[11px] font-black uppercase tracking-[0.15em] text-muted-foreground">
            Executive Briefing
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary/80 font-semibold">
            Tiempo real
          </span>
        </div>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] h-[108px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {metrics.map((m, i) => (
            <BriefingCard key={m.id} metric={m} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Executive Report types ────────────────────────────────────────────────────
interface ExecReport {
  generated_at: string;
  estado_general: {
    score: number;
    titulo: string;
    descripcion: string;
    tendencia: "positiva" | "estable" | "negativa";
  };
  dinero_probable: {
    conservador: number;
    base: number;
    optimista: number;
    resumen: string;
  };
  dinero_en_riesgo: {
    total_estimado: number;
    nivel: "bajo" | "medio" | "alto" | "crítico";
    clientes_afectados: string[];
    descripcion: string;
  };
  clientes_prioritarios: {
    nombre: string;
    empresa?: string | null;
    valor_estimado?: number | null;
    accion: string;
    urgencia: "urgente" | "alta" | "media";
  }[];
  bloqueadores: {
    titulo: string;
    impacto: "alto" | "medio" | "bajo";
    solucion: string;
  }[];
  accion_recomendada: {
    titulo: string;
    descripcion: string;
    pasos: string[];
    impacto_estimado: string;
  };
}

// ── Report Modal ──────────────────────────────────────────────────────────────
const TENDENCIA_CONFIG = {
  positiva: { icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", label: "Positiva" },
  estable:  { icon: Minus,        color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/25",   label: "Estable"  },
  negativa: { icon: TrendingDown, color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25",     label: "Negativa" },
};

const NIVEL_COLOR: Record<string, string> = {
  bajo:     "text-emerald-400",
  medio:    "text-amber-400",
  alto:     "text-orange-400",
  "crítico": "text-red-400",
};

const IMPACTO_BADGE: Record<string, string> = {
  alto:  "bg-red-500/15 text-red-300 border-red-500/25",
  medio: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  bajo:  "bg-slate-500/15 text-slate-400 border-slate-500/25",
};

const URGENCIA_BADGE: Record<string, string> = {
  urgente: "bg-red-500/15 text-red-300 border-red-500/25",
  alta:    "bg-amber-500/15 text-amber-300 border-amber-500/25",
  media:   "bg-blue-500/15 text-blue-300 border-blue-500/25",
};

function ScoreArc({ score }: { score: number }) {
  const r = 54;
  const circ = Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="140" height="78" viewBox="0 0 140 78">
      <path d="M 14 70 A 56 56 0 0 1 126 70" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
      <path
        d="M 14 70 A 56 56 0 0 1 126 70"
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
      <text x="70" y="62" textAnchor="middle" fontSize="28" fontWeight="900" fill={color}>{score}</text>
    </svg>
  );
}

function ReportSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-slate-900/50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
        <Icon className="w-4 h-4 text-primary/80 shrink-0" />
        <span className="text-[11px] font-black uppercase tracking-[0.15em] text-muted-foreground">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ReportModal({ report, onClose }: { report: ExecReport; onClose: () => void }) {
  const tend = TENDENCIA_CONFIG[report.estado_general.tendencia];
  const TrendIcon = tend.icon;
  const genTime = new Date(report.generated_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const genDate = new Date(report.generated_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  const probData = [
    { label: "Conservador", v: report.dinero_probable.conservador, fill: "#f59e0b" },
    { label: "Base",        v: report.dinero_probable.base,         fill: "#3b82f6" },
    { label: "Optimista",   v: report.dinero_probable.optimista,    fill: "#10b981" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-6 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-3xl bg-slate-950 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.07] bg-gradient-to-r from-violet-950/50 to-slate-950">
          <div className="absolute top-0 right-0 w-80 h-40 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/30 to-primary/20 border border-violet-500/20 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-violet-300" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-primary/70">Informe Ejecutivo</div>
                  <div className="text-[10px] text-muted-foreground">{genDate} · {genTime}</div>
                </div>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-foreground leading-tight">
                {report.estado_general.titulo}
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-lg leading-relaxed">
                {report.estado_general.descripcion}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors shrink-0 mt-1"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Score + tendencia */}
          <div className="flex items-center gap-6 mt-4 flex-wrap">
            <div className="flex items-center gap-3">
              <ScoreArc score={report.estado_general.score} />
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Salud del negocio</div>
                <div className={cn("flex items-center gap-1.5 mt-1 text-xs font-semibold px-2.5 py-1 rounded-full border", tend.bg, tend.border, tend.color)}>
                  <TrendIcon className="w-3 h-3" />
                  Tendencia {tend.label}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">

          {/* Dinero probable */}
          <ReportSection title="Dinero probable (30 días)" icon={DollarSign}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {probData.map(d => (
                <div key={d.label} className="text-center rounded-xl border border-white/[0.07] bg-white/[0.02] py-3 px-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{d.label}</div>
                  <div className="text-lg font-black" style={{ color: d.fill }}>€{d.v.toLocaleString("es-ES")}</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{report.dinero_probable.resumen}</p>
          </ReportSection>

          {/* Dinero en riesgo */}
          <ReportSection title="Dinero en riesgo" icon={TriangleAlert}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-3 text-center shrink-0">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Estimado</div>
                <div className={cn("text-2xl font-black", NIVEL_COLOR[report.dinero_en_riesgo.nivel])}>
                  €{report.dinero_en_riesgo.total_estimado.toLocaleString("es-ES")}
                </div>
                <div className={cn("text-[10px] font-semibold mt-1 uppercase tracking-wider", NIVEL_COLOR[report.dinero_en_riesgo.nivel])}>
                  Nivel {report.dinero_en_riesgo.nivel}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">{report.dinero_en_riesgo.descripcion}</p>
                {report.dinero_en_riesgo.clientes_afectados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {report.dinero_en_riesgo.clientes_afectados.map((c, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-300">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ReportSection>

          {/* Clientes prioritarios */}
          <ReportSection title="Clientes prioritarios" icon={Star}>
            <div className="space-y-2.5">
              {report.clientes_prioritarios.map((c, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="text-lg font-black text-muted-foreground/40 w-5 text-center shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{c.nombre}</span>
                      {c.empresa && <span className="text-[11px] text-muted-foreground">{c.empresa}</span>}
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider", URGENCIA_BADGE[c.urgencia])}>
                        {c.urgencia}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{c.accion}</div>
                  </div>
                  {c.valor_estimado && c.valor_estimado > 0 && (
                    <div className="text-sm font-bold text-emerald-400 shrink-0">€{c.valor_estimado.toLocaleString("es-ES")}</div>
                  )}
                </div>
              ))}
            </div>
          </ReportSection>

          {/* Bloqueadores */}
          <ReportSection title="Bloqueadores" icon={Lock}>
            <div className="space-y-2.5">
              {report.bloqueadores.map((b, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-foreground">{b.titulo}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider", IMPACTO_BADGE[b.impacto])}>
                      {b.impacto}
                    </span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <ArrowUpRight className="w-3 h-3 text-primary/60 mt-0.5 shrink-0" />
                    <span className="text-[11px] text-muted-foreground">{b.solucion}</span>
                  </div>
                </div>
              ))}
            </div>
          </ReportSection>

          {/* Acción recomendada */}
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-violet-900/10 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-primary/15">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-[0.15em] text-primary/80">Acción recomendada</span>
            </div>
            <div className="p-5">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-black text-foreground mb-1.5">{report.accion_recomendada.titulo}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{report.accion_recomendada.descripcion}</p>
                  <div className="space-y-1.5">
                    {report.accion_recomendada.pasos.map((p, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/15 border border-primary/25 text-[10px] font-bold text-primary flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-[12px] text-foreground/80 leading-snug">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-center shrink-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Impacto estimado</div>
                  <div className="text-sm font-black text-emerald-300 leading-tight">{report.accion_recomendada.impacto_estimado}</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between gap-4">
          <div className="text-[11px] text-muted-foreground/60">
            Generado con OmniTech AI · {genDate}
          </div>
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-xl border border-border bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            Cerrar informe
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── CEO Decision types ────────────────────────────────────────────────────────
interface CeoDecision {
  generated_at: string;
  hacer_hoy: { accion: string; cliente?: string | null; impacto_euros?: number | null; razon: string }[];
  no_hacer: { accion: string; razon: string }[];
  cliente_prioritario: { nombre: string; empresa?: string | null; valor_potencial?: number | null; por_que: string; accion_concreta: string };
  oportunidad_cerrar: { titulo: string; cliente: string; valor?: number | null; probabilidad: string; siguiente_paso: string; plazo: string };
  riesgo_eliminar: { titulo: string; dinero_en_juego?: number | null; impacto_si_ignoras: string; accion_hoy: string };
}

// ── CEO Modal ─────────────────────────────────────────────────────────────────
function CeoBlock({
  number, label, color, children,
}: { number: string; label: string; color: "green" | "red" | "blue" | "amber" | "violet"; children: React.ReactNode }) {
  const palette = {
    green:  { num: "text-emerald-400",  border: "border-emerald-500/20", bg: "bg-emerald-500/5",  tag: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"  },
    red:    { num: "text-red-400",       border: "border-red-500/20",     bg: "bg-red-500/5",      tag: "bg-red-500/10 text-red-400 border-red-500/20"              },
    blue:   { num: "text-blue-400",      border: "border-blue-500/20",    bg: "bg-blue-500/5",     tag: "bg-blue-500/10 text-blue-400 border-blue-500/20"           },
    amber:  { num: "text-amber-400",     border: "border-amber-500/20",   bg: "bg-amber-500/5",    tag: "bg-amber-500/10 text-amber-400 border-amber-500/20"        },
    violet: { num: "text-violet-400",    border: "border-violet-500/20",  bg: "bg-violet-500/5",   tag: "bg-violet-500/10 text-violet-400 border-violet-500/20"     },
  };
  const p = palette[color];
  return (
    <div className={cn("rounded-2xl border overflow-hidden", p.border, p.bg)}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.05]">
        <span className={cn("text-2xl font-black tabular-nums leading-none", p.num)}>{number}</span>
        <span className="text-xs font-black uppercase tracking-[0.15em] text-foreground/70">{label}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function CeoModal({ decision, onClose, onRefresh, loading }: {
  decision: CeoDecision; onClose: () => void; onRefresh: () => void; loading: boolean;
}) {
  const genTime = new Date(decision.generated_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-sm overflow-y-auto py-6 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="w-full max-w-2xl bg-[#09090f] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.07] bg-gradient-to-r from-slate-950 to-violet-950/30">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(139,92,246,0.08),_transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 relative">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/25 to-orange-500/15 border border-amber-500/25 flex items-center justify-center">
                  <span className="text-base leading-none">👔</span>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-500/70">Decisión Ejecutiva</div>
                  <div className="text-[10px] text-muted-foreground/60">{genTime} · Ordenado por impacto económico</div>
                </div>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-foreground">¿Qué haría un CEO?</h2>
              <p className="text-[12px] text-muted-foreground mt-1">Análisis de tus datos reales. Sin filtros.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-1">
              <button
                onClick={onRefresh}
                disabled={loading}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                {loading ? "Analizando…" : "Regenerar"}
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-3">

          {/* 01 — Hacer hoy */}
          <CeoBlock number="01" label="Qué hacer HOY" color="green">
            <div className="space-y-3">
              {decision.hacer_hoy.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-start gap-3"
                >
                  <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-black text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-bold text-foreground">{item.accion}</span>
                      {item.cliente && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{item.cliente}</span>
                      )}
                      {item.impacto_euros && item.impacto_euros > 0 && (
                        <span className="text-[10px] font-bold text-emerald-300">+€{item.impacto_euros.toLocaleString("es-ES")}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">{item.razon}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </CeoBlock>

          {/* 02 — No hacer */}
          <CeoBlock number="02" label="Qué NO hacer" color="red">
            <div className="space-y-2.5">
              {decision.no_hacer.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-red-500 text-lg leading-none shrink-0 mt-0.5">✕</span>
                  <div>
                    <div className="text-sm font-bold text-foreground/90 line-through decoration-red-500/50">{item.accion}</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.razon}</p>
                  </div>
                </div>
              ))}
            </div>
          </CeoBlock>

          {/* 03 + 04 side by side on md+ */}
          <div className="grid md:grid-cols-2 gap-3">
            {/* 03 — Cliente prioritario */}
            <CeoBlock number="03" label="Cliente a priorizar" color="blue">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center text-lg shrink-0">🔥</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-black text-foreground">{decision.cliente_prioritario.nombre}</span>
                    {decision.cliente_prioritario.empresa && (
                      <span className="text-[10px] text-muted-foreground">{decision.cliente_prioritario.empresa}</span>
                    )}
                    {decision.cliente_prioritario.valor_potencial && decision.cliente_prioritario.valor_potencial > 0 && (
                      <span className="text-[11px] font-bold text-blue-300">€{decision.cliente_prioritario.valor_potencial.toLocaleString("es-ES")}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-snug">{decision.cliente_prioritario.por_que}</p>
                  <div className="text-[11px] text-blue-300 font-semibold bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-1.5 leading-snug">
                    → {decision.cliente_prioritario.accion_concreta}
                  </div>
                </div>
              </div>
            </CeoBlock>

            {/* 04 — Oportunidad a cerrar */}
            <CeoBlock number="04" label="Oportunidad a cerrar" color="amber">
              <div className="space-y-2">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-sm font-black text-foreground">{decision.oportunidad_cerrar.titulo}</span>
                  <span className="text-[10px] text-muted-foreground">· {decision.oportunidad_cerrar.cliente}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {decision.oportunidad_cerrar.valor && decision.oportunidad_cerrar.valor > 0 && (
                    <span className="text-base font-black text-amber-300">€{decision.oportunidad_cerrar.valor.toLocaleString("es-ES")}</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold">
                    {decision.oportunidad_cerrar.probabilidad}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-muted-foreground">
                    {decision.oportunidad_cerrar.plazo}
                  </span>
                </div>
                <div className="text-[11px] text-amber-300 font-semibold bg-amber-500/8 border border-amber-500/20 rounded-lg px-2.5 py-1.5 leading-snug">
                  → {decision.oportunidad_cerrar.siguiente_paso}
                </div>
              </div>
            </CeoBlock>
          </div>

          {/* 05 — Riesgo a eliminar */}
          <CeoBlock number="05" label="Riesgo a eliminar HOY" color="violet">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-black text-foreground">{decision.riesgo_eliminar.titulo}</span>
                  {decision.riesgo_eliminar.dinero_en_juego && decision.riesgo_eliminar.dinero_en_juego > 0 && (
                    <span className="text-[11px] font-bold text-red-400">€{decision.riesgo_eliminar.dinero_en_juego.toLocaleString("es-ES")} en juego</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
                  Si no actúas: <span className="text-orange-400">{decision.riesgo_eliminar.impacto_si_ignoras}</span>
                </p>
                <div className="text-[11px] text-violet-300 font-semibold bg-violet-500/8 border border-violet-500/20 rounded-lg px-2.5 py-1.5 leading-snug">
                  → {decision.riesgo_eliminar.accion_hoy}
                </div>
              </div>
            </div>
          </CeoBlock>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.05] bg-white/[0.01] flex items-center justify-between">
          <div className="text-[10px] text-muted-foreground/50">Basado en tus datos reales · OmniTech AI</div>
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-xl border border-border bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Chart Tooltip ─────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="font-semibold text-foreground mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-bold text-foreground">€{p.value.toLocaleString("es-ES")}</span>
        </div>
      ))}
    </div>
  );
}

// ── Inline Chat ───────────────────────────────────────────────────────────────
function InlineChat({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hola. Soy tu asistente estratégico. Puedes preguntarme: ¿Cómo va el negocio? ¿Qué cliente priorizo hoy? ¿Dónde está el dinero?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const allMsgs = [...messages, userMsg];
    let aiText = "";
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const resp = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMsgs.map(m => ({ role: m.role, content: m.content })), sessionId }),
      });
      if (!resp.ok || !resp.body) throw new Error("Error");
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          try {
            const ev = JSON.parse(raw) as Record<string, unknown>;
            console.log("SSE EVENT", ev);
            if (ev["event"] === "session_created" && ev["sessionId"]) setSessionId(ev["sessionId"] as string);
            // Backend emits { token } with NO event field — check directly
            if (typeof ev["token"] === "string" && ev["token"] !== "") {
              aiText += ev["token"];
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: aiText };
                return copy;
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Error al conectar con el asistente." };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, sessionId]);

  const QUICK = [
    "¿Cómo va el negocio?",
    "¿Qué cliente priorizo hoy?",
    "¿Dónde está el dinero?",
    "¿Cuáles son los riesgos?",
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-semibold">Asistente Estratégico</span>
          <span className="flex h-1.5 w-1.5 relative ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-white/5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <Brain className="w-3 h-3 text-violet-400" />
              </div>
            )}
            <div className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "bg-primary text-white rounded-tr-sm"
                : "bg-slate-800/80 border border-white/8 text-foreground rounded-tl-sm",
            )}>
              {m.content === "" && loading && i === messages.length - 1
                ? <span className="flex gap-1 items-center h-4"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} /><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} /></span>
                : <span className="whitespace-pre-wrap">{m.content}</span>
              }
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex gap-2 flex-wrap shrink-0">
          {QUICK.map(q => (
            <button
              key={q}
              onClick={() => void send(q)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 shrink-0">
        <div className="flex items-center gap-2 bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 focus-within:border-primary/40 transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Pregunta algo estratégico..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/80 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExecutiveDashboardPage() {
  const [, navigate] = useLocation();
  const [showChat, setShowChat] = useState(false);
  const [showReport, setShowReport]     = useState(false);
  const [reportData, setReportData]     = useState<ExecReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError]   = useState<string | null>(null);

  const [showCeo, setShowCeo]         = useState(false);
  const [ceoData, setCeoData]         = useState<CeoDecision | null>(null);
  const [ceoLoading, setCeoLoading]   = useState(false);
  const [ceoError, setCeoError]       = useState<string | null>(null);

  const [aiQuoteClient, setAiQuoteClient] = useState<{
    id: number; name: string; email: string; phone?: string | null; company?: string | null; value?: number | null;
  } | null>(null);

  const generateCeo = useCallback(async () => {
    setCeoLoading(true);
    setCeoError(null);
    try {
      const r = await fetch(`${BASE}/api/executive/ceo`, { method: "POST" });
      if (!r.ok) throw new Error("Error al generar análisis CEO");
      const json = await r.json() as CeoDecision;
      setCeoData(json);
      setShowCeo(true);
    } catch (e) {
      setCeoError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCeoLoading(false);
    }
  }, []);

  const generateReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const r = await fetch(`${BASE}/api/executive/report`, { method: "POST" });
      if (!r.ok) throw new Error("Error al generar el informe");
      const json = await r.json() as ExecReport;
      setReportData(json);
      setShowReport(true);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setReportLoading(false);
    }
  }, []);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<IntelligenceData>({
    queryKey: ["exec-dashboard-intel"],
    queryFn: fetchIntelligence,
    refetchInterval: 90_000,
    staleTime: 45_000,
  });

  const { data: allClients } = useQuery<{ id: number; name: string; email: string; phone?: string | null; company?: string | null; value?: string | null }[]>({
    queryKey: ["clients-lookup"],
    queryFn: () => fetch(BASE + "/api/clients").then(r => r.json()) as Promise<{ id: number; name: string; email: string; phone?: string | null; company?: string | null; value?: string | null }[]>,
    staleTime: 300_000,
    enabled: true,
  });

  const lastUpd = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : null;

  const kpi = data?.kpis;
  const totalPipeline = kpi ? kpi.pipeline_value + kpi.confirmed_value : 0;

  // Score breakdown data for mini bar
  const scoreData = data ? [
    { name: "Conservador", v: data.forecast.pipeline_conservative, fill: "#f59e0b" },
    { name: "Base",        v: data.forecast.pipeline_base,         fill: "#3b82f6" },
    { name: "Optimista",   v: data.forecast.pipeline_optimistic,   fill: "#10b981" },
  ] : [];

  return (
    <div className="relative min-h-full pb-16">

      {/* ── Ambient BG ──────────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-violet-500/5 blur-[100px]" />
      </div>

      <div className="relative z-10 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-primary/20 border border-violet-500/20 flex items-center justify-center">
                <Brain className="w-4.5 h-4.5 text-violet-400 w-[18px] h-[18px]" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight leading-none">Executive Dashboard</h1>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Inteligencia estratégica en tiempo real
                  {lastUpd && <span className="ml-1.5 text-emerald-500/80">· {lastUpd}</span>}
                </p>
              </div>
              {isFetching && !isLoading && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void refetch()}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-slate-900/60 hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
              Actualizar
            </button>

            {/* ── ¿Qué haría un CEO? ── */}
            <button
              onClick={() => { if (ceoData) { setShowCeo(true); } else { void generateCeo(); } }}
              disabled={ceoLoading}
              className={cn(
                "relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl border font-semibold transition-all overflow-hidden",
                ceoLoading
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400/60 cursor-wait"
                  : "border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-orange-500/10 text-amber-400 hover:from-amber-500/25 hover:to-orange-500/20 hover:border-amber-500/50 shadow-sm shadow-amber-500/5",
              )}
            >
              {ceoLoading ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Analizando…</>
              ) : (
                <>
                  <span className="text-sm leading-none">👔</span>
                  ¿Qué haría un CEO?
                  {ceoData && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
                </>
              )}
            </button>
            {ceoError && (
              <span className="text-[11px] text-red-400 border border-red-500/20 bg-red-500/10 px-2 py-1 rounded-lg">{ceoError}</span>
            )}

            {/* ── Generar Informe Ejecutivo ── */}
            <button
              onClick={() => { if (reportData) { setShowReport(true); } else { void generateReport(); } }}
              disabled={reportLoading}
              className={cn(
                "relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl border font-semibold transition-all overflow-hidden",
                reportLoading
                  ? "border-primary/30 bg-primary/10 text-primary/60 cursor-wait"
                  : "border-primary/40 bg-gradient-to-r from-primary/20 to-violet-500/15 text-primary hover:from-primary/30 hover:to-violet-500/25 hover:border-primary/60 shadow-sm shadow-primary/10",
              )}
            >
              {reportLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Analizando…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Generar Informe Ejecutivo
                  {reportData && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />}
                </>
              )}
            </button>

            {reportError && (
              <span className="text-[11px] text-red-400 border border-red-500/20 bg-red-500/10 px-2 py-1 rounded-lg">
                {reportError}
              </span>
            )}

            <button
              onClick={() => setShowChat(v => !v)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all",
                showChat
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                  : "bg-slate-900/60 border-border text-muted-foreground hover:text-foreground hover:border-violet-500/30",
              )}
            >
              <MessageSquare className="w-3 h-3" />
              Asistente IA
            </button>
          </div>
        </div>

        {/* ── Executive Briefing ──────────────────────────────────────────── */}
        <ExecutiveBriefing data={data} isLoading={isLoading} />

        {/* ── Main grid ───────────────────────────────────────────────────── */}
        <div className={cn("grid gap-6", showChat ? "lg:grid-cols-[1fr_360px]" : "grid-cols-1")}>

          {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div className="space-y-6 min-w-0">

            {/* KPI Strip */}
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <Sk key={i} className="h-24" />)}
              </div>
            ) : kpi && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  label="Pipeline Total" icon={TrendingUp} accent="border-amber-500/20"
                  value={fmt(kpi.pipeline_value)}
                  sub={`${kpi.total_quotes} presupuesto${kpi.total_quotes !== 1 ? "s" : ""} activos`}
                />
                <KpiCard
                  label="Ingresos Confirmados" icon={DollarSign} accent="border-emerald-500/20"
                  value={fmt(kpi.confirmed_value)}
                  sub="Cerrado y confirmado" pulse
                />
                <KpiCard
                  label="Clientes Activos" icon={Users} accent="border-blue-500/20"
                  value={String(kpi.active_clients)}
                  sub={`${kpi.leads} leads en pipeline`}
                />
                <KpiCard
                  label="En Riesgo" icon={ShieldAlert} accent="border-red-500/20"
                  value={String(kpi.at_risk)}
                  sub={`de ${kpi.total_clients} clientes totales`}
                />
              </div>
            )}

            {/* Revenue Chart + Forecast Scenarios */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

              {/* Area chart */}
              <div className="lg:col-span-3 rounded-2xl border border-border/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">Forecast de Ingresos</span>
                    <span className="text-xs text-muted-foreground">— 6 meses</span>
                  </div>
                  {kpi && (
                    <div className="text-xs text-muted-foreground">
                      Total: <span className="font-semibold text-foreground">{fmt(totalPipeline)}</span>
                    </div>
                  )}
                </div>

                {isLoading ? <Sk className="h-52" /> : data ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {scoreData.map(s => (
                        <div key={s.name} className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5 text-center">
                          <div className="text-base font-bold" style={{ color: s.fill }}>{fmt(s.v)}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{s.name}</div>
                        </div>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={170}>
                      <AreaChart data={data.forecast.monthly} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false}
                          tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v/1000)}k` : String(v)} />
                        <Tooltip content={<ChartTip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
                        <Area dataKey="actual" name="Real" stroke="#3b82f6" fill="url(#gradActual)" strokeWidth={2} dot={false} connectNulls />
                        <Area dataKey="forecast" name="Forecast" stroke="#10b981" fill="url(#gradForecast)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </>
                ) : null}
              </div>

              {/* Conversion + activity */}
              <div className="lg:col-span-2 flex flex-col gap-4">

                {/* Conversion */}
                <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 backdrop-blur-sm flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-semibold">Conversión & Actividad</span>
                  </div>
                  {isLoading ? <Sk className="h-28" /> : kpi ? (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Tasa de conversión</span>
                          <span className="font-bold text-foreground">{kpi.conversion_rate !== null ? `${kpi.conversion_rate}%` : "—"}</span>
                        </div>
                        {kpi.conversion_rate !== null && (
                          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${kpi.conversion_rate}%` }}
                              transition={{ duration: 1, ease: "easeOut" }}
                              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Pipeline cerrado</span>
                          <span className="font-bold text-emerald-400">
                            {totalPipeline > 0 ? Math.round((kpi.confirmed_value / totalPipeline) * 100) : 0}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: totalPipeline > 0 ? `${Math.min(100, Math.round((kpi.confirmed_value / totalPipeline) * 100))}%` : "0%" }}
                            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center">
                          <div className="text-base font-bold text-blue-400">{kpi.activity_30d}</div>
                          <div className="text-[10px] text-muted-foreground">actividades 30d</div>
                        </div>
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center">
                          <div className="text-base font-bold text-amber-400">{kpi.leads}</div>
                          <div className="text-[10px] text-muted-foreground">leads activos</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Risks summary */}
                <div className="rounded-2xl border border-red-500/15 bg-gradient-to-br from-red-950/20 to-slate-950/60 p-4 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-xs font-semibold">Riesgos Detectados</span>
                    {data && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                        {data.risks.length}
                      </span>
                    )}
                  </div>
                  {isLoading ? <Sk className="h-16" /> : (
                    <ul className="space-y-1.5">
                      {data?.risks.slice(0, 3).map((r, i) => (
                        <li key={i} onClick={() => navigate(r.action_href)}
                          className="flex items-start gap-2 cursor-pointer group">
                          <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                            r.severity === "critical" ? "bg-red-500" : r.severity === "high" ? "bg-orange-500" : "bg-yellow-500")} />
                          <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors line-clamp-1">{r.title}</span>
                        </li>
                      ))}
                      {data?.risks.length === 0 && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Sin riesgos críticos
                        </div>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* ── Priorities + Opportunities ─────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Priority queue */}
              <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-amber-950/15 to-slate-950/60 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold">Acciones Prioritarias</span>
                  {data && <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">{data.priorities.length}</span>}
                </div>
                {isLoading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Sk key={i} className="h-14" />)}</div>
                ) : data?.priorities.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                    <CircleDot className="w-8 h-8 opacity-30" /><p>Sin prioridades</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {data?.priorities.slice(0, 5).map((p, i) => (
                      <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                        onClick={() => navigate(p.action_href)}
                        className="group cursor-pointer flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.04] border border-transparent hover:border-amber-500/15 transition-all">
                        <span className="text-xs font-black text-amber-500/60 w-4 shrink-0 mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{p.title}</span>
                            <span className={cn("text-[9px] px-1.5 rounded border font-semibold shrink-0",
                              p.urgency === "urgente" ? "bg-red-500/15 text-red-400 border-red-500/25"
                              : p.urgency === "alta" ? "bg-orange-500/15 text-orange-400 border-orange-500/25"
                              : "bg-yellow-500/15 text-yellow-400 border-yellow-500/25")}>
                              {p.urgency}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </motion.li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Opportunities */}
              <div className="rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-950/15 to-slate-950/60 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-semibold">Oportunidades de Venta</span>
                  {data && <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{data.opportunities.length}</span>}
                </div>
                {isLoading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Sk key={i} className="h-14" />)}</div>
                ) : data?.opportunities.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                    <Lightbulb className="w-8 h-8 opacity-30" /><p>Sin oportunidades detectadas</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {data?.opportunities.slice(0, 5).map((o, i) => {
                      const matchedClient = o.client
                        ? allClients?.find(c => c.name.toLowerCase() === o.client!.toLowerCase())
                        : undefined;
                      return (
                        <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                          className="group flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.04] border border-transparent hover:border-emerald-500/15 transition-all">
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5 cursor-pointer"
                            onClick={() => navigate(o.action_href)}
                          />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(o.action_href)}>
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <span className="text-xs font-semibold text-foreground">{o.title}</span>
                              <span className={cn("text-[9px] px-1.5 rounded border font-semibold shrink-0",
                                o.confidence === "muy alta" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                                : o.confidence === "alta" ? "bg-green-500/15 text-green-400 border-green-500/25"
                                : "bg-blue-500/15 text-blue-400 border-blue-500/25")}>
                                {o.confidence}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2">{o.description}</p>
                            <span className="text-[10px] text-emerald-500/70 flex items-center gap-0.5 mt-1 group-hover:text-emerald-400 transition-colors">
                              {o.action} <ArrowRight className="w-2.5 h-2.5" />
                            </span>
                          </div>
                          {matchedClient && (
                            <button
                              onClick={e => { e.stopPropagation(); setAiQuoteClient({ id: matchedClient.id, name: matchedClient.name, email: matchedClient.email, phone: matchedClient.phone, company: matchedClient.company, value: matchedClient.value ? Number(matchedClient.value) : null }); }}
                              title="Generar Presupuesto IA"
                              className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary/25 hover:border-primary/40 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <FilePlus className="w-3.5 h-3.5 text-primary" />
                            </button>
                          )}
                        </motion.li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* ── Strategic Insights ────────────────────────────────────── */}
            {(isLoading || (data?.insights && data.insights.length > 0)) && (
              <div className="rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-950/15 to-slate-950/60 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Brain className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-semibold">Análisis Estratégico IA</span>
                </div>
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <Sk key={i} className="h-20" />)}</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {data?.insights.map((ins, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                        className="p-3.5 rounded-xl bg-violet-500/[0.06] border border-violet-500/15">
                        <div className="flex items-start gap-2.5">
                          <span className="text-lg leading-none shrink-0 mt-0.5">{ins.icon}</span>
                          <div>
                            <div className="text-xs font-semibold text-foreground mb-1">{ins.title}</div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">{ins.body}</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Quick Nav ────────────────────────────────────────────── */}
            {data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { href: "/clients",   icon: Users,        label: "Clientes",      sub: `${kpi?.total_clients ?? 0} registrados` },
                  { href: "/quotes",    icon: FileText,      label: "Presupuestos",  sub: `${kpi?.total_quotes ?? 0} en total` },
                  { href: "/calendar",  icon: CalendarDays,  label: "Calendario",    sub: "Ver citas" },
                  { href: "/assistant", icon: Brain,         label: "Asistente IA",  sub: "Análisis conversacional" },
                ].map(({ href, icon: Icon, label, sub }) => (
                  <button key={href} onClick={() => navigate(href)}
                    className="flex items-center gap-3 p-3.5 rounded-xl border border-border/50 bg-slate-900/40 hover:bg-white/[0.04] hover:border-primary/25 transition-all group text-left">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
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

          {/* ── RIGHT COLUMN: Chat ───────────────────────────────────────── */}
          <AnimatePresence>
            {showChat && (
              <motion.div
                key="chat-panel"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.25 }}
                className="lg:sticky lg:top-0 lg:h-[calc(100vh-140px)] rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-900/95 to-slate-950/95 backdrop-blur-sm flex flex-col overflow-hidden"
              >
                <InlineChat onClose={() => setShowChat(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Report Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showReport && reportData && (
          <ReportModal report={reportData} onClose={() => setShowReport(false)} />
        )}
      </AnimatePresence>

      {/* ── CEO Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCeo && ceoData && (
          <CeoModal
            decision={ceoData}
            onClose={() => setShowCeo(false)}
            onRefresh={() => void generateCeo()}
            loading={ceoLoading}
          />
        )}
      </AnimatePresence>

      {/* ── AI Quote Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {aiQuoteClient && (
          <AIQuoteModal
            clientId={aiQuoteClient.id}
            clientName={aiQuoteClient.name}
            clientEmail={aiQuoteClient.email}
            clientPhone={aiQuoteClient.phone}
            clientCompany={aiQuoteClient.company}
            defaultValue={aiQuoteClient.value}
            onClose={() => setAiQuoteClient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
