import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { CreditCard, Trash2, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Payment {
  id: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  paidAt: string;
}

const METHOD_LABELS: Record<string, string> = {
  transfer: "Transferencia",
  card:     "Tarjeta",
  cash:     "Efectivo",
  paypal:   "PayPal",
  check:    "Cheque",
  other:    "Otro",
};

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

export default function PaymentsList() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ payments: Payment[]; total: number }>({
    queryKey: ["payments"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/payments?limit=100`);
      return r.json();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await authFetch(`${import.meta.env.BASE_URL}api/accounting/payments/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
      toast({ title: "Pago eliminado" });
    },
  });

  const total = data?.payments.reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {data && data.payments.length > 0 && (
        <div className="flex items-center gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <CreditCard className="w-5 h-5 text-emerald-400" />
          <div>
            <div className="text-lg font-bold text-emerald-400">{fmt(total)}</div>
            <div className="text-xs text-slate-400">Total cobrado ({data.payments.length} cobro{data.payments.length !== 1 ? "s" : ""})</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.payments.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CreditCard className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Sin cobros registrados</p>
          <p className="text-slate-500 text-sm">Los cobros aparecen aquí al marcar facturas como pagadas</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/40">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Factura</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Método</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Referencia</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Importe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.payments.map(p => (
                <tr key={p.id} className="bg-slate-900/40 hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(p.paidAt).toLocaleDateString("es-ES")}
                  </td>
                  <td className="px-4 py-3 text-white font-medium">
                    {p.clientName ?? <span className="text-slate-500 italic">Sin cliente</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.invoiceNumber
                      ? <span className="font-mono text-cyan-400">#{p.invoiceNumber}</span>
                      : <span className="text-slate-500">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-slate-700/50 rounded text-xs text-slate-300">
                      {METHOD_LABELS[p.method] ?? p.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{p.reference ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-400">
                    {fmt(p.amount, p.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm("¿Eliminar este pago?")) deleteMut.mutate(p.id); }}
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
    </div>
  );
}
