/**
 * OmniSeller Fase 13 — Panel "Prospectos" dentro del detalle de una Mission.
 *
 * Cubre a la vez las Partes 6 (Research), 7 (Contact Finder) y 8
 * (Leads/Contactos) del mandato: son tres pasos del MISMO flujo sobre la
 * MISMA lista de prospectos, así que viven en un único panel en vez de
 * fragmentarse en pestañas separadas — sigue siendo "un solo sistema", no
 * tres.
 *
 * Reutiliza:
 *  - GET /api/leads/results?searchId=... (routes/leads.ts, permiso
 *    leads.read, ya existente — no se crea ningún endpoint nuevo) para
 *    listar los prospectos de cada búsqueda de la misión.
 *  - POST /api/missions/:id/research (routes/missions.ts, Fase 2) para
 *    lanzar Researcher+Scorer sobre los prospectos "new".
 *  - POST /api/missions/:id/contacts/find (routes/missions.ts, Fase 3) para
 *    Contact Finder — el proveedor real sigue sin elegir (Parte 18: fuera
 *    de alcance), esta UI es agnóstica del proveedor.
 *
 * CERRADO EN FASE 14 (era una decisión abierta desde Fase 13): no existía
 * ningún GET para volver a listar los contactos ya encontrados de un
 * lead_result tras recargar — solo la respuesta síncrona de
 * POST .../contacts/find los traía. Auditoría exhaustiva de Fase 14 (grep de
 * leadContactsTable en todo el backend) confirmó que, en efecto, no existía
 * nada reutilizable — se creó GET /api/missions/:id/contacts (mismo
 * permiso, mismo patrón de pertenencia, 0 migraciones, reutiliza el índice
 * ya existente desde Fase 3). MissionDetailView llama a esa ruta al abrir
 * la Mission e hidrata `foundContacts` ANTES de que este panel se monte —
 * así Outreach/Booking también ven los contactos persistidos aunque el
 * usuario no vuelva a pasar por esta pestaña. Este panel sigue recibiendo
 * `foundContacts` como prop y solo lo actualiza localmente tras un nuevo
 * "Buscar contactos" — no duplica esa lectura.
 */
