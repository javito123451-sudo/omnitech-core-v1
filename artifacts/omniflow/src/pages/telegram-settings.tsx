import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bot, CheckCircle2, XCircle, RefreshCw, AlertCircle, ArrowLeft,
  Globe, Zap, Settings, Send, Hash, User, Link2, ClipboardCopy,
  Users, MessageSquare, UserPlus, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface TgStatus {
  connected:       boolean;
  hasCredentials:  boolean;
  envTokenPresent: boolean;
  botInfo: {
    id?:         number;
    first_name?: string;
    username?:   string;
    is_bot?:     boolean;
  } | null;
  webhookInfo: {
    url?:                   string;
    has_custom_certificate?: boolean;
    pending_update_count?:  number;
    last_error_message?:    string;
    last_error_date?:       number;
  } | null;
  connectedSince: string | null;
  config: Record<string, unknown> | null;
  stats: {
    totalMessages:       number;
    totalReplied:        number;
    totalAccepted:       number;
    contactsCreated:     number;
    uniqueConversations: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function copyToClipboard(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  navigator.clipboard.writeText(text).then(() =>
    toast({ title: "Copiado al portapapeles" }),
  ).catch(() => {});
}

// ── Status section ────────────────────────────────────────────────────────────
function StatusCard({ status }: { status: TgStatus }) {
  const webhookOk = !!status.webhookInfo?.url;
  const lastError = status.webhookInfo?.last_error_message;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Bot status */}
      <div className={cn(
        "rounded-xl border p-4",
        status.connected ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border",
      )}>
        <div className="flex items-center gap-2 mb-2">
          <Bot className={cn("w-4 h-4", status.connected ? "text-emerald-400" : "text-muted-foreground")} />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bot</span>
        </div>
        {status.connected && status.botInfo ? (
          <>
            <p className="text-sm font-bold text-white">{status.botInfo.first_name}</p>
            <p className="text-xs text-emerald-400 font-mono">@{status.botInfo.username}</p>
            <Badge className="mt-2 bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px]">
              <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Conectado
            </Badge>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Sin configurar</p>
            <Badge className="mt-2 bg-slate-500/15 text-slate-400 border-slate-500/25 text-[10px]">
              <XCircle className="w-2.5 h-2.5 mr-1" />Sin token
            </Badge>
          </>
        )}
      </div>

      {/* Webhook status */}
      <div className={cn(
        "rounded-xl border p-4",
        webhookOk ? "bg-sky-500/5 border-sky-500/20" : "bg-card border-border",
      )}>
        <div className="flex items-center gap-2 mb-2">
          <Globe className={cn("w-4 h-4", webhookOk ? "text-sky-400" : "text-muted-foreground")} />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Webhook</span>
        </div>
        {webhookOk ? (
          <>
            <p className="text-xs font-mono text-sky-300 break-all leading-relaxed">
              {status.webhookInfo?.url}
            </p>
            {status.webhookInfo?.pending_update_count != null && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {status.webhookInfo.pending_update_count} actualizaciones pendientes
              </p>
            )}
            <Badge className="mt-2 bg-sky-500/15 text-sky-400 border-sky-500/25 text-[10px]">
              <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Activo
            </Badge>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No configurado</p>
            <Badge className="mt-2 bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px]">
              <AlertCircle className="w-2.5 h-2.5 mr-1" />Pendiente
            </Badge>
          </>
        )}
        {lastError && (
          <p className="text-[10px] text-red-400 mt-1.5">{lastError}</p>
        )}
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actividad</span>
        </div>
        <div className="space-y-1.5">
          {[
            { icon: MessageSquare, label: "Mensajes",      value: status.stats.totalMessages,       color: "text-sky-400" },
            { icon: Send,          label: "Respuestas",    value: status.stats.totalReplied,         color: "text-violet-400" },
            { icon: Users,         label: "Conversaciones", value: status.stats.uniqueConversations,  color: "text-blue-400" },
            { icon: UserPlus,      label: "Contactos creados", value: status.stats.contactsCreated,  color: "text-pink-400" },
            { icon: CheckCircle2,  label: "Aceptados",     value: status.stats.totalAccepted,        color: "text-emerald-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Icon className={cn("w-3 h-3", color)} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
              <span className={cn("text-xs font-bold", color)}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Actions panel ─────────────────────────────────────────────────────────────
function ActionsPanel({
  status,
  onStatusRefresh,
}: {
  status: TgStatus;
  onStatusRefresh: () => void;
}) {
  const { toast } = useToast();
  const [chatId,        setChatId]        = useState("");
  const [verifying,     setVerifying]     = useState(false);
  const [settingWh,     setSettingWh]     = useState(false);
  const [sendingTest,   setSendingTest]   = useState(false);
  const [webhookResult, setWebhookResult] = useState<string | null>(null);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await authFetch(`${BASE}/api/telegram/verify`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string };
      if (data.success) {
        toast({ title: "✅ Bot verificado", description: data.message });
        onStatusRefresh();
      } else {
        toast({ title: "❌ Error", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  const handleSetWebhook = async () => {
    setSettingWh(true);
    setWebhookResult(null);
    try {
      const res  = await authFetch(`${BASE}/api/telegram/set-webhook`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; webhookUrl?: string };
      if (data.success) {
        setWebhookResult(data.webhookUrl ?? null);
        toast({ title: "✅ Webhook configurado", description: data.message });
        onStatusRefresh();
      } else {
        toast({ title: "❌ Error", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSettingWh(false);
    }
  };

  const handleTestSend = async () => {
    if (!chatId.trim()) {
      toast({ title: "Introduce un Chat ID", variant: "destructive" });
      return;
    }
    setSendingTest(true);
    try {
      const res  = await authFetch(`${BASE}/api/telegram/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: Number(chatId.trim()) }),
      });
      const data = await res.json() as { success: boolean; message: string };
      if (data.success) {
        toast({ title: "✅ Mensaje de prueba enviado" });
      } else {
        toast({ title: "❌ Error", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Verify bot */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold">Verificar bot</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Comprueba que el token es válido y obtiene la información del bot.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={handleVerify}
          disabled={verifying || !status.hasCredentials}
          className="w-full"
        >
          {verifying
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Verificando...</>
            : <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Verificar</>
          }
        </Button>
      </div>

      {/* Set webhook */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold">Configurar webhook</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Registra el webhook de Telegram para recibir mensajes en tiempo real.
        </p>
        {webhookResult && (
          <div className="flex items-center gap-1.5 mb-2 bg-sky-500/10 rounded-lg p-2">
            <p className="text-[10px] font-mono text-sky-300 truncate flex-1">{webhookResult}</p>
            <button onClick={() => copyToClipboard(webhookResult, toast)}>
              <ClipboardCopy className="w-3 h-3 text-sky-400 shrink-0" />
            </button>
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleSetWebhook}
          disabled={settingWh || !status.hasCredentials}
          className="w-full"
        >
          {settingWh
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Configurando...</>
            : <><Globe className="w-3.5 h-3.5 mr-1.5" />Registrar webhook</>
          }
        </Button>
      </div>

      {/* Test send */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold">Mensaje de prueba</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Envía un mensaje de prueba a un Chat ID específico.
        </p>
        <div className="space-y-2">
          <Input
            placeholder="Chat ID (Ej: 123456789)"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="text-xs font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestSend}
            disabled={sendingTest || !status.hasCredentials || !chatId.trim()}
            className="w-full"
          >
            {sendingTest
              ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Enviando...</>
              : <><Send className="w-3.5 h-3.5 mr-1.5" />Enviar prueba</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Env token notice ──────────────────────────────────────────────────────────
function EnvTokenNotice({ present }: { present: boolean }) {
  if (!present) return null;
  return (
    <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex items-center gap-3">
      <Settings className="w-4 h-4 text-sky-400 shrink-0" />
      <div>
        <p className="text-xs font-semibold text-sky-400">
          Variable de entorno TELEGRAM_BOT_TOKEN detectada
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          El bot usa el token configurado en el entorno. Para usar un token diferente por organización, configúralo en Ajustes → Integraciones → Telegram.
        </p>
      </div>
    </div>
  );
}

// ── Webhook info detail ────────────────────────────────────────────────────────
function WebhookDetail({ info }: { info: TgStatus["webhookInfo"] }) {
  if (!info) return null;
  const { toast } = useToast();
  const url = info.url ?? "";

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-sky-400" />
        <span className="text-sm font-semibold">Detalle del webhook activo</span>
      </div>
      <div className="space-y-2">
        {[
          { label: "URL", value: url, mono: true, copyable: true },
          { label: "Actualizaciones pendientes", value: String(info.pending_update_count ?? 0) },
          { label: "Certificado personalizado",  value: info.has_custom_certificate ? "Sí" : "No" },
        ].map(({ label, value, mono, copyable }) => (
          <div key={label} className="flex items-start gap-2 text-xs">
            <span className="text-muted-foreground min-w-[140px] shrink-0">{label}:</span>
            <span className={cn("text-white break-all", mono && "font-mono")}>{value || "—"}</span>
            {copyable && value && (
              <button onClick={() => copyToClipboard(value, toast)} className="shrink-0">
                <ClipboardCopy className="w-3 h-3 text-muted-foreground hover:text-white" />
              </button>
            )}
          </div>
        ))}
        {info.last_error_message && (
          <div className="bg-red-500/10 rounded-lg p-2.5 mt-2">
            <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Último error</p>
            <p className="text-xs text-red-300 font-mono">{info.last_error_message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelegramSettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [status,  setStatus]  = useState<TgStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/telegram/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as TgStatus;
      setStatus(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
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
            <Bot className="w-5 h-5 text-sky-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Telegram</h1>
              <p className="text-xs text-muted-foreground">
                Configuración, estado del bot y webhook
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocation("/telegram-inbox")}
            className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
          >
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            Ver Inbox
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadStatus}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
          Error al cargar: {error}
        </div>
      )}

      {loading && !status && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-sky-400 animate-spin" />
        </div>
      )}

      {status && (
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {/* Env token notice */}
          <EnvTokenNotice present={status.envTokenPresent} />

          {/* Status cards */}
          <StatusCard status={status} />

          {/* Actions */}
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Acciones</h2>
            <ActionsPanel status={status} onStatusRefresh={loadStatus} />
          </div>

          {/* Webhook detail */}
          {status.webhookInfo?.url && (
            <WebhookDetail info={status.webhookInfo} />
          )}

          {/* How to get bot token */}
          {!status.connected && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Hash className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-semibold">Cómo configurar el bot</span>
              </div>
              <ol className="space-y-2">
                {[
                  "Abre Telegram y busca @BotFather",
                  "Envía el comando /newbot y sigue las instrucciones",
                  "Copia el token que te proporciona BotFather",
                  "Ve a Integraciones → Telegram y pega el token en el campo Bot Token",
                  "Haz clic en Guardar y luego en «Verificar bot»",
                  "Finalmente, haz clic en «Registrar webhook» para activar la recepción de mensajes",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Bot info detail */}
          {status.botInfo && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">Información del bot</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "ID",       value: String(status.botInfo.id ?? "—") },
                  { label: "Nombre",   value: status.botInfo.first_name ?? "—" },
                  { label: "Username", value: status.botInfo.username ? `@${status.botInfo.username}` : "—" },
                  { label: "Es bot",   value: status.botInfo.is_bot ? "Sí" : "No" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-background/50 rounded-lg p-2.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                    <p className="text-xs font-mono text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
