import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  ArrowLeft, Download, CreditCard, FileText, Check, Clock,
  AlertTriangle, X, Plus, Trash2, Share2, Copy, CheckCheck, LinkOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Payment {
  id: number;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  notes: string | null;
  client: { id: number; name: string; company: string | null; email: string; phone: string | null } | null;
  items: { id: number; description: string; quantity: number; unitPrice: number; total: number }[];
  payments: Payment[];
  totalPaid: number;
  balance: number;
  shareToken: string | null;
  shareTokenExpiresAt: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Borrador",     color: "bg-slate-500/20 text-slate-400" },
  sent:      { label: "Enviada",      color: "bg-blue-500/20 text-blue-400"   },
  paid:      { label: "Pagada",       color: "bg-emerald-500/20 text-emerald-400" },
  overdue:   { label: "Vencida",      color: "bg-rose-500/20 text-rose-400"   },
  partial:   { label: "Pago parcial", color: "bg-amber-500/20 text-amber-400" },
  cancelled: { label: "Cancelada",    color: "bg-slate-600/20 text-slate-500" },
};

const METHODS = [
  { value: "transfer",  label: "Transferencia" },
  { value: "card",      label: "Tarjeta"       },
  { value: "cash",      label: "Efectivo"      },
  { value: "paypal",    label: "PayPal"        },
  { value: "check",     label: "Cheque"        },
  { value: "other",     label: "Otro"          },
];

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

