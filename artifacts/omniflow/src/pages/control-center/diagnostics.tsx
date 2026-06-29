import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  CheckCircle2, XCircle, AlertTriangle, Activity, Loader2,
  RefreshCw, Server, Plug, Brain, Users, Shield, Zap,
  ChevronRight, Clock, Wrench, TrendingUp, ArrowRight,
  ArrowDown, ArrowUp, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Types ───────────────────────────────────────────────────────────────── */

type Severity = "critical" | "warning" | "info";
type CheckStatus = "pass" | "fail" | "skip" | "warn";

interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  message: string;
  durationMs: number;
  detail?: Record<string, unknown>;
}

interface DiagnosticIssue {
  id: string;
  module: string;
  severity: Severity;
  title: string;
  description: string;
  autoFixable: boolean;
  fixAction?: string;
  fixLabel?: string;
}

interface DiagnosticRecommendation {
  id: string;
  module: string;
  severity: Severity;
  title: string;
  description: string;
}

interface ModuleResult {
  module: string;
  score: number;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  checks: DiagnosticCheck[];
  issues: DiagnosticIssue[];
  recommendations: DiagnosticRecommendation[];
  durationMs: number;
}

interface DiagnosticReport {
  id: number;
  orgId: number;
  runBy?: string;
  scope: string;
  score: number;
  status: "healthy" | "degraded" | "unhealthy";
  summary: string;
  modules: ModuleResult[];
  issues: DiagnosticIssue[];
  recommendations: DiagnosticRecommendation[];
  actionsTaken: string[];
  createdAt: string;
}

interface HistoryEntry {
  id: number;
  score: number;
  status: string;
  summary: string;
  createdAt: string;
}

/* ── Module Icons ────────────────────────────────────────────────────────── */

const MODULE_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  infrastructure: { icon: Server,    color: "text-blue-400",    label: "Infraestructura" },
  integrations:   { icon: Plug,      color: "text-cyan-400",    label: "Integraciones" },
  ai:             { icon: Brain,     color: "text-violet-400",  label: "IA" },
  crm:            { icon: Users,     color: "text-amber-400",   label: "CRM" },
  security:       { icon: Shield,     color: "text-red-400",     label: "Seguridad" },
};

/* ── Score Ring ──────────────────────────────────────────────────────────── */

function ScoreRing({ score, status }: { score: number; status: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const stroke = Math.round((score / 100) * circumference);
  const color = status === "healthy" ? "stroke-emerald-400" : status === "degraded" ? "stroke-amber-400" : "stroke-red-400";
  const bg = status === "healthy" ? "bg-emerald-500/5" : status === "degraded" ? "bg-amber-500/5" : "bg-red-500/5";
  const border = status === "healthy" ? "border-emerald-500/15" : status === "degraded" ? "border-amber-500/15" : "border-red-500/15";

  return (
    <div className={cn("flex items-center gap-5 p-5 rounded-2xl border", bg, border)}>
      <div className="relative w-28 h-28 flex-shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} className="stroke-white/5 fill-none" strokeWidth="8" />
          <circle cx="60" cy="60" r={radius} className={cn("fill-none transition-all duration-1000", color)} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={circumference - stroke} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-3xl font-bold", color.replace("stroke-", "text-"))}>{score}</span>
          <span className="text-xs text-slate-500">/100</span>
        </div>
      </div>
      <div>
        <p className={cn("text-lg font-semibold", color.replace("stroke-", "text-"))}>
          {status === "healthy" ? "Sistema Operativo" : status === "degraded" ? "Advertencias Detectadas" : "Errores Críticos"}
        </p>
        <p className="text-sm text-slate-400 mt-1">
          {score >= 90 ? "Todo funciona correctamente." : score >= 70 ? "Hay áreas que necesitan atención." : "Problemas críticos requieren intervención."}
        </p>
      </div>
    </div>
  );
}

/* ── Check Row ───────────────────────────────────────────────────────────── */

function CheckRow({ check }: { check: DiagnosticCheck }) {
  const Icon = check.status === "pass" ? CheckCircle2 : check.status === "fail" ? XCircle : AlertTriangle;
  const color = check.status === "pass" ? "text-emerald-400" : check.status === "fail" ? "text-red-400" : check.status === "warn" ? "text-amber-400" : "text-slate-500";
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <Icon size={12} className={cn("flex-shrink-0", color)} />
      <span className="text-slate-300 flex-1">{check.name}</span>
      <span className={cn("text-slate-500", color)}>{check.message}</span>
      <span className="text-slate-600 text-[10px]">{check.durationMs}ms</span>
    </div>
  );
}

/* ── Issue Card ──────────────────────────────────────────────────────────── */

