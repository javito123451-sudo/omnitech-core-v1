/**
 * Public invoice viewer — accessible via /invoice/:token (no auth required)
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, FileText, CheckCircle, Clock, AlertTriangle, X, Bell, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PublicInvoice {
  id: number;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  orgName: string;
  client: { name: string; company: string | null; email: string | null; phone: string | null } | null;
  items: { id: number; description: string; quantity: number; unitPrice: number; total: number }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Borrador",      color: "bg-slate-500/20 text-slate-400 border-slate-500/20",       icon: FileText      },
  sent:      { label: "Pendiente",     color: "bg-blue-500/20 text-blue-400 border-blue-500/20",          icon: Clock         },
  paid:      { label: "Pagada",        color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20", icon: CheckCircle   },
  overdue:   { label: "Vencida",       color: "bg-rose-500/20 text-rose-400 border-rose-500/20",          icon: AlertTriangle },
  partial:   { label: "Pago parcial",  color: "bg-amber-500/20 text-amber-400 border-amber-500/20",       icon: Clock         },
  cancelled: { label: "Cancelada",     color: "bg-slate-600/20 text-slate-500 border-slate-600/20",       icon: X             },
};

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

export default function PublicInvoicePage() {
  const token = window.location.pathname.split("/invoice/")[1] ?? "";
  const [showPayForm, setShowPayForm] = useState(false);
  const [reference, setReference]     = useState("");
  const [notified, setNotified]       = useState(false);

  const { data: inv, isLoading, isError } = useQuery<PublicInvoice>({
    queryKey: ["public-invoice", token],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/accounting-public/invoices/${token}`);
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  const notifyMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/accounting-public/invoices/${token}/notify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference.trim() }),
      });
      const body = await r.json();
      if (r.status === 409) throw Object.assign(new Error(body.error ?? "Notificación duplicada"), { isDuplicate: true });
      if (!r.ok) throw new Error(body.error ?? "Error al enviar notificación");
    },
    onSuccess: () => {
      setNotified(true);
      setShowPayForm(false);
    },
  });

  const downloadPdf = () => {
    window.open(`${BASE}/api/accounting-public/invoices/${token}/pdf`, "_blank");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !inv) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Enlace no válido</h1>
          <p className="text-slate-400 text-sm">Esta factura no existe o el enlace ha caducado.</p>
        </div>
      </div>
    );
  }

  const sc = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG["draft"]!;
  const Icon = sc.icon;
  const isOverdue  = inv.status === "overdue";
  const isPaid     = inv.status === "paid";
  const isCancelled = inv.status === "cancelled";
  const canNotify  = !isPaid && !isCancelled && !notified;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top bar */}
      <div className="border-b border-white/5 bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{inv.orgName}</p>
            <h1 className="text-lg font-bold font-mono">Factura #{inv.invoiceNumber}</h1>
          </div>
          <button
            onClick={downloadPdf}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" /> Descargar PDF
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Status banner */}
        <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border", sc.color)}>
          <Icon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{sc.label}</p>
            {inv.dueDate && !isPaid && (
              <p className={cn("text-xs", isOverdue ? "text-rose-300" : "opacity-70")}>
                {isOverdue ? "Venció el " : "Vence el "}{fmtDate(inv.dueDate)}
              </p>
            )}
            {isPaid && inv.paidAt && (
              <p className="text-xs opacity-70">Pagada el {fmtDate(inv.paidAt)}</p>
            )}
          </div>
        </div>

        {/* Payment notification success banner */}
        {notified && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Notificación enviada</p>
              <p className="text-xs opacity-70">Tu proveedor recibirá el aviso y confirmará el pago.</p>
            </div>
          </div>
        )}

        {/* Client + dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {inv.client && (
            <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Cliente</p>
              <p className="font-semibold text-white">{inv.client.name}</p>
              {inv.client.company && <p className="text-sm text-slate-400">{inv.client.company}</p>}
              {inv.client.email   && <p className="text-sm text-slate-500 mt-1">{inv.client.email}</p>}
              {inv.client.phone   && <p className="text-sm text-slate-500">{inv.client.phone}</p>}
            </div>
          )}
          <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4 space-y-2">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Detalles</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Fecha emisión</span>
              <span className="text-white">{fmtDate(inv.createdAt)}</span>
            </div>
            {inv.dueDate && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Vencimiento</span>
                <span className={isOverdue && !isPaid ? "text-rose-400 font-medium" : "text-white"}>{fmtDate(inv.dueDate)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Divisa</span>
              <span className="text-white">{inv.currency}</span>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            <span className="font-medium text-sm">Líneas de factura</span>
          </div>
          <div className="overflow-x-auto">
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
                    <td className="px-4 py-3 text-slate-300">{item.description}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{fmt(item.unitPrice, inv.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium text-white">{fmt(item.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-white/5 px-4 py-4 space-y-2 max-w-xs ml-auto">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Subtotal</span><span>{fmt(inv.subtotal, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-400">
              <span>IVA ({inv.taxRate}%)</span><span>{fmt(inv.taxAmount, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-white pt-2 border-t border-white/10">
              <span>Total</span>
              <span className="text-cyan-400">{fmt(inv.total, inv.currency)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {inv.notes && (
          <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Notas</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{inv.notes}</p>
          </div>
        )}

        {/* Notify payment section */}
        {canNotify && (
          <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Bell className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-white">¿Ya has realizado el pago?</p>
                <p className="text-sm text-slate-400 mt-0.5">
                  Si has pagado por transferencia bancaria, notifica a tu proveedor para que confirme el cobro.
                </p>
              </div>
            </div>

            {!showPayForm ? (
              <button
                onClick={() => setShowPayForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-sm font-medium rounded-lg transition-colors"
              >
                <Bell className="w-4 h-4" /> He realizado el pago — notificar a mi proveedor
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Referencia o localizador de transferencia <span className="text-slate-600">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    placeholder="Ej: REF-20240701-001, últimos 4 dígitos de la cuenta…"
                    maxLength={500}
                    className="w-full bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                {notifyMut.isError && (
                  <p className="text-xs text-rose-400">{(notifyMut.error as Error)?.message}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => notifyMut.mutate()}
                    disabled={notifyMut.isPending}
                    className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {notifyMut.isPending ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Enviar notificación
                  </button>
                  <button
                    onClick={() => setShowPayForm(false)}
                    className="px-4 py-2.5 text-slate-400 hover:text-white text-sm rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Download CTA */}
        <div className="flex justify-center pt-2">
          <button
            onClick={downloadPdf}
            className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-xl transition-colors"
          >
            <Download className="w-4 h-4" /> Descargar PDF
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 pb-8">
          Generado por {inv.orgName} · Powered by OmniTech
        </p>
      </div>
    </div>
  );
}
