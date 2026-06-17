import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Bot, Webhook, Key, MessageSquare, CheckCircle2, XCircle,
  RefreshCw, ArrowLeft, AlertTriangle, Activity, Users,
  Send, BarChart3, Clock, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BotInfo {
  id:         number;
  first_name: string;
  username:   string;
  can_join_groups: boolean;
}

interface WebhookInfo {
  url:                  string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?:     number;
  last_error_message?:  string;
  max_connections?:     number;
}

interface TelegramStatus {
  connected:       boolean;
  hasCredentials:  boolean;
  envTokenPresent: boolean;
  botInfo:         BotInfo | null;
  webhookInfo:     WebhookInfo | null;
  config:          string | null;
  connectedSince:  string | null;
  stats: {
    totalMessages:       number;
    totalReplied:        number;
    totalAccepted:       number;
    contactsCreated:     number;
    uniqueConversations: number;
  };
}

interface AuditEvent {
  id:          number;
  eventType:   string;
  direction:   string;
  status:      string;
  summary:     string;
  createdAt:   string;
  payloadJson: string | null;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok
        ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
        : <XCircle    className="w-5 h-5 text-red-400 shrink-0" />}
      <span className={cn("text-sm font-medium", ok ? "text-emerald-300" : "text-red-300")}>
        {label}
      </span>
      <Badge className={cn(
        "text-[10px] px-2 py-0.5 ml-auto",
        ok
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
          : "bg-red-500/15 text-red-400 border-red-500/25",
      )}>
        {ok ? "SÍ" : "NO"}
      </Badge>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = "sky" }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color?: "sky" | "violet" | "emerald" | "amber";
}) {
  const colors = {
    sky:     "bg-sky-500/10 border-sky-500/20 text-sky-400",
    violet:  "bg-violet-500/10 border-violet-500/20 text-violet-400",
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    amber:   "bg-amber-500/10 border-amber-500/20 text-amber-400",
  };
  return (
    <div className={cn("rounded-xl border p-4 flex flex-col gap-2", colors[color])}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-2xl font-bold text-white">{value}</span>
    </div>
  );
}

