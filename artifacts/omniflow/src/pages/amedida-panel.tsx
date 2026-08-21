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
  organizacion_espacios: "A3 · Organización",
  limpieza_profesional: "A3 · Limpieza",
  consulta_general: "A3 · Consulta general",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AMedidaPanelPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (category) params.set("category", category);
  if (search.trim()) params.set("search", search.trim());

  const { data, isLoading, isFetching, refetch } = useQuery<LeadsResponse>({
    queryKey: ["a-medida-leads", status, category, search],
    queryFn: () => authFetch(`${BASE}/api/a-medida-leads?${params.toString()}`).then(r => r.json()),
    staleTime: 10_000,
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
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Truck size={24} className="text-amber-400" /> A Medida — Solicitudes
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
          <option value="">Todas las categorías</option>
          <option value="cocinas">Cocinas</option>
          <option value="muebles">Muebles</option>
          <option value="portes">Portes</option>
          <option value="mudanzas">Mudanzas</option>
          <option value="organizacion_espacios">A3 · Organización</option>
          <option value="limpieza_profesional">A3 · Limpieza</option>
          <option value="consulta_general">A3 · Consulta general</option>
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
