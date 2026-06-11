import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, Copy, CheckCheck, ExternalLink, ChevronRight,
  MessageCircle, Send, Clock, Calendar, Flame, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
type MessageType = "seguimiento" | "cita" | "recuperar";

interface GenerateResult {
  message:         string;
  characterCount:  number;
  type:            MessageType;
  openWhatsAppUrl: string;
  client: {
    id: number; name: string; phone?: string | null;
    company?: string | null; status: string;
  };
  nextAppointment: { title: string; startTime: string } | null;
}

export interface WhatsAppModalProps {
  clientId:      number;
  clientName:    string;
  clientPhone?:  string | null;
  clientCompany?: string | null;
  clientStatus?: string;
  onClose:       () => void;
}

// ── Message type config ───────────────────────────────────────────────────────
const MSG_TYPES: { type: MessageType; icon: React.ReactNode; label: string; sublabel: string; color: string; bg: string; border: string }[] = [
  {
    type:     "seguimiento",
    icon:     <Zap className="w-5 h-5" />,
    label:    "Seguimiento",
    sublabel: "Mantén el contacto activo y avanza la relación",
    color:    "text-blue-400",
    bg:       "bg-blue-500/10",
    border:   "border-blue-500/25",
  },
  {
    type:     "cita",
    icon:     <Calendar className="w-5 h-5" />,
    label:    "Confirmar cita",
    sublabel: "Recuerda y confirma la próxima reunión o servicio",
    color:    "text-emerald-400",
    bg:       "bg-emerald-500/10",
    border:   "border-emerald-500/25",
  },
  {
    type:     "recuperar",
    icon:     <Flame className="w-5 h-5" />,
    label:    "Recuperar cliente",
    sublabel: "Reactiva a un cliente inactivo o que no responde",
    color:    "text-orange-400",
    bg:       "bg-orange-500/10",
    border:   "border-orange-500/25",
  },
];

const STATUS_LABELS: Record<string, string> = {
  lead: "Lead", active: "Activo", inactive: "Inactivo",
  prospect: "Prospecto", churned: "Perdido",
};

