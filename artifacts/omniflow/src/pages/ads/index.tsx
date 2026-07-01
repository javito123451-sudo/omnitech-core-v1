import { useState } from "react";
import { CreativeGeneratorModal, CreativeHistory, CreativeType } from "./CreativeStudio";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Plus, Loader2, Trash2, Play, Pause, CheckCircle2,
  Target, Eye, MousePointerClick, Users, TrendingUp, Sparkles,
  Image, Video, Layout, Film, Mail, MonitorPlay, ChevronRight,
  ChevronLeft, Wand2, Globe, ArrowRight, RefreshCw, X, Copy,
  BarChart3, Hash, Mic, Lightbulb, PenTool, ImagePlus, Search,
  Facebook, Instagram, Youtube, AlertCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface Campaign {
  id: number; org_id: number; name: string;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  business_name: string | null; business_type: string | null;
  product: string | null; target_audience: string | null;
  goal: string | null; budget: number | null;
  platforms: string[] | null; ai_content: AiContent | null;
  impressions: number; clicks: number; leads: number;
  conversions: number; roi: number; spend: number;
  created_at: string; launched_at: string | null;
}

interface AiContent {
  strategy: string; headlines: string[]; primaryText: string;
  callsToAction: string[]; imagePrompts: string[]; videoPrompts: string[];
  voiceoverScript: string; hashtags: string[];
  recommendedAudience: string; recommendedBudget: string; tips: string[];
}

interface Creative {
  id: number; campaign_id: number; org_id: number;
  type: string; platform: string | null; title: string | null;
  content: Record<string, unknown>; status: "draft" | "ready" | "published";
  created_at: string;
}

interface AudienceClient {
  id: number; name: string; email: string | null; phone: string | null;
  company: string | null; status: string; tags: string | null;
}

interface Segment { id: string; name: string; count: number; }

interface SummaryStats {
  total: number; active: number; draft: number; paused: number; completed: number;
  totalImpressions: number; totalClicks: number; totalLeads: number;
  totalConversions: number; totalSpend: number;
}

// ── Wizard state ──────────────────────────────────────────────────────────────
interface WizardForm {
  name:           string;
  businessName:   string;
  businessType:   string;
  product:        string;
  targetAudience: string;
  goal:           string;
  budget:         string;
  platforms:      string[];
}

const EMPTY_WIZARD: WizardForm = {
  name:           "", businessName: "", businessType: "",
  product:        "", targetAudience: "", goal: "sales",
  budget:         "", platforms:     [],
};

// ── Constants ─────────────────────────────────────────────────────────────────
const PLATFORMS = [
  { id: "facebook",  label: "Facebook",  color: "text-blue-400" },
  { id: "instagram", label: "Instagram", color: "text-pink-400" },
  { id: "tiktok",    label: "TikTok",    color: "text-slate-200" },
  { id: "google",    label: "Google Ads",color: "text-yellow-400" },
  { id: "linkedin",  label: "LinkedIn",  color: "text-blue-300" },
  { id: "email",     label: "Email",     color: "text-emerald-400" },
];

const GOALS = [
  { id: "sales",     label: "Ventas",          icon: "💰" },
  { id: "leads",     label: "Captación leads", icon: "🎯" },
  { id: "traffic",   label: "Tráfico web",     icon: "🌐" },
  { id: "awareness", label: "Reconocimiento",  icon: "📢" },
];

