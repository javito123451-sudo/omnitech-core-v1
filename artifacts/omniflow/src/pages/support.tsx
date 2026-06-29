import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Ticket, Plus, MessageSquare, Clock, CheckCircle2, AlertTriangle,
  ChevronRight, User, XCircle, Loader2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface TicketItem {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  resolution: string | null;
  creatorUserId: number | null;
  creatorEmail: string | null;
  creatorName: string | null;
  assignedToUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketComment {
  id: number;
  userId: number | null;
  authorName: string | null;
  isInternal: boolean;
  body: string;
  createdAt: string;
}

interface TicketDetail extends TicketItem {
  comments: TicketComment[];
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: "Abierto", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: Ticket },
  in_progress: { label: "En progreso", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Loader2 },
  resolved: { label: "Resuelto", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  closed: { label: "Cerrado", color: "bg-slate-500/10 text-slate-400 border-slate-500/20", icon: XCircle },
};

const PRIORITY_META: Record<string, string> = {
  low: "text-slate-400",
  medium: "text-amber-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

async function fetchTickets(status?: string): Promise<TicketItem[]> {
  const url = status ? `${BASE}/api/support/tickets?status=${status}` : `${BASE}/api/support/tickets`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error("Error cargando tickets");
  return res.json();
}

async function fetchTicketDetail(id: number): Promise<TicketDetail> {
  const res = await authFetch(`${BASE}/api/support/tickets/${id}`);
  if (!res.ok) throw new Error("Error cargando ticket");
  return res.json();
}

async function createTicket(body: Record<string, string>) {
  const res = await authFetch(`${BASE}/api/support/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error creando ticket");
  return res.json();
}

async function updateTicket(id: number, body: Record<string, unknown>) {
  const res = await authFetch(`${BASE}/api/support/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error actualizando ticket");
  return res.json();
}

async function addComment(ticketId: number, body: string) {
  const res = await authFetch(`${BASE}/api/support/tickets/${ticketId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error("Error añadiendo comentario");
  return res.json();
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets", statusFilter],
    queryFn: () => fetchTickets(statusFilter === "all" ? undefined : statusFilter),
  });

  const { data: detail } = useQuery({
    queryKey: ["support-ticket", detailId],
    queryFn: () => fetchTicketDetail(detailId!),
    enabled: detailId !== null,
  });

  const createMutation = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updateTicket(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support-ticket", detailId] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: ({ ticketId, body }: { ticketId: number; body: string }) => addComment(ticketId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-ticket", detailId] }),
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Soporte e Incidencias</h1>
          <p className="text-muted-foreground text-xs mt-0.5">Gestiona tickets y solicitudes de ayuda</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Nuevo Ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">Crear Ticket de Soporte</DialogTitle>
            </DialogHeader>
            <CreateTicketForm onSubmit={(b) => createMutation.mutate(b)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(["all", "open", "in_progress", "resolved", "closed"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              statusFilter === s
                ? "bg-primary/15 text-primary border border-primary/20"
                : "bg-muted text-muted-foreground border border-transparent hover:bg-muted/60",
            )}
          >
            {s === "all" ? "Todos" : STATUS_META[s]?.label ?? s}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      <div className="grid gap-2.5">
        {isLoading && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
            Cargando tickets...
          </div>
        )}
        {tickets.map(ticket => {
          const meta = STATUS_META[ticket.status] ?? STATUS_META.open;
          const StatusIcon = meta.icon;
          return (
            <Card
              key={ticket.id}
              className="bg-card border-border hover:border-white/10 transition-all cursor-pointer"
              onClick={() => setDetailId(ticket.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-white truncate">{ticket.title}</h3>
                      <Badge variant="outline" className={cn("text-[10px] h-5", meta.color)}>
                        <StatusIcon className="w-3 h-3 mr-1" /> {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{ticket.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={cn("text-[10px] font-medium", PRIORITY_META[ticket.priority] ?? "text-muted-foreground")}>
                        {ticket.priority.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{ticket.category}</span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(ticket.createdAt), { locale: es, addSuffix: true })}
                      </span>
                      {ticket.creatorName && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" /> {ticket.creatorName}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {tickets.length === 0 && !isLoading && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <Ticket className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No hay tickets {statusFilter !== "all" ? `en estado "${statusFilter}"` : ""}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base pr-6">{detail.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px] h-5", STATUS_META[detail.status]?.color)}>
                    {STATUS_META[detail.status]?.label ?? detail.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] h-5 border-white/10">
                    {detail.category}
                  </Badge>
                  <span className={cn("text-[10px] font-medium", PRIORITY_META[detail.priority])}>
                    {detail.priority.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm text-foreground">{detail.description}</p>
                {detail.resolution && (
                  <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3">
                    <p className="text-xs font-medium text-emerald-400 mb-1">Resolución</p>
                    <p className="text-xs text-emerald-300/80">{detail.resolution}</p>
                  </div>
                )}
                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {detail.status === "open" && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => updateMutation.mutate({ id: detail.id, body: { status: "in_progress" } })}>
                      <Loader2 className="w-3 h-3 mr-1" /> En progreso
                    </Button>
                  )}
                  {(detail.status === "open" || detail.status === "in_progress") && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateMutation.mutate({ id: detail.id, body: { status: "resolved" } })}>
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Resolver
                    </Button>
                  )}
                  {detail.status === "resolved" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateMutation.mutate({ id: detail.id, body: { status: "closed" } })}>
                      <XCircle className="w-3 h-3 mr-1" /> Cerrar
                    </Button>
                  )}
                </div>
                {/* Comments */}
                <div className="border-t border-border pt-4 space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Comentarios</h4>
                  {detail.comments.map(c => (
                    <div key={c.id} className={cn("rounded-lg p-3", c.isInternal ? "bg-amber-500/5 border border-amber-500/10" : "bg-muted/30")}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-white">{c.authorName ?? "Usuario"}</span>
                        {c.isInternal && <Badge variant="outline" className="text-[10px] h-4 border-amber-500/30 text-amber-400">Interno</Badge>}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(c.createdAt), { locale: es, addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-foreground">{c.body}</p>
                    </div>
                  ))}
                  {detail.comments.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">Sin comentarios</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Añadir comentario..."
                      className="bg-card border-border text-sm h-8"
                      onKeyDown={e => {
                        if (e.key === "Enter" && e.currentTarget.value.trim()) {
                          commentMutation.mutate({ ticketId: detail.id, body: e.currentTarget.value.trim() });
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateTicketForm({ onSubmit, loading }: { onSubmit: (b: Record<string, string>) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");

  return (
    <div className="space-y-3 pt-2">
      <div>
        <label className="text-xs text-muted-foreground">Título</label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Error al generar presupuesto" className="bg-card border-border text-sm" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Descripción</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe el problema..." className="bg-card border-border text-sm min-h-[80px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Categoría</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-card border-border text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="billing">Facturación</SelectItem>
              <SelectItem value="technical">Técnico</SelectItem>
              <SelectItem value="feature_request">Sugerencia</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Prioridad</label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="bg-card border-border text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baja</SelectItem>
              <SelectItem value="medium">Media</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="critical">Crítica</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        className="w-full"
        disabled={!title.trim() || !description.trim() || loading}
        onClick={() => onSubmit({ title, description, category, priority })}
      >
        {loading ? "Creando..." : "Crear Ticket"}
      </Button>
    </div>
  );
}
