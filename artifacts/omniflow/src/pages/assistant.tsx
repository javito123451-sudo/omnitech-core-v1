import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Hexagon, Send, Plus, Search, Sparkles, Zap,
  FileText, Calendar, RefreshCw, BarChart2,
  ChevronLeft, Copy, Check, Trash2, AlertCircle,
  UserRound, X, Building2, ChevronDown, ChevronUp,
  Tag, DollarSign, Clock, MessageSquare, ExternalLink,
  Phone, Mail, StickyNote, Menu,
  Brain, BookOpen,
} from "lucide-react";
import { Input }  from "@/components/ui/input";
import { Badge }  from "@/components/ui/badge";
import {
  useListClients,
  useGetClient,
  useListAppointments,
  useListMessages,
} from "@workspace/api-client-react";
import type { Client, Appointment } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

// ── Types ────────────────────────────────────────────────────────────────────
type Role = "user" | "ai";
type ToolEvent =
  | { type: "invoice_created"; invoice: { invoiceNumber: string; clientName: string; total: number; subtotal: number; taxAmount: number; taxRate: number; status: string; items?: { description: string; quantity: number; unitPrice: number; total: number }[] } }
  | { type: "payment_registered"; payment: { invoiceNumber: string; amount: number; paid: number; balance: number; invoiceStatus: string } };
type Msg = {
  id: string; role: Role; content: string; ts: Date;
  streaming?: boolean; error?: boolean;
  toolEvents?: ToolEvent[];
};
type Session = {
  id: string; title: string; preview: string; ts: Date;
  msgs: Msg[]; clientId?: number;
  dbSessionId?: string;
};
type AgentMemory = {
  id: number; orgId: number; agentSlug: string;
  memoryKey: string; memoryVal: string;
  source: string | null; updatedAt: string;
};

interface ClientCtxApi {
  id?: number; name: string; email?: string;
  phone?: string | null; company?: string | null;
  status?: string; tags?: string | null;
  notes?: string | null; value?: number | null;
  lastInteraction?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_LABEL: Record<string, string> = {
  lead: "Prospecto", active: "Activo", inactive: "Inactivo", churned: "Perdido",
};
const STATUS_COLOR: Record<string, string> = {
  lead:     "bg-blue-500/15 text-blue-400 border-blue-500/25",
  active:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  inactive: "bg-slate-500/15 text-slate-400 border-slate-500/25",
  churned:  "bg-red-500/15 text-red-400 border-red-500/25",
};
const AVATAR_COLORS = [
  "bg-blue-600","bg-violet-600","bg-emerald-600",
  "bg-orange-500","bg-rose-500","bg-indigo-600","bg-teal-600",
];
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
const initials    = (name: string) => name.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();

// ── Suggestions ────────────────────────────────────────────────────────────────
function getSuggestions(client: Client | null) {
  if (client) {
    const first = client.name.split(" ")[0];
    const co    = client.company ?? first;
    return [
      { icon: <RefreshCw className="w-3.5 h-3.5"/>, label: "Redactar mensaje",    text: `Redacta un mensaje profesional de seguimiento para ${first} de ${co}. Lleva un tiempo sin responder.` },
      { icon: <FileText   className="w-3.5 h-3.5"/>, label: "Crear presupuesto",   text: `Crea un presupuesto profesional para ${co}. Adapta la propuesta al perfil de ${first}.` },
      { icon: <Calendar   className="w-3.5 h-3.5"/>, label: "Proponer reunión",    text: `Ayúdame a proponer una reunión a ${first} de ${co}. Sugiere horarios y redacta la invitación.` },
      { icon: <Zap        className="w-3.5 h-3.5"/>, label: "Plan de acción",      text: `Analiza la situación de ${first} (${co}) y dame un plan de acción concreto para avanzar en la venta.` },
      { icon: <BarChart2  className="w-3.5 h-3.5"/>, label: "Análisis de cliente", text: `Dame un análisis completo del perfil de ${first} de ${co} y recomiéndame la mejor estrategia.` },
    ];
  }
  return [
    { icon: <RefreshCw className="w-3.5 h-3.5"/>, label: "Responder cliente",      text: "Ayúdame a redactar una respuesta profesional para un cliente que lleva 5 días sin noticias." },
    { icon: <FileText   className="w-3.5 h-3.5"/>, label: "Crear presupuesto",      text: "Crea un presupuesto profesional para un cliente de servicios SaaS por 12 meses." },
    { icon: <Calendar   className="w-3.5 h-3.5"/>, label: "Agendar cita",           text: "Ayúdame a proponer horarios para una reunión de demo con un nuevo prospecto." },
    { icon: <Zap        className="w-3.5 h-3.5"/>, label: "Seguimiento automático", text: "Diseña una secuencia de seguimiento de 3 pasos para prospectos que no han respondido." },
    { icon: <BarChart2  className="w-3.5 h-3.5"/>, label: "Resumen diario",         text: "Dame un resumen ejecutivo de lo que debería priorizar hoy en ventas." },
  ];
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function inlineFormat(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*")  && p.endsWith("*") && p.length > 2) return <em key={i} className="text-slate-300 italic">{p.slice(1, -1)}</em>;
    return p;
  });
}
function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("> "))  return <blockquote key={i} className="border-l-2 border-primary/60 pl-3 my-1 text-slate-300 italic">{inlineFormat(line.slice(2))}</blockquote>;
    if (/^\|/.test(line))       return <span key={i} className="block font-mono text-xs text-slate-300 whitespace-pre">{line}</span>;
    if (/^#{1,3} /.test(line))  return <strong key={i} className="block text-white font-bold mt-2 mb-0.5">{line.replace(/^#{1,3} /, "")}</strong>;
    if (/^[-*] /.test(line))    return <span key={i} className="flex gap-2 my-0.5"><span className="text-primary mt-0.5 shrink-0">•</span><span>{inlineFormat(line.slice(2))}</span></span>;
    if (line === "")             return <span key={i} className="block h-1.5"/>;
    return <span key={i} className="block leading-relaxed">{inlineFormat(line)}</span>;
  });
}

