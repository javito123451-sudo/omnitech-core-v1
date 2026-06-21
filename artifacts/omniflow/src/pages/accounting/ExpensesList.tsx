import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { TrendingDown, Plus, Trash2, Edit2, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Expense {
  id: number;
  category: string;
  description: string;
  amount: number;
  currency: string;
  vendor: string | null;
  expenseDate: string;
  taxDeductible: boolean;
}

const CATEGORIES = [
  "general", "software", "hardware", "marketing", "travel", "office",
  "salaries", "utilities", "legal", "consulting", "rent", "other",
];

const CAT_LABELS: Record<string, string> = {
  general:    "General",
  software:   "Software",
  hardware:   "Hardware",
  marketing:  "Marketing",
  travel:     "Viajes",
  office:     "Oficina",
  salaries:   "Salarios",
  utilities:  "Suministros",
  legal:      "Legal",
  consulting: "Consultoría",
  rent:       "Alquiler",
  other:      "Otro",
};

const CAT_COLORS: Record<string, string> = {
  software:   "bg-blue-500/20 text-blue-400",
  hardware:   "bg-purple-500/20 text-purple-400",
  marketing:  "bg-pink-500/20 text-pink-400",
  travel:     "bg-amber-500/20 text-amber-400",
  office:     "bg-cyan-500/20 text-cyan-400",
  salaries:   "bg-green-500/20 text-green-400",
  utilities:  "bg-orange-500/20 text-orange-400",
  legal:      "bg-red-500/20 text-red-400",
  consulting: "bg-indigo-500/20 text-indigo-400",
  rent:       "bg-teal-500/20 text-teal-400",
  general:    "bg-slate-500/20 text-slate-400",
  other:      "bg-slate-600/20 text-slate-500",
};

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

export default function ExpensesList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filterCat, setFilterCat] = useState("all");
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [category,     setCategory]     = useState("general");
  const [description,  setDescription]  = useState("");
  const [amount,       setAmount]        = useState("");
  const [currency,     setCurrency]      = useState("EUR");
  const [vendor,       setVendor]        = useState("");
  const [expenseDate,  setExpenseDate]   = useState(new Date().toISOString().split("T")[0]);
  const [taxDeductible,setTaxDeductible] = useState(false);

  const { data, isLoading } = useQuery<{ expenses: Expense[]; total: number }>({
    queryKey: ["expenses", filterCat],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (filterCat !== "all") params.set("category", filterCat);
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/expenses?${params}`);
      return r.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description, amount: parseFloat(amount), currency, vendor: vendor || undefined, expenseDate, taxDeductible }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
      toast({ title: "Gasto registrado" });
      setShowModal(false);
      setDescription(""); setAmount(""); setVendor(""); setCategory("general");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await authFetch(`${import.meta.env.BASE_URL}api/accounting/expenses/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
    },
  });

  const totalExpenses = data?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;
  const deductible    = data?.expenses.filter(e => e.taxDeductible).reduce((s, e) => s + e.amount, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {data && data.expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
            <TrendingDown className="w-4 h-4 text-rose-400 mb-1" />
            <div className="text-lg font-bold text-rose-400">{fmt(totalExpenses)}</div>
            <div className="text-xs text-slate-400">Total gastos ({data.expenses.length})</div>
          </div>
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <Check className="w-4 h-4 text-emerald-400 mb-1" />
            <div className="text-lg font-bold text-emerald-400">{fmt(deductible)}</div>
            <div className="text-xs text-slate-400">Deducibles fiscalmente</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value="all">Todas las categorías</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c] ?? c}</option>)}
        </select>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Nuevo gasto
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.expenses.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <TrendingDown className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Sin gastos registrados</p>
          <p className="text-slate-500 text-sm">Lleva el control de todos tus gastos empresariales</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/40">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Categoría</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Descripción</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Proveedor</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Deducible</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Importe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.expenses.map(e => (
                <tr key={e.id} className="bg-slate-900/40 hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(e.expenseDate).toLocaleDateString("es-ES")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", CAT_COLORS[e.category] ?? "bg-slate-700/50 text-slate-400")}>
                      {CAT_LABELS[e.category] ?? e.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{e.description}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{e.vendor ?? "—"}</td>
                  <td className="px-4 py-3">
                    {e.taxDeductible
                      ? <Check className="w-4 h-4 text-emerald-400" />
                      : <span className="text-slate-600">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-rose-400">
                    {fmt(e.amount, e.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm("¿Eliminar este gasto?")) deleteMut.mutate(e.id); }}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New expense modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">Nuevo gasto</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Categoría</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c] ?? c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Fecha</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={e => setExpenseDate(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Descripción *</label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Descripción del gasto"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Importe *</label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Moneda</label>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {["EUR", "USD", "GBP", "MXN"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Proveedor</label>
                <input
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  placeholder="Nombre del proveedor"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxDeductible}
                  onChange={e => setTaxDeductible(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-slate-300">Gasto deducible fiscalmente</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !description || !amount}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {createMut.isPending ? "Guardando…" : "Registrar gasto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
