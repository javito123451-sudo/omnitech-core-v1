import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import {
  Megaphone, Mail, BarChart3, Users, Target, ArrowRight,
  TrendingUp, Send, Sparkles, Loader2, CheckCircle2, CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Campaign {
  id: number; name: string; status: "draft" | "active" | "paused" | "completed";
  channel: string; sent: number; opened: number; clicked: number;
  createdAt: string;
}

export default function MarketingHubPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"campaigns" | "audience" | "analytics">("campaigns");
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0b14]">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-500/15 border border-pink-500/25 flex items-center justify-center">
              <Megaphone size={20} className="text-pink-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Omni Marketing Hub</h1>
              <p className="text-slate-400 text-xs">Campañas, automatización y análisis de marketing</p>
            </div>
          </div>
          <button
            onClick={() => toast({ title: "Nueva campaña", description: "Funcionalidad en desarrollo — pronto disponible." })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium transition-all"
          >
            <Sparkles size={15} />
            Nueva campaña
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 bg-white/5 rounded-xl p-1 w-fit border border-white/10">
          {([
            { key: "campaigns" as const, label: "Campañas", icon: Send },
            { key: "audience" as const, label: "Audiencia", icon: Users },
            { key: "analytics" as const, label: "Análisis", icon: BarChart3 },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? "bg-pink-600/20 text-pink-300 border border-pink-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 pb-8">
        {tab === "campaigns" && <CampaignsTab />}
        {tab === "audience" && <AudienceTab />}
        {tab === "analytics" && <AnalyticsTab />}
      </div>
    </div>
  );
}

function CampaignsTab() {
  const campaigns: Campaign[] = [
    { id: 1, name: "Bienvenida nuevos leads", status: "active", channel: "Email", sent: 1240, opened: 876, clicked: 342, createdAt: "2026-06-15" },
    { id: 2, name: "Promoción verano 2026", status: "draft", channel: "Email + WhatsApp", sent: 0, opened: 0, clicked: 0, createdAt: "2026-06-28" },
    { id: 3, name: "Reactivación clientes", status: "paused", channel: "Email", sent: 3200, opened: 1450, clicked: 580, createdAt: "2026-05-10" },
  ];

  const statusColors: Record<string, string> = {
    draft:     "bg-slate-500/15 text-slate-400 border-slate-500/20",
    active:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    paused:    "bg-amber-500/15 text-amber-400 border-amber-500/20",
    completed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  };

  const statusLabels: Record<string, string> = {
    draft: "Borrador", active: "Activa", paused: "Pausada", completed: "Completada",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={Send} label="Campañas activas" value="1" trend="+1 este mes" color="pink" />
        <MetricCard icon={Mail} label="Emails enviados" value="4.440" trend="+12% vs mes anterior" color="blue" />
        <MetricCard icon={TrendingUp} label="Tasa de apertura" value="52%" trend="+3% vs mes anterior" color="emerald" />
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-white font-medium text-sm">Todas las campañas</h3>
          <span className="text-slate-500 text-xs">{campaigns.length} campañas</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {campaigns.map(c => (
            <div key={c.id} className="px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                  <Send size={15} className="text-pink-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{c.name}</p>
                  <p className="text-slate-500 text-xs">{c.channel} • {c.createdAt}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <p className="text-white text-xs font-medium">{c.sent.toLocaleString()}</p>
                  <p className="text-slate-500 text-[10px]">enviados</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-white text-xs font-medium">{c.opened.toLocaleString()}</p>
                  <p className="text-slate-500 text-[10px]">abiertos</p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-1 rounded-lg border ${statusColors[c.status]}`}>
                  {statusLabels[c.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AudienceTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={Users} label="Contactos totales" value="12.840" trend="+240 nuevos" color="violet" />
        <MetricCard icon={Target} label="Segmentos" value="8" trend="2 nuevos" color="amber" />
        <MetricCard icon={CheckCircle2} label="Tasa de engagement" value="34%" trend="+5% vs anterior" color="emerald" />
      </div>
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center">
        <Users size={32} className="text-slate-600 mx-auto mb-3" />
        <h3 className="text-white font-medium text-sm mb-1">Gestión de audiencia</h3>
        <p className="text-slate-500 text-xs max-w-md mx-auto">
          Segmenta tus contactos, crea listas personalizadas y sincroniza con tus campañas.
          Pronto disponible.
        </p>
      </div>
    </div>
  );
}

function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={BarChart3} label="Clics totales" value="922" trend="+18% vs mes anterior" color="blue" />
        <MetricCard icon={TrendingUp} label="Conversiones" value="124" trend="+8% vs mes anterior" color="emerald" />
        <MetricCard icon={CalendarDays} label="ROI estimado" value="3.2x" trend="+0.4x vs anterior" color="pink" />
      </div>
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center">
        <BarChart3 size={32} className="text-slate-600 mx-auto mb-3" />
        <h3 className="text-white font-medium text-sm mb-1">Análisis detallado</h3>
        <p className="text-slate-500 text-xs max-w-md mx-auto">
          Visualiza el rendimiento de tus campañas con gráficos interactivos, comparativas y predicciones.
          Pronto disponible.
        </p>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, trend, color }: {
  icon: React.ElementType; label: string; value: string; trend: string; color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    pink:    { bg: "bg-pink-500/10",    text: "text-pink-400",    border: "border-pink-500/20" },
    blue:    { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/20" },
    amber:   { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20" },
  };
  const c = colorMap[color] ?? colorMap.pink;
  return (
    <div className={`${c.bg} border ${c.border} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={c.text} />
        <span className="text-slate-400 text-xs">{label}</span>
      </div>
      <p className="text-white text-xl font-semibold">{value}</p>
      <p className="text-slate-500 text-[11px] mt-1">{trend}</p>
    </div>
  );
}