import { useEffect, useState } from "react";
import { useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Search, UserSearch, Mail, Phone, Linkedin, AlertCircle, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { LeadResultRow, LeadResultsPage, ContactsByResult, FoundContact, ContactFinderResult } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function OpportunityBadge({ opportunity }: { opportunity: LeadResultRow["opportunity"] }) {
  if (!opportunity) return <span className="text-slate-600 text-xs">Sin analizar</span>;
  const map: Record<string, string> = {
    alta:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    media: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    baja:  "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  const label: Record<string, string> = { alta: "🔥 Alta", media: "➖ Media", baja: "🧊 Baja" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${map[opportunity]}`}>{label[opportunity]}</span>;
}

function ContactRow({ contact }: { contact: FoundContact }) {
  return (
    <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2">
      <div>
        <p className="text-white text-sm font-medium">{contact.name ?? "No disponible"}</p>
        {contact.role && <p className="text-slate-500 text-xs">{contact.role}</p>}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        {contact.email && <span className="flex items-center gap-1"><Mail size={12} /> {contact.email}</span>}
        {contact.phone && <span className="flex items-center gap-1"><Phone size={12} /> {contact.phone}</span>}
        {contact.linkedinUrl && (
          <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-violet-400 hover:underline">
            <Linkedin size={12} /> LinkedIn
          </a>
        )}
        {!contact.email && !contact.phone && !contact.linkedinUrl && <span>No disponible</span>}
      </div>
    </div>
  );
}

function ProspectRow({
  prospect, missionId, canWrite, contacts, onContactsFound,
}: {
  prospect: LeadResultRow; missionId: number; canWrite: boolean;
  contacts: FoundContact[] | undefined; onContactsFound: (resultId: number, contacts: FoundContact[]) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const findMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions/${missionId}/contacts/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadResultId: prospect.id }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error === "provider_not_configured" ? "No hay un proveedor de Contact Finder configurado" : (d.error ?? "Error buscando contactos"));
        return d as ContactFinderResult;
      }),
    onSuccess: (d) => {
      onContactsFound(prospect.id, d.contacts);
      setExpanded(true);
      // Fase 14: mantiene GET /api/missions/:id/contacts (la hidratación de
      // MissionDetailView) coherente con lo que el backend acaba de
      // persistir — no imprescindible para esta sesión (el estado local ya
      // se actualizó arriba), pero evita servir una lista obsoleta si el
      // componente que lo consulta se remonta más adelante.
      qc.invalidateQueries({ queryKey: ["missionContacts", missionId] });
      toast({ title: d.contactsFound > 0 ? `${d.contactsFound} contacto(s) encontrado(s)` : "Sin contactos" });
    },
    onError: (err: Error) => toast({ title: "No se pudo buscar contactos", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="bg-white/[0.02] rounded-xl p-4" data-testid={`prospect-row-${prospect.id}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white text-sm font-medium">{prospect.name}</p>
          <p className="text-slate-500 text-xs">{prospect.sector ?? "Sector no disponible"}{prospect.address ? ` · ${prospect.address}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <OpportunityBadge opportunity={prospect.opportunity} />
          {prospect.score != null && <span className="text-slate-400 text-xs">Score {prospect.score}</span>}
          <Button
            size="sm" variant="outline"
            className="border-white/10 text-slate-300 hover:text-white"
            disabled={!canWrite || findMut.isPending}
            onClick={() => findMut.mutate()}
            data-testid={`find-contacts-${prospect.id}`}
          >
            {findMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <UserSearch size={14} className="mr-1.5" />}
            Buscar contactos
          </Button>
        </div>
      </div>

      {(expanded || contacts) && (
        <div className="mt-3 pl-1 space-y-1.5">
          {!contacts || contacts.length === 0 ? (
            <p className="text-slate-600 text-xs">No se encontraron contactos para este prospecto.</p>
          ) : (
            contacts.map(c => <ContactRow key={c.id} contact={c} />)
          )}
        </div>
      )}
    </div>
  );
}

export function ProspectsPanel({
  missionId, missionStatus, searchIds, canWrite, foundContacts, onContactsFound, onProspectsLoaded,
}: {
  missionId: number; missionStatus: string; searchIds: number[]; canWrite: boolean;
  foundContacts: ContactsByResult; onContactsFound: (resultId: number, contacts: FoundContact[]) => void;
  onProspectsLoaded?: (rows: LeadResultRow[]) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const missionClosed = missionStatus === "completed" || missionStatus === "cancelled";

  const pageQueries = useQueries({
    queries: searchIds.map(searchId => ({
      queryKey: ["missionProspects", missionId, searchId],
      queryFn: () => authFetch(`${BASE}/api/leads/results?searchId=${searchId}&limit=100`).then(r => r.json()) as Promise<LeadResultsPage>,
    })),
  });

  const isLoading = pageQueries.some(q => q.isLoading);
  const hasError  = pageQueries.some(q => q.isError);
  const prospects: LeadResultRow[] = pageQueries.flatMap(q => q.data?.data ?? []);

  const prospectsKey = prospects.map(p => `${p.id}:${p.name}`).join("|");
  useEffect(() => {
    if (onProspectsLoaded && prospects.length > 0) onProspectsLoaded(prospects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectsKey]);

  const researchMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions/${missionId}/research`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al lanzar Research");
        return d as { analyzed: number; failed: number; notAttempted: number; creditsSpent: number; requested: number };
      }),
    onSuccess: (d) => {
      for (const searchId of searchIds) qc.invalidateQueries({ queryKey: ["missionProspects", missionId, searchId] });
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
      toast({
        title: d.requested === 0 ? "No hay prospectos nuevos que investigar" : `Research: ${d.analyzed} analizados`,
        description: d.requested > 0 ? `${d.failed} fallidos · ${d.creditsSpent} créditos gastados` : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "No se pudo lanzar Research", description: err.message, variant: "destructive" }),
  });

  if (searchIds.length === 0) {
    return (
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-12 text-center">
        <Search size={28} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Todavía no se ha lanzado ninguna búsqueda dentro de esta misión.</p>
        <p className="text-slate-600 text-xs mt-1">Ve a OmniLeads → Buscar e indica esta misión al buscar empresas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="prospects-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Sparkles size={14} className="text-violet-400" /> Research</h3>
          <p className="text-slate-500 text-xs mt-0.5">Analiza señales web y puntúa la oportunidad de los prospectos nuevos.</p>
        </div>
        <Button
          onClick={() => researchMut.mutate()}
          disabled={!canWrite || missionClosed || researchMut.isPending}
          className="bg-violet-600 hover:bg-violet-700"
          data-testid="run-research-btn"
        >
          {researchMut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Sparkles size={16} className="mr-2" />}
          Lanzar Research
        </Button>
      </div>
      {missionClosed && (
        <p className="text-amber-400 text-xs flex items-center gap-1.5"><AlertCircle size={14} /> Esta misión está {missionStatus === "completed" ? "completada" : "cancelada"} y no admite nuevo trabajo.</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-violet-400" /></div>
      ) : hasError ? (
        <p className="text-red-400 text-sm">No se pudieron cargar los prospectos.</p>
      ) : prospects.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8 text-center">
          <p className="text-slate-400 text-sm">Las búsquedas de esta misión todavía no han traído prospectos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prospects.map(p => (
            <ProspectRow
              key={p.id} prospect={p} missionId={missionId} canWrite={canWrite && !missionClosed}
              contacts={foundContacts[p.id]} onContactsFound={onContactsFound}
            />
          ))}
        </div>
      )}
    </div>
  );
}
