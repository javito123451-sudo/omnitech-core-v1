import { useState, useEffect, useRef, useCallback } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Send, RefreshCw, Bot, MessageSquare, User, Building2,
  Phone, Mail, Flame, Thermometer, Snowflake, ArrowLeft,
  Settings, ChevronRight, Search, CheckCheck, Sparkles,
  LayoutList, AlertCircle,
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
interface ConvSummary {
  clientId:             number | null; // null for guest conversations (no CRM client linked)
  clientName:           string;
  phone:                string | null;
  // Guest identity (see FIX-AU) — the backend returns this only for guest
  // conversations (clientId === null); absent for CRM-linked conversations.
  externalId?:          string | null;
  leadScore:            string;
  leadIntent:           string | null;
  status:               string;
  company:              string | null;
  email:                string | null;
  lastMessage:          string | null;
  lastMessageAt:        string | null;
  lastMessageDirection: string | null;
  lastMessageIsAi:      boolean | null;
  messageCount:         number;
}

interface WaMessage {
  id:        number;
  content:   string;
  direction: string;
  channel:   string | null;
  isAi:      boolean | null;
  status:    string | null;
  createdAt: string;
}

// Route param / unique id for a conversation: numeric clientId for CRM-linked
// conversations, "guest:<externalId>" for guest conversations (no client
// linked). Matches the :clientId param the backend accepts on
// GET/POST /conversations/*.
function convRouteId(conv: ConvSummary): string {
  return conv.clientId != null ? String(conv.clientId) : `guest:${conv.externalId}`;
}

// ── Lead score badge ──────────────────────────────────────────────────────────
function LeadBadge({ score }: { score: string }) {
  if (score === "caliente") return (
    <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px] gap-1">
      <Flame className="w-3 h-3" /> Caliente
    </Badge>
  );
  if (score === "tibio") return (
    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] gap-1">
      <Thermometer className="w-3 h-3" /> Tibio
    </Badge>
  );
  return (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] gap-1">
      <Snowflake className="w-3 h-3" /> Frío
    </Badge>
  );
}

function LeadDot({ score }: { score: string }) {
  if (score === "caliente") return <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />;
  if (score === "tibio")    return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-emerald-400/50 shrink-0" />;
}

// ── Conversation card (left panel) ───────────────────────────────────────────
function ConvCard({
  conv, isSelected, onClick,
}: { conv: ConvSummary; isSelected: boolean; onClick: () => void }) {
  const isInbound = conv.lastMessageDirection === "inbound";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-white/5 transition-colors flex gap-3 items-start",
        isSelected && "bg-emerald-500/10 border-l-2 border-l-emerald-500",
      )}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-border flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-sm font-bold text-white">
          {conv.clientName.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-sm font-medium text-white truncate">{conv.clientName}</span>
          {conv.lastMessageAt && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false, locale: es })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-1">
          <LeadDot score={conv.leadScore} />
          {conv.company && (
            <span className="text-[10px] text-muted-foreground truncate">{conv.company}</span>
          )}
          {!conv.company && conv.phone && (
            <span className="text-[10px] text-muted-foreground">+{conv.phone.replace(/\D/g, "").slice(-9)}</span>
          )}
        </div>

        {conv.lastMessage && (
          <p className={cn(
            "text-xs truncate",
            isInbound ? "text-muted-foreground" : "text-emerald-400/70",
          )}>
            {!isInbound && <CheckCheck className="w-3 h-3 inline mr-1" />}
            {conv.lastMessage.slice(0, 60)}{conv.lastMessage.length > 60 ? "…" : ""}
          </p>
        )}
      </div>

      {/* Lead badge */}
      {conv.leadScore !== "cold" && (
        <LeadDot score={conv.leadScore} />
      )}
    </button>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MsgBubble({ msg }: { msg: WaMessage }) {
  const isOutbound = msg.direction === "outbound";
  const isAi = msg.isAi === true;

  return (
    <div className={cn("flex gap-2", isOutbound ? "justify-end" : "justify-start")}>
      {!isOutbound && (
        <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-emerald-400" />
        </div>
      )}

      <div className={cn(
        "max-w-[72%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
        isOutbound
          ? isAi
            ? "bg-violet-600/80 text-white rounded-tr-sm border border-violet-500/30"
            : "bg-emerald-600/80 text-white rounded-tr-sm border border-emerald-500/30"
          : "bg-card border border-border text-white rounded-tl-sm",
      )}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <div className={cn("flex items-center gap-1 mt-1.5", isOutbound ? "justify-end" : "justify-start")}>
          {isAi && isOutbound && (
            <Sparkles className="w-3 h-3 text-violet-300/70" />
          )}
          <span className="text-[10px] opacity-50">
            {format(new Date(msg.createdAt), "HH:mm")}
          </span>
        </div>
      </div>

      {isOutbound && (
        <div className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 border",
          isAi
            ? "bg-violet-500/20 border-violet-500/30"
            : "bg-emerald-500/20 border-emerald-500/30",
        )}>
          {isAi
            ? <Bot className="w-3.5 h-3.5 text-violet-400" />
            : <Send className="w-3.5 h-3.5 text-emerald-400" />
          }
        </div>
      )}
    </div>
  );
}

