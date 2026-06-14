import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Bot, TrendingUp, DollarSign, Zap, AlertTriangle, CheckCircle2,
  BarChart3, Clock, Loader2, RefreshCw, Edit2, Check, X,
  ShieldAlert, Activity, Database,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UsageLog {
  id: number; orgId: number | null; orgName?: string;
  userClerkId: string | null; functionName: string; model: string;
  tokensInput: number; tokensOutput: number; tokensTotal: number;
  costUsd: string; durationMs: number | null; status: string;
  createdAt: string;
}

interface BudgetRow {
  orgId: number; orgName: string; monthlyBudgetUsd: string;
  isBlocked: boolean; blockReason: string | null;
  currentMonthSpend: number; pct: number;
  alert80: boolean; alert90: boolean; blockAt100: boolean;
}

interface FinancialRow {
  orgId: number; orgName: string; plan: string;
  revenueEur: number; aiCostUsd: number; aiCostEur: number;
  marginEur: number; marginPct: number; calls: number;
}

interface AiStats {
  totalCalls: number; totalTokens: number; totalCostUsd: number;
  monthCalls: number; monthTokens: number; monthCostUsd: number;
  modelBreakdown: Array<{ model: string; calls: number; costUsd: number }>;
}

type Tab = "usage" | "budgets" | "financial";

const STATUS_STYLE: Record<string, string> = {
  ok:      "bg-emerald-500/10 text-emerald-400",
  error:   "bg-red-500/10 text-red-400",
  blocked: "bg-amber-500/10 text-amber-400",
};

const MODEL_COLOR: Record<string, string> = {
  "gpt-4o-mini":            "bg-blue-500/20 text-blue-400",
  "gpt-4o":                 "bg-violet-500/20 text-violet-400",
  "text-embedding-3-small": "bg-teal-500/20 text-teal-400",
};