// ── Typing dots ───────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}/>
      ))}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-white transition-all">
      {ok ? <Check className="w-3.5 h-3.5 text-green-400"/> : <Copy className="w-3.5 h-3.5"/>}
    </button>
  );
}

// ── AI Avatar ─────────────────────────────────────────────────────────────────
function AiAvatar() {
  return (
    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-violet-600/30 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
      <Hexagon className="w-4 h-4 text-primary fill-primary/10"/>
    </div>
  );
}

// ── EUR formatter ─────────────────────────────────────────────────────────────
const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

// ── Invoice Card ──────────────────────────────────────────────────────────────
function InvoiceCard({ ev }: { ev: Extract<ToolEvent, { type: "invoice_created" }> }) {
  const { invoice } = ev;
  return (
    <div className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
          <FileText className="w-3.5 h-3.5"/> Factura creada
        </span>
        <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 rounded-full px-2 py-0.5 uppercase tracking-wide text-[10px]">
          {invoice.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-300">
        <span className="text-slate-500">Número</span><span className="font-mono font-semibold text-white">{invoice.invoiceNumber}</span>
        <span className="text-slate-500">Cliente</span><span>{invoice.clientName}</span>
        <span className="text-slate-500">Subtotal</span><span>{eur(invoice.subtotal)}</span>
        <span className="text-slate-500">IVA ({invoice.taxRate}%)</span><span>{eur(invoice.taxAmount)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
        <span className="text-slate-400">Total</span>
        <span className="text-lg font-bold text-white">{eur(invoice.total)}</span>
      </div>
      {invoice.items && invoice.items.length > 0 && (
        <div className="space-y-1 border-t border-white/[0.06] pt-2">
          {invoice.items.map((item, i) => (
            <div key={i} className="flex justify-between text-slate-400">
              <span className="truncate max-w-[60%]">{item.description} ×{item.quantity}</span>
              <span>{eur(item.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payment Card ──────────────────────────────────────────────────────────────
function PaymentCard({ ev }: { ev: Extract<ToolEvent, { type: "payment_registered" }> }) {
  const { payment } = ev;
  const isPaid = payment.invoiceStatus === "paid";
  return (
    <div className="mt-2 rounded-xl border border-blue-500/25 bg-blue-950/20 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-blue-400">
          <DollarSign className="w-3.5 h-3.5"/> Pago registrado
        </span>
        <span className={cn(
          "rounded-full px-2 py-0.5 uppercase tracking-wide text-[10px] border",
          isPaid
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
            : "bg-amber-500/15 text-amber-300 border-amber-500/25",
        )}>
          {payment.invoiceStatus}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-300">
        <span className="text-slate-500">Factura</span><span className="font-mono font-semibold text-white">{payment.invoiceNumber}</span>
        <span className="text-slate-500">Importe</span><span className="text-white font-semibold">{eur(payment.amount)}</span>
        <span className="text-slate-500">Total pagado</span><span>{eur(payment.paid)}</span>
        {!isPaid && <><span className="text-slate-500">Pendiente</span><span className="text-amber-300">{eur(payment.balance)}</span></>}
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && <AiAvatar/>}
      <div className={cn("flex flex-col gap-1 max-w-[85%] md:max-w-[72%]", isUser ? "items-end" : "items-start")}>
        <div className={cn("rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg",
          isUser
            ? "bg-gradient-to-br from-primary to-violet-600 text-white rounded-tr-sm shadow-[0_4px_20px_rgba(59,130,246,0.25)]"
            : msg.error
              ? "bg-red-950/40 border border-red-500/30 text-red-300 rounded-tl-sm"
              : "bg-[#1a1f2e] border border-white/[0.06] text-slate-200 rounded-tl-sm"
        )}>
          {msg.error
            ? <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0"/>{msg.content}</span>
            : <span>
                {renderMarkdown(msg.content)}
                {msg.streaming && msg.content && (
                  <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle"/>
                )}
                {!isUser && msg.toolEvents?.map((ev, i) =>
                  ev.type === "invoice_created"
                    ? <InvoiceCard key={i} ev={ev}/>
                    : ev.type === "payment_registered"
                      ? <PaymentCard key={i} ev={ev}/>
                      : null
                )}
              </span>
          }
        </div>
        <div className={cn("flex items-center gap-1.5 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
          <span className="text-[10px] text-muted-foreground">
            {msg.ts.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && !msg.error && <CopyBtn text={msg.content}/>}
        </div>
      </div>
    </motion.div>
  );
}

// ── Client Context Card ───────────────────────────────────────────────────────
function ClientContextCard({
  client,
  appointments,
  lastMessage,
  onClear,
  onChangePicker,
}: {
  client: Client;
  appointments: Appointment[];
  lastMessage?: string | null;
  onClear: () => void;
  onChangePicker: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Most recent past appointment
  const lastAppt = useMemo(() => {
    const past = appointments
      .filter(a => new Date(a.startTime) <= new Date())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return past[0] ?? null;
  }, [appointments]);

  // Next upcoming appointment
  const nextAppt = useMemo(() => {
    const future = appointments
      .filter(a => new Date(a.startTime) > new Date() && a.status === "scheduled")
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return future[0] ?? null;
  }, [appointments]);

  const tagList = client.tags ? client.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="border-b border-white/[0.07] bg-gradient-to-b from-[#111827]/80 to-transparent overflow-hidden"
    >
      {/* ── Header row (always visible) ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Avatar */}
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-lg", avatarColor(client.name))}>
          {initials(client.name)}
        </div>

        {/* Name + company */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{client.name}</span>
            <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5 shrink-0 font-semibold", STATUS_COLOR[client.status])}>
              {STATUS_LABEL[client.status]}
            </Badge>
          </div>
          {client.company && (
            <div className="flex items-center gap-1 mt-0.5">
              <Building2 className="w-2.5 h-2.5 text-muted-foreground shrink-0"/>
              <span className="text-[11px] text-muted-foreground truncate">{client.company}</span>
              {client.value && (
                <span className="text-[11px] text-emerald-400 font-semibold ml-1">
                  · €{(client.value / 1000).toFixed(0)}k
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            title={expanded ? "Colapsar" : "Ver detalles"}>
            {expanded
              ? <ChevronUp className="w-3.5 h-3.5"/>
              : <ChevronDown className="w-3.5 h-3.5"/>
            }
          </button>
          <button onClick={onChangePicker}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Cambiar cliente">
            <RefreshCw className="w-3.5 h-3.5"/>
          </button>
          <button onClick={onClear}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Quitar cliente">
            <X className="w-3.5 h-3.5"/>
          </button>
        </div>
      </div>

      {/* ── Expanded details ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-3">

              {/* Contact info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {client.email && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Mail className="w-3 h-3 text-primary/60 shrink-0"/>
                    <span className="truncate">{client.email}</span>
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Phone className="w-3 h-3 text-primary/60 shrink-0"/>
                    <span>{client.phone}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {tagList.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tag className="w-3 h-3 text-muted-foreground shrink-0"/>
                  {tagList.map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 border border-primary/15 text-primary/80">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Notes */}
              {client.notes && (
                <div className="flex gap-2">
                  <StickyNote className="w-3 h-3 text-amber-400/70 shrink-0 mt-0.5"/>
                  <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3">
                    {client.notes}
                  </p>
                </div>
              )}

              {/* Interactions grid */}
              <div className="grid grid-cols-2 gap-2">
                {/* Last interaction */}
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-muted-foreground"/>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Última cita</span>
                  </div>
                  {lastAppt ? (
                    <>
                      <p className="text-[11px] text-white font-medium truncate">{lastAppt.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(lastAppt.startTime), { locale: es, addSuffix: true })}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60 italic">Sin citas previas</p>
                  )}
                </div>

                {/* Next appointment */}
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3 h-3 text-muted-foreground"/>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Próxima cita</span>
                  </div>
                  {nextAppt ? (
                    <>
                      <p className="text-[11px] text-white font-medium truncate">{nextAppt.title}</p>
                      <p className="text-[10px] text-emerald-400">
                        {format(new Date(nextAppt.startTime), "d MMM, HH:mm", { locale: es })}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60 italic">Sin citas pendientes</p>
                  )}
                </div>
              </div>

              {/* Last message */}
              {lastMessage && (
                <div className="flex gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5"/>
                  <p className="text-[11px] text-slate-400 italic line-clamp-2">"{lastMessage}"</p>
                </div>
              )}

              {/* CRM link */}
              <a href="/clients" className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors w-fit">
                <ExternalLink className="w-3 h-3"/>
                Ver perfil completo en CRM
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Client Picker overlay ─────────────────────────────────────────────────────
function ClientPicker({
  selected,
  onSelect,
  onClose,
}: {
  selected: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  const { data: clients } = useListClients();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = clients?.filter(c =>
    !q ||
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.company ?? "").toLowerCase().includes(q.toLowerCase())
  ) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-[#141824] border border-white/[0.1] rounded-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.5)] overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <UserRound className="w-4 h-4 text-primary"/> Seleccionar cliente
        </span>
        <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
          <X className="w-4 h-4"/>
        </button>
      </div>

      <div className="px-3 py-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
          <Input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Buscar cliente o empresa..."
            className="pl-8 h-8 bg-background/40 border-white/[0.07] text-sm"/>
        </div>
      </div>

      {selected !== null && (
        <button onClick={() => { onSelect(null); onClose(); }}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/[0.06] text-left">
          <div className="w-7 h-7 rounded-lg bg-border/50 flex items-center justify-center shrink-0">
            <X className="w-3.5 h-3.5 text-muted-foreground"/>
          </div>
          <span className="text-sm text-muted-foreground">Sin contexto de cliente</span>
        </button>
      )}

      <div className="max-h-60 overflow-y-auto">
        {filtered.length === 0
          ? <div className="py-6 text-center text-xs text-muted-foreground">Sin resultados</div>
          : filtered.map(c => (
            <button key={c.id} onClick={() => { onSelect(c.id); onClose(); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-all text-left",
                selected === c.id && "bg-primary/10"
              )}>
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0", avatarColor(c.name))}>
                {initials(c.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">{c.name}</span>
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 font-semibold", STATUS_COLOR[c.status])}>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                </div>
                {c.company && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Building2 className="w-2.5 h-2.5 shrink-0"/> {c.company}
                  </span>
                )}
              </div>
              {c.value && <span className="text-xs text-emerald-400 font-semibold shrink-0">€{(c.value / 1000).toFixed(0)}k</span>}
              {selected === c.id && <Check className="w-3.5 h-3.5 text-primary shrink-0"/>}
            </button>
          ))
        }
      </div>
    </motion.div>
  );
}

// ── Memory Panel ─────────────────────────────────────────────────────────────
const CAT_META: Record<string, { label: string; cls: string }> = {
  client:     { label: "Cliente",      cls: "text-blue-400 bg-blue-400/10 border-blue-400/25" },
  sop:        { label: "SOP",          cls: "text-violet-400 bg-violet-400/10 border-violet-400/25" },
  process:    { label: "Proceso",      cls: "text-cyan-400 bg-cyan-400/10 border-cyan-400/25" },
  decision:   { label: "Decisión",     cls: "text-amber-400 bg-amber-400/10 border-amber-400/25" },
  context:    { label: "Contexto",     cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25" },
  goal:       { label: "Objetivo",     cls: "text-rose-400 bg-rose-400/10 border-rose-400/25" },
  info:       { label: "Información",  cls: "text-sky-400 bg-sky-400/10 border-sky-400/25" },
  fact:       { label: "Hecho",        cls: "text-green-400 bg-green-400/10 border-green-400/25" },
  preference: { label: "Preferencia",  cls: "text-pink-400 bg-pink-400/10 border-pink-400/25" },
};

function parseMemKey(key: string) {
  const i = key.indexOf(":");
  if (i === -1) return { cat: "fact", name: key.replace(/_/g, " ") };
  return { cat: key.slice(0, i), name: key.slice(i + 1).replace(/_/g, " ") };
}

function MemoryPanel({
  memories, flashedMemId, addOpen, addKey, addVal,
  onAddKeyChange, onAddValChange, onAddToggle, onAddSubmit, onDelete, onClose,
}: {
  memories:       AgentMemory[];
  flashedMemId:   number | null;
  addOpen:        boolean;
  addKey:         string;
  addVal:         string;
  onAddKeyChange: (v: string) => void;
  onAddValChange: (v: string) => void;
  onAddToggle:    () => void;
  onAddSubmit:    () => void;
  onDelete:       (id: number) => void;
  onClose:        () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Brain className="w-3.5 h-3.5 text-primary"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white">Memoria organizacional</p>
          <p className="text-[10px] text-muted-foreground">{memories.length} recuerdos guardados</p>
        </div>
        <button onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-white transition-colors">
          <X className="w-3.5 h-3.5"/>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-36 text-muted-foreground gap-2 text-center px-4">
            <BookOpen className="w-7 h-7 opacity-20"/>
            <p className="text-xs leading-relaxed">Aún no hay recuerdos.<br/>La IA guardará hechos importantes<br/>automáticamente.</p>
          </div>
        ) : memories.map(mem => {
          const { cat, name } = parseMemKey(mem.memoryKey);
          const meta = CAT_META[cat] ?? CAT_META["fact"]!;
          const isNew = mem.id === flashedMemId;
          return (
            <div key={mem.id}
              className={cn(
                "p-2 rounded-lg border group transition-all duration-500",
                isNew
                  ? "border-primary/50 bg-primary/5 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
              )}>
              <div className="flex items-start gap-1.5 mb-1">
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0", meta.cls)}>
                  {meta.label}
                </span>
                <p className="text-[11px] font-medium text-slate-300 capitalize leading-tight flex-1 min-w-0 truncate">
                  {name}
                </p>
                <button onClick={() => onDelete(mem.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-red-400 transition-all shrink-0">
                  <Trash2 className="w-3 h-3"/>
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{mem.memoryVal}</p>
              {isNew && <p className="text-[9px] text-primary mt-1 font-medium">✦ Guardado por la IA</p>}
            </div>
          );
        })}
      </div>

      <div className="p-2 border-t border-border shrink-0">
        {addOpen ? (
          <div className="space-y-1.5">
            <Input value={addKey} onChange={e => onAddKeyChange(e.target.value)}
              placeholder="clave (ej: client:nombre)" className="h-7 text-xs bg-background/50 border-border"/>
            <textarea value={addVal} onChange={e => onAddValChange(e.target.value)}
              placeholder="¿Qué quieres recordar?" rows={2}
              className="w-full text-xs bg-background/50 border border-border rounded-md px-2 py-1.5 text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"/>
            <div className="flex gap-1.5">
              <button onClick={onAddSubmit} disabled={!addKey.trim() || !addVal.trim()}
                className="flex-1 h-7 text-xs rounded-md bg-primary text-white font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors">
                Guardar
              </button>
              <button onClick={onAddToggle}
                className="h-7 px-2 text-xs rounded-md text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button onClick={onAddToggle}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md text-xs text-muted-foreground hover:text-white hover:bg-white/5 border border-dashed border-white/[0.08] transition-colors">
            <Plus className="w-3 h-3"/>
            Añadir recuerdo manual
          </button>
        )}
      </div>
    </div>
  );
}

// ── Welcome screen ─────────────────────────────────────────────────────────────
function WelcomeScreen({
  selectedClient,
  onSuggest,
  onOpenPicker,
}: {
  selectedClient: Client | null;
  onSuggest: (t: string) => void;
  onOpenPicker: () => void;
}) {
  const suggestions = getSuggestions(selectedClient);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full px-4 gap-6 text-center">
      <div className="relative">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 via-violet-600/20 to-indigo-600/10 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.2)]">
          <Hexagon className="w-10 h-10 text-primary fill-primary/15"/>
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-background animate-pulse"/>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-white">OmniTech <span className="text-primary">AI</span></h2>
        {selectedClient ? (
          <p className="text-muted-foreground text-sm max-w-xs">
            Asistente configurado para{" "}
            <span className="text-white font-semibold">{selectedClient.name}</span>
            {selectedClient.company && <span> · {selectedClient.company}</span>}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm max-w-xs">
              Tu asistente de negocios inteligente.
            </p>
            <button onClick={onOpenPicker}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/25 text-primary text-sm font-medium hover:bg-primary/20 transition-colors">
              <UserRound className="w-3.5 h-3.5"/>
              Seleccionar cliente para respuestas personalizadas
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-2xl">
        {suggestions.map(s => (
          <button key={s.label} onClick={() => onSuggest(s.text)}
            className="p-3.5 rounded-xl bg-card border border-white/[0.07] hover:border-primary/40 hover:bg-primary/5 text-left transition-all group shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-primary group-hover:scale-110 transition-transform">{s.icon}</div>
              <span className="text-white text-sm font-medium">{s.label}</span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{s.text}</p>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Session serialise / deserialise ───────────────────────────────────────────
const STORAGE_KEY = "omnitech_chat_sessions_v3";
function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    return parsed.map(s => ({
      ...s,
      ts:   new Date(s.ts),
      msgs: s.msgs.map(m => ({ ...m, ts: new Date(m.ts) })),
    }));
  } catch { return []; }
}
function saveSessions(sessions: Session[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); }
  catch { /* storage full — ignore */ }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assistant() {
  const [sessions,       setSessions]       = useState<Session[]>(loadSessions);
  const [activeId,       setActiveId]       = useState<string | null>(null);
  const [showList,       setShowList]       = useState(false);
  const [input,          setInput]          = useState("");
  const [isThinking,     setIsThinking]     = useState(false);
  const [search,         setSearch]         = useState("");
  const [contextId,      setContextId]      = useState<number | null>(null);
  const [showPicker,     setShowPicker]     = useState(false);

  const [avaDetailsOpen,  setAvaDetailsOpen]  = useState(false);

  const [memories,        setMemories]        = useState<AgentMemory[]>([]);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [flashedMemId,    setFlashedMemId]    = useState<number | null>(null);
  const [addMemKey,       setAddMemKey]       = useState("");
  const [addMemVal,       setAddMemVal]       = useState("");
  const [addMemOpen,      setAddMemOpen]      = useState(false);

  const queryClient  = useQueryClient();
  const bottomRef    = useRef<HTMLDivElement>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);

  // Always-fresh refs — async callbacks never read stale closures
  const sessionsRef    = useRef(sessions);
  const activeIdRef    = useRef(activeId);
  const contextIdRef   = useRef(contextId);
  const apiContextRef  = useRef<ClientCtxApi | undefined>(undefined);
  useEffect(() => { sessionsRef.current   = sessions;   }, [sessions]);
  useEffect(() => { activeIdRef.current   = activeId;   }, [activeId]);
  useEffect(() => { contextIdRef.current  = contextId;  }, [contextId]);

  // Persist sessions to localStorage
  useEffect(() => { saveSessions(sessions); }, [sessions]);

  // ── Organizational memory ─────────────────────────────────────────────────
  const fetchMemories = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/memory`);
      if (res.ok) setMemories(await res.json() as AgentMemory[]);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  // ── Sync sessions from DB on mount (restores after page reload) ────────────
  const syncSessionsFromDB = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/chat/sessions`);
      if (!res.ok) return;
      const dbSessions = await res.json() as Array<{
        id: string; title: string | null; clientId: number | null; updatedAt: string;
      }>;
      setSessions(prev => {
        const knownDbIds = new Set(prev.map(s => s.dbSessionId).filter(Boolean));
        const toAdd: Session[] = dbSessions
          .filter(db => !knownDbIds.has(db.id))
          .map(db => ({
            id:          crypto.randomUUID(),
            dbSessionId: db.id,
            title:       db.title ?? "Conversación",
            preview:     "",
            ts:          new Date(db.updatedAt),
            msgs:        [],
            clientId:    db.clientId ?? undefined,
          }));
        if (toAdd.length === 0) return prev;
        return [...toAdd, ...prev].sort(
          (a, b) => b.ts.getTime() - a.ts.getTime(),
        );
      });
    } catch { /* ignore — DB sync is best-effort */ }
  }, []);
  useEffect(() => { syncSessionsFromDB(); }, [syncSessionsFromDB]);

  // ── Live client data from API ──────────────────────────────────────────────
  // Orval injects queryKey internally via getGet*QueryOptions at runtime;
  // the generated type incorrectly requires queryKey in the user-provided options.
  const { data: clientFull } = useGetClient(contextId ?? 0, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!contextId } as any,
  });
  const { data: clientAppointments = [] } = useListAppointments(
    { clientId: contextId ?? 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!contextId } as any }
  );
  const { data: clientMessages = [] } = useListMessages(
    { clientId: contextId ?? 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!contextId } as any }
  );

  // Last message content for context panel
  const lastMessageContent = useMemo(() => {
    if (!clientMessages.length) return null;
    const sorted = [...clientMessages].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return sorted[0]?.content ?? null;
  }, [clientMessages]);

  // Build the enriched context object sent to the API
  const apiContext = useMemo((): ClientCtxApi | undefined => {
    if (!clientFull) return undefined;
    const lastAppt = [...clientAppointments]
      .filter(a => new Date(a.startTime) <= new Date())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
    return {
      id:      clientFull.id,
      name:    clientFull.name,
      email:   clientFull.email,
      phone:   clientFull.phone,
      company: clientFull.company,
      status:  clientFull.status,
      tags:    clientFull.tags,
      notes:   clientFull.notes,
      value:   clientFull.value,
      lastInteraction: lastAppt
        ? `${lastAppt.title} (${format(new Date(lastAppt.startTime), "d 'de' MMMM 'de' yyyy", { locale: es })})`
        : lastMessageContent
          ? `Mensaje: "${lastMessageContent.slice(0, 80)}"`
          : null,
    };
  }, [clientFull, clientAppointments, lastMessageContent]);

  const activeSession = sessions.find(s => s.id === activeId) ?? null;
  const suggestions   = getSuggestions(clientFull ?? null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const h = (e: MouseEvent) => {
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target as Node))
        setShowPicker(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPicker]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setInput("");
    setShowPicker(false);

    const currentActiveId  = activeIdRef.current;
    const currentContextId = contextIdRef.current;
    const currentSessions  = sessionsRef.current;

    const currentApiContext = apiContextRef.current;

    const now     = new Date();
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: trimmed, ts: now };

    let targetId: string;
    let history: { role: "user" | "assistant"; content: string }[];

    if (!currentActiveId) {
      const newSession: Session = {
        id:       crypto.randomUUID(),
        title:    trimmed.slice(0, 45),
        preview:  trimmed.slice(0, 70),
        ts:       now,
        msgs:     [userMsg],
        clientId: currentContextId ?? undefined,
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveId(newSession.id);
      setShowList(false);
      targetId = newSession.id;
      history  = [{ role: "user", content: trimmed }];
    } else {
      const existing = currentSessions.find(s => s.id === currentActiveId);
      history = [
        ...(existing?.msgs ?? []).map(m => ({
          role:    (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: trimmed },
      ];
      targetId = currentActiveId;
      setSessions(prev => prev.map(s =>
        s.id === targetId
          ? { ...s, msgs: [...s.msgs, userMsg], preview: trimmed.slice(0, 70), ts: now }
          : s
      ));
    }

    setIsThinking(true);
    setTimeout(scrollToBottom, 60);
    await new Promise(r => setTimeout(r, 600));

    const aiId  = crypto.randomUUID();
    const aiMsg: Msg = { id: aiId, role: "ai", content: "", ts: new Date(), streaming: true };
    setSessions(prev => prev.map(s =>
      s.id === targetId ? { ...s, msgs: [...s.msgs, aiMsg] } : s
    ));
    setIsThinking(false);
    setTimeout(scrollToBottom, 60);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const markError = (msg: string) =>
      setSessions(prev => prev.map(s =>
        s.id === targetId
          ? { ...s, msgs: s.msgs.map(m => m.id === aiId ? { ...m, content: msg, streaming: false, error: true } : m) }
          : s
      ));

    try {
      const currentDbSessionId = sessionsRef.current.find(s => s.id === targetId)?.dbSessionId;
      const res = await authFetch(`${API_BASE}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages:      history,
          clientContext: currentApiContext,
          sessionId:     currentDbSessionId,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Error de conexión" }));
        markError(body.error ?? "Error inesperado del servidor");
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let acc        = "";
      let done       = false;

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) lineBuffer += decoder.decode(chunk.value, { stream: !done });

        let nl: number;
        while ((nl = lineBuffer.indexOf("\n")) !== -1) {
          const line = lineBuffer.slice(0, nl).trimEnd();
          lineBuffer  = lineBuffer.slice(nl + 1);

          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }

          let parsed: { token?: string; error?: string; event?: string; memory?: AgentMemory; sessionId?: string };
          try { parsed = JSON.parse(payload); }
          catch { continue; }

          if (parsed.error) { markError(parsed.error); return; }
          if (parsed.event === "session_created" && parsed.sessionId) {
            const dbSid = parsed.sessionId as string;
            setSessions(prev => prev.map(s =>
              s.id === targetId ? { ...s, dbSessionId: dbSid } : s,
            ));
          }
          if (parsed.event === "appointment_created" || parsed.event === "appointment_rescheduled" || parsed.event === "appointment_cancelled") {
            // Invalidate appointments cache so the calendar page refreshes automatically
            void queryClient.invalidateQueries({ queryKey: ["appointments"] });
          }
          if (parsed.event === "invoice_created" || parsed.event === "payment_registered") {
            void queryClient.invalidateQueries({ queryKey: ["invoices"] });
            void queryClient.invalidateQueries({ queryKey: ["payments"] });
            void queryClient.invalidateQueries({ queryKey: ["accounting"] });
            const toolEv = parsed as unknown as ToolEvent;
            setSessions(prev => prev.map(s =>
              s.id === targetId
                ? {
                    ...s,
                    msgs: s.msgs.map(m =>
                      m.id === aiId
                        ? { ...m, toolEvents: [...(m.toolEvents ?? []), toolEv] }
                        : m,
                    ),
                  }
                : s,
            ));
          }
          if (parsed.event === "memory_saved" && parsed.memory) {
            const mem = parsed.memory;
            setMemories(prev => {
              const idx = prev.findIndex(m => m.id === mem.id);
              if (idx >= 0) return prev.map(m => m.id === mem.id ? mem : m);
              return [mem, ...prev];
            });
            setFlashedMemId(mem.id);
            setTimeout(() => setFlashedMemId(null), 3000);
          }
          if (parsed.token) {
            acc += parsed.token;
            const snap = acc;
            setSessions(prev => prev.map(s =>
              s.id === targetId
                ? { ...s, msgs: s.msgs.map(m => m.id === aiId ? { ...m, content: snap } : m) }
                : s
            ));
            setTimeout(scrollToBottom, 30);
          }
        }
      }

      setSessions(prev => prev.map(s =>
        s.id === targetId
          ? { ...s, preview: acc.slice(0, 70), msgs: s.msgs.map(m => m.id === aiId ? { ...m, streaming: false } : m) }
          : s
      ));

    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      markError("No se pudo conectar con OmniTech AI. Verifica tu conexión.");
    }
  }, [scrollToBottom]);

  // Keep apiContextRef always current
  useEffect(() => { apiContextRef.current = apiContext; }, [apiContext]);

  const startNewChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setShowList(false);
    setInput("");
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) { setActiveId(null); setShowList(true); }
  };

  const filteredSessions = sessions.filter(s =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-3rem)] flex gap-0 md:gap-4 animate-in fade-in duration-300 relative">

      {/* ── Mobile sidebar backdrop ── */}
      <AnimatePresence>
        {showList && (
          <motion.div
            key="sidebar-backdrop"
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[45]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowList(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <div className={cn(
        "flex flex-col bg-card border border-border overflow-hidden",
        "transition-transform duration-300 ease-in-out will-animate",
        // Desktop: static sidebar in flex row
        "md:relative md:translate-x-0 md:w-64 md:shrink-0 md:rounded-xl md:z-auto md:shadow-none",
        // Mobile: fixed slide-over panel
        "fixed inset-y-0 left-0 w-[82vw] max-w-xs z-50 shadow-2xl rounded-r-2xl rounded-l-none border-r border-t-0 border-b-0",
        showList ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-primary fill-primary/15"/>
              <span className="text-sm font-bold text-white">Conversaciones</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNewChat}
                className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors touch-manipulation"
                title="Nueva conversación">
                <Plus className="w-4 h-4"/>
              </button>
              <button onClick={() => setShowList(false)}
                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors touch-manipulation"
                title="Cerrar">
                <X className="w-4 h-4"/>
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..." className="pl-8 h-8 bg-background/50 border-border text-xs"/>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSessions.length === 0
            ? <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                <Sparkles className="w-6 h-6 opacity-20"/>
                <p className="text-xs">Sin conversaciones aún</p>
              </div>
            : filteredSessions.map(s => (
              <div key={s.id} onClick={() => { setActiveId(s.id); setShowList(false); }}
                className={cn(
                  "p-2.5 rounded-lg cursor-pointer group flex items-start gap-2 transition-all",
                  activeId === s.id
                    ? "bg-primary/15 border border-primary/25"
                    : "hover:bg-white/5 border border-transparent"
                )}>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-xs font-medium truncate", activeId === s.id ? "text-white" : "text-slate-300")}>
                    {s.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{s.preview}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-400 transition-all shrink-0">
                  <Trash2 className="w-3 h-3"/>
                </button>
              </div>
            ))
          }
        </div>

        <div className="p-3 border-t border-border shrink-0">
          <div className="rounded-lg bg-primary/5 border border-primary/10 overflow-hidden">
            <div className="px-2.5 pt-2.5 pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-white">🤖 Ava Online</span>
                <button
                  onClick={() => setAvaDetailsOpen(v => !v)}
                  className="text-[10px] text-muted-foreground/50 hover:text-primary transition-colors"
                  title={avaDetailsOpen ? "Ocultar detalles" : "Ver detalles técnicos"}>
                  {avaDetailsOpen ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                </button>
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"/>
                <span className="text-[10px] text-emerald-400 font-medium">Conectada</span>
              </div>
              {(() => {
                const allAiMsgs = sessions.flatMap(s => s.msgs).filter(m => m.role === "ai" && !m.streaming);
                const lastTs = allAiMsgs.length > 0
                  ? allAiMsgs.reduce((latest, m) => m.ts > latest ? m.ts : latest, allAiMsgs[0]!.ts)
                  : null;
                const SKILLS_COUNT = 18;
                return (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/55">
                      Última actividad:{" "}
                      {lastTs
                        ? formatDistanceToNow(lastTs, { locale: es, addSuffix: true })
                        : "Sin actividad reciente"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/55">
                      Skills activas: <span className="text-primary/70 font-medium">{SKILLS_COUNT}</span>
                    </p>
                  </div>
                );
              })()}
            </div>

            {avaDetailsOpen && (
              <div className="border-t border-primary/10 px-2.5 py-2 bg-black/20">
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-1.5">
                  Detalles técnicos
                </p>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground/55">Proveedor: <span className="text-white/50">OpenAI</span></p>
                  <p className="text-[10px] text-muted-foreground/55">Modelo: <span className="text-white/50">GPT-4o mini</span></p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat area ── always visible; sidebar overlays it on mobile */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden min-w-0 relative">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background/30">
          <button onClick={() => setShowList(true)}
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors touch-manipulation"
            aria-label="Abrir conversaciones">
            <Menu className="w-4 h-4"/>
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-violet-600/25 border border-primary/20 flex items-center justify-center shrink-0">
            <Hexagon className="w-4 h-4 text-primary fill-primary/10"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {activeSession ? activeSession.title : "Ava"}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
              <span className="text-[10px] text-emerald-400 font-medium">
                {isThinking ? "Procesando…" : "Conectada"}
              </span>
            </div>
          </div>
          <button
            onClick={() => setMemoryPanelOpen(v => !v)}
            title="Memoria organizacional"
            className={cn(
              "p-1.5 rounded-lg transition-colors relative",
              memoryPanelOpen
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            )}>
            <Brain className="w-4 h-4"/>
            {memories.length > 0 && !memoryPanelOpen && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary"/>
            )}
          </button>
          {activeSession && (
            <button onClick={startNewChat}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
          )}
        </div>

        {/* ── Memory Overlay Panel ── */}
        <AnimatePresence>
          {memoryPanelOpen && (
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute inset-y-0 right-0 w-72 bg-[#0d1117] border-l border-border flex flex-col z-20 shadow-2xl">
              <MemoryPanel
                memories={memories}
                flashedMemId={flashedMemId}
                addOpen={addMemOpen}
                addKey={addMemKey}
                addVal={addMemVal}
                onAddKeyChange={setAddMemKey}
                onAddValChange={setAddMemVal}
                onAddToggle={() => setAddMemOpen(v => !v)}
                onAddSubmit={async () => {
                  if (!addMemKey.trim() || !addMemVal.trim()) return;
                  try {
                    const res = await authFetch(`${API_BASE}/api/memory`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ key: addMemKey, value: addMemVal }),
                    });
                    if (res.ok) {
                      const mem = await res.json() as AgentMemory;
                      setMemories(prev => {
                        const idx = prev.findIndex(m => m.id === mem.id);
                        if (idx >= 0) return prev.map(m => m.id === mem.id ? mem : m);
                        return [mem, ...prev];
                      });
                      setFlashedMemId(mem.id);
                      setTimeout(() => setFlashedMemId(null), 3000);
                      setAddMemKey(""); setAddMemVal(""); setAddMemOpen(false);
                    }
                  } catch { /* ignore */ }
                }}
                onDelete={async (id) => {
                  await authFetch(`${API_BASE}/api/memory/${id}`, { method: "DELETE" });
                  setMemories(prev => prev.filter(m => m.id !== id));
                }}
                onClose={() => setMemoryPanelOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Current Client section ── */}
        <AnimatePresence>
          {contextId && clientFull && (
            <ClientContextCard
              key={contextId}
              client={clientFull}
              appointments={clientAppointments}
              lastMessage={lastMessageContent}
              onClear={() => setContextId(null)}
              onChangePicker={() => setShowPicker(true)}
            />
          )}
        </AnimatePresence>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!activeSession
            ? <WelcomeScreen
                selectedClient={clientFull ?? null}
                onSuggest={t => { setShowList(false); sendMessage(t); }}
                onOpenPicker={() => setShowPicker(true)}
              />
            : <>
                {activeSession.msgs.map(msg => <MessageBubble key={msg.id} msg={msg}/>)}
                <AnimatePresence>
                  {isThinking && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-start gap-3">
                      <AiAvatar/>
                      <div className="bg-[#1a1f2e] border border-white/[0.06] rounded-2xl rounded-tl-sm">
                        <TypingDots/>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={bottomRef}/>
              </>
          }
        </div>

        {/* Quick suggestions */}
        {activeSession && !isThinking && (
          <div className="px-4 pb-2 shrink-0">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {suggestions.map(s => (
                <button key={s.label} onClick={() => sendMessage(s.text)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 border border-white/[0.08] hover:border-primary/40 hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-all whitespace-nowrap shrink-0">
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="p-3 pt-0 shrink-0" ref={inputAreaRef}>
          <div className="relative">
            <AnimatePresence>
              {showPicker && (
                <ClientPicker
                  selected={contextId}
                  onSelect={setContextId}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </AnimatePresence>

            <form onSubmit={e => { e.preventDefault(); sendMessage(input); }}
              className="flex items-end gap-2 p-2 rounded-2xl bg-[#141824] border border-white/[0.08] focus-within:border-primary/40 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.3)]">

              {/* Client picker trigger */}
              <button type="button" onClick={() => setShowPicker(v => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 self-end mb-0.5",
                  contextId && clientFull
                    ? "bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25"
                    : showPicker
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "bg-white/5 text-muted-foreground border border-white/[0.07] hover:border-primary/30 hover:text-primary"
                )}>
                {contextId && clientFull ? (
                  <>
                    <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white", avatarColor(clientFull.name))}>
                      {initials(clientFull.name)[0]}
                    </div>
                    <span className="hidden sm:inline max-w-[80px] truncate">{clientFull.name.split(" ")[0]}</span>
                  </>
                ) : (
                  <>
                    <UserRound className="w-3.5 h-3.5 shrink-0"/>
                    <span className="hidden sm:inline">Cliente</span>
                  </>
                )}
                <ChevronDown className={cn("w-3 h-3 transition-transform", showPicker && "rotate-180")}/>
              </button>

              <textarea value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={clientFull
                  ? `Pregunta sobre ${clientFull.name.split(" ")[0]}…`
                  : "Escribe un mensaje… (Enter para enviar)"
                }
                rows={1} disabled={isThinking}
                className="flex-1 bg-transparent text-white text-sm placeholder:text-muted-foreground/50 resize-none focus:outline-none min-h-[36px] max-h-[120px] py-1.5 px-2 leading-relaxed disabled:opacity-50"
              />

              <button type="submit" disabled={!input.trim() || isThinking}
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200",
                  input.trim() && !isThinking
                    ? "bg-gradient-to-br from-primary to-violet-600 text-white shadow-[0_4px_15px_rgba(59,130,246,0.35)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.5)] hover:scale-105"
                    : "bg-white/5 text-muted-foreground cursor-not-allowed"
                )}>
                <Send className="w-4 h-4"/>
              </button>
            </form>
          </div>

          <p className="text-center text-[10px] text-muted-foreground/40 mt-1.5">
            Ava puede cometer errores. Verifica información importante.
          </p>
        </div>
      </div>
    </div>
  );
}