// ── Character count bar ───────────────────────────────────────────────────────
function CharBar({ count }: { count: number }) {
  const MAX    = 1024;
  const pct    = Math.min(count / MAX, 1) * 100;
  const color  = count > 900 ? "bg-red-500" : count > 600 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-white/[0.07] rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-300", color)} style={{ width: pct + "%" }} />
      </div>
      <span className={cn("text-[10px] font-mono tabular-nums shrink-0", count > 900 ? "text-red-400" : "text-muted-foreground")}>
        {count}/{MAX}
      </span>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export function WhatsAppModal({
  clientId, clientName, clientPhone, clientCompany, clientStatus, onClose,
}: WhatsAppModalProps) {
  const [step, setStep]       = useState<"select" | "generating" | "preview">("select");
  const [msgType, setMsgType] = useState<MessageType | null>(null);
  const [result, setResult]   = useState<GenerateResult | null>(null);
  const [edited, setEdited]   = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);

  const generate = useCallback(async (type: MessageType) => {
    setMsgType(type);
    setStep("generating");
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/whatsapp/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ clientId, messageType: type }),
      });
      if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error ?? "Error"); }
      const data = await r.json() as GenerateResult;
      setResult(data);
      setEdited(data.message);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
      setStep("select");
    }
  }, [clientId]);

  const copyToClipboard = useCallback(async () => {
    await navigator.clipboard.writeText(edited);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [edited]);

  const openWhatsApp = useCallback(() => {
    const phone = (clientPhone ?? "").replace(/\D/g, "");
    const url   = phone
      ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(edited)
      : "https://wa.me/?text=" + encodeURIComponent(edited);
    window.open(url, "_blank");
  }, [edited, clientPhone]);

  const sendViaApi = useCallback(async () => {
    if (!clientPhone) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/whatsapp/send`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ to: clientPhone, message: edited }),
      });
      const data = await r.json() as { success?: boolean; pending?: boolean; fallback?: string; error?: string; reason?: string };
      if (data.pending) {
        window.open(data.fallback ?? "https://wa.me", "_blank");
      } else if (data.success) {
        setSent(true);
      } else {
        throw new Error(data.error ?? "Error al enviar");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }, [clientPhone, edited]);

  const currentType = MSG_TYPES.find(m => m.type === msgType);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-sm overflow-y-auto py-6 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="w-full max-w-lg bg-slate-950 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] bg-gradient-to-r from-emerald-950/40 to-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400/70">WhatsApp IA</div>
              <div className="text-sm font-bold text-foreground">{clientName}{clientCompany ? " · " + clientCompany : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {clientStatus && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-muted-foreground font-medium">
                {STATUS_LABELS[clientStatus] ?? clientStatus}
              </span>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">

            {/* ── Step: select type ── */}
            {step === "select" && (
              <motion.div key="select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-xs text-muted-foreground mb-4">¿Qué tipo de mensaje quieres generar?</p>

                <div className="space-y-2.5">
                  {MSG_TYPES.map((m) => (
                    <motion.button
                      key={m.type}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => void generate(m.type)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group",
                        m.bg, m.border, "hover:brightness-110"
                      )}
                    >
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border", m.bg, m.border, m.color)}>
                        {m.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn("text-sm font-bold", m.color)}>{m.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{m.sublabel}</div>
                      </div>
                      <ChevronRight className={cn("w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity", m.color)} />
                    </motion.button>
                  ))}
                </div>

                {error && (
                  <div className="mt-4 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>
                )}

                {/* Future integration badge */}
                <div className="mt-5 flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="w-6 h-6 rounded-lg bg-green-600/20 border border-green-600/25 flex items-center justify-center shrink-0">
                    <span className="text-xs">🚀</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                    <span className="text-muted-foreground font-medium">WhatsApp Business API</span> — Conecta tu número oficial para envíos directos desde el CRM sin abrir WhatsApp.
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── Step: generating ── */}
            {step === "generating" && (
              <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12 gap-5">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                    <MessageCircle className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center">
                    <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">Generando mensaje…</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Analizando historial CRM y contexto del cliente</p>
                </div>
                {currentType && (
                  <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border", currentType.bg, currentType.border, currentType.color)}>
                    {currentType.icon}
                    {currentType.label}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step: preview ── */}
            {step === "preview" && result && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="space-y-4">
                  {/* Type badge + client info */}
                  <div className="flex items-center justify-between gap-2">
                    {currentType && (
                      <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border", currentType.bg, currentType.border, currentType.color)}>
                        {currentType.icon}
                        {currentType.label}
                      </div>
                    )}
                    {result.nextAppointment && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                        <Clock className="w-3 h-3" />
                        {new Date(result.nextAppointment.startTime).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                      </div>
                    )}
                  </div>

                  {/* WhatsApp message preview bubble */}
                  <div className="bg-[#1a2737] rounded-2xl p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500/40 via-emerald-400/20 to-transparent" />
                    <div className="flex items-start gap-2 mb-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      <span className="text-[10px] text-emerald-400/70 font-medium">Vista previa WhatsApp</span>
                    </div>
                    <div className="bg-[#005c4b] text-white text-sm leading-relaxed rounded-xl rounded-tl-sm px-3.5 py-2.5 shadow-sm max-w-[85%]">
                      {edited}
                      <div className="text-[9px] text-emerald-200/50 text-right mt-1">
                        {new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ✓✓
                      </div>
                    </div>
                  </div>

                  {/* Editable textarea */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Editar mensaje</label>
                      <CharBar count={edited.length} />
                    </div>
                    <textarea
                      value={edited}
                      onChange={e => setEdited(e.target.value)}
                      rows={5}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-emerald-500/40 resize-none transition-colors"
                    />
                  </div>

                  {error && (
                    <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>
                  )}

                  {sent && (
                    <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
                      <CheckCheck className="w-3.5 h-3.5 shrink-0" /> Mensaje enviado correctamente vía WhatsApp Business API
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => void copyToClipboard()}
                      className={cn(
                        "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[11px] font-semibold transition-all",
                        copied
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? "¡Copiado!" : "Copiar"}
                    </button>

                    <button
                      onClick={openWhatsApp}
                      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Abrir WA
                    </button>

                    <button
                      onClick={() => void sendViaApi()}
                      disabled={sending || sent || !clientPhone}
                      title={!clientPhone ? "El cliente no tiene teléfono registrado" : "Enviar vía WhatsApp Business API"}
                      className={cn(
                        "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[11px] font-semibold transition-colors",
                        sent
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : !clientPhone
                          ? "border-white/[0.06] bg-white/[0.02] text-white/20 cursor-not-allowed"
                          : "border-primary/25 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
                      )}
                    >
                      {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : sent ? <CheckCheck className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                      {sent ? "Enviado" : "Enviar API"}
                    </button>
                  </div>

                  {/* Regenerate / Back */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setStep("select"); setResult(null); setEdited(""); setSent(false); setError(null); }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      ← Cambiar tipo
                    </button>
                    <button
                      onClick={() => msgType && void generate(msgType)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer — future integration hint */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/40" />
            Preparado para WhatsApp Business Cloud API (Meta) · Variables de entorno: WHATSAPP_BUSINESS_PHONE_ID + WHATSAPP_ACCESS_TOKEN
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