function fmt$(n: number): string {
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`;
}

function BudgetBar({ pct, isBlocked }: { pct: number; isBlocked: boolean }) {
  const clamped = Math.min(pct, 100);
  const color = isBlocked || pct >= 100 ? "bg-red-500"
    : pct >= 90 ? "bg-amber-500"
    : pct >= 80 ? "bg-yellow-500"
    : "bg-emerald-500";
  return (
    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function EditBudgetModal({ row, onClose }: { row: BudgetRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [budget, setBudget] = useState(Number(row.monthlyBudgetUsd));
  const [b80, setB80]       = useState(row.alert80);
  const [b90, setB90]       = useState(row.alert90);
  const [block, setBlock]   = useState(row.blockAt100);

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/ai-center/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: row.orgId, monthlyBudgetUsd: budget, alert80: b80, alert90: b90, blockAt100: block }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-ai-budgets"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-white font-semibold text-lg mb-1">Presupuesto IA</h2>
        <p className="text-slate-500 text-sm mb-5">{row.orgName}</p>

        <label className="block text-xs text-slate-500 mb-1">Presupuesto mensual (USD)</label>
        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input type="number" min={0} step={1} value={budget} onChange={e => setBudget(Number(e.target.value))}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-7 pr-4 py-3 text-white text-sm focus:outline-none focus:border-violet-500" />
        </div>

        <p className="text-xs text-slate-500 mb-3">Alertas automáticas</p>
        {[
          { label: "Alerta al 80% del presupuesto",          val: b80,   set: setB80,   color: "text-yellow-400" },
          { label: "Alerta al 90% del presupuesto",          val: b90,   set: setB90,   color: "text-amber-400" },
          { label: "Bloquear IA al 100% del presupuesto",    val: block, set: setBlock, color: "text-red-400"    },
        ].map(item => (
          <button key={item.label} onClick={() => item.set(!item.val)}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] mb-2 text-left">
            <div className={`w-5 h-5 rounded flex items-center justify-center border ${item.val ? "bg-violet-600 border-violet-500" : "border-slate-600"}`}>
              {item.val && <Check size={12} className="text-white" />}
            </div>
            <span className={`text-sm ${item.val ? item.color : "text-slate-500"}`}>{item.label}</span>
          </button>
        ))}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all">
            {mut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AiCenterPage() {
  const [tab, setTab]             = useState<Tab>("usage");
  const [editBudget, setEditBudget] = useState<BudgetRow | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<AiStats>({
    queryKey: ["cc-ai-stats"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/ai-center/stats`).then(r => r.json()),
    refetchInterval: 30_000,
  });
  const { data: usage = [], isLoading: usageLoading, refetch: refetchUsage } = useQuery<UsageLog[]>({
    queryKey: ["cc-ai-usage"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/ai-center/usage`).then(r => r.json()),
    enabled:  tab === "usage",
  });
  const { data: budgets = [], isLoading: budgetsLoading, refetch: refetchBudgets } = useQuery<BudgetRow[]>({
    queryKey: ["cc-ai-budgets"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/ai-center/budgets`).then(r => r.json()),
    enabled:  tab === "budgets",
  });
  const { data: financial = [], isLoading: financialLoading } = useQuery<FinancialRow[]>({
    queryKey: ["cc-ai-financial"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/ai-center/financial`).then(r => r.json()),
    enabled:  tab === "financial",
  });

  const unblockMut = useMutation({
    mutationFn: (orgId: number) => authFetch(`${BASE}/api/control-center/ai-center/budgets/unblock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId }),
    }).then(r => r.json()),
    onSuccess: () => refetchBudgets(),
  });

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "usage",     label: "Registro de Uso",  icon: Activity    },
    { id: "budgets",   label: "Presupuestos",      icon: DollarSign  },
    { id: "financial", label: "Rentabilidad",      icon: TrendingUp  },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {editBudget && <EditBudgetModal row={editBudget} onClose={() => setEditBudget(null)} />}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Bot size={24} className="text-violet-400" /> AI Center
        </h1>
        <p className="text-slate-500 mt-1">Monitorización financiera y control de uso de IA</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Zap,       label: "Llamadas (mes)",   value: statsLoading ? "—" : (stats?.monthCalls ?? 0).toLocaleString(),      color: "bg-blue-600" },
          { icon: Database,  label: "Tokens (mes)",     value: statsLoading ? "—" : (stats?.monthTokens ?? 0).toLocaleString(),     color: "bg-teal-600" },
          { icon: DollarSign,label: "Coste (mes)",      value: statsLoading ? "—" : fmt$(stats?.monthCostUsd ?? 0),                 color: "bg-violet-600" },
          { icon: BarChart3, label: "Total histórico",  value: statsLoading ? "—" : fmt$(stats?.totalCostUsd ?? 0),                 color: "bg-pink-600" },
        ].map(card => (
          <div key={card.label} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
            <div className={`w-9 h-9 rounded-xl ${card.color} flex items-center justify-center mb-3`}>
              <card.icon size={18} className="text-white" />
            </div>
            <p className="text-2xl font-bold text-white">{card.value}</p>
            <p className="text-slate-500 text-xs mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Model breakdown */}
      {!statsLoading && stats?.modelBreakdown && stats.modelBreakdown.length > 0 && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 mb-8">
          <p className="text-white text-sm font-semibold mb-4 flex items-center gap-2"><Bot size={15} className="text-violet-400" /> Uso por Modelo</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {stats.modelBreakdown.map(m => (
              <div key={m.model} className="flex items-center gap-3 bg-white/[0.02] rounded-xl px-4 py-3">
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${MODEL_COLOR[m.model] ?? "bg-slate-500/20 text-slate-400"}`}>{m.model}</span>
                <div className="flex-1 text-right">
                  <p className="text-white text-sm font-medium">{m.calls.toLocaleString()} calls</p>
                  <p className="text-slate-500 text-xs">{fmt$(m.costUsd)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06] mb-6 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Usage Log ── */}
      {tab === "usage" && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <p className="text-white font-semibold text-sm">{usage.length} registros</p>
            <button onClick={() => refetchUsage()} className="text-slate-500 hover:text-white transition-all">
              <RefreshCw size={16} />
            </button>
          </div>
          {usageLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
          ) : usage.length === 0 ? (
            <div className="text-center py-16">
              <Bot size={36} className="mx-auto mb-3 text-slate-700" />
              <p className="text-slate-500 text-sm">No hay registros todavía.</p>
              <p className="text-slate-600 text-xs mt-1">Los registros aparecerán al usar el asistente IA.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {["Función", "Modelo", "Workspace", "Tokens In", "Tokens Out", "Coste", "Duración", "Estado", "Fecha"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usage.map(log => (
                    <tr key={log.id} className="border-b border-white/[0.04] hover:bg-white/[0.01]">
                      <td className="px-4 py-3 text-white text-xs font-mono font-medium">{log.functionName}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${MODEL_COLOR[log.model] ?? "bg-slate-500/20 text-slate-400"}`}>{log.model}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{log.orgName ?? `#${log.orgId}`}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs text-right">{(log.tokensInput ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs text-right">{(log.tokensOutput ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-emerald-400 text-xs font-medium">{fmt$(Number(log.costUsd))}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{log.durationMs ? `${log.durationMs}ms` : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[log.status] ?? STATUS_STYLE.ok}`}>{log.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Budgets ── */}
      {tab === "budgets" && (
        <div className="space-y-4">
          {budgetsLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
          ) : budgets.map(b => (
            <div key={b.orgId} className={`bg-[#0d0e1e] border rounded-2xl p-6 ${b.isBlocked ? "border-red-500/30" : "border-white/[0.06]"}`}>
              <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold">{b.orgName}</p>
                    {b.isBlocked && (
                      <span className="inline-flex items-center gap-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">
                        <ShieldAlert size={10} /> BLOQUEADO
                      </span>
                    )}
                    {!b.isBlocked && b.pct >= 90 && (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={10} /> Alerta 90%
                      </span>
                    )}
                    {!b.isBlocked && b.pct >= 80 && b.pct < 90 && (
                      <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={10} /> Alerta 80%
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-sm mt-0.5">
                    {fmt$(b.currentMonthSpend)} usado de {fmt$(Number(b.monthlyBudgetUsd))} ({b.pct.toFixed(1)}%)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {b.isBlocked && (
                    <button onClick={() => unblockMut.mutate(b.orgId)}
                      className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 transition-all">
                      <CheckCircle2 size={12} /> Desbloquear
                    </button>
                  )}
                  <button onClick={() => setEditBudget(b)}
                    className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all">
                    <Edit2 size={15} />
                  </button>
                </div>
              </div>

              <BudgetBar pct={b.pct} isBlocked={b.isBlocked} />

              <div className="flex items-center gap-4 mt-3 text-xs text-slate-600">
                {[
                  { on: b.alert80,    label: "Alerta 80%",   color: "text-yellow-500" },
                  { on: b.alert90,    label: "Alerta 90%",   color: "text-amber-500" },
                  { on: b.blockAt100, label: "Bloqueo 100%", color: "text-red-500"   },
                ].map(({ on, label, color }) => (
                  <span key={label} className={`flex items-center gap-1 ${on ? color : "text-slate-700"}`}>
                    {on ? <CheckCircle2 size={11} /> : <X size={11} />} {label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Financial ── */}
      {tab === "financial" && (
        <div className="space-y-6">
          {/* Platform summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(() => {
              const totalRevenue = financial.reduce((s, r) => s + r.revenueEur, 0);
              const totalCost    = financial.reduce((s, r) => s + r.aiCostEur, 0);
              const totalMargin  = financial.reduce((s, r) => s + r.marginEur, 0);
              return [
                { label: "Ingresos estimados (mes)",  value: `€${totalRevenue.toFixed(0)}`,   color: "text-emerald-400", icon: DollarSign },
                { label: "Coste IA total (mes)",       value: `€${totalCost.toFixed(2)}`,      color: "text-red-400",     icon: Bot },
                { label: "Margen estimado",            value: `€${totalMargin.toFixed(2)}`,    color: "text-violet-400",  icon: TrendingUp },
              ].map(c => (
                <div key={c.label} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
                  <c.icon size={18} className={`${c.color} mb-2`} />
                  <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                  <p className="text-slate-500 text-xs mt-1">{c.label}</p>
                </div>
              ));
            })()}
          </div>

          {/* Per-org table */}
          {financialLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
          ) : (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06]">
                <p className="text-white font-semibold text-sm">Rentabilidad por cliente</p>
                <p className="text-slate-500 text-xs mt-0.5">Ingresos estimados vs. coste de IA este mes</p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {["Workspace", "Plan", "Ingresos", "Coste IA", "Margen", "Margen %", "Llamadas IA"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {financial.map(row => {
                    const isNegative = row.marginEur < 0;
                    return (
                      <tr key={row.orgId} className="border-b border-white/[0.04] hover:bg-white/[0.01]">
                        <td className="px-5 py-4 text-white text-sm font-medium">{row.orgName}</td>
                        <td className="px-5 py-4">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 capitalize">{row.plan}</span>
                        </td>
                        <td className="px-5 py-4 text-emerald-400 text-sm font-medium">€{row.revenueEur.toFixed(0)}</td>
                        <td className="px-5 py-4 text-red-400 text-sm">{fmt$(row.aiCostUsd)}</td>
                        <td className={`px-5 py-4 text-sm font-medium ${isNegative ? "text-red-400" : "text-emerald-400"}`}>
                          €{row.marginEur.toFixed(2)}
                        </td>
                        <td className="px-5 py-4">
                          <div className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${isNegative ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                            {row.marginPct.toFixed(1)}%
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-400 text-sm">{row.calls.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-6 py-3 border-t border-white/[0.06]">
                <p className="text-xs text-slate-600">* Ingresos estimados basados en plan de licencia (Starter €0, Professional €49, Enterprise €200/mes). Coste IA convertido a EUR (1 USD ≈ 0.93 EUR).</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
