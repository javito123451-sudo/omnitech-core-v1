import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, AlertTriangle, CheckCircle2, FileDigit,
  Clock, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function TaxCalendar() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: obligations, isLoading } = useQuery({
    queryKey: ["tax-obligations", year],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/tax/obligations?year=${year}`);
      if (!r.ok) throw new Error("Failed to load obligations");
      return r.json();
    },
  });

  const byMonth: Record<number, any[]> = {};
  (obligations ?? []).forEach((o: any) => {
    const m = new Date(o.dueDate).getMonth();
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(o);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Year selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setYear(y => y - 1)}
          className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300"
        >
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-xl font-bold text-white">{year}</h2>
        <button
          onClick={() => setYear(y => y + 1)}
          className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {MONTH_NAMES.map((name, monthIdx) => {
          const monthObligations = byMonth[monthIdx] ?? [];
          return (
            <div
              key={monthIdx}
              className={cn(
                "bg-slate-900/60 border rounded-xl p-4",
                monthObligations.length > 0 ? "border-emerald-500/20" : "border-white/5",
              )}
            >
              <h3 className="text-sm font-semibold text-slate-300 mb-3">{name}</h3>
              {monthObligations.length === 0 ? (
                <div className="text-xs text-slate-500 italic">Sin obligaciones</div>
              ) : (
                <div className="space-y-2">
                  {monthObligations.map((o: any) => (
                    <div
                      key={o.id}
                      className={cn(
                        "flex items-start gap-2 p-2 rounded-lg text-xs",
                        o.status === "filed"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : o.status === "preparing"
                          ? "bg-blue-500/10 text-blue-300"
                          : new Date(o.dueDate) < new Date()
                          ? "bg-red-500/10 text-red-300"
                          : "bg-amber-500/10 text-amber-300",
                      )}
                    >
                      {o.status === "filed" ? (
                        <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                      ) : (
                        <Clock size={14} className="shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-medium">{o.name}</div>
                        <div className="opacity-70">
                          {new Date(o.dueDate).toLocaleDateString("es-ES")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
