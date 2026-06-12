import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  MessageCircle, CreditCard, Globe, Mail, CalendarDays, Hash,
  CheckCircle2, AlertCircle, Loader2, Plug, Unplug, FlaskConical,
  ChevronRight, Clock, ArrowDownLeft, ArrowUpRight, Puzzle,
  Send, RefreshCw, ClipboardList, Bot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface IntegrationItem {
  slug:         string;
  name:         string;
  category:     string;
  authType:     string;
  planRequired: string;
  description:  string;
  iconSlug:     string;
  connected:    boolean;
  status:       string;
  displayName:  string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  connectedAt:  string | null;
}

interface IntegrationDetail extends IntegrationItem {
  connection: {
    status:                string;
    displayName:           string | null;
    config:                Record<string, unknown> | null;
    lastSyncedAt:          string | null;
    errorMessage:          string | null;
    createdAt:             string;
    hasCredentials:        boolean;
    credentialKeysPresent: string[];
  } | null;
  events: EventRow[];
}

interface EventRow {
  id:        number;
  direction: string;
  eventType: string;
  status:    string;
  summary:   string | null;
  error:     string | null;
  createdAt: string;
}

// ── Static catalog metadata (UI only) ────────────────────────────────────────
interface FieldDef { key: string; label: string; type: string; placeholder: string; hint?: string }