export default function TelegramDiagnosticoPage() {
  const [, setLocation] = useLocation();
  const { toast }       = useToast();

  const [status,  setStatus]  = useState<TelegramStatus | null>(null);
  const [audit,   setAudit]   = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [setting, setSetting] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, auditRes] = await Promise.all([
        authFetch(`${BASE}/api/telegram/status`),
        authFetch(`${BASE}/api/telegram/audit?limit=20`),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json() as TelegramStatus;
        setStatus(data);
      }
      if (auditRes.ok) {
        const data = await auditRes.json() as AuditEvent[];
        setAudit(data);
      }
      setLastChecked(new Date());
    } catch (e) {
      toast({ title: "Error al cargar diagnóstico", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSetWebhook = async () => {
    setSetting(true);
    try {
      const res  = await authFetch(`${BASE}/api/telegram/set-webhook`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; webhookUrl?: string };
      if (data.success) {
        toast({ title: "Webhook actualizado ✓", description: data.webhookUrl ?? "" });
        await load();
      } else {
        toast({ title: "Error al configurar webhook", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSetting(false);
    }
  };

  // Parse webhook secret from config
  let webhookSecret: string | null = null;
  if (status?.config) {
    try {
      const cfg = JSON.parse(status.config) as { webhookSecret?: string };
      webhookSecret = cfg.webhookSecret ?? null;
    } catch { /* ignore */ }
  }

  const webhookUrl = webhookSecret
    ? `${window.location.origin}/api/telegram/webhook/${webhookSecret}`
    : null;

  const webhookActive = !!(
    status?.webhookInfo?.url &&
    webhookUrl &&
    status.webhookInfo.url === webhookUrl
  );

  const lastMsg = audit.find((e) => e.eventType === "message_received");

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocation("/integrations/telegram")}
            className="text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
            <Bot className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-none">Diagnóstico Telegram</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Estado en tiempo real del bot Telegram
              {lastChecked && (
                <> · Actualizado: {format(lastChecked, "HH:mm:ss")}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Actualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/telegram-inbox")}>
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            Inbox
          </Button>
        </div>
      </div>

      {loading && !status && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-sky-400 animate-spin" />
        </div>
      )}

      {status && (
        <div className="space-y-5">

          {/* ── Estado principal ── */}
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              Estado del sistema
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card/60 p-3 space-y-3">
                <StatusBadge
                  ok={status.hasCredentials}
                  label="Token válido / bot conectado"
                />
                <StatusBadge
                  ok={status.envTokenPresent}
                  label="Variable TELEGRAM_BOT_TOKEN configurada"
                />
                <StatusBadge
                  ok={webhookActive}
                  label="Webhook activo y apuntando a este servidor"
                />
                <StatusBadge
                  ok={!status.webhookInfo?.last_error_message}
                  label="Sin errores en el webhook"
                />
              </div>

              {/* Bot info */}
              <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Información del bot
                </p>
                {status.botInfo ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0">
                        <Bot className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{status.botInfo.first_name}</p>
                        <p className="text-xs text-muted-foreground">@{status.botInfo.username}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">ID: {status.botInfo.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-[10px]">
                        Activo
                      </Badge>
                      {status.connectedSince && (
                        <Badge className="bg-card text-muted-foreground border-border text-[10px]">
                          Desde {format(new Date(status.connectedSince), "dd MMM yyyy", { locale: es })}
                        </Badge>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm">No se pudo conectar al bot</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Webhook ── */}
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Webhook className="w-4 h-4 text-violet-400" />
                Webhook Telegram
              </h2>
              <Button size="sm" variant="outline" onClick={handleSetWebhook} disabled={setting}>
                <Settings className={cn("w-3.5 h-3.5 mr-1.5", setting && "animate-spin")} />
                {setting ? "Configurando…" : "Re-configurar webhook"}
              </Button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-28 shrink-0">URL registrada:</span>
                <span className={cn(
                  "font-mono break-all",
                  status.webhookInfo?.url ? "text-sky-300" : "text-red-400",
                )}>
                  {status.webhookInfo?.url || "No configurada"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-28 shrink-0">URL esperada:</span>
                <span className="font-mono break-all text-muted-foreground">
                  {webhookUrl ?? "No disponible (sin secret)"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Updates pendientes:</span>
                <span className={cn(
                  "font-mono",
                  (status.webhookInfo?.pending_update_count ?? 0) > 0 ? "text-amber-400" : "text-emerald-400",
                )}>
                  {status.webhookInfo?.pending_update_count ?? "—"}
                </span>
              </div>
              {status.webhookInfo?.last_error_message && (
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-red-400">Último error:</span>
                    <span className="ml-1 text-red-300">{status.webhookInfo.last_error_message}</span>
                    {status.webhookInfo.last_error_date && (
                      <span className="ml-1 text-muted-foreground">
                        ({format(new Date(status.webhookInfo.last_error_date * 1000), "dd/MM HH:mm")})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!webhookActive && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex gap-2 items-start">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="text-amber-300 font-medium">El webhook no apunta a este servidor</p>
                  <p className="text-amber-400/70 mt-0.5">
                    Haz clic en "Re-configurar webhook" para registrar la URL correcta.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Estadísticas ── */}
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              Estadísticas de actividad
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard icon={MessageSquare} label="Mensajes recibidos" value={status.stats.totalMessages} color="sky" />
              <StatCard icon={Send}         label="Respuestas enviadas" value={status.stats.totalReplied}   color="violet" />
              <StatCard icon={Users}        label="Conversaciones únicas" value={status.stats.uniqueConversations} color="emerald" />
              <StatCard icon={Users}        label="Contactos creados"   value={status.stats.contactsCreated} color="amber" />
              <StatCard icon={CheckCircle2} label="Presupuestos aceptados" value={status.stats.totalAccepted} color="emerald" />
            </div>
          </div>

          {/* ── Último mensaje ── */}
          {lastMsg && (
            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                Último mensaje recibido
              </h2>
              <div className="rounded-lg bg-card/60 border border-border p-3 text-xs space-y-1.5">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Fecha:</span>
                  <span className="text-white">
                    {format(new Date(lastMsg.createdAt), "dd MMM yyyy, HH:mm:ss", { locale: es })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Resumen:</span>
                  <span className="text-sky-300">{lastMsg.summary}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Estado:</span>
                  <Badge className={cn(
                    "text-[10px]",
                    lastMsg.status === "processed"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/25",
                  )}>
                    {lastMsg.status}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* ── Log de eventos ── */}
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              Últimos 20 eventos
            </h2>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin eventos registrados</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {audit.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                      e.direction === "inbound"  ? "bg-sky-400"    :
                      e.direction === "outbound" ? "bg-violet-400" : "bg-muted-foreground",
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{e.summary}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {format(new Date(e.createdAt), "dd/MM HH:mm:ss")}
                        </span>
                        <Badge className="text-[9px] px-1 py-0 bg-card text-muted-foreground border-border">
                          {e.eventType}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