export default function InvoiceDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount,   setPayAmount]   = useState("");
  const [payMethod,   setPayMethod]   = useState("transfer");
  const [payRef,      setPayRef]      = useState("");
  const [payDate,     setPayDate]     = useState(new Date().toISOString().split("T")[0]);
  const [copied,      setCopied]      = useState(false);

  const { data: inv, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}`);
      return r.json();
    },
  });

  const patchMut = useMutation({
    mutationFn: async (status: string) => {
      await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
    },
  });

  const payMut = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: id,
          clientId: inv?.client?.id,
          amount: parseFloat(payAmount),
          currency: inv?.currency ?? "EUR",
          method: payMethod,
          reference: payRef || undefined,
          paidAt: payDate,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
      setShowPayment(false); setPayAmount(""); setPayRef("");
      toast({ title: "Pago registrado" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const downloadPdf = async () => {
    if (!inv) return;
    const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}/pdf`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `factura-${inv.invoiceNumber}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const shareMut = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}/share`, { method: "POST" });
      if (!r.ok) throw new Error("Error generando enlace");
      const { token } = await r.json() as { token: string; expiresAt: string };
      const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
      return `${base}/invoice/${token}`;
    },
    onSuccess: async (link) => {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast({ title: "Enlace copiado al portapapeles" });
      setTimeout(() => setCopied(false), 3000);
    },
    onError: () => toast({ title: "Error generando el enlace", variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}/share`, { method: "DELETE" });
      if (!r.ok) throw new Error("Error revocando enlace");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast({ title: "Enlace revocado" });
    },
    onError: () => toast({ title: "Error revocando el enlace", variant: "destructive" }),
  });

  if (isLoading || !inv) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sc = STATUS_CONFIG[inv.status] ?? { label: inv.status, color: "bg-slate-500/20 text-slate-400" };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white font-mono">#{inv.invoiceNumber}</h2>
            <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", sc.color)}>{sc.label}</span>
          </div>
          <p className="text-sm text-slate-400">{inv.client?.name ?? "Sin cliente"} · {new Date(inv.createdAt).toLocaleDateString("es-ES")}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={downloadPdf} className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
            <Download className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={() => shareMut.mutate()}
            disabled={shareMut.isPending}
            className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            {copied ? "¡Copiado!" : "Compartir"}
          </button>
          {inv.shareToken && (
            <button
              onClick={() => revokeMut.mutate()}
              disabled={revokeMut.isPending}
              title="Revocar enlace compartido"
              className="flex items-center gap-2 px-3 py-2 bg-rose-900/40 hover:bg-rose-800/50 disabled:opacity-50 text-rose-400 text-sm rounded-lg transition-colors border border-rose-800/40"
            >
              <LinkOff className="w-4 h-4" />
              {revokeMut.isPending ? "Revocando…" : "Revocar enlace"}
            </button>
          )}
          {inv.status !== "paid" && inv.status !== "cancelled" && (
            <button
              onClick={() => setShowPayment(true)}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors"
            >
              <CreditCard className="w-4 h-4" /> Registrar cobro
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main invoice */}
        <div className="lg:col-span-2 space-y-5">
          {/* Items */}
          <div className="bg-slate-800/40 border border-white/5 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span className="font-medium text-sm text-white">Líneas de factura</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-slate-800/30">
                  <th className="text-left px-4 py-2.5 text-xs text-slate-400">Descripción</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-400">Cant.</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-400">Precio unit.</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {inv.items.map(item => (
                  <tr key={item.id} className="hover:bg-white/2">
                    <td className="px-4 py-2.5 text-slate-300">{item.description}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(item.unitPrice, inv.currency)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-white">{fmt(item.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-white/5 px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Subtotal</span><span>{fmt(inv.subtotal, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-400">
                <span>IVA ({inv.taxRate}%)</span><span>{fmt(inv.taxAmount, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-white/5">
                <span>Total</span><span className="text-cyan-400">{fmt(inv.total, inv.currency)}</span>
              </div>
            </div>
          </div>

          {/* Payments history */}
          {inv.payments.length > 0 && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl">
              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-400" />
                <span className="font-medium text-sm text-white">Pagos registrados</span>
              </div>
              <div className="divide-y divide-white/5">
                {inv.payments.map(p => (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">{fmt(p.amount, p.currency)}</div>
                      <div className="text-xs text-slate-400">{METHODS.find(m => m.value === p.method)?.label ?? p.method} · {new Date(p.paidAt).toLocaleDateString("es-ES")}</div>
                      {p.reference && <div className="text-xs text-slate-500">Ref: {p.reference}</div>}
                    </div>
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {inv.notes && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-400 mb-1">Notas</p>
              <p className="text-sm text-slate-300">{inv.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar: client + status actions + balance */}
        <div className="space-y-4">
          {/* Balance card */}
          <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Balance</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-300">
                <span>Total factura</span><span className="font-medium">{fmt(inv.total, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>Cobrado</span><span className="font-medium">{fmt(inv.totalPaid, inv.currency)}</span>
              </div>
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-bold text-white">
                <span>Pendiente</span>
                <span className={inv.balance > 0 ? "text-amber-400" : "text-emerald-400"}>{fmt(inv.balance, inv.currency)}</span>
              </div>
            </div>
          </div>

          {/* Client */}
          {inv.client && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Cliente</h3>
              <p className="font-medium text-white">{inv.client.name}</p>
              {inv.client.company && <p className="text-xs text-slate-400">{inv.client.company}</p>}
              <p className="text-xs text-slate-400 mt-1">{inv.client.email}</p>
              {inv.client.phone && <p className="text-xs text-slate-400">{inv.client.phone}</p>}
            </div>
          )}

          {/* Status actions */}
          <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Cambiar estado</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { s: "sent",      label: "Marcar enviada",    color: "bg-blue-600/20 hover:bg-blue-600/30 text-blue-400"     },
                { s: "paid",      label: "Marcar pagada",     color: "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400" },
                { s: "overdue",   label: "Marcar vencida",    color: "bg-rose-600/20 hover:bg-rose-600/30 text-rose-400"     },
                { s: "cancelled", label: "Cancelar",          color: "bg-slate-600/20 hover:bg-slate-600/30 text-slate-400"  },
              ].filter(a => a.s !== inv.status).map(a => (
                <button
                  key={a.s}
                  onClick={() => patchMut.mutate(a.s)}
                  disabled={patchMut.isPending}
                  className={cn("px-3 py-2 rounded-lg text-xs font-medium border border-white/5 transition-colors", a.color)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          {inv.dueDate && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Vencimiento</h3>
              <p className={cn("text-sm font-medium", new Date(inv.dueDate) < new Date() && inv.status !== "paid" ? "text-rose-400" : "text-white")}>
                {new Date(inv.dueDate).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          )}

          {/* Share link status */}
          {inv.shareToken && inv.shareTokenExpiresAt && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Enlace público</h3>
              {new Date(inv.shareTokenExpiresAt) > new Date() ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-xs text-emerald-400 font-medium">Activo</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Caduca el{" "}
                    <span className="text-slate-300">
                      {new Date(inv.shareTokenExpiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                    <span className="text-xs text-rose-400 font-medium">Expirado</span>
                  </div>
                  <p className="text-xs text-slate-400">Genera uno nuevo con "Compartir"</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Payment modal */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">Registrar cobro</h3>
              <button onClick={() => setShowPayment(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Importe</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  placeholder={`Pendiente: ${fmt(inv.balance, inv.currency)}`}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Método</label>
                  <select
                    value={payMethod}
                    onChange={e => setPayMethod(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Fecha</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Referencia (opcional)</label>
                <input
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="Nº transferencia, recibo…"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
              <button onClick={() => setShowPayment(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
              <button
                onClick={() => payMut.mutate()}
                disabled={payMut.isPending || !payAmount}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {payMut.isPending ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
