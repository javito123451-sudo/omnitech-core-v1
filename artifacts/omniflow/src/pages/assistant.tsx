import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hexagon, Send, Plus, Search, Sparkles, Zap, FileText, Calendar, RefreshCw, BarChart2, ChevronLeft, Copy, Check, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────
type Role = "user" | "ai";
type Msg = {
  id: string;
  role: Role;
  content: string;
  ts: Date;
  streaming?: boolean;
};
type Session = {
  id: string;
  title: string;
  preview: string;
  ts: Date;
  msgs: Msg[];
};

// ── Smart Response Engine ─────────────────────────────────────────────────
const RESPONSES: { kw: string[]; reply: string }[] = [
  {
    kw: ["responder", "cliente", "mensaje", "whatsapp"],
    reply: `Claro, he analizado el historial del cliente. Aquí tienes una respuesta optimizada:\n\n> *"Hola [Nombre], gracias por ponerte en contacto con nosotros. He revisado tu consulta con detalle y me complace ofrecerte una solución personalizada. Podríamos reunirnos esta semana para repasar los detalles. ¿Te viene bien el jueves a las 10:00?"*\n\nEsta respuesta tiene una tasa de apertura estimada del **87%** basada en conversaciones similares. ¿Quieres ajustar el tono o enviarla directamente?`,
  },
  {
    kw: ["presupuesto", "precio", "cotizar", "cotización", "propuesta"],
    reply: `He generado un borrador de presupuesto profesional:\n\n**📄 Presupuesto #2024-089**\n\n| Servicio | Unidades | Precio |\n|---|---|---|\n| Implementación CRM | 1 | €2.400 |\n| Formación equipo | 5h | €750 |\n| Soporte Premium 1 año | 12 meses | €1.800 |\n| **Total** | | **€4.950** |\n\nIVA no incluido. Validez: 30 días.\n\n¿Quieres que personalice las líneas, aplique un descuento o lo envíe directamente al cliente?`,
  },
  {
    kw: ["cita", "agendar", "reunión", "llamada", "meeting"],
    reply: `He revisado tu calendario y encontré los siguientes huecos disponibles:\n\n📅 **Opciones para esta semana:**\n• **Mañana** — 10:00 o 16:30\n• **Jueves** — 11:00 o 15:00\n• **Viernes** — 09:30\n\nRecomiendo el **jueves a las 11:00** — históricamente tienes mejores conversiones en reuniones de mañana.\n\n¿Confirmo la cita y envío invitación al cliente con enlace de videoconferencia?`,
  },
  {
    kw: ["seguimiento", "follow", "recordatorio", "automatico", "automático"],
    reply: `He diseñado una secuencia de seguimiento automático de 3 pasos:\n\n**⚡ Secuencia "Conversión 7 días"**\n\n1. **Día 1** — Email de bienvenida + video demo (15 min)\n2. **Día 3** — WhatsApp con caso de éxito relevante al sector\n3. **Día 7** — Llamada de seguimiento + oferta limitada\n\n📊 Esta secuencia tiene un **42% de tasa de conversión** en clientes similares.\n\n¿Activo esta secuencia para los prospectos sin respuesta de esta semana?`,
  },
  {
    kw: ["resumen", "diario", "informe", "hoy", "reportar", "reporte"],
    reply: `**📊 Resumen del día — ${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}**\n\n**Actividad:**\n• ✅ 3 clientes contactados\n• 📅 2 citas completadas\n• 💬 8 mensajes respondidos\n• 🎯 1 propuesta enviada\n\n**Métricas del día:**\n• Ingresos cerrados: **€8.400**\n• Pipeline activo: **€127.000**\n• Tasa de respuesta: **91%** (+6% vs ayer)\n\n**Prioridad para mañana:**\n1. Seguimiento con Lucía Fernández (Grupo Iberia)\n2. Cierre con Diego López (ScalePath)\n3. Demo para Sofía Blanco (Aurora Cloud)\n\n¿Quieres que envíe este resumen al equipo?`,
  },
  {
    kw: ["hola", "buenas", "buenos", "hey", "hi"],
    reply: `¡Hola! Soy **Omniflow AI**, tu asistente de negocio inteligente. 👋\n\nEstoy conectado a tu CRM en tiempo real y puedo ayudarte con:\n\n• 💬 **Redactar y enviar mensajes** a clientes\n• 📄 **Generar presupuestos** en segundos\n• 📅 **Agendar reuniones** automáticamente\n• 🔁 **Activar secuencias** de seguimiento\n• 📊 **Resumir** la actividad del equipo\n\n¿Por dónde empezamos?`,
  },
  {
    kw: ["gracias", "perfecto", "genial", "ok", "dale", "excelente"],
    reply: `De nada, siempre a tu disposición. 🎯\n\nRecuerda que puedo ayudarte en cualquier momento con mensajes, presupuestos, citas o análisis. ¿Hay algo más en lo que pueda ayudarte ahora?`,
  },
];

