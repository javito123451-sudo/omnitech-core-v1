import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, FileText,
  TrendingUp, TrendingDown, Minus, CalendarClock,
  Percent, Wallet, Receipt, FileDigit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";
  const bg =
    score >= 80 ? "bg-emerald-500/10" : score >= 60 ? "bg-amber-500/10" : "bg-red-500/10";
  return (
    <div className={cn("flex flex-col items-center gap-1 p-3 rounded-xl border", bg, color.replace("text-", "border-").replace("400", "500/20"))}>
      <div className="text-3xl font-bold">{score}</div>
      <div className="text-xs font-medium opacity-80">{label}</div>
    </div>
  );
}

function KPICard({
  label, value, change, icon: Icon, color,
}: {
  label: string; value: string; change?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} className={color} />
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {change && <div className="text-xs text-slate-500 mt-1">{change}</div>}
    </div>
  );
}

export default function TaxDashboard() {
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["tax-dashboard"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/tax/dashboard`);
      if (!r.ok) throw new Error("Failed to load tax dashboard");
      return r.json();
    },
  });

  const { data: health } = useQuery({
    queryKey: ["tax-health"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/tax/health-score`);
      if (!r.ok) throw new Error("Failed to load health score");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  const d = dashboard ?? {};
  const h = health ?? {};

  return (
    <div className="space-y-6">
      {/* Health Score */}
      {h.score !== undefined && (
        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={20} className="text-emerald-400" />
              Fiscal Health Score
            </h2>
            <div className={cn(
              "text-2xl font-bold",
              h.score >= 80 ? "text-emerald-400" : h.score >= 60 ? "text-amber-400" : "text-red-400",
            )}>
              {h.score}<span className="text-sm text-slate-500 ml-1">/100</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreRing score={h.breakdown?.compliance ?? 0} label="Cumplimiento" />
            <ScoreRing score={h.breakdown?.accuracy ?? 0} label="Precisión" />
            <ScoreRing score={h.breakdown?.documents ?? 0} label="Documentos" />
            <ScoreRing score={h.breakdown?.timeliness ?? 0} label="Puntualidad" />
          </div>
          {h.recommendations?.length > 0 && (
            <div className="mt-4 space-y-2">
              {h.recommendations.map((rec: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  {rec}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Ingresos (año)"
          value={`${(d.financials?.totalIncome ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`}
          icon={TrendingUp}
          color="text-emerald-400"
        />
        <KPICard
          label="Gastos (año)"
          value={`${(d.financials?.totalExpenses ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`}
          icon={TrendingDown}
          color="text-red-400"
        />
        <KPICard
          label="Beneficio"
          value={`${(d.financials?.benefit ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`}
          icon={Wallet}
          color={d.financials?.benefit >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <KPICard
          label="Documentos fiscales"
          value={`${d.documents?.total ?? 0}`}
          icon={FileText}
          color="text-cyan-400"
        />
      </div>

      {/* Obligaciones */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <CalendarClock size={20} className="text-cyan-400" />
          Estado de Obligaciones Fiscales
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-white/5">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle size={18} className="text-amber-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">{d.obligations?.pending ?? 0}</div>
              <div className="text-xs text-slate-400">Pendientes</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-white/5">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <FileDigit size={18} className="text-blue-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">{d.obligations?.preparing ?? 0}</div>
              <div className="text-xs text-slate-400">En preparación</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-white/5">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-emerald-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">{d.obligations?.filed ?? 0}</div>
              <div className="text-xs text-slate-400">Presentadas</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-white/5">
            <div className="w-10 h-10 rounded-full bg-slate-500/10 flex items-center justify-center">
              <Minus size={18} className="text-slate-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">{d.obligations?.ready ?? 0}</div>
              <div className="text-xs text-slate-400">Listas</div>
            </div>
          </div>
        </div>
      </div>

      {/* Próxima obligación */}
      {d.nextObligation && (
        <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <CalendarClock size={20} className="text-emerald-400" />
            <div>
              <div className="text-sm text-emerald-300 font-medium">
                Próxima obligación: {d.nextObligation.name}
              </div>
              <div className="text-xs text-emerald-400/70">
                Fecha límite: {new Date(d.nextObligation.dueDate).toLocaleDateString("es-ES")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
