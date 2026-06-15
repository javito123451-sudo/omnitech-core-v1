import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Plug, MessageSquare, Bot, Mail, CreditCard, Lock, Shield,
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  ExternalLink, Copy, Check,
} from "lucide-react";
import { useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface IntegrationInfo {
  name: string; configured: boolean;
  orgsActive?: number; orgsTotal?: number;
  warning: string | null;
}

interface IntegrationsData {
  platform: {
    whatsapp:   IntegrationInfo;
    telegram:   IntegrationInfo;
    resend:     IntegrationInfo;
    stripe:     IntegrationInfo;
    openai:     IntegrationInfo;
    encryption: IntegrationInfo;
  };
  webhookBase: string | null;
  warnings: string[];
}

const INTEGRATION_META: Record<string, { icon: React.ElementType; color: string; bg: string; border: string; description: string }> = {
  whatsapp:   { icon: MessageSquare, color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20",  description: "Mensajería y automatizaciones con clientes" },
  telegram:   { icon: Bot,           color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20",   description: "Bot de notificaciones y acciones remotas" },
  resend:     { icon: Mail,          color: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/20",   description: "Envío de emails de invitación y notificación" },
  stripe:     { icon: CreditCard,    color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20", description: "Pagos y subscripciones de workspaces" },
  openai:     { icon: Bot,           color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", description: "Motor de IA para chat, importación y análisis" },
  encryption: { icon: Lock,          color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20",  description: "Cifrado AES-256 para tokens almacenados" },
};

function WebhookUrl({ label, path, base }: { label: string; path: string; base: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${base}${path}`;
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="flex items-center gap-2 bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <p className="text-white text-xs font-mono truncate">{url}</p>
      </div>
      <button onClick={copy} className="text-slate-500 hover:text-white transition-all flex-shrink-0">
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function IntegrationCard({ slug, info }: { slug: string; info: IntegrationInfo }) {
  const meta  = INTEGRATION_META[slug];
  if (!meta) return null;
  const Icon  = meta.icon;
  const hasOrgs = info.orgsActive !== undefined;

  return (
    <div className={`bg-[#0d0e1e] border rounded-2xl p-5 transition-all ${info.configured ? "border-white/[0.06]" : "border-red-500/10"}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bg} border ${meta.border}`}>
          <Icon size={20} className={meta.color} />
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
          info.configured
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            : "bg-red-500/10 text-red-400 border border-red-500/20"
        }`}>
          {info.configured
            ? <><CheckCircle2 size={11} /> Configurado</>
            : <><XCircle size={11} /> Sin configurar</>
          }
        </span>
      </div>

      <h3 className="text-white font-semibold text-sm mb-1">{info.name}</h3>
      <p className="text-slate-500 text-xs mb-4">{meta.description}</p>

      {hasOrgs && (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${info.orgsTotal! > 0 ? (info.orgsActive! / info.orgsTotal!) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 flex-shrink-0">
            {info.orgsActive}/{info.orgsTotal} orgs
          </span>
        </div>
      )}

      {info.warning && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-300 text-xs">{info.warning}</p>
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<IntegrationsData>({
    queryKey: ["cc-integrations"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/integrations`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-violet-400" /></div>;
  }

  const platform = data?.platform;
  const warnings = data?.warnings ?? [];
  const webhookBase = data?.webhookBase;

  const configuredCount = platform
    ? Object.values(platform).filter(i => i.configured).length
    : 0;
  const totalCount = platform ? Object.keys(platform).length : 0;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Plug size={24} className="text-violet-400" /> Integraciones
          </h1>
          <p className="text-slate-500 mt-1">
            {configuredCount}/{totalCount} servicios configurados
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      {/* Warnings banner */}
      {warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 mb-8">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-300 font-semibold text-sm mb-2">{warnings.length} advertencia{warnings.length !== 1 ? "s" : ""} detectada{warnings.length !== 1 ? "s" : ""}</p>
              <ul className="space-y-1">
                {warnings.map(w => (
                  <li key={w} className="text-amber-400/80 text-xs flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Integration cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {platform && Object.entries(platform).map(([slug, info]) => (
          <IntegrationCard key={slug} slug={slug} info={info} />
        ))}
      </div>

      {/* Webhook URLs */}
      {webhookBase && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6 mb-6">
          <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
            <ExternalLink size={16} className="text-violet-400" /> URLs de Webhook
          </h2>
          <p className="text-slate-500 text-xs mb-4">Configura estas URLs en los paneles de cada plataforma</p>
          <div className="space-y-3">
            <WebhookUrl label="WhatsApp Webhook (Meta)"  path="/api/whatsapp/webhook"          base={webhookBase} />
            <WebhookUrl label="Telegram Webhook"         path="/api/telegram/webhook/:secret"  base={webhookBase} />
            <WebhookUrl label="Stripe Webhook"           path="/api/stripe/webhook"            base={webhookBase} />
          </div>
        </div>
      )}

      {/* Integration status table */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Shield size={15} className="text-violet-400" /> Estado de Seguridad de Integraciones
          </h2>
        </div>
        <div className="p-6 space-y-3">
          {[
            {
              label: "Cifrado de tokens en DB",
              detail: platform?.encryption.configured
                ? "Tokens cifrados con AES-256 (INTEGRATION_ENCRYPTION_KEY)"
                : "Tokens almacenados en Base64 sin cifrado real",
              ok: !!platform?.encryption.configured,
              warn: !platform?.encryption.configured,
            },
            {
              label: "WhatsApp Verify Token",
              detail: platform?.whatsapp.warning
                ? platform.whatsapp.warning
                : "Verify token configurado correctamente",
              ok: !platform?.whatsapp.warning,
              warn: !!platform?.whatsapp.warning,
            },
            {
              label: "API Keys de terceros",
              detail: `${configuredCount}/${totalCount} servicios con credenciales configuradas`,
              ok: configuredCount >= totalCount * 0.7,
              warn: configuredCount < totalCount,
            },
            {
              label: "Webhooks con autenticación",
              detail: "WhatsApp usa verify token · Telegram usa URL secret · Stripe requiere webhook secret",
              ok: true,
              warn: false,
            },
          ].map(item => (
            <div key={item.label} className="flex items-start gap-3 py-3 border-b border-white/[0.04] last:border-0">
              {item.ok
                ? <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                : item.warn
                  ? <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  : <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              }
              <div className="flex-1">
                <p className={`text-sm font-medium ${item.ok ? "text-white" : item.warn ? "text-amber-300" : "text-red-300"}`}>{item.label}</p>
                <p className="text-slate-500 text-xs mt-0.5">{item.detail}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${item.ok ? "bg-emerald-500/10 text-emerald-400" : item.warn ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>
                {item.ok ? "OK" : item.warn ? "Advertencia" : "Error"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
