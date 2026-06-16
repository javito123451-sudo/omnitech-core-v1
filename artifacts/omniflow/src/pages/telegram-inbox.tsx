import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Send, RefreshCw, AlertCircle, ArrowDownLeft, ArrowLeft,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, User,
  FileText, Brain, Clock, Zap, Bot, MessageSquare, Hash,
  UserPlus, Settings,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface TgEvent {
  id:            number;
  orgId:         number;
  direction:     string;
  eventType:     string;
  status:        string;
  summary:       string | null;
  error:         string | null;
  createdAt:     string;
  payloadJson:   string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  message_received:  "Mensaje recibido",
  message_sent:      "Mensaje enviado",
  message_send_failed: "Envío fallido",
  quote_accepted:    "Presupuesto aceptado",
  quote_rejected:    "Presupuesto rechazado",
  contact_created:   "Contacto creado automáticamente",
  test_sent:         "Mensaje de prueba enviado",
  test_send_failed:  "Prueba fallida",
  test_ok:           "Test de conexión OK",
  test_failed:       "Test de conexión fallido",
  credentials_saved: "Credenciales guardadas",
  webhook_set:       "Webhook configurado",
};

function parseChatId(evt: TgEvent): string | null {
  if (!evt.payloadJson) return null;
  try {
    const p = JSON.parse(evt.payloadJson);
    return p.chatId != null ? String(p.chatId) : null;
  } catch { return null; }
}

function parsePreview(evt: TgEvent): string | null {
  if (!evt.payloadJson) return null;
  try {
    const p = JSON.parse(evt.payloadJson);
    return p.message ?? p.preview ?? p.messageText ?? null;
  } catch { return null; }
}

function parseSenderName(evt: TgEvent): string | null {
  if (!evt.payloadJson) return null;
  try {
    const p = JSON.parse(evt.payloadJson);
    return p.senderName ?? p.username ?? null;
  } catch { return null; }
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, eventType }: { status: string; eventType: string }) {
  const isError   = status === "error" || eventType.includes("failed");
  const isOk      = status === "processed" || status === "ok";
  const isCreated = eventType === "contact_created";
  if (isError)   return <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px]">Error</Badge>;
  if (isCreated) return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[10px]">Nuevo contacto</Badge>;
  if (isOk)      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px]">Procesado</Badge>;
  return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/25 text-[10px]">{status}</Badge>;
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "inbound")  return <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />;
  if (direction === "outbound") return <Send className="w-3.5 h-3.5 text-violet-400" />;
  return <Zap className="w-3.5 h-3.5 text-muted-foreground" />;
}

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType === "message_received")  return <ArrowDownLeft className="w-4 h-4 text-sky-400" />;
  if (eventType === "message_sent")      return <Send className="w-4 h-4 text-violet-400" />;
  if (eventType === "quote_accepted")    return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (eventType === "quote_rejected")    return <XCircle className="w-4 h-4 text-red-400" />;
  if (eventType === "contact_created")   return <UserPlus className="w-4 h-4 text-violet-400" />;
  if (eventType.includes("failed"))      return <AlertCircle className="w-4 h-4 text-red-400" />;
  return <Bot className="w-4 h-4 text-muted-foreground" />;
}

