import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  ScanSearch, Search, BarChart3, MessageSquare, Brain,
  Building2, Phone, Globe, Star, MapPin, CheckCircle2, XCircle,
  Loader2, Plus, TrendingUp, AlertTriangle, RefreshCw, Trash2,
  ChevronLeft, ChevronRight, X, Copy, Check, Zap,
  Users, ExternalLink, ArrowRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "dashboard" | "buscar" | "resultados" | "analisis" | "mensajes";

interface DashboardData {
  totalSearches: number; totalResults: number; analyzed: number; leadsCreated: number;
  highOpportunity: number; mediumOpportunity: number; lowOpportunity: number;
  lastSearch: string | null;
  recentSearches: Array<{ id: number; sector: string; city: string; status: string; total_found: number; created_at: string }>;
  scoreDistrib: Array<{ level: string; cnt: number }>;
}

interface LeadResult {
  id: number; name: string; address: string | null; phone: string | null;
  website: string | null; email: string | null; rating: number | null;
  review_count: number | null; sector: string | null; status: string;
  crm_client_id: number | null; created_at: string;
  score: number | null; opportunity: string | null; summary: string | null;
  has_website: boolean | null; has_https: boolean | null; has_form: boolean | null;
  has_whatsapp: boolean | null; has_facebook: boolean | null; has_instagram: boolean | null;
  has_google_business: boolean | null; has_cta: boolean | null;
  has_mobile_optimization: boolean | null; has_load_speed: boolean | null;
  has_contact_info: boolean | null; improvements: string | null;
}

interface ResultsPage { data: LeadResult[]; total: number; page: number; pages: number; }

