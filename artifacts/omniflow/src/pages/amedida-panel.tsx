import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Truck, Search, RefreshCw, Loader2, Phone, MapPin, Clock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AMedidaLead {
  id: string;
  category: string;
  description: string;
  zone: string;
  timing: string | null;
  contactPhone: string;
  status: string;
  createdAt: string;
}

interface LeadsResponse {
  leads: AMedidaLead[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  contacted: "Contactada",
  closed: "Cerrada",
};
const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  contacted: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  closed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};
const CATEGORY_LABELS: Record<string, string> = {
  cocinas: "Cocinas",
  muebles: "Muebles",
  portes: "Portes",
  mudanzas: "Mudanzas",
  electrodomesticos: "Electrodomésticos",
  organizacion_espacios: "A3 · Organización",
  limpieza_profesional: "A3 · Limpieza",
  consulta_general: "A3 · Consulta general",
};

// ── Marcas ────────────────────────────────────────────────────────────────────
// La tabla física es una sola (leads públicos), pero tres landings distintas
// escriben ahí: A3 Ordena, A Medida y FridgeFix. `category` es el único
// discriminador — este mapa (espejo de BRAND_CATEGORIES en
// routes/aMedidaLeads.ts) agrupa las solicitudes por marca para que el panel
// no las muestre todas mezcladas bajo un único filtro de categoría.
const BRANDS = [
  { id: "", label: "Todas las marcas", icon: "🗂️", categories: [] as string[] },
  { id: "a3_ordena", label: "A3 Ordena", icon: "🧹", categories: ["organizacion_espacios", "limpieza_profesional", "consulta_general"] },
  { id: "a_medida", label: "A Medida", icon: "🚚", categories: ["cocinas", "muebles", "portes", "mudanzas"] },
  { id: "fridgefix", label: "FridgeFix", icon: "🧊", categories: ["electrodomesticos"] },
] as const;

type BrandId = typeof BRANDS[number]["id"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AMedidaPanelPage() {
  const qc = useQueryClient();
  const [brand, setBrand] = useState<BrandId>("");
  const [status, setStatus] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const activeBrand = BRANDS.find(b => b.id === brand) ?? BRANDS[0];

  function handleBrandChange(next: BrandId) {
    setBrand(next);
    setCategory(""); // la categoría pertenece a la marca anterior — se reinicia al cambiar
  }

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (brand) params.set("brand", brand);
  if (category) params.set("category", category);
  if (search.trim()) params.set("search", search.trim());

  const { data, isLoading, isFetching, refetch } = useQuery<LeadsResponse>({
    queryKey: ["a-medida-leads", brand, status, category, search],
    queryFn: () => authFetch(`${BASE}/api/a-medida-leads?${params.toString()}`).then(r => r.json()),
    staleTime: 10_000,
  });

  const { data: brandCounts } = useQuery<Record<string, number>>({
    queryKey: ["a-medida-leads-brand-counts"],
    queryFn: () => authFetch(`${BASE}/api/a-medida-leads/brand-counts`).then(r => r.json()),
    staleTime: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const res = await authFetch(`${BASE}/api/a-medida-leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? `Error al actualizar (HTTP ${res.status})`);
      return body;
    },
    onMutate: ({ id }) => setPendingId(id),
    onError: (err: Error) => alert(err.message),
    onSettled: () => {
      setPendingId(null);
      void qc.invalidateQueries({ queryKey: ["a-medida-leads"] });
      void qc.invalidateQueries({ queryKey: ["a-medida-leads-brand-counts"] });
    },
  });

  const deleteLead = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`${BASE}/api/a-medida-leads/${id}`, { method: "DELETE" });
      const raw = await res.text();
      let body: { message?: string } | null = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON — show raw below */ }
      if (!res.ok) {
        throw new Error(body?.message ?? `HTTP ${res.status}: ${raw.slice(0, 200) || "(respuesta vacía)"}`);
      }
      return body;
    },
    onMutate: (id) => setPendingId(id),
    onError: (err: Error) => alert(err.message),
    onSettled: () => {
      setPendingId(null);
      void qc.invalidateQueries({ queryKey: ["a-medida-leads"] });
      void qc.invalidateQueries({ queryKey: ["a-medida-leads-brand-counts"] });
    },
  });

  function handleDelete(id: string) {
    if (window.confirm("¿Borrar esta solicitud definitivamente? Esta acción no se puede deshacer.")) {
      deleteLead.mutate(id);
    }
  }

  const leads = data?.leads ?? [];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Truck size={24} className="text-amber-400" /> {activeBrand.id ? activeBrand.label : "Leads"} — Solicitudes
          </h1>
          <p className="text-slate-500 mt-1">
            Solicitudes recibidas desde la landing pública ({data?.total ?? 0} en total)
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      {/* Brand tabs — separan las solicitudes de A3 Ordena, A Medida y FridgeFix,
          aunque compartan la misma tabla y el mismo pipeline de captación. */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {BRANDS.map(b => (
          <button
            key={b.id || "todas"}
            onClick={() => handleBrandChange(b.id)}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors",
              brand === b.id
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]",
            )}
          >
            <span>{b.icon}</span> {b.label}
            {b.id && brandCounts && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-slate-300">
                {brandCounts[b.id] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por zona, teléfono o descripción…"
            className="bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 w-72 transition-colors"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
        >
          <option value="">{activeBrand.id ? `Todas — ${activeBrand.label}` : "Todas las categorías"}</option>
          {(activeBrand.id ? activeBrand.categories : Object.keys(CATEGORY_LABELS)).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
        >
          <option value="">Todos los estados</option>
          <option value="open">Abierta</option>
          <option value="contacted">Contactada</option>
          <option value="closed">Cerrada</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-amber-400" />
        </div>
      ) : leads.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Truck size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay solicitudes que coincidan con los filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map(lead => (
            <div
              key={lead.id}
              className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 flex items-start gap-4 flex-wrap"
            >
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    {CATEGORY_LABELS[lead.category] ?? lead.category}
                  </span>
                  <span className="text-slate-600 text-xs">{fmtDate(lead.createdAt)}</span>
                </div>
                <p className="text-white text-sm mb-2">{lead.description}</p>
                <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1.5"><MapPin size={12} /> {lead.zone}</span>
                  <span className="flex items-center gap-1.5"><Phone size={12} /> {lead.contactPhone}</span>
                  {lead.timing && <span className="flex items-center gap-1.5"><Clock size={12} /> {lead.timing}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn(
                  "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border",
                  STATUS_COLORS[lead.status] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20",
                )}>
                  {STATUS_LABELS[lead.status] ?? lead.status}
                </span>
                <select
                  value={lead.status}
                  disabled={pendingId === lead.id}
                  onChange={e => updateStatus.mutate({ id: lead.id, newStatus: e.target.value })}
                  className={cn(
                    "bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50",
                    pendingId === lead.id && "opacity-60",
                  )}
                >
                  <option value="open">Abierta</option>
                  <option value="contacted">Contactada</option>
                  <option value="closed">Cerrada</option>
                </select>
                <button
                  onClick={() => handleDelete(lead.id)}
                  disabled={pendingId === lead.id}
                  title="Borrar solicitud"
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/[0.06] transition-colors",
                    pendingId === lead.id && "opacity-60",
                  )}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
