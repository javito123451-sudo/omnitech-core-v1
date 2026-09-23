import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Target, Plus, Loader2, MapPin, Building2, ArrowLeft, Search as SearchIcon,
  Users, Coins, Pause, CheckCircle2, XCircle, Compass,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ProspectsPanel } from "@/components/omniseller/ProspectsPanel";
import { OutreachPanel } from "@/components/omniseller/OutreachPanel";
import { FollowupPanel } from "@/components/omniseller/FollowupPanel";
import { BookingPanel } from "@/components/omniseller/BookingPanel";
import { TraceabilityPanel } from "@/components/omniseller/TraceabilityPanel";
import type { ContactsByResult, ContactWithLeadContext, FoundContact, LeadResultRow } from "@/components/omniseller/types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface MissionSummary { searchesCount: number; totalProspects: number; }

interface Mission {
  id: number; name: string; objective: string | null; sector: string | null;
  location: string | null; targetProspectCount: number | null; creditBudget: string | null;
  status: "active" | "paused" | "completed" | "cancelled" | string;
  createdAt: string; summary: MissionSummary;
}

interface MissionSearch {
  id: number; sector: string; city: string; status: string; totalFound: number | null; createdAt: string;
}

interface MissionDetail extends Mission {
  searches: MissionSearch[];
}

