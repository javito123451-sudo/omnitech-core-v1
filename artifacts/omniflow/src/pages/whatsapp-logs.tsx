import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  MessageCircle, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  User, FileText, Brain, Send, ChevronDown, ChevronUp,
  ArrowDownLeft, ArrowLeft, Phone, Clock, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface AuditEvent {
  id:             number;
  orgId:          number;
  direction:      string;
  eventType:      string;
  status:         string;
  summary:        string | null;
  error:          string | null;
  createdAt:      string;
  phone:          string | null;
  clientFound:    boolean | null;
  clientName:     string | null;
  clientId:       number | null;
  quoteFound:     boolean | null;
  quoteTitle:     string | null;
  quoteId:        number | null;
  quoteTotal:     number | null;
  quoteCurrency:  string | null;
  result:         string | null;
  memoryCreated:  boolean | null;
  autoReplySent:  boolean | null;
  clientPromoted: boolean | null;
  messageText:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  message_received:  "Mensaje recibido",
  quote_accepted:    "Presupuesto aceptado",
  quote_rejected:    "Presupuesto rechazado",
  message_sent:      "Mensaje enviado",
  test_sent:         "Mensaje de prueba enviado",
  test_send_failed:  "Prueba fallida",
  message_send_failed: "Envío fallido",
  test_ok:           "Test de conexión OK",
  test_failed:       "Test de conexión fallido",
  credentials_saved: "Credenciales guardadas",
  credentials_deleted: "Credenciales eliminadas",
};

const RESULT_LABELS: Record<string, { label: string; color: string }> = {
  no_client:        { label: "Cliente no encontrado", color: "text-slate-400" },
  no_keyword:       { label: "Sin palabra clave",     color: "text-slate-400" },
  keyword_accepted: { label: "Keyword: aceptar",      color: "text-emerald-400" },
  keyword_rejected: { label: "Keyword: rechazar",     color: "text-red-400" },
  accepted:         { label: "Aceptado",               color: "text-emerald-400" },
  rejected:         { label: "Rechazado",              color: "text-red-400" },
};

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency", currency: currency ?? "EUR",
  }).format(amount);
}

function StatusBadge({ status, eventType }: { status: string; eventType: string }) {
  const isError = status === "error" || eventType.includes("failed");
  const isWarning = status === "unmatched";
  const isOk = status === "processed" || status === "ok";

  if (isError)   return <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px]">Error</Badge>;
  if (isWarning) return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px]">Sin coincidencia</Badge>;
  if (isOk)      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px]">Procesado</Badge>;
  return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/25 text-[10px]">{status}</Badge>;
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "inbound")  return <ArrowDownLeft className="w-3.5 h-3.5 text-blue-400" />;
  if (direction === "outbound") return <Send className="w-3.5 h-3.5 text-violet-400" />;
  return <Zap className="w-3.5 h-3.5 text-muted-foreground" />;
}

