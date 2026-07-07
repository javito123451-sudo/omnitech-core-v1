import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Send, Users, BarChart3, TrendingUp, Mail, Plus, Loader2,
  MoreHorizontal, Copy, Trash2, Play, CheckCircle2, X,
  Target, Zap, Eye, MousePointerClick, CalendarDays,
  AlertCircle, AlertTriangle, Clock, FileText, Phone,
  CheckCheck, XCircle,
} from "lucide-react";
import { PortalDropdown, PortalDropdownItem } from "@/components/ui/PortalDropdown";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
type CampaignStatus =
  | "draft" | "active" | "paused" | "sending"
  | "sent"  | "sent_with_errors" | "completed" | "error";

interface Campaign {
  id: number; org_id: number; name: string;
  status: CampaignStatus;
  channel: string; subject: string | null; body: string | null;
  audience_filter: string;
  sent_count: number; failed_count: number;
  opened_count: number; clicked_count: number;
  created_at: string; updated_at: string;
  sent_at: string | null;
}

interface AudienceClient {
  id: number; name: string; email: string | null; phone: string | null;
  company: string | null; status: string; tags: string | null;
  leadScore: string | null; createdAt: string;
}

interface Segment { id: string; name: string; count: number; }

interface SendLog {
  id: number; client_id: number | null; client_name: string | null;
  phone_raw: string | null; phone_normalized: string | null;
  status: "sent" | "failed" | "skipped";
  message_id: string | null; error_message: string | null;
  meta_http_status: number | null; sent_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  draft:            "Borrador",
  active:           "Activa",
  paused:           "Pausada",
  sending:          "Enviando…",
  sent:             "Enviada",
  sent_with_errors: "Con errores",
  completed:        "Completada",
  error:            "Error",
};
const STATUS_COLOR: Record<string, string> = {
  draft:            "bg-slate-500/15 text-slate-300 border-slate-500/25",
  active:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  paused:           "bg-amber-500/15 text-amber-400 border-amber-500/25",
  sending:          "bg-blue-500/15 text-blue-300 border-blue-500/25",
  sent:             "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  sent_with_errors: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  completed:        "bg-blue-500/15 text-blue-400 border-blue-500/25",
  error:            "bg-rose-500/15 text-rose-400 border-rose-500/25",
};
const CHANNEL_LABEL: Record<string, string> = {
  email: "Email", whatsapp: "WhatsApp", both: "Email + WhatsApp", sms: "SMS",
};
const STATUS_CLIENT_COLOR: Record<string, string> = {
  active:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  client:   "bg-blue-500/15 text-blue-400 border-blue-500/20",
  lead:     "bg-amber-500/15 text-amber-400 border-amber-500/20",
  inactive: "bg-slate-500/15 text-slate-400 border-slate-500/20",
};

function pct(num: number, den: number) {
  if (den === 0) return "0%";
  return (num / den * 100).toFixed(1) + "%";
}