function getAIReply(input: string): string {
  const lower = input.toLowerCase();
  for (const r of RESPONSES) {
    if (r.kw.some((k) => lower.includes(k))) return r.reply;
  }
  return `He analizado tu consulta: *"${input}"*\n\nBasándome en el contexto de tu negocio, te recomiendo revisar los clientes en estado **Prospecto** que llevan más de 7 días sin contacto. Tienes **4 oportunidades** que podrían cerrarse esta semana si actuamos ahora.\n\n¿Quieres que prepare una respuesta personalizada para cada uno?`;
}

// ── Quick Suggestions ─────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: <RefreshCw className="w-3.5 h-3.5" />, label: "Responder cliente", text: "Ayúdame a responder al último mensaje de un cliente" },
  { icon: <FileText className="w-3.5 h-3.5" />, label: "Crear presupuesto", text: "Crea un presupuesto profesional para un nuevo cliente" },
  { icon: <Calendar className="w-3.5 h-3.5" />, label: "Agendar cita", text: "Ayúdame a agendar una reunión para esta semana" },
  { icon: <Zap className="w-3.5 h-3.5" />, label: "Seguimiento automático", text: "Diseña una secuencia de seguimiento automático" },
  { icon: <BarChart2 className="w-3.5 h-3.5" />, label: "Resumen diario", text: "Dame el resumen de actividad de hoy" },
];

// ── Streaming text ────────────────────────────────────────────────────────
function StreamingText({ content, onDone }: { content: string; onDone?: () => void }) {
  const [shown, setShown] = useState("");
  const [cursor, setCursor] = useState(true);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setShown("");
    const id = setInterval(() => {
      if (idx.current < content.length) {
        idx.current++;
        setShown(content.slice(0, idx.current));
      } else {
        clearInterval(id);
        setCursor(false);
        onDone?.();
      }
    }, 8);
    return () => clearInterval(id);
  }, [content]);

  return (
    <span className="whitespace-pre-wrap">
      {renderMarkdown(shown)}
      {cursor && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />}
    </span>
  );
}

// ── Minimal markdown renderer ─────────────────────────────────────────────
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
      if (p.startsWith("**") && p.endsWith("**")) {
        return <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong>;
      }
      // Italic: *text*
      return p.split(/(\*[^*]+\*)/g).map((q, k) => {
        if (q.startsWith("*") && q.endsWith("*") && q.length > 2) {
          return <em key={k} className="text-slate-300 italic">{q.slice(1, -1)}</em>;
        }
        return q;
      });
    });

    const prefix = line.startsWith("> ") ? (
      <blockquote key={i} className="border-l-2 border-primary/60 pl-3 my-1 italic text-slate-300">
        {renderMarkdown(line.slice(2))}
      </blockquote>
    ) : line.startsWith("| ") ? (
      <span key={i} className="font-mono text-xs text-slate-300 block">{line}</span>
    ) : line.match(/^#{1,3} /) ? (
      <span key={i} className="block font-bold text-white mt-1">{line.replace(/^#{1,3} /, "")}</span>
    ) : (
      <span key={i} className="block">{parts}<br /></span>
    );
    return prefix;
  });
}