const CREATIVE_TYPES = [
  { type: "image",    label: "Imagen",    icon: Image,      desc: "Anuncio estático de alta calidad" },
  { type: "video",    label: "Video",     icon: Video,      desc: "Video corto hasta 60 segundos" },
  { type: "carousel", label: "Carrusel",  icon: Layout,     desc: "Hasta 10 imágenes deslizables" },
  { type: "reel",     label: "Reel",      icon: Film,       desc: "Video vertical formato Stories" },
  { type: "story",    label: "Story",     icon: MonitorPlay,desc: "Story de 15 segundos" },
  { type: "email",    label: "Email",     icon: Mail,       desc: "Campaña de email marketing" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador", active: "Activa", paused: "Pausada",
  completed: "Completada", archived: "Archivada",
};
const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-slate-500/15 text-slate-300 border-slate-500/25",
  active:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  paused:    "bg-amber-500/15 text-amber-400 border-amber-500/25",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  archived:  "bg-slate-600/15 text-slate-400 border-slate-600/25",
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-[#111827] border border-[#1e2d40] rounded-xl p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${color} shrink-0`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function CampaignCard({ campaign, onStatusChange, onDelete }: {
  campaign: Campaign;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const platforms: string[] = Array.isArray(campaign.platforms)
    ? campaign.platforms
    : (typeof campaign.platforms === "string" ? JSON.parse(campaign.platforms as string) : []);

  return (
    <div className="bg-[#111827] border border-[#1e2d40] rounded-xl p-4 hover:border-blue-500/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate">{campaign.name}</h3>
          {campaign.product && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">{campaign.product}</p>
          )}
        </div>
        <span className={`ml-2 shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOR[campaign.status] ?? STATUS_COLOR["draft"]}`}>
          {STATUS_LABEL[campaign.status] ?? campaign.status}
        </span>
      </div>

      {platforms.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-3">
          {platforms.map(p => (
            <span key={p} className="text-[10px] bg-[#1e2d40] text-slate-300 px-2 py-0.5 rounded-full">{p}</span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <p className="text-sm font-bold text-white">{fmt(campaign.impressions)}</p>
          <p className="text-[10px] text-slate-500">Impresiones</p>
        </div>
        <div>
          <p className="text-sm font-bold text-white">{fmt(campaign.clicks)}</p>
          <p className="text-[10px] text-slate-500">Clicks</p>
        </div>
        <div>
          <p className="text-sm font-bold text-white">{fmt(campaign.leads)}</p>
          <p className="text-[10px] text-slate-500">Leads</p>
        </div>
      </div>

      <div className="flex gap-2">
        {campaign.status === "draft" && (
          <button
            onClick={() => onStatusChange(campaign.id, "active")}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 rounded-lg py-1.5 transition-colors"
          >
            <Play size={12} /> Activar
          </button>
        )}
        {campaign.status === "active" && (
          <button
            onClick={() => onStatusChange(campaign.id, "paused")}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 rounded-lg py-1.5 transition-colors"
          >
            <Pause size={12} /> Pausar
          </button>
        )}
        {campaign.status === "paused" && (
          <button
            onClick={() => onStatusChange(campaign.id, "active")}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 rounded-lg py-1.5 transition-colors"
          >
            <Play size={12} /> Reanudar
          </button>
        )}
        {campaign.status !== "completed" && (
          <button
            onClick={() => onStatusChange(campaign.id, "completed")}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/25 hover:bg-blue-500/20 rounded-lg py-1.5 transition-colors"
          >
            <CheckCircle2 size={12} /> Completar
          </button>
        )}
        <button
          onClick={() => onDelete(campaign.id)}
          className="flex items-center justify-center text-xs bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 rounded-lg px-2 py-1.5 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ onNewCampaign }: { onNewCampaign: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: summary } = useQuery({
    queryKey: ["ads-summary"],
    queryFn: () => authFetch(`${BASE}/api/ads/summary`).then(r => r.json()) as Promise<{ stats: SummaryStats; recent: Campaign[] }>,
  });

  const { data: campaignsData, isLoading } = useQuery({
    queryKey: ["ads-campaigns"],
    queryFn: () => authFetch(`${BASE}/api/ads/campaigns`).then(r => r.json()) as Promise<{ campaigns: Campaign[] }>,
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      authFetch(`${BASE}/api/ads/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ads-campaigns"] }); qc.invalidateQueries({ queryKey: ["ads-summary"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/ads/campaigns/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ads-campaigns"] }); qc.invalidateQueries({ queryKey: ["ads-summary"] }); toast({ title: "Campaña eliminada" }); },
  });

  const s = summary?.stats;
  const campaigns = campaignsData?.campaigns ?? [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total campañas"  value={s?.total ?? 0}            icon={Megaphone}       color="bg-purple-500/15 text-purple-400" />
        <StatCard label="Activas"         value={s?.active ?? 0}           icon={Play}            color="bg-emerald-500/15 text-emerald-400" />
        <StatCard label="Impresiones"     value={fmt(s?.totalImpressions ?? 0)} icon={Eye}        color="bg-blue-500/15 text-blue-400" />
        <StatCard label="Clicks"          value={fmt(s?.totalClicks ?? 0)} icon={MousePointerClick}color="bg-cyan-500/15 text-cyan-400" />
        <StatCard label="Leads"           value={fmt(s?.totalLeads ?? 0)}  icon={Target}          color="bg-amber-500/15 text-amber-400" />
      </div>

      {/* Campaign grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Campañas</h2>
          <button
            onClick={onNewCampaign}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            <Plus size={14} /> Nueva campaña
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-400" size={28} /></div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border border-dashed border-[#1e2d40] rounded-xl">
            <Megaphone size={40} className="text-slate-600 mb-3" />
            <p className="text-slate-400 font-medium">Sin campañas todavía</p>
            <p className="text-slate-500 text-sm mt-1 mb-4">Crea tu primera campaña con IA</p>
            <button onClick={onNewCampaign} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors flex items-center gap-2">
              <Wand2 size={14} /> Crear con IA
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(c => (
              <CampaignCard
                key={c.id} campaign={c}
                onStatusChange={(id, status) => statusMut.mutate({ id, status })}
                onDelete={(id) => deleteMut.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI Content display ────────────────────────────────────────────────────────
function AiContentDisplay({ content, onClose }: { content: AiContent; onClose: () => void }) {
  const [section, setSection] = useState<"strategy" | "copy" | "creative" | "distribution">("strategy");
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado al portapapeles" });
  };

  return (
    <div className="bg-[#0d1320] border border-blue-500/30 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="text-blue-400" size={18} />
          <h3 className="font-semibold text-white">Contenido generado por IA</h3>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[
          { id: "strategy",     label: "Estrategia" },
          { id: "copy",         label: "Copy" },
          { id: "creative",     label: "Creativos" },
          { id: "distribution", label: "Distribución" },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id as typeof section)}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${section === s.id ? "bg-blue-600 text-white" : "bg-[#1e2d40] text-slate-300 hover:bg-[#253449]"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "strategy" && (
        <div className="space-y-3">
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={14} className="text-yellow-400" />
              <span className="text-xs font-medium text-yellow-400">Estrategia general</span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{content.strategy}</p>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-cyan-400">Audiencia recomendada</span>
            </div>
            <p className="text-sm text-slate-300">{content.recommendedAudience}</p>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={14} className="text-purple-400" />
              <span className="text-xs font-medium text-purple-400">Tips estratégicos</span>
            </div>
            <ul className="space-y-2">
              {content.tips.map((tip, i) => (
                <li key={i} className="text-sm text-slate-300 flex gap-2">
                  <span className="text-purple-400 shrink-0">•</span>{tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {section === "copy" && (
        <div className="space-y-3">
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PenTool size={14} className="text-blue-400" />
                <span className="text-xs font-medium text-blue-400">Titulares</span>
              </div>
              <button onClick={() => copyToClipboard(content.headlines.join("\n"))} className="text-slate-500 hover:text-slate-300"><Copy size={12} /></button>
            </div>
            <ul className="space-y-2">
              {content.headlines.map((h, i) => (
                <li key={i} className="text-sm text-white font-medium border-b border-[#1e2d40] last:border-0 pb-2 last:pb-0">
                  {i + 1}. {h}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PenTool size={14} className="text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">Texto principal</span>
              </div>
              <button onClick={() => copyToClipboard(content.primaryText)} className="text-slate-500 hover:text-slate-300"><Copy size={12} /></button>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{content.primaryText}</p>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target size={14} className="text-amber-400" />
              <span className="text-xs font-medium text-amber-400">Calls to action</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {content.callsToAction.map((cta, i) => (
                <span key={i} className="px-3 py-1.5 bg-amber-500/15 text-amber-300 border border-amber-500/25 rounded-lg text-sm font-medium">
                  {cta}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Hash size={14} className="text-pink-400" />
              <span className="text-xs font-medium text-pink-400">Hashtags</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {content.hashtags.map((h, i) => (
                <span key={i} className="text-sm text-pink-300">{h}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {section === "creative" && (
        <div className="space-y-3">
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <ImagePlus size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-cyan-400">Prompts para imágenes</span>
            </div>
            <ul className="space-y-3">
              {content.imagePrompts.map((p, i) => (
                <li key={i} className="text-sm text-slate-300 bg-[#1e2d40] rounded-lg p-3 flex gap-2">
                  <span className="text-cyan-400 shrink-0 font-bold">{i + 1}.</span>{p}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Film size={14} className="text-purple-400" />
              <span className="text-xs font-medium text-purple-400">Conceptos de video</span>
            </div>
            <ul className="space-y-3">
              {content.videoPrompts.map((p, i) => (
                <li key={i} className="text-sm text-slate-300 bg-[#1e2d40] rounded-lg p-3 flex gap-2">
                  <span className="text-purple-400 shrink-0 font-bold">{i + 1}.</span>{p}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-[#111827] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Mic size={14} className="text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">Script de locución</span>
              </div>
              <button onClick={() => copyToClipboard(content.voiceoverScript)} className="text-slate-500 hover:text-slate-300"><Copy size={12} /></button>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{content.voiceoverScript}</p>
          </div>
        </div>
      )}

      {section === "distribution" && (
        <div className="bg-[#111827] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-blue-400" />
            <span className="text-xs font-medium text-blue-400">Distribución de presupuesto</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{content.recommendedBudget}</p>
        </div>
      )}
    </div>
  );
}

// ── Wizard Tab ────────────────────────────────────────────────────────────────
function WizardTab({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep]           = useState(1);
  const [form, setForm]           = useState<WizardForm>(EMPTY_WIZARD);
  const [generating, setGenerating] = useState(false);
  const [aiContent, setAiContent] = useState<AiContent | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [error, setError]         = useState("");

  const totalSteps = 5;
  const pct = ((step - 1) / (totalSteps - 1)) * 100;

  const togglePlatform = (id: string) => {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(id)
        ? f.platforms.filter(p => p !== id)
        : [...f.platforms, id],
    }));
  };

  const createCampaign = async () => {
    try {
      const r = await authFetch(`${BASE}/api/ads/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           form.name || `Campaña ${new Date().toLocaleDateString("es-ES")}`,
          businessName:   form.businessName,
          businessType:   form.businessType,
          product:        form.product,
          targetAudience: form.targetAudience,
          goal:           form.goal,
          budget:         parseFloat(form.budget) || 0,
          platforms:      form.platforms,
        }),
      });
      const data = await r.json() as { campaign?: { id: number }; error?: string };
      if (!data.campaign) throw new Error(data.error ?? "Error creating campaign");
      return data.campaign.id;
    } catch (err) {
      throw err;
    }
  };

  const generateAI = async (id: number) => {
    setGenerating(true);
    setError("");
    try {
      const r = await authFetch(`${BASE}/api/ads/campaigns/${id}/generate`, { method: "POST" });
      const data = await r.json() as { content?: AiContent; error?: string };
      if (!data.content) throw new Error(data.error ?? "Error generating content");
      setAiContent(data.content);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleStep4 = async () => {
    try {
      let id = campaignId;
      if (!id) {
        id = await createCampaign();
        setCampaignId(id);
      }
      await generateAI(id);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleLaunch = async (status: "active" | "draft") => {
    if (!campaignId) return;
    await authFetch(`${BASE}/api/ads/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ["ads-campaigns"] });
    qc.invalidateQueries({ queryKey: ["ads-summary"] });
    toast({ title: status === "active" ? "¡Campaña activada!" : "Campaña guardada como borrador" });
    setForm(EMPTY_WIZARD);
    setStep(1);
    setAiContent(null);
    setCampaignId(null);
    onCreated();
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-white">Paso {step} de {totalSteps}</span>
          <span className="text-xs text-slate-400">{Math.round(pct)}% completado</span>
        </div>
        <div className="h-1.5 bg-[#1e2d40] rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-600 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          {["Info", "Objetivo", "Audiencia", "IA", "Lanzar"].map((label, i) => (
            <span key={label} className={`text-[10px] ${i + 1 <= step ? "text-blue-400" : "text-slate-600"}`}>{label}</span>
          ))}
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1e2d40] rounded-xl p-6">
        {/* Step 1: Información básica */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-1">Información de tu negocio</h2>
            <p className="text-sm text-slate-400 mb-4">Cuéntanos sobre tu empresa y producto</p>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Nombre de la campaña</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Black Friday 2025" className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Nombre de la empresa *</label>
              <input value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} placeholder="Ej: Mi Empresa S.L." className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Sector / Tipo de negocio *</label>
              <input value={form.businessType} onChange={e => setForm(f => ({ ...f, businessType: e.target.value }))} placeholder="Ej: Clínica estética, E-commerce, Consultoría..." className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Producto o servicio *</label>
              <textarea value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} rows={3} placeholder="Describe qué quieres promocionar..." className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
            </div>
          </div>
        )}

        {/* Step 2: Objetivo + Plataformas */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white mb-1">Objetivo y plataformas</h2>
              <p className="text-sm text-slate-400 mb-4">¿Qué quieres conseguir y dónde?</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-3">Objetivo de la campaña</label>
              <div className="grid grid-cols-2 gap-3">
                {GOALS.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setForm(f => ({ ...f, goal: g.id }))}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${form.goal === g.id ? "border-blue-500 bg-blue-500/10 text-white" : "border-[#1e2d40] text-slate-300 hover:border-[#2a3f5f]"}`}
                  >
                    <span className="text-xl">{g.icon}</span>
                    <span className="text-sm font-medium">{g.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-3">Plataformas (selecciona las que quieras)</label>
              <div className="grid grid-cols-2 gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => togglePlatform(p.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-colors ${form.platforms.includes(p.id) ? "border-blue-500 bg-blue-500/10 text-white" : "border-[#1e2d40] text-slate-300 hover:border-[#2a3f5f]"}`}
                  >
                    <Globe size={13} className={form.platforms.includes(p.id) ? "text-blue-400" : "text-slate-500"} />
                    {p.label}
                    {form.platforms.includes(p.id) && <CheckCircle2 size={12} className="ml-auto text-blue-400" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Audiencia + Presupuesto */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-1">Audiencia y presupuesto</h2>
            <p className="text-sm text-slate-400 mb-4">Define a quién te diriges y cuánto inviertes</p>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Audiencia objetivo *</label>
              <textarea value={form.targetAudience} onChange={e => setForm(f => ({ ...f, targetAudience: e.target.value }))} rows={4} placeholder="Ej: Mujeres de 25-45 años interesadas en belleza y bienestar, con poder adquisitivo medio-alto, ubicadas en España..." className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Presupuesto total (€)</label>
              <input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} placeholder="500" className="w-full bg-[#0d1320] border border-[#1e2d40] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        )}

        {/* Step 4: AI Generation */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Wand2 className="text-blue-400" size={20} />
              <h2 className="text-lg font-semibold text-white">Generación con IA</h2>
            </div>
            <p className="text-sm text-slate-400 mb-4">La IA creará toda la estrategia y contenido de tu campaña</p>

            {!aiContent && !generating && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/25 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="text-blue-400" size={28} />
                </div>
                <p className="text-white font-medium mb-2">Listo para generar</p>
                <p className="text-sm text-slate-400 mb-6">GPT-4o creará para ti: estrategia, titulares, textos, prompts de imagen, script de video, hashtags y más</p>
                {error && (
                  <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 mb-4 text-sm">
                    <AlertCircle size={14} />{error}
                  </div>
                )}
                <button
                  onClick={handleStep4}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium rounded-lg transition-all flex items-center gap-2 mx-auto"
                >
                  <Wand2 size={16} /> Generar con IA
                </button>
              </div>
            )}

            {generating && (
              <div className="text-center py-10">
                <div className="relative w-16 h-16 mx-auto mb-4">
                  <div className="w-16 h-16 border-2 border-blue-500/20 rounded-full" />
                  <div className="absolute inset-0 w-16 h-16 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <Sparkles className="absolute inset-0 m-auto text-blue-400" size={20} />
                </div>
                <p className="text-white font-medium">Generando estrategia completa…</p>
                <p className="text-sm text-slate-400 mt-1">GPT-4o está trabajando en tu campaña</p>
              </div>
            )}

            {aiContent && !generating && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-lg">
                  <CheckCircle2 className="text-emerald-400 shrink-0" size={16} />
                  <span className="text-sm text-emerald-300 font-medium">¡Contenido generado con éxito!</span>
                  <button
                    onClick={handleStep4}
                    className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                  >
                    <RefreshCw size={12} /> Regenerar
                  </button>
                </div>
                <AiContentDisplay content={aiContent} onClose={() => setAiContent(null)} />
              </div>
            )}
          </div>
        )}

        {/* Step 5: Review + Launch */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-1">Resumen y lanzamiento</h2>
            <p className="text-sm text-slate-400 mb-4">Revisa tu campaña antes de lanzarla</p>

            <div className="bg-[#0d1320] rounded-xl p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Nombre</span>
                <span className="text-sm text-white font-medium">{form.name || "Sin nombre"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Empresa</span>
                <span className="text-sm text-white">{form.businessName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Objetivo</span>
                <span className="text-sm text-white">{GOALS.find(g => g.id === form.goal)?.label ?? form.goal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Presupuesto</span>
                <span className="text-sm text-white">{form.budget ? `${form.budget}€` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Plataformas</span>
                <span className="text-sm text-white">{form.platforms.length > 0 ? form.platforms.join(", ") : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Contenido IA</span>
                <span className={`text-sm font-medium ${aiContent ? "text-emerald-400" : "text-amber-400"}`}>
                  {aiContent ? "✓ Generado" : "No generado"}
                </span>
              </div>
            </div>

            {!campaignId && (
              <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg text-sm text-amber-300">
                <AlertCircle size={14} className="shrink-0" />
                Debes generar el contenido IA en el paso anterior antes de lanzar.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => handleLaunch("draft")}
                disabled={!campaignId}
                className="flex items-center justify-center gap-2 py-2.5 bg-[#1e2d40] hover:bg-[#253449] text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Guardar borrador
              </button>
              <button
                onClick={() => handleLaunch("active")}
                disabled={!campaignId}
                className="flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={14} /> Lanzar campaña
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#1e2d40]">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="flex items-center gap-1 px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          {step < totalSteps && (
            <button
              onClick={() => {
                if (step === 3) { handleStep4(); }
                setStep(s => Math.min(totalSteps, s + 1));
              }}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              {step === 3 ? "Generar IA" : "Siguiente"} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Creatives Tab ─────────────────────────────────────────────────────────────
function CreativesTab() {
  const { data: campaignsData } = useQuery({
    queryKey: ["ads-campaigns"],
    queryFn: () => authFetch(`${BASE}/api/ads/campaigns`).then(r => r.json()) as Promise<{ campaigns: Campaign[] }>,
  });

  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [openType, setOpenType]                 = useState<CreativeType | null>(null);
  const campaigns = campaignsData?.campaigns ?? [];

  return (
    <div className="space-y-6">
      {/* Campaign selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 shrink-0">Campaña:</label>
        <select
          value={selectedCampaign ?? ""}
          onChange={e => setSelectedCampaign(e.target.value ? parseInt(e.target.value) : null)}
          className="bg-[#111827] border border-[#1e2d40] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
        >
          <option value="">Todas las campañas</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Creative type cards — clicables */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white">Estudio de creativos con IA</h3>
          <span className="text-[11px] text-slate-500 flex items-center gap-1">
            <Sparkles size={11} className="text-blue-400" /> Pulsa una tarjeta para crear
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {CREATIVE_TYPES.map(ct => {
            const Icon = ct.icon;
            return (
              <button
                key={ct.type}
                onClick={() => setOpenType(ct.type as CreativeType)}
                className="bg-[#111827] border border-[#1e2d40] rounded-xl p-4 text-left hover:border-blue-500/50 hover:bg-[#131d2e] active:scale-[0.98] transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-blue-500/10 group-hover:bg-blue-500/20 rounded-lg transition-colors">
                    <Icon size={18} className="text-blue-400" />
                  </div>
                  <Wand2 size={13} className="text-slate-600 group-hover:text-blue-400 transition-colors mt-0.5" />
                </div>
                <h4 className="font-semibold text-white text-sm">{ct.label}</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 mb-3">{ct.desc}</p>
                <div className="flex items-center justify-end">
                  <span className="text-[10px] bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full group-hover:from-blue-600/40 group-hover:to-purple-600/40 transition-colors">
                    Crear con IA
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* History */}
      <CreativeHistory campaignId={selectedCampaign} />

      {/* Modal */}
      {openType && (
        <CreativeGeneratorModal
          type={openType}
          campaignId={selectedCampaign}
          onClose={() => setOpenType(null)}
        />
      )}
    </div>
  );
}

// ── Audience Tab ──────────────────────────────────────────────────────────────
function AudienceTab() {
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["ads-audience"],
    queryFn: () => authFetch(`${BASE}/api/ads/audience`).then(r => r.json()) as Promise<{ clients: AudienceClient[]; segments: Segment[] }>,
  });

  const segments = data?.segments ?? [];
  const allClients = data?.clients ?? [];
  const filtered = allClients.filter(c => {
    const matchSeg = segment === "all" || c.status === segment || (segment === "active" && (c.status === "active" || c.status === "client"));
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase());
    return matchSeg && matchSearch;
  });

  return (
    <div className="space-y-5">
      {/* Segment cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {segments.map(s => (
          <button
            key={s.id}
            onClick={() => setSegment(s.id)}
            className={`p-4 rounded-xl border text-left transition-colors ${segment === s.id ? "border-blue-500 bg-blue-500/10" : "border-[#1e2d40] bg-[#111827] hover:border-[#2a3f5f]"}`}
          >
            <p className="text-2xl font-bold text-white">{s.count}</p>
            <p className="text-xs text-slate-400 mt-1">{s.name}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar contacto..."
          className="w-full bg-[#111827] border border-[#1e2d40] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Clients table */}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-400" size={24} /></div>
      ) : (
        <div className="bg-[#111827] border border-[#1e2d40] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2d40]">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden md:table-cell">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map(c => (
                <tr key={c.id} className="border-b border-[#1e2d40] last:border-0 hover:bg-[#0d1320] transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{c.name}</p>
                    {c.company && <p className="text-[11px] text-slate-500">{c.company}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden md:table-cell">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${c.status === "active" || c.status === "client" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : c.status === "lead" ? "bg-amber-500/15 text-amber-400 border-amber-500/25" : "bg-slate-500/15 text-slate-400 border-slate-500/25"}`}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">Sin contactos</td>
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <div className="px-4 py-2 border-t border-[#1e2d40] text-xs text-slate-500">
              Mostrando 50 de {filtered.length} contactos
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ads-analytics"],
    queryFn: () => authFetch(`${BASE}/api/ads/analytics`).then(r => r.json()) as Promise<{
      campaigns: Campaign[];
      totals: { impressions: number; clicks: number; leads: number; conversions: number; spend: number; ctr: number; cvr: number };
    }>,
  });

  const campaigns = data?.campaigns ?? [];
  const totals = data?.totals;

  return (
    <div className="space-y-5">
      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Impresiones totales" value={fmt(totals.impressions)} icon={Eye}              color="bg-blue-500/15 text-blue-400" />
          <StatCard label="Clicks totales"      value={fmt(totals.clicks)}      icon={MousePointerClick}color="bg-cyan-500/15 text-cyan-400" />
          <StatCard label="Leads totales"       value={fmt(totals.leads)}       icon={Target}          color="bg-amber-500/15 text-amber-400" />
          <StatCard label="Conversiones"        value={fmt(totals.conversions)} icon={TrendingUp}      color="bg-emerald-500/15 text-emerald-400" />
        </div>
      )}
      {totals && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#111827] border border-[#1e2d40] rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{totals.ctr}%</p>
            <p className="text-xs text-slate-400 mt-1">CTR (Click-through rate)</p>
          </div>
          <div className="bg-[#111827] border border-[#1e2d40] rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{totals.cvr}%</p>
            <p className="text-xs text-slate-400 mt-1">CVR (Conversión de clicks)</p>
          </div>
        </div>
      )}

      {/* Campaign performance table */}
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-3">Rendimiento por campaña</h3>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-400" size={24} /></div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[#1e2d40] rounded-xl">
            <BarChart3 size={32} className="text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">Sin datos de campañas todavía</p>
          </div>
        ) : (
          <div className="bg-[#111827] border border-[#1e2d40] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e2d40]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Campaña</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Impr.</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Clicks</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Leads</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Conv.</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => (
                    <tr key={c.id} className="border-b border-[#1e2d40] last:border-0 hover:bg-[#0d1320] transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-white font-medium truncate max-w-[160px]">{c.name}</p>
                        <p className="text-[11px] text-slate-500">{GOALS.find(g => g.id === c.goal)?.label ?? c.goal ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmt(c.impressions)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmt(c.clicks)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmt(c.leads)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmt(c.conversions)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLOR[c.status] ?? STATUS_COLOR["draft"]}`}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type Tab = "dashboard" | "wizard" | "creatives" | "audience" | "analytics";

export default function OmniAdsPage() {
  const [tab, setTab] = useState<Tab>("dashboard");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard",  label: "Dashboard",     icon: BarChart3 },
    { id: "wizard",     label: "Nueva Campaña", icon: Wand2 },
    { id: "creatives",  label: "Creativos",     icon: ImagePlus },
    { id: "audience",   label: "Audiencia",     icon: Users },
    { id: "analytics",  label: "Analíticas",    icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-[#0a0b14]">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#1e2d40]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl">
              <Megaphone size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">OmniAds</h1>
              <p className="text-xs text-slate-400">Centro de publicidad con inteligencia artificial</p>
            </div>
          </div>
          <button
            onClick={() => setTab("wizard")}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-all"
          >
            <Wand2 size={14} /> Nueva campaña
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-[#1e2d40] overflow-x-auto">
        <div className="flex gap-1 pt-2">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {tab === "dashboard"  && <DashboardTab onNewCampaign={() => setTab("wizard")} />}
        {tab === "wizard"     && <WizardTab onCreated={() => setTab("dashboard")} />}
        {tab === "creatives"  && <CreativesTab />}
        {tab === "audience"   && <AudienceTab />}
        {tab === "analytics"  && <AnalyticsTab />}
      </div>
    </div>
  );
}
