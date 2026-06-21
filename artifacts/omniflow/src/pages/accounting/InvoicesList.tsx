import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Plus, Download, Search, ChevronDown, Check, X, Clock,
  AlertTriangle, FileText, Trash2, Eye, FileInput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import InvoiceModal from "./InvoiceModal";
import InvoiceDetail from "./InvoiceDetail";
import { useToast } from "@/hooks/use-toast";

interface Invoice {
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
  clientId: number | null;
  clientName: string | null;
  clientCompany: string | null;
}

interface InvoicesResponse {
  invoices: Invoice[];
  total: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Borrador",     color: "bg-slate-500/20 text-slate-400 border-slate-500/20",   icon: FileText    },
  sent:      { label: "Enviada",      color: "bg-blue-500/20 text-blue-400 border-blue-500/20",      icon: Clock       },
  paid:      { label: "Pagada",       color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20", icon: Check    },
  overdue:   { label: "Vencida",      color: "bg-rose-500/20 text-rose-400 border-rose-500/20",      icon: AlertTriangle },
  partial:   { label: "Pago parcial", color: "bg-amber-500/20 text-amber-400 border-amber-500/20",   icon: Clock       },
  cancelled: { label: "Cancelada",    color: "bg-slate-600/20 text-slate-500 border-slate-600/20",   icon: X           },
};

const STATUSES = ["all", "draft", "sent", "paid", "overdue", "partial", "cancelled"];

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

export default function InvoicesList() {
  const [search, setSearch]       = useState("");
  const [status, setStatus]       = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [detailId, setDetailId]   = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: ["invoices", status, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "all") params.set("status", status);
      if (search)           params.set("search", search);
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices?${params}`);
      return r.json();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}`, { method: "DELETE" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["accounting-summary"] }); },
  });

  const downloadPdf = async (id: number, num: string) => {
    const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices/${id}/pdf`);
    if (!r.ok) { toast({ title: "Error al generar PDF", variant: "destructive" }); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `factura-${num}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  if (detailId !== null) {
    return <InvoiceDetail id={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              className="w-full bg-slate-800/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
              placeholder="Buscar factura o cliente…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          {/* Status filter */}
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">Todos los estados</option>
            {STATUSES.slice(1).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>
            ))}
          </select>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Nueva factura
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.invoices.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileText className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Sin facturas</p>
          <p className="text-slate-500 text-sm">Crea tu primera factura para empezar</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/40">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Vencimiento</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.invoices.map((inv) => {
                const sc = STATUS_CONFIG[inv.status] ?? { label: inv.status, color: "bg-slate-500/20 text-slate-400 border-slate-500/20", icon: FileText };
                const Icon = sc.icon;
                const isOverdue = !inv.paidAt && inv.dueDate && new Date(inv.dueDate) < new Date() && inv.status !== "paid" && inv.status !== "cancelled";
                return (
                  <tr
                    key={inv.id}
                    className="bg-slate-900/40 hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => setDetailId(inv.id)}
                  >
                    <td className="px-4 py-3 font-mono text-cyan-400 font-medium">
                      #{inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3">
                      {inv.clientName ? (
                        <div>
                          <div className="text-white font-medium">{inv.clientName}</div>
                          {inv.clientCompany && <div className="text-slate-500 text-xs">{inv.clientCompany}</div>}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Sin cliente</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", sc.color)}>
                        <Icon className="w-3 h-3" />
                        {isOverdue && inv.status === "sent" ? "Vencida" : sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {inv.dueDate
                        ? <span className={cn(isOverdue && "text-rose-400 font-medium")}>
                            {new Date(inv.dueDate).toLocaleDateString("es-ES")}
                          </span>
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-white">
                      {fmt(inv.total, inv.currency)}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setDetailId(inv.id)}
                          className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
                          title="Ver detalle"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => downloadPdf(inv.id, inv.invoiceNumber)}
                          className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
                          title="Descargar PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Eliminar factura #${inv.invoiceNumber}?`)) deleteMut.mutate(inv.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <InvoiceModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