// ── Shared helpers ────────────────────────────────────────────────────────────
function OpportunityBadge({ opp }: { opp: string | null }) {
  if (!opp) return null;
  const styles: Record<string, string> = {
    alta:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    media: "bg-amber-500/20  text-amber-400  border-amber-500/30",
    baja:  "bg-red-500/20    text-red-400    border-red-500/30",
  };
  const labels: Record<string, string> = { alta: "🟢 Alta", media: "🟡 Media", baja: "🔴 Baja" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[opp] ?? styles.media}`}>
      {labels[opp] ?? opp}
    </span>
  );
}

function SignalRow({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      {value === null
        ? <span className="text-slate-600 text-xs">N/A</span>
        : value
          ? <CheckCircle2 size={15} className="text-emerald-400" />
          : <XCircle     size={15} className="text-red-400/60" />
      }
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    added_to_crm: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    analyzed:     "bg-blue-500/20    text-blue-400    border-blue-500/30",
    analyzing:    "bg-amber-500/20   text-amber-400   border-amber-500/30",
    new:          "bg-slate-500/20   text-slate-400   border-slate-500/30",
  };
  const labels: Record<string, string> = {
    added_to_crm: "En CRM", analyzed: "Analizado", analyzing: "Analizando…", new: "Nuevo",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${map[status] ?? map.new}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardTab() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["leads-dashboard"],
    queryFn:  () => authFetch(`${BASE}/api/leads/dashboard`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-violet-400" /></div>;
  if (!data) return null;

  const distrib = data.scoreDistrib.map(d => ({ name: d.level, value: Number(d.cnt) }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Búsquedas",  value: data.totalSearches,  color: "text-violet-400",  bg: "bg-violet-500/10", Icon: Search },
          { label: "Empresas",   value: data.totalResults,   color: "text-blue-400",    bg: "bg-blue-500/10",   Icon: Building2 },
          { label: "Analizadas", value: data.analyzed,       color: "text-amber-400",   bg: "bg-amber-500/10",  Icon: Brain },
          { label: "Leads CRM",  value: data.leadsCreated,   color: "text-emerald-400", bg: "bg-emerald-500/10",Icon: Users },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border border-white/[0.06] rounded-2xl p-5`}>
            <s.Icon size={20} className={`${s.color} mb-3`} />
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-slate-400 text-sm mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Alta oportunidad",  value: data.highOpportunity,   color: "text-emerald-400", border: "border-emerald-500/20" },
          { label: "Media oportunidad", value: data.mediumOpportunity, color: "text-amber-400",   border: "border-amber-500/20" },
          { label: "Baja oportunidad",  value: data.lowOpportunity,    color: "text-red-400",     border: "border-red-500/20" },
        ].map(o => (
          <div key={o.label} className={`bg-[#0d0e1e] border ${o.border} rounded-2xl p-5 text-center`}>
            <p className={`text-3xl font-bold ${o.color}`}>{o.value}</p>
            <p className="text-slate-400 text-sm mt-1">{o.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {distrib.length > 0 && (
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-white font-semibold text-sm mb-4">Distribución de oportunidades</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={distrib} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#0d0e1e", border: "1px solid #ffffff15", borderRadius: 8, color: "#fff" }} />
                <Bar dataKey="value" fill="#7c3aed" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Búsquedas recientes</h3>
          {data.recentSearches.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No hay búsquedas aún. ¡Empieza buscando empresas!</p>
          ) : (
            <div className="space-y-2">
              {data.recentSearches.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                  <div>
                    <p className="text-white text-sm font-medium">{s.sector} en {s.city}</p>
                    <p className="text-slate-500 text-xs">{new Date(s.created_at).toLocaleDateString("es-ES")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-violet-400 text-sm font-bold">{s.total_found}</p>
                    <p className="text-slate-600 text-xs">empresas</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Buscar ────────────────────────────────────────────────────────────────────
function BuscarTab({ onSearchDone }: { onSearchDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ sector: "", city: "", postalCode: "", radiusKm: 20, maxResults: 20 });
  const [lastResult, setLastResult] = useState<{ found: number } | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/leads/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error en la búsqueda");
        return d as { found: number; searchId: number };
      }),
    onSuccess: data => {
      setLastResult({ found: data.found });
      qc.invalidateQueries({ queryKey: ["leads-results"] });
      qc.invalidateQueries({ queryKey: ["leads-dashboard"] });
      toast({ title: `✅ ${data.found} empresas encontradas` });
    },
    onError: (err: Error) => toast({ title: "Error en la búsqueda", description: err.message, variant: "destructive" }),
  });

  const canSearch = form.sector.trim() && form.city.trim() && !mut.isPending;

  return (
    <div className="max-w-2xl">
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Search size={20} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold">Buscar empresas</h2>
            <p className="text-slate-500 text-sm">Encuentra empresas reales con Google Places API</p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-2">Sector / Tipo de negocio *</label>
              <input
                value={form.sector}
                onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}
                placeholder="Dentistas, Fontaneros, Abogados…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-2">Ciudad *</label>
              <input
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="Madrid, Barcelona, Sevilla…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-2">Código Postal</label>
              <input
                value={form.postalCode}
                onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))}
                placeholder="28001"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-2">Radio</label>
              <select
                value={form.radiusKm}
                onChange={e => setForm(f => ({ ...f, radiusKm: Number(e.target.value) }))}
                className="w-full bg-[#0a0b14] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 text-sm"
              >
                {[5, 10, 20, 30, 50].map(v => <option key={v} value={v}>{v} km</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-2">Máx. resultados</label>
              <select
                value={form.maxResults}
                onChange={e => setForm(f => ({ ...f, maxResults: Number(e.target.value) }))}
                className="w-full bg-[#0a0b14] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 text-sm"
              >
                {[10, 20, 40, 60].map(v => <option key={v} value={v}>{v} empresas</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={() => mut.mutate()}
            disabled={!canSearch}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-all"
          >
            {mut.isPending
              ? <><Loader2 size={18} className="animate-spin" /> Buscando empresas… <span className="text-violet-300 text-xs">(puede tardar unos segundos)</span></>
              : <><Search size={18} /> Buscar empresas</>
            }
          </button>
        </div>

        {lastResult && (
          <div className="mt-5 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <p className="text-emerald-300 text-sm font-medium">{lastResult.found} empresas encontradas</p>
            </div>
            <button
              onClick={onSearchDone}
              className="flex items-center gap-1.5 text-emerald-400 text-sm hover:text-emerald-300 transition-colors"
            >
              Ver resultados <ArrowRight size={14} />
            </button>
          </div>
        )}

        <div className="mt-5 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <p className="text-blue-300 text-xs flex items-start gap-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            Requiere <code className="text-blue-200 font-mono">GOOGLE_PLACES_API_KEY</code> configurada como secreto del servidor. Los datos provienen de la API oficial de Google Places, respetando sus términos de servicio.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Resultados ────────────────────────────────────────────────────────────────
function ResultadosTab({
  onAnalyze, onViewMessages,
}: {
  onAnalyze: (r: LeadResult) => void;
  onViewMessages: (r: LeadResult) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage]   = useState(1);
  const [q, setQ]         = useState("");
  const [stF, setStF]     = useState("");
  const [oppF, setOppF]   = useState("");
  const [sel, setSel]     = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery<ResultsPage>({
    queryKey: ["leads-results", page, q, stF, oppF],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "20" });
      if (q)   p.set("q", q);
      if (stF) p.set("status", stF);
      if (oppF) p.set("opportunity", oppF);
      return authFetch(`${BASE}/api/leads/results?${p}`).then(r => r.json());
    },
    refetchInterval: 6000,
  });

  const toCrmMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/leads/results/${id}/to-crm`, { method: "POST" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-results"] }); qc.invalidateQueries({ queryKey: ["leads-dashboard"] }); toast({ title: "✅ Lead añadido al CRM" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const analyzeMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/leads/results/${id}/analyze`, { method: "POST" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-results"] }); toast({ title: "✅ Análisis completado" }); },
    onError: (err: Error) => toast({ title: "Error en análisis", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/leads/results/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads-results"] }),
  });

  const handleBulkAnalyze = async () => {
    const ids = Array.from(sel).slice(0, 10);
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      await authFetch(`${BASE}/api/leads/results/bulk-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      toast({ title: `🔄 Analizando ${ids.length} empresa(s)`, description: "Los resultados se actualizarán automáticamente." });
      setSel(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="Buscar empresa…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
          />
        </div>
        <select value={stF} onChange={e => { setStF(e.target.value); setPage(1); }}
          className="bg-[#0d0e1e] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500">
          <option value="">Todos los estados</option>
          <option value="new">Nuevos</option>
          <option value="analyzing">Analizando</option>
          <option value="analyzed">Analizados</option>
          <option value="added_to_crm">En CRM</option>
        </select>
        <select value={oppF} onChange={e => { setOppF(e.target.value); setPage(1); }}
          className="bg-[#0d0e1e] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500">
          <option value="">Todas las oportunidades</option>
          <option value="alta">🟢 Alta</option>
          <option value="media">🟡 Media</option>
          <option value="baja">🔴 Baja</option>
        </select>
        <button onClick={() => refetch()} className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-600/10 border border-violet-500/20 rounded-xl">
          <span className="text-violet-300 text-sm font-medium">{sel.size} seleccionadas</span>
          <button onClick={handleBulkAnalyze} disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-all">
            {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
            Analizar con IA (máx 10)
          </button>
          <button onClick={() => setSel(new Set())} className="text-slate-500 hover:text-white ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
        ) : !data || data.data.length === 0 ? (
          <div className="text-center py-20">
            <Building2 size={44} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">Sin resultados</p>
            <p className="text-slate-600 text-sm mt-1">Realiza una búsqueda en la pestaña "Buscar"</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox"
                      checked={sel.size === data.data.length && data.data.length > 0}
                      onChange={() => setSel(prev => prev.size === data.data.length ? new Set() : new Set(data.data.map(r => r.id)))}
                      className="rounded border-white/20 bg-white/5 accent-violet-500"
                    />
                  </th>
                  {["Empresa", "Contacto", "Valoración", "Score IA", "Oportunidad", "Estado", "Acciones"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.data.map(r => (
                  <tr key={r.id} className={`hover:bg-white/[0.02] transition-colors ${sel.has(r.id) ? "bg-violet-500/5" : ""}`}>
                    <td className="px-4 py-4">
                      <input type="checkbox" checked={sel.has(r.id)}
                        onChange={() => setSel(prev => { const s = new Set(prev); s.has(r.id) ? s.delete(r.id) : s.add(r.id); return s; })}
                        className="rounded border-white/20 bg-white/5 accent-violet-500"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-white font-medium text-sm">{r.name}</p>
                      {r.address && (
                        <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-1">
                          <MapPin size={10} /> {r.address.length > 45 ? r.address.slice(0, 45) + "…" : r.address}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {r.phone && <p className="text-slate-300 text-xs flex items-center gap-1"><Phone size={11} /> {r.phone}</p>}
                      {r.website && (
                        <a href={r.website} target="_blank" rel="noopener noreferrer"
                          className="text-blue-400 text-xs flex items-center gap-1 hover:underline mt-0.5">
                          <Globe size={11} /> {r.website.replace(/^https?:\/\//, "").slice(0, 28)} <ExternalLink size={9} />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {r.rating != null && (
                        <span className="flex items-center gap-1 text-amber-400 text-sm">
                          <Star size={13} fill="currentColor" /> {r.rating.toFixed(1)}
                          <span className="text-slate-500 text-xs">({r.review_count})</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {r.score != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-14 bg-white/10 rounded-full h-1.5">
                            <div
                              className={`h-full rounded-full ${r.score >= 65 ? "bg-emerald-400" : r.score >= 35 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${r.score}%` }}
                            />
                          </div>
                          <span className="text-white text-sm font-bold">{r.score}</span>
                        </div>
                      ) : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-4"><OpportunityBadge opp={r.opportunity} /></td>
                    <td className="px-4 py-4"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-0.5">
                        {r.status === "new" && (
                          <button onClick={() => analyzeMut.mutate(r.id)} disabled={analyzeMut.isPending}
                            title="Analizar con IA"
                            className="p-1.5 text-slate-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-all">
                            {analyzeMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                          </button>
                        )}
                        {(r.status === "analyzed" || r.status === "added_to_crm") && (
                          <button onClick={() => onAnalyze(r)} title="Ver análisis"
                            className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all">
                            <TrendingUp size={13} />
                          </button>
                        )}
                        {r.status === "analyzed" && (
                          <button onClick={() => onViewMessages(r)} title="Generar propuesta"
                            className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all">
                            <MessageSquare size={13} />
                          </button>
                        )}
                        {r.status === "analyzed" && !r.crm_client_id && (
                          <button onClick={() => toCrmMut.mutate(r.id)} disabled={toCrmMut.isPending}
                            title="Añadir al CRM"
                            className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all">
                            {toCrmMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                          </button>
                        )}
                        <button onClick={() => { if (confirm("¿Eliminar este resultado?")) deleteMut.mutate(r.id); }}
                          title="Eliminar"
                          className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.pages > 1 && (
          <div className="border-t border-white/[0.06] px-6 py-3 flex items-center justify-between">
            <p className="text-slate-500 text-sm">{data.total} empresa{data.total !== 1 ? "s" : ""}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30">
                <ChevronLeft size={16} />
              </button>
              <span className="text-white text-sm">{page} / {data.pages}</span>
              <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Análisis ──────────────────────────────────────────────────────────────────
function AnalisisTab({ result, onGenerateProposal }: { result: LeadResult | null; onGenerateProposal: (r: LeadResult) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const toCrmMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/leads/results/${id}/to-crm`, { method: "POST" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-results"] }); qc.invalidateQueries({ queryKey: ["leads-dashboard"] }); toast({ title: "✅ Lead añadido al CRM" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Brain size={52} className="text-slate-700 mb-4" />
        <p className="text-slate-500 text-lg font-medium">Ninguna empresa seleccionada</p>
        <p className="text-slate-600 text-sm mt-2">Ve a Resultados → analiza una empresa → haz clic en el icono 📈 para ver el análisis aquí.</p>
      </div>
    );
  }

  let improvements: string[] = [];
  try { improvements = JSON.parse(result.improvements ?? "[]"); } catch { /* */ }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <h2 className="text-white text-xl font-bold">{result.name}</h2>
            {result.address && <p className="text-slate-500 text-sm mt-1 flex items-center gap-1"><MapPin size={12} />{result.address}</p>}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {result.phone   && <span className="text-slate-400 text-sm flex items-center gap-1"><Phone size={12}/>{result.phone}</span>}
              {result.website && (
                <a href={result.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-sm flex items-center gap-1 hover:underline">
                  <Globe size={12}/>{result.website.replace(/^https?:\/\//, "").slice(0,35)}<ExternalLink size={10}/>
                </a>
              )}
            </div>
          </div>
          <div className="text-center">
            <p className={`text-5xl font-black ${result.score! >= 65 ? "text-emerald-400" : result.score! >= 35 ? "text-amber-400" : "text-red-400"}`}>
              {result.score ?? "—"}
            </p>
            <p className="text-slate-500 text-xs mb-2">/100</p>
            <OpportunityBadge opp={result.opportunity} />
          </div>
        </div>

        {result.summary && (
          <div className="mt-5 p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl">
            <p className="text-slate-300 text-sm leading-relaxed">{result.summary}</p>
          </div>
        )}

        <div className="flex gap-3 mt-5 flex-wrap">
          {!result.crm_client_id ? (
            <button onClick={() => toCrmMut.mutate(result.id)} disabled={toCrmMut.isPending}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all">
              {toCrmMut.isPending ? <Loader2 size={15} className="animate-spin"/> : <Plus size={15}/>}
              Añadir al CRM
            </button>
          ) : (
            <span className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-xl">
              <CheckCircle2 size={15}/> En CRM (#{result.crm_client_id})
            </span>
          )}
          <button onClick={() => onGenerateProposal(result)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all">
            <MessageSquare size={15}/> Generar propuesta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Señales digitales detectadas</h3>
          <SignalRow label="Tiene sitio web"          value={result.has_website} />
          <SignalRow label="HTTPS (seguro)"           value={result.has_https} />
          <SignalRow label="Formulario de contacto"   value={result.has_form} />
          <SignalRow label="WhatsApp Business"        value={result.has_whatsapp} />
          <SignalRow label="Presencia en Facebook"    value={result.has_facebook} />
          <SignalRow label="Presencia en Instagram"   value={result.has_instagram} />
          <SignalRow label="Google Business Profile"  value={result.has_google_business} />
          <SignalRow label="Llamadas a la acción"     value={result.has_cta} />
          <SignalRow label="Optimizado para móvil"    value={result.has_mobile_optimization} />
          <SignalRow label="Carga rápida (&lt; 3s)"  value={result.has_load_speed} />
          <SignalRow label="Datos de contacto"        value={result.has_contact_info} />
        </div>

        {improvements.length > 0 && (
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
              <Zap size={15} className="text-amber-400"/> Oportunidades de mejora
            </h3>
            <div className="space-y-2">
              {improvements.map((imp, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
                  <p className="text-slate-300 text-sm">{imp}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mensajes ──────────────────────────────────────────────────────────────────
function MensajesTab({ result }: { result: LeadResult | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [channel, setChannel] = useState<"email" | "whatsapp" | "linkedin">("email");
  const [tone, setTone]       = useState("profesional");
  const [copiedId, setCopied] = useState<number | null>(null);

  const { data: messages = [], isLoading } = useQuery<Array<{ id: number; channel: string; content: string; tone: string; status: string; created_at: string }>>({
    queryKey: ["leads-messages", result?.id],
    queryFn:  () => result
      ? authFetch(`${BASE}/api/leads/results/${result.id}/messages`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!result,
  });

  const proposeMut = useMutation({
    mutationFn: () => result
      ? authFetch(`${BASE}/api/leads/results/${result.id}/propose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, tone }),
        }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      : Promise.reject(new Error("Sin empresa seleccionada")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-messages", result?.id] }); toast({ title: "✅ Propuesta generada" }); },
    onError:   (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const copy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquare size={52} className="text-slate-700 mb-4"/>
        <p className="text-slate-500 text-lg font-medium">Selecciona una empresa analizada</p>
        <p className="text-slate-600 text-sm mt-2">Desde Resultados, analiza una empresa y haz clic en el icono 💬 para generar propuestas aquí.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-1">Propuesta para <span className="text-violet-400">{result.name}</span></h3>
        <p className="text-slate-500 text-sm mb-5">La IA genera un mensaje 100% personalizado basado en el análisis de la empresa.</p>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs text-slate-500 mb-2">Canal</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["email", "whatsapp", "linkedin"] as const).map(c => (
                <button key={c} onClick={() => setChannel(c)}
                  className={`px-2 py-2 rounded-xl border text-xs font-medium capitalize transition-all ${channel === c ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-2">Tono</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full bg-[#0a0b14] border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-violet-500">
              <option value="profesional">Profesional</option>
              <option value="casual">Casual</option>
              <option value="amigable">Amigable</option>
              <option value="directo">Directo y conciso</option>
            </select>
          </div>
        </div>

        <button onClick={() => proposeMut.mutate()} disabled={proposeMut.isPending || result.status === "new"}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
          {proposeMut.isPending ? <Loader2 size={15} className="animate-spin"/> : <Zap size={15}/>}
          {result.status === "new" ? "Analiza la empresa primero" : "Generar propuesta con IA"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-violet-400"/></div>
      ) : messages.length === 0 ? (
        <p className="text-center text-slate-500 py-10">Aún no hay propuestas para esta empresa.</p>
      ) : (
        <div className="space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 bg-violet-600/20 text-violet-400 rounded-lg capitalize font-medium">{msg.channel}</span>
                  <span className="text-xs px-2 py-1 bg-white/5 text-slate-400 rounded-lg">{msg.tone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-600 text-xs">{new Date(msg.created_at).toLocaleDateString("es-ES")}</span>
                  <button onClick={() => copy(msg.content, msg.id)} title="Copiar" className="p-1.5 text-slate-500 hover:text-white transition-colors">
                    {copiedId === msg.id ? <Check size={14} className="text-emerald-400"/> : <Copy size={14}/>}
                  </button>
                </div>
              </div>
              <p className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const [tab, setTab]         = useState<Tab>("dashboard");
  const [activeResult, setActiveResult] = useState<LeadResult | null>(null);

  const goAnalysis = useCallback((r: LeadResult) => { setActiveResult(r); setTab("analisis"); }, []);
  const goMessages = useCallback((r: LeadResult) => { setActiveResult(r); setTab("mensajes"); }, []);

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "dashboard",  label: "Dashboard",  icon: BarChart3 },
    { id: "buscar",     label: "Buscar",      icon: Search },
    { id: "resultados", label: "Resultados",  icon: Building2 },
    { id: "analisis",   label: "Análisis",    icon: Brain },
    { id: "mensajes",   label: "Mensajes",    icon: MessageSquare },
  ];

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-5 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <ScanSearch size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-xl">OmniLeads AI</h1>
            <p className="text-slate-500 text-sm">Prospección inteligente · Empresas reales · Oportunidades de venta</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/[0.06] px-6 lg:px-8">
        <div className="flex gap-1 overflow-x-auto py-2 scrollbar-none">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}>
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 lg:p-8">
        {tab === "dashboard"  && <DashboardTab />}
        {tab === "buscar"     && <BuscarTab onSearchDone={() => setTab("resultados")} />}
        {tab === "resultados" && <ResultadosTab onAnalyze={goAnalysis} onViewMessages={goMessages} />}
        {tab === "analisis"   && <AnalisisTab result={activeResult} onGenerateProposal={goMessages} />}
        {tab === "mensajes"   && <MensajesTab result={activeResult} />}
      </div>
    </div>
  );
}