// ── Helpers visuales ──────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; Icon: typeof CheckCircle2 }> = {
    active:    { cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Activa",     Icon: CheckCircle2 },
    paused:    { cls: "bg-amber-500/20   text-amber-400   border-amber-500/30",   label: "Pausada",    Icon: Pause },
    completed: { cls: "bg-blue-500/20    text-blue-400    border-blue-500/30",    label: "Completada", Icon: CheckCircle2 },
    cancelled: { cls: "bg-red-500/20     text-red-400     border-red-500/30",     label: "Cancelada",  Icon: XCircle },
  };
  const s = map[status] ?? map.active;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${s.cls}`}>
      <s.Icon size={12} /> {s.label}
    </span>
  );
}

// ── Crear misión ──────────────────────────────────────────────────────────────
function NewMissionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", objective: "", sector: "", location: "", targetProspectCount: "", creditBudget: "",
  });

  const mut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          objective: form.objective || undefined,
          sector: form.sector || undefined,
          location: form.location || undefined,
          targetProspectCount: form.targetProspectCount ? Number(form.targetProspectCount) : undefined,
          creditBudget: form.creditBudget ? Number(form.creditBudget) : undefined,
        }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al crear la misión");
        return d as Mission;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["missions"] });
      toast({ title: "Misión creada" });
      setForm({ name: "", objective: "", sector: "", location: "", targetProspectCount: "", creditBudget: "" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "No se pudo crear la misión", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0e1e] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Target size={18} className="text-violet-400" /> Nueva misión</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-slate-400">Nombre *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Dentistas Madrid Centro — Q1" className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-slate-400">Objetivo</Label>
            <Input value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}
              placeholder="Conseguir 10 reuniones cualificadas" className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-400">Sector</Label>
              <Input value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}
                placeholder="Dentistas" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-400">Ubicación</Label>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Madrid" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-400">Prospectos objetivo</Label>
              <Input type="number" value={form.targetProspectCount}
                onChange={e => setForm(f => ({ ...f, targetProspectCount: e.target.value }))}
                placeholder="50" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-400">Presupuesto (créditos)</Label>
              <Input type="number" value={form.creditBudget}
                onChange={e => setForm(f => ({ ...f, creditBudget: e.target.value }))}
                placeholder="200" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            El presupuesto de créditos es orientativo por ahora — todavía no bloquea nuevas búsquedas
            automáticamente (llegará junto con la tarificación definitiva de OmniCredits).
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={!form.name.trim() || mut.isPending} className="bg-violet-600 hover:bg-violet-700">
            {mut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Plus size={16} className="mr-2" />}
            Crear misión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detalle de misión ─────────────────────────────────────────────────────────
function MissionDetailView({ missionId, onBack }: { missionId: number; onBack: () => void }) {
  const { data, isLoading } = useQuery<MissionDetail>({
    queryKey: ["mission", missionId],
    queryFn:  () => authFetch(`${BASE}/api/missions/${missionId}`).then(r => r.json()),
  });
  const { hasPermission } = useOrg();
  const canWrite = hasPermission("omniseller.write");

  // Contactos ya encontrados por Contact Finder, indexados por leadResultId.
  // OmniSeller Fase 14 (cierre de Gap 1, detectado en el informe de
  // Fase 13): hasta ahora esto vivía SOLO en memoria de sesión, porque no
  // existía ningún GET para volver a listarlos tras recargar la página. Se
  // creó GET /api/missions/:id/contacts (mínimo, reutiliza el permiso e
  // índice ya existentes — 0 migraciones) y aquí se usa para hidratar este
  // mismo estado al abrir la Mission, ANTES de que el usuario visite la
  // pestaña Prospectos — así Outreach y Booking también ven los contactos
  // persistidos aunque el usuario entre directamente a esas pestañas tras
  // recargar. Un "Buscar contactos" posterior sigue actualizando este mismo
  // estado con la respuesta síncrona, como en Fase 13.
  const [foundContacts, setFoundContacts] = useState<ContactsByResult>({});
  const [prospectNames, setProspectNames] = useState<Record<number, string>>({});

  const contactsHydration = useQuery<{ missionId: number; contacts: FoundContact[] & { leadResultId: number }[] }>({
    queryKey: ["missionContacts", missionId],
    queryFn: () => authFetch(`${BASE}/api/missions/${missionId}/contacts`).then(r => r.json()),
  });
  const hydratedContactsKey = (contactsHydration.data?.contacts ?? []).map(c => c.id).join(",");
  useEffect(() => {
    const rows = contactsHydration.data?.contacts;
    if (!rows || rows.length === 0) return;
    setFoundContacts(prev => {
      const byResult = new Map<number, FoundContact[]>();
      for (const row of rows as Array<FoundContact & { leadResultId: number }>) {
        const { leadResultId, ...contact } = row;
        if (!byResult.has(leadResultId)) byResult.set(leadResultId, []);
        byResult.get(leadResultId)!.push(contact);
      }
      const next = { ...prev };
      for (const [resultId, contacts] of byResult) {
        // No se pisa un resultado que ya tenga contactos más recientes en
        // este mismo estado (p. ej. un "Buscar contactos" ya ejecutado en
        // esta sesión) — la hidratación solo rellena lo que faltaba.
        if (!next[resultId]) next[resultId] = contacts;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedContactsKey]);

  const handleContactsFound = (resultId: number, contacts: FoundContact[]) =>
    setFoundContacts(prev => ({ ...prev, [resultId]: contacts }));

  const handleProspectsLoaded = (rows: LeadResultRow[]) =>
    setProspectNames(prev => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = r.name;
      return next;
    });

  const contactsWithContext: ContactWithLeadContext[] = useMemo(() => {
    const out: ContactWithLeadContext[] = [];
    for (const [resultIdStr, contacts] of Object.entries(foundContacts)) {
      const resultId = Number(resultIdStr);
      for (const c of contacts ?? []) {
        out.push({ ...c, leadResultId: resultId, leadName: prospectNames[resultId] ?? `Prospecto #${resultId}` });
      }
    }
    return out;
  }, [foundContacts, prospectNames]);

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-violet-400" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm">
        <ArrowLeft size={16} /> Volver a misiones
      </button>

      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-white font-semibold text-lg">{data.name}</h2>
              <StatusPill status={data.status} />
            </div>
            {data.objective && <p className="text-slate-400 text-sm">{data.objective}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="bg-white/[0.02] rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><SearchIcon size={12} /> Búsquedas</p>
            <p className="text-white text-xl font-bold">{data.summary.searchesCount}</p>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><Users size={12} /> Prospectos</p>
            <p className="text-white text-xl font-bold">{data.summary.totalProspects}</p>
            {data.targetProspectCount != null && (
              <p className="text-slate-600 text-xs">de {data.targetProspectCount} objetivo</p>
            )}
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><Coins size={12} /> Presupuesto</p>
            <p className="text-white text-xl font-bold">{data.creditBudget ?? "—"}</p>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><MapPin size={12} /> Ubicación</p>
            <p className="text-white text-sm font-medium">{data.location ?? "—"}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="resumen">
        <TabsList className="bg-white/[0.03] border border-white/[0.06]">
          <TabsTrigger value="resumen" data-testid="tab-resumen">Resumen</TabsTrigger>
          <TabsTrigger value="prospectos" data-testid="tab-prospectos">Prospectos</TabsTrigger>
          <TabsTrigger value="outreach" data-testid="tab-outreach">Outreach</TabsTrigger>
          <TabsTrigger value="followup" data-testid="tab-followup">Follow-up</TabsTrigger>
          <TabsTrigger value="booking" data-testid="tab-booking">Booking</TabsTrigger>
          <TabsTrigger value="trazabilidad" data-testid="tab-trazabilidad">Trazabilidad</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="pt-4">
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-white font-semibold text-sm mb-4">Búsquedas de esta misión</h3>
            {data.searches.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">
                Todavía no se ha lanzado ninguna búsqueda dentro de esta misión.
                Ve a OmniLeads → Buscar e indica esta misión al buscar empresas.
              </p>
            ) : (
              <div className="space-y-2">
                {data.searches.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                    <div>
                      <p className="text-white text-sm font-medium">{s.sector} en {s.city}</p>
                      <p className="text-slate-500 text-xs">{new Date(s.createdAt).toLocaleDateString("es-ES")} · {s.status}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-violet-400 text-sm font-bold">{s.totalFound ?? 0}</p>
                      <p className="text-slate-600 text-xs">empresas</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="prospectos" className="pt-4">
          <ProspectsPanel
            missionId={missionId} missionStatus={data.status} searchIds={data.searches.map(s => s.id)}
            canWrite={canWrite} foundContacts={foundContacts} onContactsFound={handleContactsFound}
            onProspectsLoaded={handleProspectsLoaded}
          />
        </TabsContent>

        <TabsContent value="outreach" className="pt-4">
          <OutreachPanel missionId={missionId} canWrite={canWrite} contacts={contactsWithContext} />
        </TabsContent>

        <TabsContent value="followup" className="pt-4">
          <FollowupPanel missionId={missionId} canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="booking" className="pt-4">
          <BookingPanel missionId={missionId} canWrite={canWrite} contacts={contactsWithContext} />
        </TabsContent>

        <TabsContent value="trazabilidad" className="pt-4">
          <TraceabilityPanel missionId={missionId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function MissionsPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: missions, isLoading } = useQuery<Mission[]>({
    queryKey: ["missions"],
    queryFn:  () => authFetch(`${BASE}/api/missions`).then(r => r.json()),
    enabled:  selected === null,
  });

  if (selected != null) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <MissionDetailView missionId={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Compass size={20} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-lg">Misiones</h1>
            <p className="text-slate-500 text-sm">Orquesta tus campañas de prospección — OmniSeller</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus size={16} className="mr-2" /> Nueva misión
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
      ) : !missions || missions.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-12 text-center">
          <Target size={32} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Todavía no has creado ninguna misión.</p>
          <p className="text-slate-600 text-xs mt-1">Una misión agrupa tus búsquedas de prospección bajo un objetivo común.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {missions.map(m => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className="text-left bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 hover:border-violet-500/40 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <p className="text-white font-medium">{m.name}</p>
                <StatusPill status={m.status} />
              </div>
              {m.sector && (
                <p className="text-slate-500 text-xs flex items-center gap-1 mb-1"><Building2 size={12} /> {m.sector}{m.location ? ` · ${m.location}` : ""}</p>
              )}
              <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                <span className="flex items-center gap-1"><SearchIcon size={12} /> {m.summary.searchesCount} búsquedas</span>
                <span className="flex items-center gap-1"><Users size={12} /> {m.summary.totalProspects} prospectos</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <NewMissionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
