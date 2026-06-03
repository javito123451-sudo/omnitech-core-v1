import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Hexagon, Send, Plus, Search, Sparkles, Zap,
  FileText, Calendar, RefreshCw, BarChart2,
  ChevronLeft, Copy, Check, Trash2, AlertCircle,
  UserRound, X, Building2, ChevronDown, ChevronUp,
  Tag, DollarSign, Clock, MessageSquare, ExternalLink,
  Phone, Mail, StickyNote,
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

// ── Types ────────────────────────────────────────────────────────────────────
type Role = "user" | "ai";
type Msg = {
  id: string; role: Role; content: string; ts: Date;
  streaming?: boolean; error?: boolean;
};
type Session = {
  id: string; title: string; preview: string; ts: Date;
  msgs: Msg[]; clientId?: number;
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
        <h2 className="text-2xl md:text-3xl font-bold text-white">Omniflow <span className="text-primary">AI</span></h2>
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
const STORAGE_KEY = "omniflow_chat_sessions_v2";
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

  // ── Live client data from API ──────────────────────────────────────────────
  const { data: clientFull } = useGetClient(contextId ?? 0, {
    query: { enabled: !!contextId },
  });
  const { data: clientAppointments = [] } = useListAppointments(
    { clientId: contextId ?? 0 },
    { query: { enabled: !!contextId } }
  );
  const { data: clientMessages = [] } = useListMessages(
    { clientId: contextId ?? 0 },
    { query: { enabled: !!contextId } }
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
      const res = await fetch(`${API_BASE}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages:      history,
          clientContext: currentApiContext,
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

          let parsed: { token?: string; error?: string };
          try { parsed = JSON.parse(payload); }
          catch { continue; }

          if (parsed.error) { markError(parsed.error); return; }
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
      markError("No se pudo conectar con Omniflow AI. Verifica tu conexión.");
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
    <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] flex gap-0 md:gap-4 animate-in fade-in duration-300">

      {/* ── Sidebar ── */}
      <div className={cn(
        "flex-col bg-card border border-border rounded-xl overflow-hidden",
        "w-full md:w-64 md:flex md:shrink-0",
        showList ? "flex" : "hidden md:flex"
      )}>
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-primary fill-primary/15"/>
              <span className="text-sm font-bold text-white">Conversaciones</span>
            </div>
            <button onClick={startNewChat}
              className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
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
          <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
            <span className="text-xs text-muted-foreground">
              Omniflow AI <span className="text-primary font-medium">GPT-4o mini</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className={cn(
        "flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden min-w-0",
        showList ? "hidden md:flex" : "flex"
      )}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background/30">
          <button onClick={() => setShowList(true)}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-violet-600/25 border border-primary/20 flex items-center justify-center shrink-0">
            <Hexagon className="w-4 h-4 text-primary fill-primary/10"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {activeSession ? activeSession.title : "Omniflow AI"}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
              <span className="text-[10px] text-emerald-400 font-medium">
                {isThinking ? "Procesando…" : "Conectado · GPT-4o mini"}
              </span>
            </div>
          </div>
          {activeSession && (
            <button onClick={startNewChat}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
          )}
        </div>

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
            GPT-4o mini · Omniflow AI puede cometer errores. Verifica información importante.
          </p>
        </div>
      </div>
    </div>
  );
}
