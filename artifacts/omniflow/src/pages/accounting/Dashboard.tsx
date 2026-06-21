import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  TrendingUp, TrendingDown, Receipt, AlertTriangle, Clock,
  DollarSign, BarChart3, CreditCard,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Summary {
  invoices: Record<string, { count: number; total: number }>;
  overdueCount: number;
  pendingTotal: number;
  revenue: { thisMonth: number; thisYear: number };
  expenses: { thisMonth: number; thisYear: number };
  profit: { thisMonth: number; thisYear: number };
  charts: {
    monthlyRevenue: { month: string; revenue: number }[];
    monthlyExpenses: { month: string; amount: number }[];
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function MonthLabel(m: string) {
  return new Date(m).toLocaleDateString("es-ES", { month: "short" });
}

export default function AccountingDashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["accounting-summary"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/summary`);
      return r.json();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const paidTotal = data.invoices["paid"]?.total ?? 0;
  const paidCount = data.invoices["paid"]?.count ?? 0;
  const sentCount = (data.invoices["sent"]?.count ?? 0) + (data.invoices["partial"]?.count ?? 0);
  const draftCount = data.invoices["draft"]?.count ?? 0;

  // Build merged chart data
  const allMonths = Array.from(new Set([
    ...data.charts.monthlyRevenue.map(r => r.month),
    ...data.charts.monthlyExpenses.map(e => e.month),
  ])).sort();

  const chartData = allMonths.map(m => ({
    month: MonthLabel(m),
    ingresos: data.charts.monthlyRevenue.find(r => r.month === m)?.revenue ?? 0,
    gastos:   data.charts.monthlyExpenses.find(e => e.month === m)?.amount ?? 0,
  }));

  const kpis = [
    {
      label: "Ingresos este mes",
      value: fmt(data.revenue.thisMonth),
      sub: `Año: ${fmt(data.revenue.thisYear)}`,
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
      onClick: () => onNavigate("payments"),
    },
    {
      label: "Gastos este mes",
      value: fmt(data.expenses.thisMonth),
      sub: `Año: ${fmt(data.expenses.thisYear)}`,
      icon: TrendingDown,
      color: "text-rose-400",
      bg: "bg-rose-500/10 border-rose-500/20",
      onClick: () => onNavigate("expenses"),
    },
    {
      label: "Beneficio neto",
      value: fmt(data.profit.thisMonth),
      sub: data.profit.thisMonth >= 0 ? "Positivo este mes" : "Negativo este mes",
      icon: DollarSign,
      color: data.profit.thisMonth >= 0 ? "text-cyan-400" : "text-orange-400",
      bg: data.profit.thisMonth >= 0 ? "bg-cyan-500/10 border-cyan-500/20" : "bg-orange-500/10 border-orange-500/20",
      onClick: undefined,
    },
    {
      label: "Pendiente de cobro",
      value: fmt(data.pendingTotal),
      sub: `${sentCount} factura${sentCount !== 1 ? "s" : ""} en curso`,
      icon: Clock,
      color: "text-amber-400",
      bg: "bg-amber-500/10 border-amber-500/20",
      onClick: () => onNavigate("invoices"),
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            onClick={kpi.onClick}
            className={`text-left p-4 rounded-xl border ${kpi.bg} transition-all hover:brightness-110 ${kpi.onClick ? "cursor-pointer" : "cursor-default"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 font-medium">{kpi.label}</span>
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
            </div>
            <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{kpi.sub}</div>
          </button>
        ))}
      </div>

      {/* Charts + invoice status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue vs expenses chart */}
        <div className="lg:col-span-2 bg-slate-800/40 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-sm text-white">Ingresos vs Gastos (6 meses)</h3>
          </div>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
              Sin datos de los últimos 6 meses
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}€`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  formatter={(v: number, name: string) => [fmt(v), name === "ingresos" ? "Ingresos" : "Gastos"]}
                />
                <Area type="monotone" dataKey="ingresos" stroke="#22d3ee" fill="#22d3ee22" strokeWidth={2} />
                <Area type="monotone" dataKey="gastos"   stroke="#f87171" fill="#f8717122" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Invoice status */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-sm text-white">Estado facturas</h3>
          </div>

          {[
            { label: "Pagadas", count: paidCount, total: paidTotal, color: "bg-emerald-500", text: "text-emerald-400" },
            { label: "En curso", count: sentCount, total: (data.invoices["sent"]?.total ?? 0) + (data.invoices["partial"]?.total ?? 0), color: "bg-amber-500", text: "text-amber-400" },
            { label: "Borradores", count: draftCount, total: data.invoices["draft"]?.total ?? 0, color: "bg-slate-500", text: "text-slate-400" },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-sm text-slate-300">{s.label}</span>
              </div>
              <div className="text-right">
                <div className={`text-sm font-semibold ${s.text}`}>{s.count}</div>
                <div className="text-xs text-slate-500">{fmt(s.total)}</div>
              </div>
            </div>
          ))}

          {data.overdueCount > 0 && (
            <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="text-xs text-rose-300">
                <strong>{data.overdueCount}</strong> factura{data.overdueCount > 1 ? "s" : ""} vencida{data.overdueCount > 1 ? "s" : ""}
              </span>
            </div>
          )}

          <button
            onClick={() => onNavigate("invoices")}
            className="w-full mt-2 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/20 text-cyan-400 text-xs font-medium rounded-lg transition-colors"
          >
            Ver todas las facturas
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total facturado (año)", value: fmt(data.revenue.thisYear + data.pendingTotal), icon: Receipt, color: "text-slate-300" },
          { label: "Cobrado (año)", value: fmt(data.revenue.thisYear), icon: CreditCard, color: "text-emerald-400" },
          { label: "Gastos (año)", value: fmt(data.expenses.thisYear), icon: TrendingDown, color: "text-rose-400" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/30 border border-white/5 rounded-xl p-4 text-center">
            <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