// ── Typing Indicator ──────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i} className="w-2 h-2 rounded-full bg-primary"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

// ── Copy Button ───────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-white transition-all"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────
function MessageBubble({ msg, isLast }: { msg: Msg; isLast: boolean }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-violet-600/30 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
          <Hexagon className="w-4 h-4 text-primary fill-primary/10" />
        </div>
      )}

      {/* Bubble */}
      <div className={cn("max-w-[85%] md:max-w-[72%]", isUser ? "items-end" : "items-start", "flex flex-col gap-1")}>
        <div className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg relative",
          isUser
            ? "bg-gradient-to-br from-primary to-violet-600 text-white rounded-tr-sm shadow-[0_4px_20px_rgba(59,130,246,0.25)]"
            : "bg-[#1a1f2e] border border-white/[0.06] text-slate-200 rounded-tl-sm"
        )}>
          {msg.streaming && isLast ? (
            <StreamingText content={msg.content} />
          ) : (
            <span className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</span>
          )}
        </div>
        <div className={cn("flex items-center gap-1.5 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
          <span className="text-[10px] text-muted-foreground">
            {msg.ts.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && <CopyButton text={msg.content} />}
        </div>
      </div>
    </motion.div>
  );
}

// ── Welcome Screen ────────────────────────────────────────────────────────
function WelcomeScreen({ onSuggest }: { onSuggest: (text: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full px-4 gap-8 text-center"
    >
      {/* AI Orb */}
      <div className="relative">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 via-violet-600/20 to-indigo-600/10 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.2)]">
          <Hexagon className="w-10 h-10 text-primary fill-primary/15" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-background animate-pulse" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-white">Omniflow <span className="text-primary">AI</span></h2>
        <p className="text-muted-foreground text-sm md:text-base max-w-xs">
          Tu asistente de negocios inteligente. ¿En qué puedo ayudarte hoy?
        </p>
      </div>

      {/* Suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-2xl">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggest(s.text)}
            className="p-3.5 rounded-xl bg-card border border-white/[0.07] hover:border-primary/40 hover:bg-primary/5 text-left transition-all group shadow-sm"
          >
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

// ── Main Page ─────────────────────────────────────────────────────────────
export default function Assistant() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    setInput("");

    const now = new Date();
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: trimmed, ts: now };

    let targetId = activeId;
    if (!targetId) {
      const newSession: Session = {
        id: crypto.randomUUID(),
        title: trimmed.slice(0, 40),
        preview: trimmed.slice(0, 60),
        ts: now,
        msgs: [userMsg],
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveId(newSession.id);
      setShowList(false);
      targetId = newSession.id;
    } else {
      setSessions((prev) => prev.map((s) =>
        s.id === targetId
          ? { ...s, msgs: [...s.msgs, userMsg], preview: trimmed.slice(0, 60), ts: now }
          : s
      ));
    }

    scrollToBottom();
    setIsThinking(true);

    // Simulate AI thinking delay
    const thinkMs = 900 + Math.random() * 600;
    setTimeout(() => {
      const reply = getAIReply(trimmed);
      const aiMsg: Msg = { id: crypto.randomUUID(), role: "ai", content: reply, ts: new Date(), streaming: true };
      setSessions((prev) => prev.map((s) =>
        s.id === targetId ? { ...s, msgs: [...s.msgs, aiMsg], preview: reply.slice(0, 60) } : s
      ));
      setIsThinking(false);
      scrollToBottom();
    }, thinkMs);
  }, [activeId, isThinking, scrollToBottom]);

  const startNewChat = () => {
    setActiveId(null);
    setShowList(false);
    setInput("");
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) { setActiveId(null); setShowList(true); }
  };

  const filteredSessions = sessions.filter((s) =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] flex gap-0 md:gap-4 animate-in fade-in duration-300">

      {/* ── Sidebar ── */}
      <div className={cn(
        "flex-col bg-card border border-border rounded-xl overflow-hidden transition-all duration-300",
        "w-full md:w-64 md:flex md:shrink-0",
        showList ? "flex" : "hidden md:flex"
      )}>
        {/* Sidebar header */}
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-primary fill-primary/15" />
              <span className="text-sm font-bold text-white">Conversaciones</span>
            </div>
            <button
              onClick={startNewChat}
              className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
              title="Nueva conversación"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..." className="pl-8 h-8 bg-background/50 border-border text-xs"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Sparkles className="w-6 h-6 opacity-20" />
              <p className="text-xs">Sin conversaciones aún</p>
            </div>
          ) : filteredSessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setActiveId(s.id); setShowList(false); }}
              className={cn(
                "p-2.5 rounded-lg cursor-pointer group flex items-start gap-2 transition-all",
                activeId === s.id ? "bg-primary/15 border border-primary/25" : "hover:bg-white/5 border border-transparent"
              )}
            >
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs font-medium truncate", activeId === s.id ? "text-white" : "text-slate-300")}>
                  {s.title}
                </p>
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{s.preview}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-400 transition-all shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Model badge */}
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-muted-foreground">Omniflow AI <span className="text-primary font-medium">Pro</span></span>
          </div>
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div className={cn(
        "flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden min-w-0",
        showList ? "hidden md:flex" : "flex"
      )}>
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background/30">
          <button
            onClick={() => setShowList(true)}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-violet-600/25 border border-primary/20 flex items-center justify-center shrink-0">
            <Hexagon className="w-4 h-4 text-primary fill-primary/10" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {activeSession ? activeSession.title : "Omniflow AI"}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">Conectado</span>
            </div>
          </div>

          {activeSession && (
            <button onClick={startNewChat} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!activeSession ? (
            <WelcomeScreen onSuggest={(text) => { setShowList(false); sendMessage(text); }} />
          ) : (
            <>
              {activeSession.msgs.map((msg, i) => (
                <MessageBubble key={msg.id} msg={msg} isLast={i === activeSession.msgs.length - 1} />
              ))}
              <AnimatePresence>
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-violet-600/30 border border-primary/20 flex items-center justify-center shrink-0">
                      <Hexagon className="w-4 h-4 text-primary fill-primary/10" />
                    </div>
                    <div className="bg-[#1a1f2e] border border-white/[0.06] rounded-2xl rounded-tl-sm">
                      <TypingDots />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Quick suggestions (shown when chat is active) */}
        {activeSession && !isThinking && (
          <div className="px-4 pb-2 shrink-0">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendMessage(s.text)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 border border-white/[0.08] hover:border-primary/40 hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-all whitespace-nowrap shrink-0"
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="p-3 pt-0 shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="flex items-end gap-2 p-2 rounded-2xl bg-[#141824] border border-white/[0.08] focus-within:border-primary/40 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
              }}
              placeholder="Escribe un mensaje o elige una sugerencia..."
              rows={1}
              className="flex-1 bg-transparent text-white text-sm placeholder:text-muted-foreground/50 resize-none focus:outline-none min-h-[36px] max-h-[120px] py-1.5 px-2 leading-relaxed"
              style={{ height: "auto" }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200",
                input.trim() && !isThinking
                  ? "bg-gradient-to-br from-primary to-violet-600 text-white shadow-[0_4px_15px_rgba(59,130,246,0.35)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.5)] hover:scale-105"
                  : "bg-white/5 text-muted-foreground cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground/40 mt-1.5">
            Omniflow AI puede cometer errores. Verifica información importante.
          </p>
        </div>
      </div>
    </div>
  );
}