// ── Day divider ────────────────────────────────────────────────────────────────
function DayDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[10px] text-muted-foreground px-2">
        {format(date, "EEEE, d MMMM", { locale: es })}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyThread() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <MessageSquare className="w-8 h-8 text-emerald-400/50" />
      </div>
      <div>
        <p className="text-white font-medium mb-1">Selecciona una conversación</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Elige un cliente de la lista para ver su hilo de mensajes y responder directamente.
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WhatsAppInboxPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [convs,       setConvs]       = useState<ConvSummary[]>([]);
  const [selected,    setSelected]    = useState<ConvSummary | null>(null);
  const [messages,    setMessages]    = useState<WaMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [msgLoading,  setMsgLoading]  = useState(false);
  const [reply,       setReply]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [search,      setSearch]      = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Load conversations list
  const loadConvs = useCallback(async () => {
    setConvLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/whatsapp/conversations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ConvSummary[];
      setConvs(data);
    } catch (e) {
      toast({ title: "Error al cargar conversaciones", description: String(e), variant: "destructive" });
    } finally {
      setConvLoading(false);
    }
  }, [toast]);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (conv: ConvSummary) => {
    setMsgLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/whatsapp/conversations/${convRouteId(conv)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as WaMessage[];
      setMessages(data);
    } catch (e) {
      toast({ title: "Error al cargar mensajes", description: String(e), variant: "destructive" });
    } finally {
      setMsgLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  useEffect(() => {
    if (selected) loadMessages(selected);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await authFetch(`${BASE}/api/whatsapp/conversations/${convRouteId(selected)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        setReply("");
        await loadMessages(selected);
        await loadConvs();
        toast({ title: "Mensaje enviado ✓" });
      } else {
        toast({ title: "Error al enviar", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
  };

  const filteredConvs = convs.filter((c) =>
    search.trim() === "" ||
    c.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (c.company ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? "").includes(search),
  );

  // Group messages by day for dividers
  const msgsWithDividers: Array<{ type: "msg"; msg: WaMessage } | { type: "day"; date: Date }> = [];
  let lastDay = "";
  for (const msg of messages) {
    const day = format(new Date(msg.createdAt), "yyyy-MM-dd");
    if (day !== lastDay) {
      msgsWithDividers.push({ type: "day", date: new Date(msg.createdAt) });
      lastDay = day;
    }
    msgsWithDividers.push({ type: "msg", msg });
  }

  const hotCount  = convs.filter((c) => c.leadScore === "caliente").length;
  const warmCount = convs.filter((c) => c.leadScore === "tibio").length;

  return (
    <div className="flex flex-col h-[calc(100dvh-130px)] -mt-1">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-1 pb-3 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* On mobile show back-to-list arrow when a conv is selected */}
          {selected ? (
            <button
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-white transition-colors md:hidden shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setLocation("/integrations/whatsapp")}
              className="text-muted-foreground hover:text-white transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {/* Desktop: always show back button pointing to settings */}
          <button
            onClick={() => setLocation("/integrations/whatsapp")}
            className="text-muted-foreground hover:text-white transition-colors hidden md:block shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white leading-none truncate">
                {selected ? <span className="md:hidden">{selected.clientName}</span> : null}
                <span className={cn(selected ? "hidden md:inline" : "")}>WhatsApp Inbox</span>
              </h1>
              <p className="text-[11px] text-muted-foreground truncate">
                {convs.length} conversaciones
                {hotCount > 0 && <> · <span className="text-red-400">{hotCount} calientes</span></>}
                {warmCount > 0 && <> · <span className="text-amber-400">{warmCount} tibios</span></>}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={loadConvs} disabled={convLoading} className="h-8 px-2 sm:px-3">
            <RefreshCw className={cn("w-3.5 h-3.5 sm:mr-1.5", convLoading && "animate-spin")} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/integrations/whatsapp")} className="h-8 px-2 sm:px-3">
            <Settings className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Config</span>
          </Button>
        </div>
      </div>

      {/* ── Split panel ── */}
      <div className="flex flex-1 min-h-0 rounded-xl border border-border overflow-hidden bg-card/30">

        {/* ── LEFT: Conversation list (hidden on mobile when conv selected) ── */}
        <div className={cn(
          "w-full md:w-72 xl:w-80 border-r border-border flex flex-col shrink-0",
          selected ? "hidden md:flex" : "flex",
        )}>
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar conversación..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-xs bg-background/50"
              />
            </div>
          </div>

          {/* Conv list */}
          <div className="flex-1 overflow-y-auto">
            {convLoading && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
              </div>
            )}

            {!convLoading && filteredConvs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <LayoutList className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-white mb-1">Sin conversaciones</p>
                <p className="text-xs text-muted-foreground">
                  {search ? "Sin resultados para esa búsqueda" : "Los contactos de WhatsApp aparecerán aquí"}
                </p>
              </div>
            )}

            {filteredConvs.map((conv) => (
              <ConvCard
                key={convRouteId(conv)}
                conv={conv}
                isSelected={selected ? convRouteId(selected) === convRouteId(conv) : false}
                onClick={() => setSelected(conv)}
              />
            ))}
          </div>
        </div>

        {/* ── RIGHT: Message thread (hidden on mobile when no conv selected) ── */}
        <div className={cn(
          "flex-1 flex flex-col min-w-0",
          selected ? "flex" : "hidden md:flex",
        )}>
          {!selected ? (
            <EmptyThread />
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-card/40">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-border flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-white">
                    {selected.clientName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{selected.clientName}</span>
                    <LeadBadge score={selected.leadScore} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {selected.company && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Building2 className="w-3 h-3" />{selected.company}
                      </span>
                    )}
                    {selected.phone && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3" />+{selected.phone.replace(/\D/g, "").slice(-9)}
                      </span>
                    )}
                    {selected.email && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />{selected.email}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {selected.messageCount} mensajes
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => loadMessages(selected)}
                    disabled={msgLoading}
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", msgLoading && "animate-spin")} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setLocation(`/clients`)}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    Ver cliente
                  </Button>
                </div>
              </div>

              {/* Lead intent banner */}
              {selected.leadIntent && (
                <div className="mx-4 mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2 shrink-0">
                  <Flame className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-amber-400 font-medium uppercase tracking-wide">Intención detectada</span>
                    <p className="text-xs text-amber-300/80 mt-0.5">{selected.leadIntent.slice(0, 120)}{selected.leadIntent.length > 120 ? "…" : ""}</p>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgLoading && (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                  </div>
                )}

                {!msgLoading && messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <AlertCircle className="w-7 h-7 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Sin mensajes en el historial aún</p>
                  </div>
                )}

                {!msgLoading && msgsWithDividers.map((item, i) =>
                  item.type === "day"
                    ? <DayDivider key={`d-${i}`} date={item.date} />
                    : <MsgBubble key={item.msg.id} msg={item.msg} />
                )}
                <div ref={bottomRef} />
              </div>

              {/* Reply input */}
              <div className="p-3 border-t border-border shrink-0 bg-card/40">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Textarea
                      placeholder="Escribe una respuesta... (Ctrl+Enter para enviar)"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="resize-none text-sm bg-background/50"
                    />
                  </div>
                  <Button
                    onClick={handleSend}
                    disabled={sending || !reply.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white h-[64px] px-4 shrink-0"
                  >
                    {sending
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Send className="w-4 h-4" />
                    }
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  <Bot className="w-3 h-3 text-violet-400" />
                  El bot IA responde automáticamente a los mensajes entrantes.
                  <span className="text-emerald-400">Tú puedes escribir respuestas manuales aquí.</span>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