function IssueCard({ issue, onFix, fixing }: { issue: DiagnosticIssue; onFix?: (id: string, module: string, action: string) => void; fixing?: boolean }) {
  const color = issue.severity === "critical" ? "border-red-500/15 bg-red-500/5" : issue.severity === "warning" ? "border-amber-500/15 bg-amber-500/5" : "border-blue-500/15 bg-blue-500/5";
  const textColor = issue.severity === "critical" ? "text-red-400" : issue.severity === "warning" ? "text-amber-400" : "text-blue-400";
  const Icon = issue.severity === "critical" ? XCircle : issue.severity === "warning" ? AlertTriangle : Activity;

  return (
    <div className={cn("rounded-xl border p-3", color)}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={cn("flex-shrink-0 mt-0.5", textColor)} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium", textColor)}>{issue.title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{issue.description}</p>
        </div>
        {issue.autoFixable && onFix && (
          <button
            onClick={() => onFix(issue.id, issue.module, issue.fixAction ?? "custom")}
            disabled={fixing}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 transition-colors disabled:opacity-50"
          >
            {fixing ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
            {fixing ? "Reparando…" : issue.fixLabel ?? "Reparar"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Module Card ─────────────────────────────────────────────────────────── */

function ModuleCard({ module, expanded, onToggle }: { module: ModuleResult; expanded: boolean; onToggle: () => void }) {
  const meta = MODULE_META[module.module] ?? { icon: Activity, color: "text-slate-400", label: module.module };
  const Icon = meta.icon;
  const scoreColor = module.score >= 80 ? "text-emerald-400" : module.score >= 50 ? "text-amber-400" : "text-red-400";
  const barColor = module.score >= 80 ? "bg-emerald-400" : module.score >= 50 ? "bg-amber-400" : "bg-red-400";
  const issueCount = module.issues.length;

  return (
    <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center bg-white/5", meta.color)}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium">{meta.label}</span>
            {issueCount > 0 && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border",
                module.issues.some(i => i.severity === "critical") ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              )}>
                {issueCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${module.score}%` }} />
            </div>
            <span className={cn("text-xs font-semibold", scoreColor)}>{module.score}%</span>
          </div>
        </div>
        <ChevronRight size={14} className={cn("text-slate-500 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="px-5 pb-4 border-t border-white/[0.06]">
          <div className="pt-3 space-y-0.5">
            {module.checks.map((c, i) => <CheckRow key={i} check={c} />)}
          </div>
          {module.issues.length > 0 && (
            <div className="mt-3 space-y-2">
              {module.issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
            </div>
          )}
          {module.recommendations.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Recomendaciones</p>
              {module.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 py-1 text-xs text-slate-400">
                  <ArrowRight size={10} className="flex-shrink-0 mt-0.5 text-slate-500" />
                  <span>{rec.title}: {rec.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Trend Arrow ─────────────────────────────────────────────────────────── */

function TrendArrow({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return null;
  const diff = current - previous;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  const color = diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-slate-500";
  return (
    <span className={cn("flex items-center gap-0.5 text-xs", color)}>
      <Icon size={12} />
      {Math.abs(diff)}%
    </span>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function DiagnosticsPage() {
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"report" | "history">("report");
  const [fixingId, setFixingId] = useState<string | null>(null);

  const { data: latest, isLoading: latestLoading, refetch: refetchLatest } = useQuery<{ report: DiagnosticReport | null }>({
    queryKey: ["diagnostics-latest"],
    queryFn: () => authFetch(`${BASE}/api/diagnostics/latest`).then(r => r.json()),
  });

  const { data: history, isLoading: historyLoading } = useQuery<{ reports: HistoryEntry[]; total: number }>({
    queryKey: ["diagnostics-history"],
    queryFn: () => authFetch(`${BASE}/api/diagnostics/history?limit=10`).then(r => r.json()),
    enabled: activeTab === "history",
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`${BASE}/api/diagnostics/run`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<DiagnosticReport>;
    },
    onSuccess: () => {
      refetchLatest();
      setActiveTab("report");
    },
  });

  const fixMutation = useMutation({
    mutationFn: async ({ reportId, module, action }: { reportId: number; module: string; action: string }) => {
      const res = await authFetch(`${BASE}/api/diagnostics/${reportId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      setFixingId(null);
      refetchLatest();
    },
    onError: () => setFixingId(null),
  });

  const handleFix = useCallback((id: string, module: string, action: string) => {
    const report = latest?.report;
    if (!report || !report.id) return;
    setFixingId(id);
    fixMutation.mutate({ reportId: report.id, module, action });
  }, [latest, fixMutation]);

  const report = latest?.report;
  const prevReport = history?.reports?.[1];
  const isRunning = runMutation.isPending;

  const toggleModule = (name: string) => {
    setExpandedModule(expanded => expanded === name ? null : name);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity size={24} className="text-violet-400" /> Omni Diagnostics
          </h1>
          <p className="text-slate-500 mt-1">Diagnóstico completo del sistema y salud del workspace</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetchLatest()}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all"
          >
            <RefreshCw size={14} />
            Actualizar
          </button>
          <button
            onClick={() => runMutation.mutate()}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {isRunning ? "Ejecutando…" : "Ejecutar diagnóstico"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/[0.06]">
        {(["report", "history"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors relative",
              activeTab === tab ? "text-violet-400" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {tab === "report" ? "Informe Actual" : "Historial"}
            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-400 rounded-t-full" />}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {latestLoading && activeTab === "report" && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 size={36} className="animate-spin text-violet-400 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Cargando diagnóstico…</p>
          </div>
        </div>
      )}

      {/* Report Tab */}
      {activeTab === "report" && report && (
        <div className="space-y-6">
          {/* Score + Summary */}
          <ScoreRing score={report.score} status={report.status} />

          {/* Summary text */}
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-sm text-slate-300">{report.summary}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Clock size={12} /> {new Date(report.createdAt).toLocaleString("es-ES")}</span>
              {prevReport && <TrendArrow current={report.score} previous={prevReport.score} />}
            </div>
          </div>

          {/* Issues summary banner */}
          {report.issues.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3 text-center">
                <p className="text-red-400 text-xl font-bold">{report.issues.filter(i => i.severity === "critical").length}</p>
                <p className="text-xs text-red-400/70 mt-1">Críticos</p>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 text-center">
                <p className="text-amber-400 text-xl font-bold">{report.issues.filter(i => i.severity === "warning").length}</p>
                <p className="text-xs text-amber-400/70 mt-1">Advertencias</p>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3 text-center">
                <p className="text-blue-400 text-xl font-bold">{report.recommendations.length}</p>
                <p className="text-xs text-blue-400/70 mt-1">Recomendaciones</p>
              </div>
            </div>
          )}

          {/* Module cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {report.modules.map(mod => (
              <ModuleCard
                key={mod.module}
                module={mod}
                expanded={expandedModule === mod.module}
                onToggle={() => toggleModule(mod.module)}
              />
            ))}
          </div>

          {/* All issues list */}
          {report.issues.length > 0 && (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" /> Problemas Detectados
              </h3>
              <div className="space-y-2">
                {report.issues.map((issue, i) => (
                  <IssueCard
                    key={i}
                    issue={issue}
                    onFix={handleFix}
                    fixing={fixingId === issue.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-blue-400" /> Recomendaciones
              </h3>
              <div className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-400">
                    <ArrowRight size={12} className="flex-shrink-0 mt-0.5 text-slate-500" />
                    <div>
                      <span className="text-slate-300 font-medium">{rec.title}</span>
                      <span className="text-slate-500"> — {rec.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions taken */}
          {report.actionsTaken.length > 0 && (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Wrench size={14} className="text-emerald-400" /> Acciones Automáticas
              </h3>
              <div className="space-y-1">
                {report.actionsTaken.map((action, i) => (
                  <div key={i} className="text-xs text-slate-400 flex items-center gap-2">
                    <CheckCircle2 size={10} className="text-emerald-400" /> {JSON.stringify(action)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "report" && !latestLoading && !report && (
        <div className="text-center py-24 text-slate-500">
          <Activity size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-sm">No hay diagnósticos ejecutados todavía.</p>
          <p className="text-xs text-slate-600 mt-2">Pulsa "Ejecutar diagnóstico" para comenzar.</p>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div>
          {historyLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={36} className="animate-spin text-violet-400" />
            </div>
          ) : history?.reports && history.reports.length > 0 ? (
            <div className="space-y-3">
              {history.reports.map((entry, idx) => {
                const prev = history.reports[idx + 1];
                return (
                  <div key={entry.id} className="bg-[#0d0e1e] border border-white/[0.06] rounded-xl p-4 flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold",
                      entry.status === "healthy" ? "bg-emerald-500/10 text-emerald-400" : entry.status === "degraded" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                    )}>
                      {entry.score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{entry.summary}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(entry.createdAt).toLocaleString("es-ES")}</p>
                    </div>
                    <TrendArrow current={entry.score} previous={prev?.score} />
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full border",
                      entry.status === "healthy" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : entry.status === "degraded" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                    )}>
                      {entry.status}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-24 text-slate-500">
              <Clock size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-sm">Sin historial de diagnósticos.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
