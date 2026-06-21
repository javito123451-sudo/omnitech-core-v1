import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { AIQuoteModal } from "@/components/ai-quote-modal";
import { WhatsAppModal } from "@/components/whatsapp-modal";
import {
  useListClients, useCreateClient, useUpdateClient, useDeleteClient,
  getListClientsQueryKey, useListMessages,
} from "@workspace/api-client-react";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, Plus, Phone, Mail, Building2, Tag, FileText,
  DollarSign, X, Pencil, Trash2, ChevronRight, Clock, User,
  MessageCircle, Bot, Send, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
type ClientStatus = "lead" | "active" | "inactive" | "churned";

interface ClientRow {
  id: number; name: string; email: string; phone?: string | null;
  company?: string | null; status: string; tags?: string | null;
  notes?: string | null; value?: number | null; createdAt: string;
}

// ── Constants ───────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  lead: "Prospecto", active: "Activo", inactive: "Inactivo", churned: "Perdido",
};

const STATUS_COLOR: Record<string, string> = {
  lead:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  churned:  "bg-red-500/10 text-red-400 border-red-500/20",
};

const AVATAR_COLORS = [
  "bg-blue-600", "bg-violet-600", "bg-emerald-600",
  "bg-orange-500", "bg-rose-500", "bg-indigo-600", "bg-teal-600",
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function parseTags(tags?: string | null): string[] {
  if (!tags) return [];
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

const FILTER_TABS = [
  { key: "all", label: "Todos" },
  { key: "lead", label: "Prospectos" },
  { key: "active", label: "Activos" },
  { key: "inactive", label: "Inactivos" },
  { key: "churned", label: "Perdidos" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function RelativeTime({ date }: { date: string }) {
  const d = new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return <span>Hoy</span>;
  if (days === 1) return <span>Ayer</span>;
  if (days < 30) return <span>Hace {days} días</span>;
  return <span>{d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>;
}

// ── Client Form Modal (Add / Edit) ──────────────────────────────────────────
function ClientFormModal({
  mode, client, onClose,
}: {
  mode: "add" | "edit"; client?: ClientRow | null; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  const [form, setForm] = useState({
    name:    client?.name    ?? "",
    email:   client?.email   ?? "",
    phone:   client?.phone   ?? "",
    company: client?.company ?? "",
    status:  (client?.status ?? "lead") as ClientStatus,
    tags:    client?.tags    ?? "",
    notes:   client?.notes   ?? "",
    value:   client?.value != null ? String(client.value) : "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const isPending = createClient.isPending || updateClient.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name:    form.name.trim(),
      email:   form.email.trim(),
      phone:   form.phone.trim() || undefined,
      company: form.company.trim() || undefined,
      status:  form.status,
      tags:    form.tags.trim() || undefined,
      notes:   form.notes.trim() || undefined,
      value:   form.value ? Number(form.value) : undefined,
    };

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      onClose();
    };

    if (mode === "add") {
      createClient.mutate({ data }, { onSuccess: invalidate });
    } else if (client) {
      updateClient.mutate({ id: client.id, data }, { onSuccess: invalidate });
    }
  };

  const inputClass = "bg-background/60 border-border text-white text-sm h-9 focus-visible:ring-primary placeholder:text-muted-foreground/60";
  const labelClass = "text-xs font-medium text-muted-foreground";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-white max-w-lg w-full max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {mode === "add" ? "Agregar Cliente" : "Editar Cliente"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Row 1: name + status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Nombre completo *</Label>
              <Input value={form.name} onChange={set("name")} required placeholder="Juan Pérez" className={inputClass} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Estado</Label>
              <select
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ClientStatus }))}
                className="w-full h-9 rounded-md border border-border bg-background/60 text-white text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k} className="bg-card">{v}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: email + phone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Correo electrónico *</Label>
              <Input type="email" value={form.email} onChange={set("email")} required placeholder="correo@empresa.com" className={inputClass} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Teléfono</Label>
              <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 555-0000" className={inputClass} />
            </div>
          </div>

          {/* Row 3: company + value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Empresa</Label>
              <Input value={form.company} onChange={set("company")} placeholder="TechCorp S.A." className={inputClass} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className={labelClass}>Valor del trato ($)</Label>
              <Input type="number" value={form.value} onChange={set("value")} placeholder="0" min="0" className={inputClass} />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className={labelClass}>Etiquetas (separadas por coma)</Label>
            <Input value={form.tags} onChange={set("tags")} placeholder="enterprise, saas, tech" className={inputClass} />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className={labelClass}>Notas</Label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={3}
              placeholder="Observaciones sobre este cliente..."
              className="w-full rounded-md border border-border bg-background/60 text-white text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60 resize-none"
            />
          </div>

          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="border-border text-muted-foreground hover:text-white">
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} className="bg-primary hover:bg-primary/90">
              {isPending ? "Guardando..." : mode === "add" ? "Agregar Cliente" : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Finanzas Tab ──────────────────────────────────────────────────────────────
function FinanzasTab({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery<{
    invoices: {
      id: number; invoiceNumber: string; status: string; total: number;
      dueDate: string | null; paidAt: string | null; createdAt: string;
    }[];
    total: number;
  }>({
    queryKey: ["client-invoices", clientId],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices?clientId=${clientId}&limit=50`);
      if (!r.ok) throw new Error("módulo contabilidad no disponible");
      return r.json();
    },
    retry: false,
  });

  const { data: paymentsData } = useQuery<{
    payments: {
      id: number; invoiceNumber: string | null; amount: number;
      method: string; paidAt: string; reference: string | null;
    }[];
  }>({
    queryKey: ["client-payments", clientId],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/payments?clientId=${clientId}&limit=50`);
      if (!r.ok) return { payments: [] };
      return r.json();
    },
    retry: false,
  });

  const STATUS_COLOR: Record<string, string> = {
    draft:    "bg-slate-500/10 text-slate-400 border-slate-500/20",
    sent:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
    partial:  "bg-blue-500/10 text-blue-400 border-blue-500/20",
    paid:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    overdue:  "bg-rose-500/10 text-rose-400 border-rose-500/20",
    cancelled:"bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador", sent: "Enviada", partial: "Parcial",
    paid: "Pagada", overdue: "Vencida", cancelled: "Cancelada",
  };

  if (isLoading) {
    return (
      <div className="space-y-2 pt-1">
        {[1,2,3].map(i => <div key={i} className="h-10 bg-background/40 rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Receipt className="w-7 h-7 mb-2 opacity-20" />
        <p className="text-xs text-center">Módulo de contabilidad no disponible.<br />Actívalo en Control Center → Módulos.</p>
      </div>
    );
  }

  const invoices = data.invoices ?? [];
  const totalFacturado = invoices.reduce((s, i) => s + i.total, 0);
  const totalPendiente = invoices
    .filter(i => ["draft","sent","partial"].includes(i.status))
    .reduce((s, i) => s + i.total, 0);

  const fmtEur = (n: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Receipt className="w-7 h-7 mb-2 opacity-20" />
        <p className="text-sm">Sin facturas</p>
        <p className="text-xs mt-1">Las facturas de este cliente aparecerán aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-[10px] text-emerald-400/70 font-medium">Total facturado</p>
          <p className="text-base font-bold text-emerald-400">{fmtEur(totalFacturado)}</p>
          <p className="text-[10px] text-emerald-400/50">{invoices.length} factura{invoices.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] text-amber-400/70 font-medium">Pendiente</p>
          <p className="text-base font-bold text-amber-400">{fmtEur(totalPendiente)}</p>
          <p className="text-[10px] text-amber-400/50">Sin cobrar</p>
        </div>
      </div>

      {/* Invoice list */}
      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
        {invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-background/40 border border-border/50">
            <div className="min-w-0">
              <p className="text-xs font-mono text-white/80 truncate">{inv.invoiceNumber}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(inv.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4", STATUS_COLOR[inv.status])}>
                {STATUS_LABEL[inv.status] ?? inv.status}
              </Badge>
              <span className="text-xs font-semibold text-white">{fmtEur(inv.total)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Payments list */}
      {paymentsData && paymentsData.payments.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cobros registrados</p>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
            {paymentsData.payments.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                <div className="min-w-0">
                  {p.invoiceNumber && (
                    <p className="text-[10px] font-mono text-emerald-400/70 truncate">{p.invoiceNumber}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground capitalize">
                    {p.method} · {new Date(p.paidAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <span className="text-xs font-semibold text-emerald-400 shrink-0">{fmtEur(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Messages Tab ─────────────────────────────────────────────────────────────
function MessagesTab({ clientId }: { clientId: number }) {
  const { data: messages, isLoading } = useListMessages({ clientId });

  if (isLoading) {
    return (
      <div className="space-y-2 pt-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 bg-background/40 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <MessageCircle className="w-8 h-8 mb-2 opacity-20" />
        <p className="text-sm">Sin mensajes todavía</p>
        <p className="text-xs mt-1 text-center">Los mensajes de WhatsApp y Telegram aparecerán aquí automáticamente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
      {messages.map((msg) => {
        const isInbound = msg.direction === "inbound";
        return (
          <div key={msg.id} className={cn("flex gap-2", isInbound ? "justify-start" : "justify-end")}>
            {isInbound && (
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <Send className="w-3 h-3 text-blue-400" />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-xl px-3 py-2 text-sm",
              isInbound
                ? "bg-background/60 border border-border/60 text-slate-200"
                : msg.isAi
                  ? "bg-primary/15 border border-primary/30 text-primary"
                  : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            )}>
              {!isInbound && msg.isAi && (
                <div className="flex items-center gap-1 mb-1">
                  <Bot className="w-3 h-3 text-primary/70" />
                  <span className="text-[10px] text-primary/70 font-medium">Respuesta IA</span>
                </div>
              )}
              <p className="leading-snug">{msg.content}</p>
              <p className={cn("text-[10px] mt-1", isInbound ? "text-muted-foreground" : "text-primary/50")}>
                {new Date(msg.createdAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {!isInbound && (
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                {msg.isAi ? <Bot className="w-3 h-3 text-primary" /> : <Send className="w-3 h-3 text-primary" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Client Profile Dialog ───────────────────────────────────────────────────
function ClientProfileDialog({
  client, onEdit, onClose,
}: {
  client: ClientRow; onEdit: () => void; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteClient = useDeleteClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQuote, setShowQuote]         = useState(false);
  const [showWhatsApp, setShowWhatsApp]   = useState(false);
  const [activeTab, setActiveTab]         = useState<"info" | "messages" | "finanzas">("info");
  const tags = parseTags(client.tags);

  const handleDelete = () => {
    deleteClient.mutate({ id: client.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        onClose();
      },
    });
  };

  console.log("ClientProfileDialog render — showWhatsApp:", showWhatsApp, "showQuote:", showQuote);

  return (
    <>
    <Dialog open onOpenChange={onClose} modal={!showQuote && !showWhatsApp}>
      <DialogContent
        className="bg-card border-border text-white max-w-md w-full max-h-[90dvh] overflow-y-auto"
        onInteractOutside={(e) => { if (showQuote || showWhatsApp) e.preventDefault(); }}
      >
        <DialogTitle className="sr-only">{client.name}</DialogTitle>
        {/* Header */}
        <div className="flex items-start gap-4 pt-2">
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shrink-0", avatarColor(client.name))}>
            {initials(client.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white leading-tight truncate">{client.name}</h2>
            {client.company && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                <Building2 className="w-3 h-3 shrink-0" /> {client.company}
              </p>
            )}
            <Badge variant="outline" className={cn("mt-2 text-xs", STATUS_COLOR[client.status])}>
              {STATUS_LABEL[client.status] ?? client.status}
            </Badge>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 mt-3 bg-background/30 p-1 rounded-lg border border-border/50">
          <button
            onClick={() => setActiveTab("info")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
              activeTab === "info"
                ? "bg-card text-white shadow-sm"
                : "text-muted-foreground hover:text-white"
            )}
          >
            <User className="w-3 h-3" /> Info
          </button>
          <button
            onClick={() => setActiveTab("messages")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
              activeTab === "messages"
                ? "bg-card text-white shadow-sm"
                : "text-muted-foreground hover:text-white"
            )}
          >
            <MessageCircle className="w-3 h-3" /> Mensajes
          </button>
          <button
            onClick={() => setActiveTab("finanzas")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
              activeTab === "finanzas"
                ? "bg-card text-white shadow-sm"
                : "text-muted-foreground hover:text-white"
            )}
          >
            <Receipt className="w-3 h-3" /> Finanzas
          </button>
        </div>

        {/* ── TAB: Messages ── */}
        {activeTab === "messages" && (
          <div className="mt-3">
            <MessagesTab clientId={client.id} />
          </div>
        )}

        {/* ── TAB: Finanzas ── */}
        {activeTab === "finanzas" && (
          <div className="mt-3">
            <FinanzasTab clientId={client.id} />
          </div>
        )}

        {/* ── TAB: Info ── */}
        {activeTab === "info" && <>

        {/* Contact info */}
        <div className="space-y-2 mt-2">
          <a href={`mailto:${client.email}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-background/40 hover:bg-white/5 transition-colors group">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Mail className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Correo</p>
              <p className="text-sm text-white truncate group-hover:text-primary transition-colors">{client.email}</p>
            </div>
          </a>

          {client.phone && (
            <a href={`tel:${client.phone}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-background/40 hover:bg-white/5 transition-colors group">
              <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Phone className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Teléfono</p>
                <p className="text-sm text-white group-hover:text-primary transition-colors">{client.phone}</p>
              </div>
            </a>
          )}

          {client.value != null && client.value > 0 && (
            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/40">
              <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Valor del trato</p>
                <p className="text-sm text-white font-semibold">${client.value.toLocaleString()}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/40">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Clock className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Último contacto</p>
              <p className="text-sm text-white"><RelativeTime date={client.createdAt} /></p>
            </div>
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="mt-1">
            <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1"><Tag className="w-3 h-3" /> Etiquetas</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {client.notes && (
          <div className="mt-1">
            <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1"><FileText className="w-3 h-3" /> Notas</p>
            <div className="p-3 rounded-lg bg-background/40 border border-border/50">
              <p className="text-sm text-slate-300 leading-relaxed">{client.notes}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        {!confirmDelete ? (
          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => { console.log("WHATSAPP CLICK — calling setShowWhatsApp(true)"); setShowWhatsApp(true); console.log("WHATSAPP — setShowWhatsApp called"); }}
                variant="outline"
                className="h-9 text-sm border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold"
              >
                <span className="mr-1.5">📲</span> WhatsApp IA
              </Button>
              <Button
                onClick={() => { console.log("PDF CLICK"); setShowQuote(true); }}
                className="h-9 text-sm bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500 font-bold"
              >
                <span className="mr-1.5">📄</span> Presupuesto IA
              </Button>
            </div>
            <div className="flex gap-2">
              <Button onClick={onEdit} className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-muted-foreground hover:text-foreground h-9 text-sm" variant="outline">
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
              </Button>
              <Button
                variant="outline" onClick={() => setConfirmDelete(true)}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 h-9 px-3"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pt-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
            <p className="text-sm text-red-400 font-medium">¿Eliminar este cliente?</p>
            <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm" onClick={() => setConfirmDelete(false)}
                className="flex-1 border-border text-muted-foreground"
              >
                Cancelar
              </Button>
              <Button
                size="sm" onClick={handleDelete} disabled={deleteClient.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteClient.isPending ? "Eliminando..." : "Sí, eliminar"}
              </Button>
            </div>
          </div>
        )}

        </>}

      </DialogContent>
    </Dialog>

    {showQuote && createPortal(
      <AIQuoteModal
        clientId={client.id}
        clientName={client.name}
        clientEmail={client.email}
        clientPhone={client.phone}
        clientCompany={client.company}
        defaultValue={client.value ? Number(client.value) : null}
        onClose={() => setShowQuote(false)}
      />,
      document.body
    )}

    {showWhatsApp && createPortal(
      <WhatsAppModal
        clientId={client.id}
        clientName={client.name}
        clientPhone={client.phone}
        clientCompany={client.company}
        clientStatus={client.status}
        onClose={() => setShowWhatsApp(false)}
      />,
      document.body
    )}
  </>
  );
}

// ── Main Clients Page ───────────────────────────────────────────────────────
export default function Clients() {
  const { data: clients, isLoading } = useListClients();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modal, setModal] = useState<"add" | "edit" | "view" | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);

  const openAdd  = () => { setSelectedClient(null); setModal("add"); };
  const openView = (c: ClientRow) => { setSelectedClient(c); setModal("view"); };
  const openEdit = (c: ClientRow) => { setSelectedClient(c); setModal("edit"); };
  const closeModal = () => { setModal(null); setSelectedClient(null); };

  const filtered = clients?.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q) ||
      (c.tags ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Count per status for filter tabs
  const counts = {
    all:      clients?.length ?? 0,
    lead:     clients?.filter((c) => c.status === "lead").length ?? 0,
    active:   clients?.filter((c) => c.status === "active").length ?? 0,
    inactive: clients?.filter((c) => c.status === "inactive").length ?? 0,
    churned:  clients?.filter((c) => c.status === "churned").length ?? 0,
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Clientes</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden sm:block">
            Gestiona tu pipeline y relaciones con clientes.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
          <Plus className="w-4 h-4 mr-1.5" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Search */}
      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, empresa, etiqueta..."
          className="pl-9 bg-background/50 border-border text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 shrink-0 scrollbar-none">
        {FILTER_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
              statusFilter === key
                ? "bg-primary text-white border-primary shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                : "bg-card border-border text-muted-foreground hover:text-white hover:border-primary/40"
            )}
          >
            {label}
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
              statusFilter === key ? "bg-white/20 text-white" : "bg-background/80 text-muted-foreground"
            )}>
              {counts[key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {/* Client list */}
      <div className="flex-1 overflow-y-auto space-y-2 pb-1">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
          ))
        ) : filtered?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <User className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">Sin clientes encontrados</p>
            <p className="text-xs mt-1">Prueba cambiando los filtros o agrega un cliente nuevo.</p>
            <Button size="sm" onClick={openAdd} className="mt-4 bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-1.5" /> Agregar Cliente
            </Button>
          </div>
        ) : (
          filtered?.map((client) => <ClientCard key={client.id} client={client} onView={() => openView(client)} />)
        )}
      </div>

      {/* Results count */}
      {filtered && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center shrink-0">
          {filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}
        </p>
      )}

      {/* Modals */}
      {modal === "add" && <ClientFormModal mode="add" onClose={closeModal} />}
      {modal === "edit" && selectedClient && (
        <ClientFormModal mode="edit" client={selectedClient} onClose={closeModal} />
      )}
      {modal === "view" && selectedClient && (
        <ClientProfileDialog
          client={selectedClient}
          onEdit={() => { setModal("edit"); }}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ── Client Card ─────────────────────────────────────────────────────────────
function ClientCard({ client, onView }: { client: ClientRow; onView: () => void }) {
  const tags = parseTags(client.tags);

  return (
    <Card
      onClick={onView}
      className="bg-card border-border hover:border-primary/40 active:bg-white/[0.03] cursor-pointer transition-all duration-150 hover:shadow-[0_0_15px_rgba(59,130,246,0.08)] group touch-manipulation"
    >
      <CardContent className="p-3.5">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 transition-transform group-hover:scale-105",
            avatarColor(client.name)
          )}>
            {initials(client.name)}
          </div>

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-white text-sm leading-tight truncate">{client.name}</p>
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 font-semibold", STATUS_COLOR[client.status])}>
                    {STATUS_LABEL[client.status] ?? client.status}
                  </Badge>
                </div>

                {client.company && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <p className="text-xs text-muted-foreground truncate">{client.company}</p>
                  </div>
                )}
              </div>

              {client.value && client.value > 0 ? (
                <div className="flex items-center gap-0.5 text-emerald-400 font-bold text-sm shrink-0">
                  <DollarSign className="w-3 h-3" />
                  {client.value >= 1000 ? `${(client.value / 1000).toFixed(0)}k` : client.value}
                </div>
              ) : null}
            </div>

            {/* Contact row */}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Mail className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px]">{client.email}</span>
              </span>
              {client.phone && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Phone className="w-3 h-3 shrink-0" />
                  <span>{client.phone}</span>
                </span>
              )}
            </div>

            {/* Tags + last contact */}
            <div className="flex items-center justify-between mt-1.5 gap-2">
              {tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20">
                      {tag}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-border/60 text-muted-foreground">
                      +{tags.length - 3}
                    </span>
                  )}
                </div>
              )}
              <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                <Clock className="w-3 h-3" />
                <RelativeTime date={client.createdAt} />
              </div>
            </div>
          </div>

          <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 self-center" />
        </div>
      </CardContent>
    </Card>
  );
}
