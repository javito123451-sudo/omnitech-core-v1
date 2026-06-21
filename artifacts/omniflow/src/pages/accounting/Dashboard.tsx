import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  TrendingUp, TrendingDown, Receipt, AlertTriangle, Clock,
  DollarSign, BarChart3, CreditCard, FileText, Percent, CheckCircle2,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Summary {
  invoices: Record<string, { count: number; total: number }>;
  overdueCount: number;
  overdueTotal: number;
  pendingTotal: number;
  pendingQuotesCount: number;
  tasaCobro: number;
  ivaRepercutido: number;
  ivaSoportado: number;
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

  const paidTotal  = data.invoices["paid"]?.total ?? 0;
  const paidCount  = data.invoices["paid"]?.count ?? 0;
  const sentCount  = (data.invoices["sent"]?.count ?? 0) + (data.invoices["partial"]?.count ?? 0);
  const draftCount = data.invoices["draft"]?.count ?? 0;
  const pendingCount = (data.invoices["draft"]?.count ?? 0) + (data.invoices["sent"]?.count ?? 0) + (data.invoices["partial"]?.count ?? 0);

  const allMonths = Array.from(new Set([
    ...data.charts.monthlyRevenue.map(r => r.month),
    ...data.charts.monthlyExpenses.map(e => e.month),
  ])).sort();

  const chartData = allMonths.map(m => ({
    month:    MonthLabel(m),
    ingresos: data.charts.monthlyRevenue.find(r => r.month === m)?.revenue ?? 0,
    gastos:   data.charts.monthlyExpenses.find(e => e.month === m)?.amount  ?? 0,
  }));

  const kpis = [
    {
      label: "Ventas del mes",
      value: fmt(data.revenue.thisMonth),
      sub: `Año: ${fmt(data.revenue.thisYear)}`,
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
      onClick: () => onNavigate("payments"),
    },
    {
      label: "Facturas pendientes",
      value: fmt(data.pendingTotal),
      sub: `${pendingCount} factura${pendingCount !== 1 ? "s" : ""} sin cobrar`,
      icon: Clock,
      color: "text-amber-400",
      bg: "bg-amber-500/10 border-amber-500/20",
      onClick: () => onNavigate("invoices"),
    },
    {
      label: "Facturas vencidas",
      value: fmt(data.overdueTotal),
      sub: `${data.overdueCount} vencida${data.overdueCount !== 1 ? "s" : ""}`,
      icon: AlertTriangle,
      color: data.overdueCount > 0 ? "text-rose-400" : "text-slate-400",
      bg: data.overdueCount > 0 ? "bg-rose-500/10 border-rose-500/20" : "bg-slate-500/10 border-slate-500/20",
      onClick: () => onNavigate("invoices"),
    },
    {
      label: "Presupuestos pendientes",
      value: String(data.pendingQuotesCount),
      sub: "Sin convertir a factura",
      icon: FileText,
      color: "text-violet-400",
      bg: "bg-violet-500/10 border-violet-500/20",
      onClick: undefined,
    },
    {
      label: "Ingresos acumulados",
      value: fmt(data.revenue.thisYear),
      sub: "Este año",
      icon: CreditCard,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10 border-cyan-500/20",
      onClick: () => onNavigate("payments"),
    },
    {
      label: "Gastos acumulados",
      value: fmt(data.expenses.thisYear),
      sub: "Este año",
      icon: TrendingDown,
      color: "text-rose-400",
      bg: "bg-rose-500/10 border-rose-500/20",
      onClick: () => onNavigate("expenses"),
    },
    {
      label: "Beneficio estimado",
      value: fmt(data.profit.thisMonth),
      sub: data.profit.thisMonth >= 0 ? "Positivo este mes" : "Negativo este mes",
      icon: DollarSign,
      color: data.profit.thisMonth >= 0 ? "text-cyan-400" : "text-orange-400",
      bg: data.profit.thisMonth >= 0 ? "bg-cyan-500/10 border-cyan-500/20" : "bg-orange-500/10 border-orange-500/20",
      onClick: undefined,
    },
    {
      label: "IVA repercutido",
      value: fmt(data.ivaRepercutido),
      sub: "IVA en facturas emitidas (año)",
      icon: Percent,
      color: "text-blue-400",
      bg: "bg-blue-500/10 border-blue-500/20",
      onClick: undefined,
    },
    {
      label: "IVA soportado",
      value: fmt(data.ivaSoportado),
      sub: "IVA en gastos deducibles (año)",
      icon: Percent,
      color: "text-indigo-400",
      bg: "bg-indigo-500/10 border-indigo-500/20",
      onClick: () => onNavigate("expenses"),
    },
    {
      label: "Tasa de cobro",
      value: `${data.tasaCobro}%`,
      sub: "Facturas cobradas vs emitidas",
      icon: CheckCircle2,
      color: data.tasaCobro >= 80 ? "text-emerald-400" : data.tasaCobro >= 50 ? "text-amber-400" : "text-rose-400",
      bg: data.tasaCobro >= 80 ? "bg-emerald-500/10 border-emerald-500/20" : data.tasaCobro >= 50 ? "bg-amber-500/10 border-amber-500/20" : "bg-rose-500/10 border-rose-500/20",
      onClick: () => onNavigate("invoices"),
    },
  ];

  return (
    <div className="space-y-5">
      {/* 10 KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            onClick={kpi.onClick}
            className={`text-left p-3.5 rounded-xl border ${kpi.bg} transition-all hover:brightness-110 ${kpi.onClick ? "cursor-pointer" : "cursor-default"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-400 font-medium leading-tight">{kpi.label}</span>
              <kpi.icon className={`w-3.5 h-3.5 ${kpi.color} shrink-0`} />
            </div>
            <div className={`text-base font-bold ${kpi.color} truncate`}>{kpi.value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{kpi.sub}</div>
          </button>
        ))}
      </div>

      {/* Chart + invoice status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
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

        {/* Invoice status breakdown */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-sm text-white">Estado facturas</h3>
          </div>

          {[
            { label: "Pagadas",    count: paidCount,  total: paidTotal, color: "bg-emerald-500", text: "text-emerald-400" },
            { label: "En curso",   count: sentCount,  total: (data.invoices["sent"]?.total ?? 0) + (data.invoices["partial"]?.total ?? 0), color: "bg-amber-500", text: "text-amber-400" },
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

      {/* IVA summary strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total facturado (año)",  value: fmt(data.revenue.thisYear + data.pendingTotal), icon: Receipt,     color: "text-slate-300" },
          { label: "IVA neto a liquidar",    value: fmt(data.ivaRepercutido - data.ivaSoportado),  icon: Percent,     color: data.ivaRepercutido >= data.ivaSoportado ? "text-amber-400" : "text-emerald-400" },
          { label: "Beneficio acumulado",    value: fmt(data.profit.thisYear),                       icon: TrendingUp,  color: data.profit.thisYear >= 0 ? "text-emerald-400" : "text-rose-400" },
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