// ── Event row ──────────────────────────────────────────────────────────────────
function EventRow({ evt, idx }: { evt: TgEvent; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const isAccepted = evt.eventType === "quote_accepted";
  const isRejected = evt.eventType === "quote_rejected";
  const isError    = evt.status === "error" || evt.eventType.includes("failed");
  const chatId     = parseChatId(evt);
  const preview    = parsePreview(evt);
  const sender     = parseSenderName(evt);

  const rowBg = isAccepted
    ? "bg-emerald-500/5 border-emerald-500/15"
    : isRejected
    ? "bg-red-500/5 border-red-500/15"
    : isError
    ? "bg-red-500/5 border-red-500/15"
    : "bg-card border-border";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.02, duration: 0.2 }}
      className={cn("rounded-xl border overflow-hidden", rowBg)}
    >
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <DirectionIcon direction={evt.direction} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <EventIcon eventType={evt.eventType} />
            <span className="text-sm font-medium text-white">
              {EVENT_LABELS[evt.eventType] ?? evt.eventType}
            </span>
            <StatusBadge status={evt.status} eventType={evt.eventType} />
            {isAccepted && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px]">✅ Venta</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {evt.summary ?? "—"}
          </p>
          {preview && (
            <p className="text-xs text-sky-300/70 mt-0.5 truncate font-mono">
              "{preview.slice(0, 80)}{preview.length > 80 ? "…" : ""}"
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(evt.createdAt), { addSuffix: true, locale: es })}
          </span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-border/50">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">

                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Hash className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Chat ID</span>
                  </div>
                  <span className="text-xs font-mono text-white">{chatId ?? "—"}</span>
                </div>

                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <User className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Remitente</span>
                  </div>
                  <span className="text-xs text-white">{sender ?? "—"}</span>
                </div>

                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Dirección</span>
                  </div>
                  <span className="text-xs text-white capitalize">{evt.direction}</span>
                </div>
              </div>

              {evt.error && (
                <div className="mt-3 bg-red-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Error</p>
                  <p className="text-xs text-red-300 font-mono">{evt.error}</p>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(new Date(evt.createdAt), "dd MMM yyyy · HH:mm:ss", { locale: es })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ events }: { events: TgEvent[] }) {
  const received  = events.filter((e) => e.eventType === "message_received").length;
  const sent      = events.filter((e) => e.eventType === "message_sent").length;
  const accepted  = events.filter((e) => e.eventType === "quote_accepted").length;
  const created   = events.filter((e) => e.eventType === "contact_created").length;

  const chatIds = new Set<string>();
  for (const e of events) {
    const cid = parseChatId(e);
    if (cid) chatIds.add(cid);
  }

  const stats = [
    { label: "Mensajes recibidos",   value: received, color: "text-sky-400",     icon: ArrowDownLeft },
    { label: "Respuestas enviadas",  value: sent,     color: "text-violet-400",  icon: Send },
    { label: "Presupuestos aceptados", value: accepted, color: "text-emerald-400", icon: CheckCircle2 },
    { label: "Contactos creados",    value: created,  color: "text-pink-400",    icon: UserPlus },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
      {stats.map(({ label, value, color, icon: Icon }) => (
        <div key={label} className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={cn("w-3.5 h-3.5", color)} />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
          </div>
          <span className={cn("text-xl font-bold", color)}>{value}</span>
        </div>
      ))}
      {chatIds.size > 0 && (
        <div className="col-span-2 md:col-span-4 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-sky-400" />
          <div>
            <p className="text-[10px] text-sky-400/80 uppercase tracking-wide">Conversaciones únicas en Telegram</p>
            <p className="text-lg font-bold text-sky-400">{chatIds.size}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Send panel ─────────────────────────────────────────────────────────────────
function SendPanel({ onSent }: { onSent: () => void }) {
  const { toast } = useToast();
  const [chatId,  setChatId]  = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [open,    setOpen]    = useState(false);

  const handleSend = async () => {
    if (!chatId.trim() || !message.trim()) return;
    setSending(true);
    try {
      const res = await authFetch(`${BASE}/api/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: Number(chatId.trim()), message: message.trim() }),
      });
      const data = await res.json() as { success: boolean; message: string };
      if (data.success) {
        toast({ title: "Mensaje enviado", description: `Chat ID: ${chatId}` });
        setMessage("");
        onSent();
      } else {
        toast({ title: "Error al enviar", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-card border border-sky-500/20 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-medium text-white">Enviar mensaje a Telegram</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/50"
          >
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Chat ID del destinatario</label>
                <Input
                  placeholder="Ej: 123456789"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Mensaje</label>
                <Textarea
                  placeholder="Escribe el mensaje..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                />
              </div>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || !chatId.trim() || !message.trim()}
                className="bg-sky-600 hover:bg-sky-500 text-white"
              >
                {sending
                  ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Enviando...</>
                  : <><Send className="w-3.5 h-3.5 mr-1.5" />Enviar</>
                }
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Filter ────────────────────────────────────────────────────────────────────
type Filter = "all" | "message_received" | "message_sent" | "quote_accepted" | "contact_created" | "error";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all",              label: "Todos" },
  { value: "message_received", label: "Recibidos" },
  { value: "message_sent",     label: "Enviados" },
  { value: "quote_accepted",   label: "Aceptados" },
  { value: "contact_created",  label: "Contactos" },
  { value: "error",            label: "Errores" },
];

function applyFilter(events: TgEvent[], filter: Filter): TgEvent[] {
  if (filter === "all")              return events;
  if (filter === "error")            return events.filter((e) => e.status === "error" || e.eventType.includes("failed"));
  return events.filter((e) => e.eventType === filter);
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelegramInboxPage() {
  const [, setLocation] = useLocation();
  const [events,  setEvents]  = useState<TgEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [filter,  setFilter]  = useState<Filter>("all");
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/telegram/audit?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as TgEvent[];
      setEvents(data);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = applyFilter(events, filter);

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocation("/integrations/telegram")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Telegram
          </button>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-sky-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Telegram Inbox</h1>
              <p className="text-xs text-muted-foreground">
                Mensajes entrantes, respuestas automáticas y eventos del bot
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocation("/integrations/telegram")}
          >
            <Settings className="w-3.5 h-3.5 mr-1.5" />
            Configurar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            {loaded ? "Actualizar" : "Cargar"}
          </Button>
        </div>
      </div>

      {/* Send panel */}
      <SendPanel onSent={load} />

      {/* Empty state */}
      {!loaded && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bot className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-white font-medium mb-1">Telegram Inbox</p>
          <p className="text-sm text-muted-foreground max-w-sm mb-5">
            Visualiza todos los mensajes entrantes de Telegram, contactos creados automáticamente y respuestas del bot.
          </p>
          <Button onClick={load} size="sm">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Cargar mensajes
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-sky-400 animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
          Error al cargar: {error}
        </div>
      )}

      {loaded && !loading && (
        <>
          <StatsBar events={events} />

          {/* Filter tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-sky-600 text-white"
                    : "bg-card border border-border text-muted-foreground hover:text-white",
                )}
              >
                {f.label}
                {f.value !== "all" && (
                  <span className="ml-1.5 opacity-60">
                    {applyFilter(events, f.value).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Event list */}
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No hay eventos para el filtro seleccionado
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((evt, idx) => (
                <EventRow key={evt.id} evt={evt} idx={idx} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