const META: Record<string, {
  Icon:         React.ElementType;
  color:        string;
  bg:           string;
  border:       string;
  fields:       FieldDef[];
  webhookNote?: string;
}> = {
  whatsapp: {
    Icon: MessageCircle, color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/20",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID",   type: "text",     placeholder: "123456789012345", hint: "Meta Business › WhatsApp › Configuración" },
      { key: "accessToken",   label: "Access Token",      type: "password",  placeholder: "EAABwz..." },
      { key: "verifyToken",   label: "Verify Token",      type: "text",     placeholder: "omnitech-webhook", hint: "Token que configurarás en Meta Business" },
    ],
    webhookNote: "URL del webhook para Meta Business:",
  },
  stripe: {
    Icon: CreditCard, color: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/20",
    fields: [
      { key: "apiKey",        label: "API Key Secreta",   type: "password",  placeholder: "sk_live_..." },
      { key: "webhookSecret", label: "Webhook Secret",    type: "password",  placeholder: "whsec_..." },
    ],
    webhookNote: "URL del webhook para Stripe:",
  },
  webhook_outbound: {
    Icon: Globe, color: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20",
    fields: [
      { key: "url",    label: "URL del endpoint",       type: "url",      placeholder: "https://hooks.zapier.com/..." },
      { key: "secret", label: "HMAC Secret (opcional)", type: "password", placeholder: "mi-secret" },
    ],
  },
  gmail: {
    Icon: Mail, color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/20",
    fields: [],
  },
  google_calendar: {
    Icon: CalendarDays, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20",
    fields: [],
  },
  slack: {
    Icon: Hash, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20",
    fields: [],
  },
  telegram: {
    Icon: Bot, color: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/20",
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "123456789:AABBccDD...", hint: "Créalo en @BotFather → /newbot" },
    ],
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "Todas", communication: "Comunicación", calendar: "Calendario",
  payments: "Pagos", automation: "Automatización",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  message_received:    "Mensaje recibido",
  message_sent:        "Mensaje enviado",
  message_send_failed: "Envío fallido",
  quote_accepted:      "Presupuesto aceptado",
  quote_rejected:      "Presupuesto rechazado",
  test_sent:           "Prueba enviada",
  test_send_failed:    "Prueba fallida",
  test_ok:             "Test OK",
  test_failed:         "Test fallido",
  connected:           "Conectado",
  disconnected:        "Desconectado",
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-[10px]"><CheckCircle2 className="w-2.5 h-2.5 mr-1" />Conectado</Badge>;
  if (status === "error")
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px]"><AlertCircle className="w-2.5 h-2.5 mr-1" />Error</Badge>;
  return null;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IntegrationsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [items,         setItems]         = useState<IntegrationItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [category,      setCategory]      = useState("all");
  const [selected,      setSelected]      = useState<IntegrationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalTab,      setModalTab]      = useState<"config" | "events">("config");
  const [form,          setForm]          = useState<Record<string, string>>({});
  const [displayName,   setDisplayName]   = useState("");
  const [saving,        setSaving]        = useState(false);
  const [testing,       setTesting]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // WhatsApp test panel
  const [testPhone,     setTestPhone]     = useState("");
  const [sendingTest,   setSendingTest]   = useState(false);
  // Telegram panel
  const [tgVerifying,      setTgVerifying]      = useState(false);
  const [tgBotInfo,        setTgBotInfo]        = useState<string | null>(null);
  const [tgChatId,         setTgChatId]         = useState("");
  const [tgSending,        setTgSending]        = useState(false);
  const [tgSettingWebhook, setTgSettingWebhook] = useState(false);
  const [tgWebhookUrl,     setTgWebhookUrl]     = useState<string | null>(null);
  const [tgWebhookError,   setTgWebhookError]   = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/integrations`);
      const data = await res.json() as IntegrationItem[];
      setItems(data);
    } catch {
      toast({ title: "Error cargando integraciones", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadList(); }, [loadList]);

  const openDetail = useCallback(async (slug: string) => {
    setDetailLoading(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/integrations/${slug}`);
      const data = await res.json() as IntegrationDetail;
      setSelected(data);
    } catch {
      toast({ title: "Error cargando detalle", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const openModal = (slug: string) => {
    setModalTab("config");
    setForm({});
    setDisplayName("");
    setTestPhone("");
    setTgBotInfo(null);
    setTgChatId("");
    setTgWebhookUrl(null);
    setTgWebhookError(null);
    void openDetail(slug);
    if (slug === "telegram") {
      void authFetch(`${BASE_URL}/api/telegram/webhook-info`)
        .then((r) => r.json())
        .then((d: unknown) => {
          const data = d as { registered: boolean; url: string | null; lastError: string | null };
          if (data.registered && data.url) setTgWebhookUrl(data.url);
          if (data.lastError) setTgWebhookError(data.lastError);
        })
        .catch(() => {/**/});
    }
  };

  const refreshEvents = () => {
    if (selected) void openDetail(selected.slug);
  };

  const handleConnect = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await authFetch(`${BASE_URL}/api/integrations/${selected.slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: form, displayName: displayName || undefined }),
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      toast({ title: `${selected.name} conectado`, description: "Credenciales guardadas correctamente." });
      setSelected(null);
      await loadList();
    } catch (err) {
      toast({ title: "Error al conectar", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!selected) return;
    setDisconnecting(true);
    try {
      await authFetch(`${BASE_URL}/api/integrations/${selected.slug}/disconnect`, { method: "DELETE" });
      toast({ title: `${selected.name} desconectado` });
      setSelected(null);
      await loadList();
    } catch {
      toast({ title: "Error al desconectar", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTest = async () => {
    if (!selected) return;
    setTesting(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/integrations/${selected.slug}/test`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; duration_ms: number };
      toast({
        title:       data.success ? "✅ Test exitoso" : "⚠️ Test fallido",
        description: `${data.message}${data.duration_ms ? ` (${data.duration_ms}ms)` : ""}`,
        variant:     data.success ? "default" : "destructive",
      });
      void openDetail(selected.slug);
    } catch {
      toast({ title: "Error en el test", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleTelegramSetWebhook = async () => {
    setTgSettingWebhook(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/telegram/set-webhook`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; webhookUrl?: string };
      if (data.success && data.webhookUrl) {
        setTgWebhookUrl(data.webhookUrl);
        setTgWebhookError(null);
        toast({ title: "✅ Webhook registrado", description: "Telegram enviará los mensajes a OmniTech." });
      } else {
        toast({ title: "⚠️ Error registrando webhook", description: data.message, variant: "destructive" });
      }
      void openDetail("telegram");
    } catch {
      toast({ title: "Error al registrar webhook", variant: "destructive" });
    } finally {
      setTgSettingWebhook(false);
    }
  };

  const handleTelegramVerify = async () => {
    setTgVerifying(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/telegram/verify`, { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; botName?: string; botUser?: string };
      if (data.success) {
        setTgBotInfo(`${data.botName ?? ""} ${data.botUser ?? ""}`.trim());
        toast({ title: "✅ Bot verificado", description: data.message });
      } else {
        toast({ title: "⚠️ Verificación fallida", description: data.message, variant: "destructive" });
      }
      void openDetail("telegram");
    } catch {
      toast({ title: "Error verificando bot", variant: "destructive" });
    } finally {
      setTgVerifying(false);
    }
  };

  const handleTelegramTestSend = async () => {
    if (!tgChatId.trim()) return;
    setTgSending(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/telegram/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: tgChatId }),
      });
      const data = await res.json() as { success: boolean; message: string };
      toast({
        title:       data.success ? "✅ Mensaje enviado" : "⚠️ Error al enviar",
        description: data.message,
        variant:     data.success ? "default" : "destructive",
      });
      void openDetail("telegram");
      if (data.success) setModalTab("events");
    } catch {
      toast({ title: "Error al enviar prueba", variant: "destructive" });
    } finally {
      setTgSending(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!selected || !testPhone.trim()) return;
    setSendingTest(true);
    try {
      const res  = await authFetch(`${BASE_URL}/api/whatsapp/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone }),
      });
      const data = await res.json() as { success: boolean; messageId?: string; error?: string; credSource?: string };
      if (data.success) {
        toast({
          title:       "✅ Mensaje de prueba enviado",
          description: `ID: ${data.messageId ?? "—"} · Credenciales: ${data.credSource ?? "—"}`,
        });
        void openDetail(selected.slug);
        setModalTab("events");
      } else {
        toast({ title: "Error al enviar prueba", description: data.error ?? "Error desconocido", variant: "destructive" });
        void openDetail(selected.slug);
      }
    } catch {
      toast({ title: "Error de red al enviar prueba", variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  };

  const filtered = category === "all"
    ? items
    : items.filter((i) => i.category === category);

  const categories = ["all", ...Array.from(new Set(items.map((i) => i.category)))];
  const isOAuth    = (slug: string) => ["gmail", "google_calendar", "slack"].includes(slug);
  const selectedMeta = selected ? (META[selected.slug] ?? null) : null;

  const webhookUrl   = selected
    ? (selected.slug === "whatsapp"
        ? `${window.location.origin}${BASE_URL}/api/whatsapp/webhook`
        : `${window.location.origin}${BASE_URL}/api/integrations/${selected.slug}/inbound`)
    : "";

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Puzzle className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Integraciones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Conecta herramientas externas con OmniTech Core
          </p>
        </div>
      </div>

      {/* ── Category filter ─────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
              category === cat
                ? "bg-primary/15 text-primary border-primary/25"
                : "text-muted-foreground border-border hover:bg-white/5 hover:text-foreground",
            )}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => {
            const m    = META[item.slug];
            const Icon = m?.Icon ?? Globe;
            return (
              <Card
                key={item.slug}
                onClick={() => openModal(item.slug)}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary/30 hover:bg-card/80 group",
                  item.status === "active" && "border-green-500/20",
                  item.status === "error"  && "border-red-500/20",
                )}
              >
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border",
                      m?.bg ?? "bg-muted/30", m?.border ?? "border-border",
                    )}>
                      <Icon className={cn("w-4 h-4", m?.color ?? "text-muted-foreground")} />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {item.planRequired !== "free" && (
                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">
                          {item.planRequired.toUpperCase()}
                        </Badge>
                      )}
                      <StatusBadge status={item.status} />
                    </div>
                  </div>

                  <div>
                    <div className="font-semibold text-sm text-foreground">{item.name}</div>
                    {item.displayName && (
                      <div className="text-[11px] text-primary/70 mt-0.5 truncate">{item.displayName}</div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/50">
                    <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                      {item.connected ? "Configurar" : isOAuth(item.slug) ? "Ver info" : "Conectar"}
                      <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Detail Modal ────────────────────────────────────────────────── */}
      <Dialog open={!!selected || detailLoading} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">

          {detailLoading || !selected ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <>
              <DialogHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", selectedMeta?.bg, selectedMeta?.border)}>
                    {selectedMeta && <selectedMeta.Icon className={cn("w-5 h-5", selectedMeta.color)} />}
                  </div>
                  <div>
                    <DialogTitle className="text-base">{selected.name}</DialogTitle>
                    <DialogDescription className="text-xs mt-0.5">{selected.description}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-border -mx-1">
                {(["config", "events"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setModalTab(tab)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2",
                      modalTab === tab
                        ? "text-primary border-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    )}
                  >
                    {tab === "config"
                      ? "Configuración"
                      : `Eventos${selected.events.length > 0 ? ` (${selected.events.length})` : ""}`
                    }
                  </button>
                ))}
              </div>

              {/* ── Config tab ──────────────────────────────────────────── */}
              {modalTab === "config" && (
                <div className="space-y-4 pt-1">

                  {/* Connection status banner */}
                  {selected.connection?.status === "active" && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Conectado{selected.connection.displayName ? ` como ${selected.connection.displayName}` : ""}
                        {selected.connection.createdAt
                          ? ` · ${new Date(selected.connection.createdAt).toLocaleDateString("es-ES")}`
                          : ""}
                      </span>
                    </div>
                  )}

                  {selected.connection?.errorMessage && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{selected.connection.errorMessage}</span>
                    </div>
                  )}

                  {/* OAuth — not yet */}
                  {isOAuth(selected.slug) ? (
                    <div className="p-4 rounded-lg bg-muted/30 border border-border text-center space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">OAuth 2.0 — Próximamente</div>
                      <p className="text-xs text-muted-foreground">
                        La conexión con {selected.name} requiere OAuth y estará disponible en la Fase 3 de integraciones.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Credential form */}
                      {(selectedMeta?.fields ?? []).length > 0 && (
                        <div className="space-y-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Credenciales
                          </div>
                          {(selectedMeta?.fields ?? []).map((field) => (
                            <div key={field.key} className="space-y-1">
                              <label className="text-xs font-medium text-foreground">{field.label}</label>
                              <input
                                type={field.type === "password" ? "password" : "text"}
                                placeholder={
                                  selected.connection?.credentialKeysPresent.includes(field.key)
                                    ? "••••••••  (guardado — escribe para cambiar)"
                                    : field.placeholder
                                }
                                value={form[field.key] ?? ""}
                                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                              />
                              {field.hint && <p className="text-[10px] text-muted-foreground">{field.hint}</p>}
                            </div>
                          ))}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-foreground">Nombre de visualización (opcional)</label>
                            <input
                              type="text"
                              placeholder="Ej: +34 612 345 678, mi@email.com"
                              value={displayName}
                              onChange={(e) => setDisplayName(e.target.value)}
                              className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                          </div>
                        </div>
                      )}

                      {/* Webhook URL info */}
                      {selectedMeta?.webhookNote && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground">{selectedMeta.webhookNote}</div>
                          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border">
                            <code className="text-[11px] text-primary/80 flex-1 truncate font-mono">{webhookUrl}</code>
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(webhookUrl);
                                toast({ title: "URL copiada al portapapeles" });
                              }}
                              className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                            >
                              Copiar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Main actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => void handleConnect()}
                          disabled={saving}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                          {selected.connected ? "Actualizar" : "Conectar"}
                        </button>

                        {selected.connected && (
                          <>
                            <button
                              onClick={() => void handleTest()}
                              disabled={testing}
                              title="Verificar credenciales"
                              className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => void handleDisconnect()}
                              disabled={disconnecting}
                              title="Desconectar integración"
                              className="px-3 py-2 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            >
                              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                      </div>

                      {/* ── WhatsApp audit link ──────────────────────── */}
                      {selected.slug === "whatsapp" && (
                        <div className="pt-2">
                          <button
                            onClick={() => { setSelected(null); setLocation("/integrations/whatsapp/logs"); }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ClipboardList className="w-3.5 h-3.5 text-primary/70" />
                              <span>Ver auditoría de mensajes</span>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* ── Telegram panel — only when connected ─────── */}
                      {selected.slug === "telegram" && selected.connected && (
                        <div className="space-y-4 pt-3 border-t border-border">

                          {/* ── 1. Verify bot ── */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-sky-400" />
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Verificar bot
                              </span>
                            </div>
                            {tgBotInfo && (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Bot activo: <strong>{tgBotInfo}</strong></span>
                              </div>
                            )}
                            <button
                              onClick={() => void handleTelegramVerify()}
                              disabled={tgVerifying}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-sky-600/80 hover:bg-sky-600 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                            >
                              {tgVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                              Verificar Bot Token
                            </button>
                          </div>

                          {/* ── 2. Register webhook ── */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5 text-sky-400" />
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Webhook de entrada
                              </span>
                            </div>
                            {tgWebhookUrl ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span className="font-medium">Webhook activo — recibiendo mensajes</span>
                                </div>
                                <div className="px-3 py-2 rounded-lg bg-muted/20 border border-border/50 text-[10px] text-muted-foreground break-all font-mono">
                                  {tgWebhookUrl}
                                </div>
                                {tgWebhookError && (
                                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>Último error: {tgWebhookError}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Registra el webhook para que Telegram envíe los mensajes entrantes a OmniTech. Sin esto el bot no responde.
                              </p>
                            )}
                            <button
                              onClick={() => void handleTelegramSetWebhook()}
                              disabled={tgSettingWebhook}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-sm font-medium disabled:opacity-50 transition-colors"
                            >
                              {tgSettingWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                              {tgWebhookUrl ? "Volver a registrar webhook" : "Registrar webhook"}
                            </button>
                          </div>

                          {/* ── 3. Test send ── */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Send className="w-3.5 h-3.5 text-sky-400" />
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Mensaje de prueba
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Envía tu Chat ID para recibir un mensaje de prueba. Consíguelo enviando <code className="bg-muted px-1 rounded text-[10px]">/start</code> a{" "}
                              <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-sky-400 underline">@userinfobot</a>.
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="123456789"
                                value={tgChatId}
                                onChange={(e) => setTgChatId(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && tgChatId.trim()) void handleTelegramTestSend(); }}
                                className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                              />
                              <button
                                onClick={() => void handleTelegramTestSend()}
                                disabled={tgSending || !tgChatId.trim()}
                                className="px-4 py-2 rounded-md bg-sky-600/80 hover:bg-sky-600 text-white text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                              >
                                {tgSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                Enviar
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── WhatsApp test panel — only when connected ──── */}
                      {selected.slug === "whatsapp" && selected.connected && (
                        <div className="space-y-3 pt-3 border-t border-border">
                          <div className="flex items-center gap-1.5">
                            <Send className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Panel de prueba
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Envía un mensaje real a un número registrado en tu cuenta de Meta Business para verificar que la integración funciona.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="tel"
                              placeholder="+34612345678"
                              value={testPhone}
                              onChange={(e) => setTestPhone(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && testPhone.trim()) void handleSendTestMessage(); }}
                              className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-green-500/40"
                            />
                            <button
                              onClick={() => void handleSendTestMessage()}
                              disabled={sendingTest || !testPhone.trim()}
                              className="px-4 py-2 rounded-md bg-green-600/80 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                            >
                              {sendingTest
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Send className="w-4 h-4" />
                              }
                              Enviar
                            </button>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            ⚠️ El número debe estar previamente aprobado en Meta Business para recibir mensajes de prueba.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Events tab ──────────────────────────────────────────── */}
              {modalTab === "events" && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">
                      {selected.events.length > 0
                        ? `${selected.events.length} evento${selected.events.length !== 1 ? "s" : ""} recientes`
                        : "Sin eventos registrados aún"}
                    </span>
                    <button
                      onClick={refreshEvents}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Actualizar
                    </button>
                  </div>

                  {selected.events.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Los eventos aparecerán aquí cuando se procesen mensajes.
                    </div>
                  ) : (
                    selected.events.map((ev) => (
                      <div
                        key={ev.id}
                        className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg border text-xs",
                          ev.status === "error"
                            ? "bg-red-500/5 border-red-500/20"
                            : "bg-muted/20 border-border/50",
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {ev.direction === "inbound"
                            ? <ArrowDownLeft className="w-3.5 h-3.5 text-blue-400" />
                            : <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">
                              {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                            </span>
                            {ev.status === "error" && (
                              <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px]">error</Badge>
                            )}
                            {ev.status === "processed" && ev.eventType.includes("accept") && (
                              <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-[10px]">✓</Badge>
                            )}
                          </div>
                          {ev.summary && (
                            <p className="text-muted-foreground mt-0.5 line-clamp-2">{ev.summary}</p>
                          )}
                          {ev.error && (
                            <p className="text-red-400 mt-0.5 text-[10px] line-clamp-2">{ev.error}</p>
                          )}
                        </div>
                        <div className="text-muted-foreground shrink-0 flex items-center gap-1 text-[10px] whitespace-nowrap">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(ev.createdAt).toLocaleString("es-ES", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
