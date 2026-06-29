import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SimulatorIRPF() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [showDetails, setShowDetails] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tax-simulator-irpf", year, quarter],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/tax/simulator/irpf?year=${year}&quarter=${quarter}`);
      if (!r.ok) throw new Error("Failed to load IRPF simulation");
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

  const d = data ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
        >
          {[2024, 2025, 2026].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>Q{q}</option>
          ))}
        </select>
      </div>

      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <Wallet size={20} className="text-emerald-400" />
          Simulador IRPF — Q{quarter} {year}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800/40 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Ingresos</div>
            <div className="text-2xl font-bold text-emerald-400">
              {(d.ingresos ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Gastos</div>
            <div className="text-2xl font-bold text-red-400">
              {(d.gastos ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Pago estimado</div>
            <div className="text-2xl font-bold text-amber-400">
              {(d.pagoEstimado ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-800/30 rounded-lg p-3">
            <div className="text-sm text-slate-400 mb-1">Beneficio</div>
            <div className="text-lg font-semibold text-white">
              {(d.beneficio ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
          </div>
          <div className="bg-slate-800/30 rounded-lg p-3">
            <div className="text-sm text-slate-400 mb-1">Base imponible</div>
            <div className="text-lg font-semibold text-white">
              {(d.baseImponible ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
          </div>
        </div>

        {d.comparativa && (
          <div className="bg-slate-800/30 rounded-lg p-3 mb-4">
            <div className="text-sm text-slate-400 mb-1">Comparativa trimestre anterior</div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">
                {d.comparativa.anterior.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
              </span>
              <span className={cn(
                "text-xs font-medium",
                d.comparativa.variacion > 0 ? "text-emerald-400" : d.comparativa.variacion < 0 ? "text-red-400" : "text-slate-400",
              )}>
                {d.comparativa.variacion > 0 ? "+" : ""}{d.comparativa.variacion}%
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
        >
          {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showDetails ? "Ocultar detalles" : "Ver detalles"}
        </button>

        {showDetails && (
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Retenciones</span>
              <span>{(d.retenciones ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
            <div className="flex justify-between">
              <span>Tipo estimado</span>
              <span>20%</span>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 text-xs text-amber-400/70 bg-amber-500/5 rounded-lg p-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {d.nota}
        </div>
      </div>
    </div>
  );
}
