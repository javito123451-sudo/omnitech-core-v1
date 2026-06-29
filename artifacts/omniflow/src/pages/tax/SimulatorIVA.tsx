import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Percent, Calculator, TrendingUp, TrendingDown,
  AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SimulatorIVA() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [showDetails, setShowDetails] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tax-simulator-iva", year, quarter],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/tax/simulator/iva?year=${year}&quarter=${quarter}`);
      if (!r.ok) throw new Error("Failed to load IVA simulation");
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
      {/* Controls */}
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

      {/* Result card */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <Percent size={20} className="text-emerald-400" />
          Simulador IVA — Q{quarter} {year}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800/40 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">IVA Repercutido</div>
            <div className="text-2xl font-bold text-emerald-400">
              {(d.ivaRepercutido ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
            <div className="text-xs text-slate-500">Ventas con IVA</div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">IVA Soportado</div>
            <div className="text-2xl font-bold text-amber-400">
              {(d.ivaSoportado ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
            <div className="text-xs text-slate-500">Gastos con IVA (est.)</div>
          </div>
          <div className={cn(
            "bg-slate-800/40 rounded-lg p-4",
            d.resultado > 0 ? "border border-emerald-500/20" : d.resultado < 0 ? "border border-amber-500/20" : "",
          )}>
            <div className="text-sm text-slate-400 mb-1">Resultado</div>
            <div className={cn(
              "text-2xl font-bold",
              d.resultado > 0 ? "text-emerald-400" : d.resultado < 0 ? "text-amber-400" : "text-slate-300",
            )}>
              {(d.resultado ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
            </div>
            <div className="text-xs text-slate-500">
              {d.resultado > 0 ? "A pagar" : d.resultado < 0 ? "A devolver" : "Neutral"}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 mb-4">
          {d.aPagar > 0 && (
            <div className="flex items-center gap-2 text-emerald-400">
              <TrendingUp size={16} />
              <span className="font-medium">A pagar: {d.aPagar.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
          )}
          {d.aDevolver > 0 && (
            <div className="flex items-center gap-2 text-amber-400">
              <TrendingDown size={16} />
              <span className="font-medium">A devolver: {d.aDevolver.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
          )}
        </div>

        {/* Comparativa */}
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

        {/* Details toggle */}
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
              <span>Ingresos trimestre</span>
              <span>{(d.ingresos ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
            <div className="flex justify-between">
              <span>Gastos trimestre</span>
              <span>{(d.gastos ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
            <div className="flex justify-between">
              <span>Beneficio</span>
              <span>{(d.beneficio ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-400/70 bg-amber-500/5 rounded-lg p-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {d.nota}
        </div>
      </div>
    </div>
  );
}