// ── Audit Row ─────────────────────────────────────────────────────────────────
function AuditRow({ evt, idx }: { evt: AuditEvent; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const isAccepted = evt.eventType === "quote_accepted";
  const isRejected = evt.eventType === "quote_rejected";
  const isReceived = evt.eventType === "message_received";
  const isError    = evt.status === "error" || evt.eventType.includes("failed");

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
      transition={{ delay: idx * 0.025, duration: 0.2 }}
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
            <span className="text-sm font-medium text-white">
              {EVENT_LABELS[evt.eventType] ?? evt.eventType}
            </span>
            <StatusBadge status={evt.status} eventType={evt.eventType} />
            {isAccepted && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px]">✅ Venta</Badge>}
            {isRejected && <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px]">❌ Rechazado</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {evt.summary ?? "—"}
          </p>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">

                {/* Teléfono */}
                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Teléfono</span>
                  </div>
                  <span className="text-xs font-mono text-white">
                    {evt.phone ? `+${evt.phone.replace(/\D/g, "").slice(-9)}` : "—"}
                  </span>
                </div>

                {/* Cliente encontrado */}
                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <User className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Cliente</span>
                  </div>
                  {evt.clientFound === null
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : evt.clientFound
                    ? <span className="text-xs text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {evt.clientName ?? "Encontrado"}
                      </span>
                    : <span className="text-xs text-red-400 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        No encontrado
                      </span>
                  }
                </div>

                {/* Presupuesto encontrado */}
                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Presupuesto</span>
                  </div>
                  {evt.quoteFound === null
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : evt.quoteFound
                    ? <span className="text-xs text-emerald-400 flex items-center gap-1 truncate">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">{evt.quoteTitle ?? "Encontrado"}</span>
                      </span>
                    : <span className="text-xs text-red-400 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        No encontrado
                      </span>
                  }
                </div>

                {/* Resultado */}
                <div className="bg-background/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Resultado</span>
                  </div>
                  <span className={cn("text-xs font-medium", RESULT_LABELS[evt.result ?? ""]?.color ?? "text-muted-foreground")}>
                    {RESULT_LABELS[evt.result ?? ""]?.label ?? evt.result ?? "—"}
                  </span>
                </div>
              </div>

              {/* Fila de acciones automáticas (solo en eventos de aceptación) */}
              {(isAccepted || isRejected) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {evt.clientPromoted && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 rounded-md px-2 py-1">
                      <CheckCircle2 className="w-3 h-3" /> Cliente → Activo
                    </span>
                  )}
                  {evt.memoryCreated && (
                    <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 rounded-md px-2 py-1">
                      <Brain className="w-3 h-3" /> Memoria creada
                    </span>
                  )}
                  {evt.autoReplySent === true && (
                    <span className="flex items-center gap-1 text-[11px] text-violet-400 bg-violet-500/10 rounded-md px-2 py-1">
                      <Send className="w-3 h-3" /> Auto-respuesta enviada
                    </span>
                  )}
                  {evt.autoReplySent === false && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 rounded-md px-2 py-1">
                      <AlertCircle className="w-3 h-3" /> Auto-respuesta no enviada (sin credenciales)
                    </span>
                  )}
                  {evt.quoteTotal != null && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-500/10 rounded-md px-2 py-1">
                      💰 {formatCurrency(evt.quoteTotal, evt.quoteCurrency)}
                    </span>
                  )}
                </div>
              )}

              {/* Mensaje original (solo en message_received) */}
              {isReceived && evt.messageText && (
                <div className="mt-3 bg-background/50 rounded-lg p-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Mensaje original</p>
                  <p className="text-xs text-white font-mono">"{evt.messageText}"</p>
                </div>
              )}

              {/* Error */}
              {evt.error && (
                <div className="mt-3 bg-red-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Error</p>
                  <p className="text-xs text-red-300 font-mono">{evt.error}</p>
                </div>
              )}

              {/* Timestamp exacto */}
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
function StatsBar({ events }: { events: AuditEvent[] }) {
  const received  = events.filter((e) => e.eventType === "message_received").length;
  const accepted  = events.filter((e) => e.eventType === "quote_accepted").length;
  const rejected  = events.filter((e) => e.eventType === "quote_rejected").length;
  const unmatched = events.filter((e) => e.status === "unmatched").length;

  const totalRevenue = events
    .filter((e) => e.eventType === "quote_accepted" && e.quoteTotal != null)
    .reduce((acc, e) => acc + (e.quoteTotal ?? 0), 0);

  const stats = [
    { label: "Mensajes recibidos", value: received,  color: "text-blue-400",    icon: ArrowDownLeft },
    { label: "Presupuestos aceptados", value: accepted,  color: "text-emerald-400", icon: CheckCircle2 },
    { label: "Presupuestos rechazados", value: rejected,  color: "text-red-400",     icon: XCircle },
    { label: "Sin coincidencia", value: unmatched, color: "text-amber-400",   icon: AlertCircle },
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
      {accepted > 0 && (
        <div className="col-span-2 md:col-span-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div>
            <p className="text-[10px] text-emerald-400/80 uppercase tracking-wide">Revenue vía WhatsApp</p>
            <p className="text-lg font-bold text-emerald-400">
              {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(totalRevenue)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────
type Filter = "all" | "message_received" | "quote_accepted" | "quote_rejected" | "error";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all",              label: "Todos" },
  { value: "message_received", label: "Mensajes" },
  { value: "quote_accepted",   label: "Aceptados" },
  { value: "quote_rejected",   label: "Rechazados" },
  { value: "error",            label: "Errores" },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WhatsAppLogsPage() {
  const [, setLocation] = useLocation();
  const [events,  setEvents]  = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [filter,  setFilter]  = useState<Filter>("all");
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/whatsapp/audit?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AuditEvent[];
      setEvents(data);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = events.filter((e) => {
    if (filter === "all")              return true;
    if (filter === "error")            return e.status === "error" || e.eventType.includes("failed");
    if (filter === "message_received") return e.eventType === "message_received";
    if (filter === "quote_accepted")   return e.eventType === "quote_accepted";
    if (filter === "quote_rejected")   return e.eventType === "quote_rejected";
    return true;
  });

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocation("/integrations")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Integraciones
          </button>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Auditoría WhatsApp</h1>
              <p className="text-xs text-muted-foreground">
                Registro completo de mensajes entrantes y flujo de aceptación automática
              </p>
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
          {loaded ? "Actualizar" : "Cargar logs"}
        </Button>
      </div>

      {/* Empty / loading state */}
      {!loaded && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageCircle className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-white font-medium mb-1">Auditoría de WhatsApp</p>
          <p className="text-sm text-muted-foreground max-w-sm mb-5">
            Haz clic en "Cargar logs" para ver el historial de mensajes recibidos, detección de palabras clave y resultado de la automatización.
          </p>
          <Button onClick={load} size="sm">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Cargar logs
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
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
                    ? "bg-primary text-white"
                    : "bg-card border border-border text-muted-foreground hover:text-white",
                )}
              >
                {f.label}
                {f.value !== "all" && (
                  <span className="ml-1.5 opacity-60">
                    {events.filter((e) => {
                      if (f.value === "error")            return e.status === "error" || e.eventType.includes("failed");
                      if (f.value === "message_received") return e.eventType === "message_received";
                      if (f.value === "quote_accepted")   return e.eventType === "quote_accepted";
                      if (f.value === "quote_rejected")   return e.eventType === "quote_rejected";
                      return false;
                    }).length}
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
                <AuditRow key={evt.id} evt={evt} idx={idx} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
