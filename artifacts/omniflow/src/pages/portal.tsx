/**
 * Client Self-Service Portal — public page (no Clerk auth required)
 * Accessed via: /portal?token=<token>
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, CheckCircle, Clock, AlertTriangle, FileText, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getToken(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

interface Profile {
  client: { id: number; name: string; email: string | null; company: string | null };
  orgName: string;
  expiresAt: string;
}

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
  notes: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Borrador",      color: "bg-slate-500/20 text-slate-400 border-slate-500/20",      icon: FileText      },
  sent:      { label: "Pendiente",     color: "bg-blue-500/20 text-blue-400 border-blue-500/20",         icon: Clock         },
  paid:      { label: "Pagada",        color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",icon: CheckCircle   },
  overdue:   { label: "Vencida",       color: "bg-rose-500/20 text-rose-400 border-rose-500/20",         icon: AlertTriangle },
  partial:   { label: "Pago parcial",  color: "bg-amber-500/20 text-amber-400 border-amber-500/20",      icon: Clock         },
  cancelled: { label: "Cancelada",     color: "bg-slate-600/20 text-slate-500 border-slate-600/20",      icon: X             },
};

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG["draft"]!;
  const Icon = cfg.icon;
  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-cyan-400 text-sm font-semibold">#{inv.invoiceNumber}</span>
            <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>
            {inv.dueDate && inv.status !== "paid" && inv.status !== "cancelled" && (
              <span className={cn("text-xs", new Date(inv.dueDate) < new Date() ? "text-rose-400" : "text-slate-500")}>
                Vence: {fmtDate(inv.dueDate)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">Emitida el {fmtDate(inv.createdAt)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white font-bold">{fmt(inv.total, inv.currency)}</p>
          {inv.status === "paid" && inv.paidAt && (
            <p className="text-xs text-emerald-400">Pagada el {fmtDate(inv.paidAt)}</p>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-white/5 bg-slate-900/40">
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm mb-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Base imponible</p>
              <p className="text-white font-medium">{fmt(inv.subtotal, inv.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">IVA ({inv.taxRate}%)</p>
              <p className="text-white font-medium">{fmt(inv.taxAmount, inv.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Total</p>
              <p className="text-cyan-400 font-bold">{fmt(inv.total, inv.currency)}</p>
            </div>
          </div>
          {inv.notes && (
            <div className="p-3 bg-slate-800/60 rounded-lg">
              <p className="text-xs text-slate-400">{inv.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortalPage() {
  const token = getToken();

  const { data: profile, isLoading: loadingProfile, error: profileError } = useQuery<Profile>({
    queryKey: ["portal-profile", token],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/portal/profile?token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error((await r.json()).error ?? "Token inválido");
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  const { data: invoicesData, isLoading: loadingInvoices } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ["portal-invoices", token],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/portal/invoices?token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
      return r.json();
    },
    enabled: !!profile,
    staleTime: 60_000,
  });

  const invoices = invoicesData?.invoices ?? [];
  const paid    = invoices.filter(i => i.status === "paid");
  const pending = invoices.filter(i => ["sent", "partial", "overdue"].includes(i.status));
  const other   = invoices.filter(i => ["draft", "cancelled"].includes(i.status));

  const totalPending = pending.reduce((s, i) => s + i.total, 0);
  const currency     = invoices[0]?.currency ?? "EUR";

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Receipt className="w-12 h-12 text-slate-600 mx-auto" />
          <h1 className="text-xl font-bold text-white">Enlace no válido</h1>
          <p className="text-slate-400 text-sm">Este enlace no contiene un token de acceso.</p>
        </div>
      </div>
    );
  }

  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto" />
          <h1 className="text-xl font-bold text-white">Enlace expirado o inválido</h1>
          <p className="text-slate-400 text-sm">
            {profileError instanceof Error ? profileError.message : "Solicita un nuevo enlace a tu proveedor."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center">
              <Receipt className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs text-slate-400">{profile.orgName}</p>
              <p className="font-semibold text-white text-sm">{profile.client.name}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Acceso válido hasta</p>
            <p className="text-xs text-slate-400">{new Date(profile.expiresAt).toLocaleDateString("es-ES")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Summary KPIs */}
        {!loadingInvoices && invoices.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800/50 border border-white/5 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{invoices.length}</p>
              <p className="text-xs text-slate-400 mt-1">Total facturas</p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{pending.length}</p>
              <p className="text-xs text-slate-400 mt-1">Pendientes</p>
              {totalPending > 0 && <p className="text-xs text-amber-400 font-medium mt-0.5">{fmt(totalPending, currency)}</p>}
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{paid.length}</p>
              <p className="text-xs text-slate-400 mt-1">Pagadas</p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loadingInvoices && (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loadingInvoices && invoices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="w-12 h-12 text-slate-600 mb-3" />
            <p className="text-slate-400 font-medium">Sin facturas</p>
            <p className="text-slate-500 text-sm">Aún no tienes facturas emitidas.</p>
          </div>
        )}

        {/* Pending invoices */}
        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" /> Pendientes de pago
            </h2>
            {pending.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
          </section>
        )}

        {/* Paid invoices */}
        {paid.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" /> Pagadas
            </h2>
            {paid.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
          </section>
        )}

        {/* Other (draft/cancelled) */}
        {other.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" /> Otras
            </h2>
            {other.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
          </section>
        )}

        <p className="text-center text-xs text-slate-600 pb-4">
          Portal seguro · {profile.orgName} · Los datos son confidenciales
        </p>
      </div>
    </div>
  );
}