function isSendingStatus(s: CampaignStatus) {
  return s === "sending";
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MarketingHubPage() {
  const [tab, setTab] = useState<"campaigns" | "audience" | "analytics">("campaigns");
  const [showModal,    setShowModal]    = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);

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
              <p className="text-slate-400 text-xs">Campañas, audiencias y análisis de marketing</p>
            </div>
          </div>
          <button
            onClick={() => { setEditCampaign(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium transition-all"
          >
            <Plus size={15} />
            Nueva campaña
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 bg-white/5 rounded-xl p-1 w-fit border border-white/10">
          {([
            { key: "campaigns" as const, label: "Campañas",  icon: Send },
            { key: "audience"  as const, label: "Audiencia", icon: Users },
            { key: "analytics" as const, label: "Análisis",  icon: BarChart3 },
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
        {tab === "campaigns" && (
          <CampaignsTab
            onNew={() => { setEditCampaign(null); setShowModal(true); }}
            onEdit={c  => { setEditCampaign(c);   setShowModal(true); }}
            onReport={c => setReportCampaign(c)}
          />
        )}
        {tab === "audience"  && <AudienceTab />}
        {tab === "analytics" && <AnalyticsTab />}
      </div>

      {/* Modals */}
      {showModal && (
        <CampaignModal
          existing={editCampaign}
          onClose={() => setShowModal(false)}
        />
      )}
      {reportCampaign && (
        <ReportModal
          campaign={reportCampaign}
          onClose={() => setReportCampaign(null)}
        />
      )}
    </div>
  );
}

// ── Campaigns Tab ─────────────────────────────────────────────────────────────
function CampaignsTab({
  onNew, onEdit, onReport,
}: {
  onNew: () => void;
  onEdit: (c: Campaign) => void;
  onReport: (c: Campaign) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketing-campaigns"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/marketing/campaigns`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { campaigns: Campaign[] };
    },
    // Auto-refresh while any campaign is in "sending" state
    refetchInterval: (query) => {
      const campaigns = (query.state.data as { campaigns: Campaign[] } | undefined)?.campaigns ?? [];
      return campaigns.some(c => isSendingStatus(c.status)) ? 3000 : false;
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`${BASE}/api/marketing/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); toast({ title: "Campaña eliminada" }); },
    onError:   e  => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const dupMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`${BASE}/api/marketing/campaigns/${id}/duplicate`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); toast({ title: "Campaña duplicada" }); },
    onError:   e  => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const launchMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`${BASE}/api/marketing/campaigns/${id}/launch`, { method: "POST" });
      const d = await r.json() as { ok?: boolean; queued?: boolean; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Error desconocido");
      return d;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
      toast({ title: "📤 Campaña en proceso de envío", description: "El estado se actualizará automáticamente" });
      void id;
    },
    onError: e => toast({ title: "Error al lanzar campaña", description: String(e), variant: "destructive" }),
  });

  const launchingId = launchMut.isPending ? (launchMut.variables as number) : null;
  const campaigns   = data?.campaigns ?? [];
  const active      = campaigns.filter(c => c.status === "active" || c.status === "sending").length;
  const totalSent   = campaigns.reduce((s, c) => s + c.sent_count, 0);
  const avgOpen     = campaigns.length > 0
    ? pct(campaigns.reduce((s, c) => s + c.opened_count, 0), totalSent || 1)
    : "—";

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard icon={Send}      label="Campañas activas"  value={String(active)}              trend={`${campaigns.length} en total`} color="pink" />
        <MetricCard icon={Mail}      label="Mensajes enviados" value={totalSent.toLocaleString()}   trend="acumulado"                      color="blue" />
        <MetricCard icon={TrendingUp} label="Tasa de apertura" value={avgOpen}                     trend="promedio campañas"              color="emerald" />
      </div>

      {/* Table */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-white font-medium text-sm">Todas las campañas</h3>
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600/15 hover:bg-pink-600/25 text-pink-400 text-xs font-medium transition-all border border-pink-500/20"
          >
            <Plus size={12} /> Nueva
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Cargando campañas…
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center gap-2 py-12 text-rose-400">
            <AlertCircle size={16} /> Error al cargar campañas
          </div>
        )}
        {!isLoading && !isError && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
              <Megaphone size={22} className="text-pink-500" />
            </div>
            <p className="text-slate-400 text-sm">Aún no hay campañas</p>
            <button onClick={onNew} className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium transition-all">
              Crear primera campaña
            </button>
          </div>
        )}

        {!isLoading && campaigns.length > 0 && (
          <div className="divide-y divide-white/[0.04]">
            {campaigns.map(c => (
              <div key={c.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center flex-shrink-0">
                    {c.status === "sending"
                      ? <Loader2 size={13} className="text-blue-400 animate-spin" />
                      : <Send size={13} className="text-pink-400" />
                    }
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.name}</p>
                    <p className="text-slate-500 text-[11px]">
                      {CHANNEL_LABEL[c.channel] ?? c.channel} · {new Date(c.created_at).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-shrink-0">
                  {/* Sent / failed counts */}
                  <div className="text-right hidden md:block">
                    <p className="text-white text-xs font-medium">{c.sent_count.toLocaleString()}</p>
                    <p className="text-slate-500 text-[10px]">enviados</p>
                  </div>
                  {(c.failed_count ?? 0) > 0 && (
                    <div className="text-right hidden md:block">
                      <p className="text-rose-400 text-xs font-medium">{c.failed_count.toLocaleString()}</p>
                      <p className="text-slate-500 text-[10px]">fallidos</p>
                    </div>
                  )}
                  <div className="text-right hidden md:block">
                    <p className="text-white text-xs font-medium">{pct(c.opened_count, c.sent_count)}</p>
                    <p className="text-slate-500 text-[10px]">abiertos</p>
                  </div>

                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-lg border ${STATUS_COLOR[c.status] ?? STATUS_COLOR["draft"]}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>

                  <PortalDropdown
                    trigger={
                      <button className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100">
                        <MoreHorizontal size={15} />
                      </button>
                    }
                  >
                    <PortalDropdownItem icon={<Eye size={13} />} label="Ver / Editar" onClick={() => onEdit(c)} />

                    {/* Launch: only for draft campaigns */}
                    {c.status === "draft" && (
                      <PortalDropdownItem
                        icon={launchingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                        label={launchingId === c.id ? "Enviando…" : "Publicar y enviar"}
                        onClick={() => launchMut.mutate(c.id)}
                        disabled={launchingId === c.id}
                      />
                    )}

                    {/* Sending in progress */}
                    {c.status === "sending" && (
                      <PortalDropdownItem
                        icon={<Loader2 size={13} className="animate-spin" />}
                        label="Enviando…"
                        onClick={() => {}}
                        disabled
                      />
                    )}

                    {/* Report for terminal states */}
                    {["sent", "sent_with_errors", "error", "completed"].includes(c.status) && (
                      <PortalDropdownItem
                        icon={<FileText size={13} />}
                        label="Ver informe"
                        onClick={() => onReport(c)}
                      />
                    )}

                    <PortalDropdownItem
                      icon={<Copy size={13} />}
                      label="Duplicar"
                      onClick={() => dupMut.mutate(c.id)}
                    />
                    <PortalDropdownItem
                      icon={<Trash2 size={13} />}
                      label="Eliminar"
                      onClick={() => { if (confirm("¿Eliminar campaña?")) deleteMut.mutate(c.id); }}
                      danger
                    />
                  </PortalDropdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Report Modal ───────────────────────────────────────────────────────────────
function ReportModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaign-report", campaign.id],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/marketing/campaigns/${campaign.id}/report`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as {
        campaign: Record<string, unknown>;
        logs: SendLog[];
      };
    },
  });

  const logs    = data?.logs ?? [];
  const sent    = logs.filter(l => l.status === "sent").length;
  const failed  = logs.filter(l => l.status === "failed").length;
  const total   = logs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#10111e] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={17} className="text-pink-400" />
            <div>
              <h2 className="text-white font-semibold text-sm">{campaign.name}</h2>
              <p className="text-slate-500 text-xs">Informe de envío</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Stats row */}
        {!isLoading && !isError && (
          <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">{sent}</p>
              <p className="text-slate-400 text-xs mt-0.5">Enviados</p>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-rose-400">{failed}</p>
              <p className="text-slate-400 text-xs mt-0.5">Fallidos</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{total}</p>
              <p className="text-slate-400 text-xs mt-0.5">Total</p>
            </div>
          </div>
        )}

        {/* Log list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-1.5">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Cargando informe…
            </div>
          )}
          {isError && (
            <div className="flex items-center justify-center gap-2 py-12 text-rose-400">
              <AlertCircle size={15} /> Error al cargar el informe
            </div>
          )}
          {!isLoading && !isError && logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
              <FileText size={28} />
              <p className="text-sm">Sin registros de envío</p>
              <p className="text-xs text-slate-600">Los logs aparecen después de lanzar la campaña</p>
            </div>
          )}
          {logs.map(log => (
            <div
              key={log.id}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
                log.status === "sent"
                  ? "bg-emerald-500/5 border-emerald-500/15"
                  : "bg-rose-500/5 border-rose-500/15"
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {log.status === "sent"
                  ? <CheckCheck size={14} className="text-emerald-400" />
                  : <XCircle   size={14} className="text-rose-400" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white text-xs font-medium">{log.client_name ?? "Desconocido"}</p>
                  <span className="text-slate-500 text-[10px] flex items-center gap-1">
                    <Phone size={9} />
                    {log.phone_normalized ?? log.phone_raw ?? "—"}
                  </span>
                  {log.message_id && (
                    <span className="text-slate-600 text-[10px] font-mono hidden sm:inline truncate max-w-[160px]">
                      {log.message_id}
                    </span>
                  )}
                </div>
                {log.error_message && (
                  <p className="text-rose-400 text-[11px] mt-0.5 leading-snug">{log.error_message}</p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-slate-500 text-[10px]">
                  {new Date(log.sent_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
                {log.meta_http_status != null && log.meta_http_status !== 200 && (
                  <p className="text-rose-400 text-[10px]">HTTP {log.meta_http_status}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Audience Tab ──────────────────────────────────────────────────────────────
function AudienceTab() {
  const [search,  setSearch]  = useState("");
  const [segment, setSegment] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-audience"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/marketing/audience`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { clients: AudienceClient[]; segments: Segment[] };
    },
  });

  const segments = data?.segments ?? [];
  const filtered = (data?.clients ?? []).filter(c => {
    const matchSeg = segment === "all"
      ? true
      : segment === "active"   ? (c.status === "active" || c.status === "client")
      : segment === "leads"    ? c.status === "lead"
      : segment === "inactive" ? c.status === "inactive"
      : true;
    const q = search.toLowerCase();
    const matchQ = !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
    return matchSeg && matchQ;
  });

  return (
    <div className="space-y-4">
      {/* Segment pills */}
      <div className="flex flex-wrap gap-2">
        {segments.map(s => (
          <button
            key={s.id}
            onClick={() => setSegment(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              segment === s.id
                ? "bg-pink-600/20 text-pink-300 border-pink-500/30"
                : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
            }`}
          >
            {s.name}
            <span className="bg-white/10 px-1.5 py-0.5 rounded-md text-[10px]">{s.count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-3">
          <Target size={14} className="text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar contacto…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none"
          />
          <span className="text-slate-500 text-xs">{filtered.length} registros</span>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Cargando audiencia…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
            <Users size={28} />
            <p className="text-sm">Sin contactos en este segmento</p>
          </div>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
            {filtered.map(c => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 text-xs font-semibold flex-shrink-0">
                    {(c.name?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{c.name}</p>
                    <p className="text-slate-500 text-[11px]">
                      {c.email ?? "Sin email"}{c.company ? ` · ${c.company}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {c.phone && (
                    <span className="text-slate-500 text-[10px] flex items-center gap-1 hidden sm:flex">
                      <Phone size={9} /> {c.phone}
                    </span>
                  )}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-lg border ${STATUS_CLIENT_COLOR[c.status] ?? STATUS_CLIENT_COLOR["inactive"]}`}>
                    {c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["marketing-analytics"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/marketing/analytics`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as {
        overview: {
          totalSent: number; totalOpened: number; totalClicked: number;
          openRate: number; clickRate: number;
          activeCampaigns: number; draftCampaigns: number;
          pausedCampaigns: number; completedCampaigns: number; totalCampaigns: number;
        };
        monthly: Array<{ month: string; sent: string; opened: string; clicked: string }>;
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Cargando analíticas…
      </div>
    );
  }

  const o       = data?.overview;
  const monthly = data?.monthly ?? [];

  if (!o || o.totalCampaigns === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
        <BarChart3 size={36} className="text-slate-700" />
        <p className="text-sm">Sin datos. Crea tu primera campaña para ver analíticas.</p>
      </div>
    );
  }

  const maxSent = Math.max(...monthly.map(m => Number(m.sent)), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox icon={Send}              label="Enviados"      value={o.totalSent.toLocaleString()}   color="pink" />
        <StatBox icon={Eye}               label="Abiertos"      value={o.totalOpened.toLocaleString()}  color="blue" />
        <StatBox icon={MousePointerClick} label="Clics"         value={o.totalClicked.toLocaleString()} color="violet" />
        <StatBox icon={TrendingUp}        label="Tasa apertura" value={`${o.openRate}%`}               color="emerald" />
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
        <h3 className="text-white font-medium text-sm mb-4">Estado de campañas</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Activas/Enviando", count: o.activeCampaigns,    color: "text-emerald-400" },
            { label: "Borradores",       count: o.draftCampaigns,     color: "text-slate-400"   },
            { label: "Pausadas",         count: o.pausedCampaigns,    color: "text-amber-400"   },
            { label: "Finalizadas",      count: o.completedCampaigns, color: "text-blue-400"    },
          ].map(s => (
            <div key={s.label} className="bg-white/5 rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-slate-400 text-xs mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {monthly.length > 0 && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Envíos por mes</h3>
          <div className="flex items-end gap-3 h-32">
            {monthly.map(m => {
              const height = Math.max(4, (Number(m.sent) / maxSent) * 100);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full bg-pink-600/30 hover:bg-pink-600/50 rounded-t-md transition-all cursor-default"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-slate-600 text-[10px]">{m.month.slice(5)}</span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1a1b2e] border border-white/10 rounded-lg px-2 py-1 text-xs text-white whitespace-nowrap z-10">
                    {Number(m.sent).toLocaleString()} enviados
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RateCard label="Tasa de apertura" rate={o.openRate} icon={Eye}               color="blue"   desc={`${o.totalOpened.toLocaleString()} de ${o.totalSent.toLocaleString()} mensajes abiertos`} />
        <RateCard label="Tasa de clics"    rate={o.clickRate} icon={MousePointerClick} color="violet" desc={`${o.totalClicked.toLocaleString()} clics sobre ${o.totalSent.toLocaleString()} enviados`} />
      </div>
    </div>
  );
}

// ── Campaign Modal ─────────────────────────────────────────────────────────────
function CampaignModal({ existing, onClose }: { existing: Campaign | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!existing;

  const [name,     setName]     = useState(existing?.name      ?? "");
  const [channel,  setChannel]  = useState(existing?.channel   ?? "email");
  const [subject,  setSubject]  = useState(existing?.subject   ?? "");
  const [body,     setBody]     = useState(existing?.body      ?? "");
  const [audience, setAudience] = useState(existing?.audience_filter ?? "all");
  const [saving,   setSaving]   = useState(false);

  // Test-send state
  const [testPhone,   setTestPhone]   = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult,  setTestResult]  = useState<{ ok: boolean; messageId?: string; normalized?: string; error?: string; rawResponse?: string } | null>(null);

  const audienceOptions = [
    { id: "all",      label: "Todos los contactos" },
    { id: "active",   label: "Clientes activos" },
    { id: "leads",    label: "Leads" },
    { id: "inactive", label: "Inactivos" },
  ];

  async function handleSave() {
    if (!name.trim()) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { name, channel, subject, body, audience_filter: audience };
      const url = isEdit
        ? `${BASE}/api/marketing/campaigns/${existing!.id}`
        : `${BASE}/api/marketing/campaigns`;
      const r = await authFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
      toast({ title: isEdit ? "Campaña actualizada" : "Campaña creada" });
      onClose();
    } catch (e) {
      toast({ title: "Error al guardar", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    if (!testPhone.trim()) { toast({ title: "Introduce un teléfono", variant: "destructive" }); return; }
    if (!existing?.id)     { toast({ title: "Guarda la campaña antes de enviar la prueba", variant: "destructive" }); return; }
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await authFetch(`${BASE}/api/marketing/campaigns/${existing.id}/test-send`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone: testPhone }),
      });
      const d = await r.json() as { ok: boolean; messageId?: string; normalized?: string; error?: string; rawResponse?: string };
      setTestResult(d);
      if (d.ok) {
        toast({ title: `✅ Prueba enviada a +${d.normalized}`, description: `ID: ${d.messageId ?? "?"}` });
      } else {
        toast({ title: "❌ Envío de prueba fallido", description: d.error, variant: "destructive" });
      }
    } catch (e) {
      setTestResult({ ok: false, error: String(e) });
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setTestLoading(false);
    }
  }

  const showTestSend = isEdit && (channel === "whatsapp" || channel === "both");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#10111e] border border-white/10 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-pink-400" />
            <h2 className="text-white font-semibold">{isEdit ? "Editar campaña" : "Nueva campaña"}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <Field label="Nombre *">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Promoción verano 2026"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500/40"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Canal">
              <select
                value={channel}
                onChange={e => setChannel(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-pink-500/40"
              >
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="both">Email + WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </Field>
            <Field label="Audiencia">
              <select
                value={audience}
                onChange={e => setAudience(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-pink-500/40"
              >
                {audienceOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Asunto">
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Asunto del mensaje"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500/40"
            />
          </Field>

          <Field label="Contenido">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Escribe el contenido de tu campaña..."
              rows={5}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500/40 resize-none"
            />
          </Field>

          {/* ── Test-send section ── */}
          {showTestSend && (
            <div className="border border-white/[0.08] rounded-xl p-4 space-y-3">
              <p className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
                <Phone size={11} />
                Enviar mensaje de prueba
              </p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="+34 612 345 678"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-pink-500/40"
                />
                <button
                  onClick={handleTestSend}
                  disabled={testLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/20 text-pink-400 text-xs font-medium transition-all disabled:opacity-50 flex-shrink-0"
                >
                  {testLoading
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Send size={12} />
                  }
                  Enviar prueba
                </button>
              </div>
              {/* Test result feedback */}
              {testResult && (
                <div className={`rounded-xl px-3 py-2.5 text-xs space-y-1 ${
                  testResult.ok
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "bg-rose-500/10 border border-rose-500/20"
                }`}>
                  {testResult.ok ? (
                    <>
                      <p className="text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCheck size={11} /> Mensaje enviado correctamente
                      </p>
                      {testResult.normalized && (
                        <p className="text-slate-400">Número normalizado: +{testResult.normalized}</p>
                      )}
                      {testResult.messageId && (
                        <p className="text-slate-400 font-mono break-all">ID: {testResult.messageId}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-rose-400 font-medium flex items-center gap-1">
                        <XCircle size={11} /> Error en el envío
                      </p>
                      <p className="text-slate-400">{testResult.error}</p>
                      {testResult.rawResponse && (
                        <details className="mt-1">
                          <summary className="text-slate-500 cursor-pointer">Respuesta completa de Meta API</summary>
                          <pre className="text-slate-500 text-[10px] mt-1 break-all whitespace-pre-wrap">{testResult.rawResponse}</pre>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 disabled:opacity-60 text-white text-sm font-medium transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {isEdit ? "Guardar cambios" : "Crear campaña"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-slate-400 text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, trend, color }: {
  icon: React.ElementType; label: string; value: string; trend: string; color: string;
}) {
  const cm: Record<string, { bg: string; text: string; border: string }> = {
    pink:    { bg: "bg-pink-500/10",    text: "text-pink-400",    border: "border-pink-500/20"    },
    blue:    { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20"    },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/20"  },
    amber:   { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20"   },
  };
  const c = cm[color] ?? cm["pink"]!;
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center flex-shrink-0`}>
        <Icon size={18} className={c.text} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-slate-400 text-xs">{label}</p>
        <p className="text-slate-600 text-[10px]">{trend}</p>
      </div>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string;
}) {
  const cm: Record<string, { bg: string; text: string; border: string }> = {
    pink:    { bg: "bg-pink-500/10",    text: "text-pink-400",    border: "border-pink-500/20"    },
    blue:    { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20"    },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/20"  },
  };
  const c = cm[color] ?? cm["blue"]!;
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg ${c.bg} border ${c.border} flex items-center justify-center flex-shrink-0`}>
        <Icon size={15} className={c.text} />
      </div>
      <div>
        <p className="text-white font-bold">{value}</p>
        <p className="text-slate-500 text-[11px]">{label}</p>
      </div>
    </div>
  );
}

function RateCard({ label, rate, icon: Icon, color, desc }: {
  label: string; rate: number; icon: React.ElementType; color: string; desc: string;
}) {
  const cm: Record<string, { bg: string; text: string; border: string; bar: string }> = {
    blue:   { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/20",   bar: "bg-blue-500" },
    violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20", bar: "bg-violet-500" },
  };
  const c = cm[color] ?? cm["blue"]!;
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg ${c.bg} border ${c.border} flex items-center justify-center`}>
          <Icon size={15} className={c.text} />
        </div>
        <p className="text-white text-sm font-medium">{label}</p>
      </div>
      <p className={`text-3xl font-bold ${c.text} mb-2`}>{rate}%</p>
      <div className="w-full bg-white/5 rounded-full h-1.5 mb-2">
        <div className={`h-1.5 rounded-full ${c.bar}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <p className="text-slate-500 text-xs">{desc}</p>
    </div>
  );
}
