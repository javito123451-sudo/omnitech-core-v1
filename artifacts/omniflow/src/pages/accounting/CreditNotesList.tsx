import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { FileX, Plus, X, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CreditNote {
  id: number;
  noteNumber: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

interface Invoice { id: number; invoiceNumber: string; total: number; currency: string; clientName: string | null; }

const STATUS_COLORS: Record<string, string> = {
  issued:    "bg-blue-500/20 text-blue-400",
  applied:   "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-slate-600/20 text-slate-500",
};

const STATUS_LABELS: Record<string, string> = {
  issued:    "Emitida",
  applied:   "Aplicada",
  cancelled: "Cancelada",
};

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

export default function CreditNotesList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [invoiceId, setInvoiceId] = useState<number | "">("");
  const [amount,    setAmount]    = useState("");
  const [currency,  setCurrency]  = useState("EUR");
  const [reason,    setReason]    = useState("");

  const { data, isLoading } = useQuery<{ creditNotes: CreditNote[]; total: number }>({
    queryKey: ["credit-notes"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/credit-notes?limit=100`);
      return r.json();
    },
  });

  // Only show paid invoices — credit notes must always reference a paid invoice
  const { data: paidInvoices = [] } = useQuery<Invoice[]>({
    queryKey: ["invoices-paid"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices?status=paid&limit=200`);
      const d = await r.json();
      return d.invoices ?? [];
    },
    enabled: showModal,
  });

  const selectedInvoice = paidInvoices.find(i => i.id === invoiceId);

  function openModal() {
    setInvoiceId("");
    setAmount("");
    setCurrency("EUR");
    setReason("");
    setShowModal(true);
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!invoiceId) throw new Error("Debes seleccionar una factura pagada");
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount: parseFloat(amount),
          currency,
          reason: reason || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error al emitir nota");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
      toast({ title: "Nota de crédito emitida" });
      setShowModal(false);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/credit-notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit-notes"] }),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva nota de crédito
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.creditNotes.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileX className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Sin notas de crédito</p>
          <p className="text-slate-500 text-sm">Las notas de crédito se usan para corregir o anular facturas pagadas</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/40">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Número</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Factura</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Motivo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Importe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.creditNotes.map(n => (
                <tr key={n.id} className="bg-slate-900/40 hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-cyan-400">#{n.noteNumber}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(n.createdAt).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-3 text-white">{n.clientName ?? <span className="text-slate-500 italic">—</span>}</td>
                  <td className="px-4 py-3">
                    {n.invoiceNumber
                      ? <span className="font-mono text-cyan-400 text-xs">#{n.invoiceNumber}</span>
                      : <span className="text-slate-500">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", STATUS_COLORS[n.status] ?? "bg-slate-700/50 text-slate-400")}>
                      {STATUS_LABELS[n.status] ?? n.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">{n.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-400">{fmt(n.amount, n.currency)}</td>
                  <td className="px-4 py-3">
                    {n.status === "issued" && (
                      <button
                        onClick={() => patchMut.mutate({ id: n.id, status: "applied" })}
                        className="px-2 py-1 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 rounded-lg transition-colors"
                      >
                        Aplicar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">Nueva nota de crédito</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Info banner */}
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-300">Las notas de crédito solo pueden emitirse contra facturas ya <strong>pagadas</strong>.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Factura pagada <span className="text-red-400">*</span>
                </label>
                {paidInvoices.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">No hay facturas pagadas disponibles</p>
                ) : (
                  <select
                    value={invoiceId}
                    onChange={e => {
                      const inv = paidInvoices.find(i => i.id === Number(e.target.value));
                      setInvoiceId(e.target.value === "" ? "" : Number(e.target.value));
                      if (inv) setCurrency(inv.currency);
                    }}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="">— Selecciona una factura —</option>
                    {paidInvoices.map(i => (
                      <option key={i.id} value={i.id}>
                        #{i.invoiceNumber} · {i.clientName ?? "Sin cliente"} · {fmt(i.total, i.currency)}
                      </option>
                    ))}
                  </select>
                )}
                {selectedInvoice && (
                  <p className="text-xs text-slate-400 mt-1">
                    Total factura: <span className="text-white font-medium">{fmt(selectedInvoice.total, selectedInvoice.currency)}</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Importe a acreditar <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
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
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Motivo</label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Motivo de la nota de crédito…"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !amount || !invoiceId}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {createMut.isPending ? "Emitiendo…" : "Emitir nota"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
