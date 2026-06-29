import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Target, ChevronRight, DollarSign, User, Calendar, ArrowRight, ArrowLeft,
  Plus, Briefcase,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Deal {
  id: number;
  clientId: number;
  clientName: string | null;
  clientCompany: string | null;
  stageId: number;
  value: number;
  currency: string;
  assignedToUserId: number | null;
  assignedName: string | null;
  expectedCloseDate: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface Stage {
  id: number;
  name: string;
  color: string;
  orderIndex: number;
  winProbability: number;
}

async function fetchStages(): Promise<Stage[]> {
  const res = await authFetch(`${BASE}/api/pipeline/stages`);
  if (!res.ok) throw new Error("Error cargando etapas");
  return res.json();
}

async function fetchDeals(): Promise<Deal[]> {
  const res = await authFetch(`${BASE}/api/pipeline/deals`);
  if (!res.ok) throw new Error("Error cargando deals");
  return res.json();
}

async function moveDeal(id: number, stageId: number) {
  const res = await authFetch(`${BASE}/api/pipeline/deals/${id}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stageId }),
  });
  if (!res.ok) throw new Error("Error moviendo deal");
  return res.json();
}

async function createDeal(body: Record<string, unknown>) {
  const res = await authFetch(`${BASE}/api/pipeline/deals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error creando deal");
  return res.json();
}

export default function PipelinePage() {
  const queryClient = useQueryClient();
  const { data: stages = [], isLoading: stagesLoading } = useQuery({ queryKey: ["pipeline-stages"], queryFn: fetchStages });
  const { data: deals = [], isLoading: dealsLoading } = useQuery({ queryKey: ["pipeline-deals"], queryFn: fetchDeals });
  const [filterSeller, setFilterSeller] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: number; stageId: number }) => moveDeal(id, stageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pipeline-deals"] }),
  });

  const createMutation = useMutation({
    mutationFn: createDeal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals"] });
      setCreateOpen(false);
    },
  });

  const sellers = Array.from(new Set(deals.filter(d => d.assignedName).map(d => d.assignedName)));

  const filteredDeals = filterSeller === "all"
    ? deals
    : deals.filter(d => d.assignedName === filterSeller);

  const sortedStages = [...stages].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Pipeline Comercial</h1>
          <p className="text-muted-foreground text-xs mt-0.5">Gestiona tus oportunidades de venta</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterSeller} onValueChange={setFilterSeller}>
            <SelectTrigger className="w-[140px] h-8 text-xs bg-card border-border">
              <SelectValue placeholder="Filtrar vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {sellers.map(s => (
                <SelectItem key={s} value={s!}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs">
                <Plus className="w-3.5 h-3.5 mr-1" /> Nuevo Deal
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base">Nueva Oportunidad</DialogTitle>
              </DialogHeader>
              <CreateDealForm stages={sortedStages} onSubmit={(b) => createMutation.mutate(b)} loading={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {sortedStages.map(stage => {
          const stageDeals = filteredDeals.filter(d => d.stageId === stage.id);
          const stageValue = stageDeals.reduce((s, d) => s + (d.value ?? 0), 0);
          return (
            <div key={stage.id} className="w-72 shrink-0">
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-xs font-semibold text-white">{stage.name}</span>
                <Badge variant="outline" className="text-[10px] h-5 ml-auto border-white/10">
                  {stageDeals.length}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground px-1 mb-2">
                €{stageValue.toLocaleString(undefined, {maximumFractionDigits:0})} • {stage.winProbability}% prob.
              </div>
              <div className="space-y-2">
                {stageDeals.map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stages={sortedStages}
                    onMove={(stageId) => moveMutation.mutate({ id: deal.id, stageId })}
                  />
                ))}
                {stageDeals.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground/40 text-xs border border-dashed border-border rounded-lg">
                    Sin oportunidades
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ deal, stages, onMove }: { deal: Deal; stages: Stage[]; onMove: (stageId: number) => void }) {
  const currentIndex = stages.findIndex(s => s.id === deal.stageId);
  const prevStage = currentIndex > 0 ? stages[currentIndex - 1] : null;
  const nextStage = currentIndex < stages.length - 1 ? stages[currentIndex + 1] : null;

  return (
    <Card className="bg-card/80 border-border hover:border-white/15 transition-all">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-white">{deal.clientName ?? "Sin nombre"}</p>
            {deal.clientCompany && <p className="text-[10px] text-muted-foreground">{deal.clientCompany}</p>}
          </div>
          <span className="text-xs font-semibold text-emerald-400">€{(deal.value ?? 0).toLocaleString()}</span>
        </div>
        {deal.notes && <p className="text-[10px] text-muted-foreground line-clamp-2">{deal.notes}</p>}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <User className="w-3 h-3" />
            {deal.assignedName ?? "Sin asignar"}
          </div>
          <div className="flex items-center gap-1">
            {prevStage && (
              <button
                onClick={() => onMove(prevStage.id)}
                className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-white transition-colors"
                title={`Mover a ${prevStage.name}`}
              >
                <ArrowLeft className="w-3 h-3" />
              </button>
            )}
            {nextStage && (
              <button
                onClick={() => onMove(nextStage.id)}
                className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-white transition-colors"
                title={`Mover a ${nextStage.name}`}
              >
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateDealForm({ stages, onSubmit, loading }: { stages: Stage[]; onSubmit: (b: Record<string, unknown>) => void; loading: boolean }) {
  const [clientId, setClientId] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id?.toString() ?? "");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="space-y-3 pt-2">
      <div>
        <label className="text-xs text-muted-foreground">ID Cliente</label>
        <Input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Ej: 42" className="bg-card border-border text-sm" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Etapa</label>
        <Select value={stageId} onValueChange={setStageId}>
          <SelectTrigger className="bg-card border-border text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stages.map(s => (
              <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Valor (€)</label>
        <Input value={value} onChange={e => setValue(e.target.value)} placeholder="5000" type="number" className="bg-card border-border text-sm" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Notas</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Detalles..." className="bg-card border-border text-sm" />
      </div>
      <Button
        className="w-full"
        disabled={!clientId || !stageId || loading}
        onClick={() => onSubmit({ clientId: Number(clientId), stageId: Number(stageId), value: Number(value) || 0, notes })}
      >
        {loading ? "Creando..." : "Crear Oportunidad"}
      </Button>
    </div>
  );
}
