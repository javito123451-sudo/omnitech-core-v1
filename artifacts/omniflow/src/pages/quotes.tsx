import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge }     from "@/components/ui/badge";
import { useToast }  from "@/hooks/use-toast";
import {
  Plus, FileText, Download, Trash2, Pencil, Search, X,
  ChevronRight, Euro, Calendar, User, Package,
  Brain, Sparkles, TrendingUp, CheckCircle2, Clock,
  Target, Send, AlertCircle, Loader2, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { authFetch } from "@/lib/authFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api  = (path: string) => `${BASE}${path}`;

// ── Types ─────────────────────────────────────────────────────────────────────
interface QuoteItem {
  id?:          number;
  description:  string;
  quantity:     number;
  unitPrice:    number;
  total:        number;
  orderIndex:   number;
}
interface Client {
  id:      number;
  name:    string;
  company: string | null;
  email:   string;
  phone:   string | null;
  status:  string;
}
interface QuoteRow {
  id:            number;
  title:         string;
  status:        string;
  currency:      string;
  subtotal:      number;
  taxRate:       number;
  taxAmount:     number;
  total:         number;
  notes:         string | null;
  validUntil:    string | null;
  createdAt:     string;
  updatedAt:     string;
  clientId:      number;
  clientName:    string | null;
  clientCompany: string | null;
  clientEmail:   string | null;
}
interface QuoteDetail extends QuoteRow {
  items:  QuoteItem[];
  client: Client | null;
}
interface PriorityQuote {
  id:            number;
  title:         string;
  status:        string;
  total:         number;
  clientName:    string | null;
  clientCompany: string | null;
  daysSince:     number;
  score:         number;
  prob:          number;
  isTop:         boolean;
  action:        string | null;
  reason:        string | null;
}
interface PriorityResult {
  ranked:       PriorityQuote[];
  summary:      string | null;
  generated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  draft:    { label: "Borrador",  cls: "bg-muted text-muted-foreground",                            icon: FileText },
  sent:     { label: "Enviado",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/20",           icon: Send },
  pending:  { label: "Pendiente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/20",        icon: Clock },
  accepted: { label: "Aceptado",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",  icon: CheckCircle2 },
  rejected: { label: "Rechazado", cls: "bg-red-500/15 text-red-400 border-red-500/20",              icon: X },
};
const TABS = ["todos", "draft", "sent", "pending", "accepted", "rejected"] as const;
const TAB_LABELS: Record<string, string> = {
  todos: "Todos", draft: "Borrador", sent: "Enviado",
  pending: "Pendiente", accepted: "Aceptado", rejected: "Rechazado",
};

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

// ── Fetchers ──────────────────────────────────────────────────────────────────
async function fetchQuotes(): Promise<QuoteRow[]> {
  const r = await authFetch(api("/api/quotes"));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function fetchClients(): Promise<Client[]> {
  const r = await authFetch(api("/api/clients"));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function fetchQuote(id: number): Promise<QuoteDetail> {
  const r = await authFetch(api(`/api/quotes/${id}`));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Empty line-item ───────────────────────────────────────────────────────────
function emptyItem(): QuoteItem {
  return { description: "", quantity: 1, unitPrice: 0, total: 0, orderIndex: 0 };
}

// ═════════════════════════════════════════════════════════════════════════════
// AI Priority Panel
// ═════════════════════════════════════════════════════════════════════════════
function AIPriorityPanel({ onViewQuote }: { onViewQuote: (id: number) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PriorityResult | null>(null);

  const prioritize = useMutation({
    mutationFn: async () => {
      const r = await authFetch(api("/api/quotes/ai-prioritize"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<PriorityResult>;
    },
    onSuccess: (data) => { setResult(data); setOpen(true); },
    onError: (e: Error) => toast({ title: "Error IA", description: e.message, variant: "destructive" }),
  });

  const scoreColor = (score: number, max: number) => {
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.7) return "text-red-400";
    if (pct >= 0.4) return "text-amber-400";
    return "text-blue-400";
  };

  const maxScore = result ? Math.max(...result.ranked.map(r => r.score), 1) : 1;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => prioritize.mutate()}
        disabled={prioritize.isPending}
        className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
      >
        {prioritize.isPending
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Brain className="w-4 h-4" />}
        ¿Qué presupuesto perseguir hoy?
      </Button>

      {open && result && (
        <Dialog open onOpenChange={v => !v && setOpen(false)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Priorización IA — Presupuestos
              </DialogTitle>
            </DialogHeader>

            {result.summary && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex gap-3">
                <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
              </div>
            )}

            {result.ranked.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Target className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No hay presupuestos activos para priorizar.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Ordenados por: valor × probabilidad × días sin respuesta
                </p>
                {result.ranked.map((q, idx) => {
                  const sm = STATUS_META[q.status] ?? STATUS_META["draft"];
                  const ScoreIcon = sm.icon;
                  return (
                    <div
                      key={q.id}
                      className={cn(
                        "rounded-xl border p-4 space-y-2.5 transition-all",
                        q.isTop
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0",
                            q.isTop ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                          )}>
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{q.title}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {q.clientName}{q.clientCompany ? ` · ${q.clientCompany}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {q.isTop && (
                            <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                              HOY
                            </span>
                          )}
                          <Badge className={cn("text-xs border", sm.cls)}>
                            {sm.label}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                          <p className="text-[10px] text-muted-foreground">Valor</p>
                          <p className="text-xs font-bold text-foreground">{eur(q.total ?? 0)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                          <p className="text-[10px] text-muted-foreground">Probabilidad</p>
                          <p className="text-xs font-bold text-foreground">{Math.round(q.prob * 100)}%</p>
                        </div>
                        <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                          <p className="text-[10px] text-muted-foreground">Sin respuesta</p>
                          <p className={cn("text-xs font-bold", scoreColor(q.score, maxScore))}>
                            {q.daysSince}d
                          </p>
                        </div>
                      </div>

                      {q.action && (
                        <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-2.5">
                          <AlertCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-foreground">{q.action}</p>
                            {q.reason && <p className="text-[11px] text-muted-foreground">{q.reason}</p>}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Score:</span>
                          <span className={cn("text-[11px] font-bold tabular-nums", scoreColor(q.score, maxScore))}>
                            {q.score.toLocaleString("es-ES")}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant={q.isTop ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => { setOpen(false); onViewQuote(q.id); }}
                        >
                          Ver presupuesto <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground">
                Generado {new Date(result.generated_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <Button size="sm" variant="outline" onClick={() => { setResult(null); prioritize.mutate(); }}>
                <Brain className="w-3.5 h-3.5 mr-1.5" /> Regenerar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Create / Edit Modal
// ═════════════════════════════════════════════════════════════════════════════
function QuoteFormModal({
  open, onClose, clients, editQuote,
}: {
  open:       boolean;
  onClose:    () => void;
  clients:    Client[];
  editQuote?: QuoteDetail | null;
}) {
  const qc      = useQueryClient();
  const { toast } = useToast();

  const [clientId,   setClientId]   = useState<string>(editQuote ? String(editQuote.clientId) : "");
  const [title,      setTitle]      = useState(editQuote?.title ?? "");
  const [taxRate,    setTaxRate]    = useState(String(editQuote?.taxRate ?? 21));
  const [notes,      setNotes]      = useState(editQuote?.notes ?? "");
  const [validUntil, setValidUntil] = useState(
    editQuote?.validUntil ? editQuote.validUntil.substring(0, 10) : "",
  );
  const [items, setItems] = useState<QuoteItem[]>(
    editQuote?.items?.length
      ? editQuote.items
      : [emptyItem()],
  );

  const subtotal  = items.reduce((a, i) => a + i.total, 0);
  const tax       = subtotal * (parseFloat(taxRate) / 100 || 0);
  const total     = subtotal + tax;

  const updateItem = (idx: number, field: keyof QuoteItem, val: string | number) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [field]: val };
      if (field === "quantity" || field === "unitPrice") {
        next.total = (Number(next.quantity) || 0) * (Number(next.unitPrice) || 0);
      }
      return next;
    }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        clientId: parseInt(clientId),
        title,
        taxRate:   parseFloat(taxRate) || 21,
        notes:     notes || null,
        validUntil: validUntil || null,
        items: items.map((it, idx) => ({
          description: it.description,
          quantity:    Number(it.quantity),
          unitPrice:   Number(it.unitPrice),
          orderIndex:  idx,
        })),
      };
      const url    = editQuote ? api(`/api/quotes/${editQuote.id}`) : api("/api/quotes");
      const method = editQuote ? "PATCH" : "POST";
      const r = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: editQuote ? "Presupuesto actualizado" : "Presupuesto creado", description: title });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const valid = clientId && title.trim() && items.every(i => i.description.trim());

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editQuote ? "Editar presupuesto" : "Nuevo presupuesto"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Client + Title */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Cliente *</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.company ? ` — ${c.company}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Título del presupuesto *</Label>
              <Input
                placeholder="Ej: Servicios de automatización Q3"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Líneas de presupuesto *</Label>
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => setItems(p => [...p, emptyItem()])}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Añadir línea
              </Button>
            </div>

            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_110px_100px_32px] gap-2 text-xs text-muted-foreground px-1">
              <span>Descripción</span>
              <span className="text-center">Cant.</span>
              <span className="text-right">Precio unit.</span>
              <span className="text-right">Importe</span>
              <span />
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_110px_100px_32px] gap-2 items-center">
                <Input
                  placeholder="Descripción del servicio"
                  value={item.description}
                  onChange={e => updateItem(idx, "description", e.target.value)}
                />
                <Input
                  type="number" min={0} step="0.01"
                  className="text-center"
                  value={item.quantity}
                  onChange={e => updateItem(idx, "quantity", e.target.value)}
                />
                <Input
                  type="number" min={0} step="0.01"
                  className="text-right"
                  value={item.unitPrice}
                  onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                />
                <div className="text-right text-sm font-medium text-foreground pr-1">
                  {eur(item.total)}
                </div>
                <Button
                  type="button" size="icon" variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={items.length === 1}
                  onClick={() => setItems(p => p.filter((_, i) => i !== idx))}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Totals + IVA */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{eur(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground gap-2">
                <span className="shrink-0">IVA (%)</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} max={100} step="0.5"
                    className="h-7 w-16 text-right text-xs"
                    value={taxRate}
                    onChange={e => setTaxRate(e.target.value)}
                  />
                  <span className="text-xs w-20 text-right">{eur(tax)}</span>
                </div>
              </div>
              <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1.5">
                <span>Total</span>
                <span className="text-primary">{eur(total)}</span>
              </div>
            </div>
          </div>

          {/* Notes + valid until */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Textarea
                placeholder="Condiciones de pago, observaciones..."
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Válido hasta</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Guardando..." : editQuote ? "Guardar cambios" : "Crear presupuesto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Detail Modal
// ═════════════════════════════════════════════════════════════════════════════
function QuoteDetailModal({
  quoteId, onClose, onEdit,
}: {
  quoteId: number;
  onClose: () => void;
  onEdit:  () => void;
}) {
  const qc      = useQueryClient();
  const { toast } = useToast();

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote", quoteId],
    queryFn:  () => fetchQuote(quoteId),
  });

  const changeStatus = useMutation({
    mutationFn: async (status: string) => {
      const r = await authFetch(api(`/api/quotes/${quoteId}/status`), {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteQuote = useMutation({
    mutationFn: async () => {
      const r = await authFetch(api(`/api/quotes/${quoteId}`), { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: "Presupuesto eliminado" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const convertToInvoice = useMutation({
    mutationFn: async () => {
      const r = await authFetch(api(`/api/accounting/invoices/from-quote/${quoteId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Factura creada", description: "El presupuesto se ha convertido en factura correctamente." });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (e: Error) => toast({ title: "Error al crear factura", description: e.message, variant: "destructive" }),
  });

  const downloadPdf = () => {
    const a = document.createElement("a");
    a.href     = api(`/api/quotes/${quoteId}/pdf`);
    a.download = `presupuesto-${String(quoteId).padStart(5, "0")}.pdf`;
    a.click();
  };

  if (isLoading || !quote) {
    return (
      <Dialog open onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">Cargando presupuesto</DialogTitle>
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Cargando presupuesto...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const sm = STATUS_META[quote.status] ?? STATUS_META["draft"];

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-6">
            <div>
              <DialogTitle className="text-lg">{quote.title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Presupuesto #{String(quote.id).padStart(5, "0")} · {fmt(quote.createdAt)}
              </p>
            </div>
            <Badge className={cn("shrink-0 border", sm.cls)}>{sm.label}</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Client */}
          {quote.client && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <User className="w-4 h-4 mt-0.5 text-primary shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{quote.client.name}</p>
                {quote.client.company && <p className="text-muted-foreground">{quote.client.company}</p>}
                <p className="text-muted-foreground">{quote.client.email}</p>
              </div>
            </div>
          )}

          {/* Items table */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Líneas del presupuesto
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descripción</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground w-16">Cant.</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Precio unit.</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.items.map((item, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{eur(item.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium">{eur(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-60 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>{eur(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>IVA ({quote.taxRate}%)</span><span>{eur(quote.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1.5">
                <span>Total</span>
                <span className="text-primary text-base">{eur(quote.total)}</span>
              </div>
            </div>
          </div>

          {/* Notes + valid until */}
          {(quote.notes || quote.validUntil) && (
            <div className="flex gap-4 text-sm text-muted-foreground">
              {quote.validUntil && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Válido hasta {fmt(quote.validUntil)}
                </div>
              )}
              {quote.notes && (
                <p className="italic">{quote.notes}</p>
              )}
            </div>
          )}

          {/* Status actions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Cambiar estado
            </p>
            <div className="flex flex-wrap gap-2">
              {(["draft", "sent", "pending", "accepted", "rejected"] as const).map(s => {
                const m = STATUS_META[s];
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    disabled={quote.status === s || changeStatus.isPending}
                    className={cn(quote.status === s && "opacity-40")}
                    onClick={() => changeStatus.mutate(s)}
                  >
                    {m.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => deleteQuote.mutate()}
            disabled={deleteQuote.isPending}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Eliminar
          </Button>
          <div className="flex-1" />
          {(quote.status === "accepted") && (
            <Button
              size="sm"
              variant="outline"
              className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
              onClick={() => convertToInvoice.mutate()}
              disabled={convertToInvoice.isPending}
            >
              {convertToInvoice.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Receipt className="w-3.5 h-3.5 mr-1.5" />}
              Convertir a Factura
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Editar
          </Button>
          <Button size="sm" onClick={downloadPdf}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Descargar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Metric Card
// ═════════════════════════════════════════════════════════════════════════════
function MetricCard({
  label, value, sub, icon: Icon, accentClass,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; accentClass: string;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 flex flex-col gap-1.5",
      "bg-card", accentClass,
    )}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Quotes Page
// ═════════════════════════════════════════════════════════════════════════════
export default function Quotes() {
  const [tab,        setTab]        = useState<string>("todos");
  const [search,     setSearch]     = useState("");
  const [modal,      setModal]      = useState<"create" | "view" | "edit" | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editQuote,  setEditQuote]  = useState<QuoteDetail | null>(null);

  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: fetchQuotes });
  const { data: clients = [] }           = useQuery({ queryKey: ["clients"], queryFn: fetchClients });

  const filtered = useMemo(() => {
    let rows = quotes;
    if (tab !== "todos") rows = rows.filter(q => q.status === tab);
    if (search.trim()) {
      const s = search.toLowerCase();
      rows = rows.filter(q =>
        q.title.toLowerCase().includes(s) ||
        (q.clientName ?? "").toLowerCase().includes(s) ||
        (q.clientCompany ?? "").toLowerCase().includes(s),
      );
    }
    return rows;
  }, [quotes, tab, search]);

  // ── Metrics ──────────────────────────────────────────────────────────────
  const totalSent     = quotes.filter(q => q.status === "sent").reduce((a, q) => a + q.total, 0);
  const totalAccepted = quotes.filter(q => q.status === "accepted").reduce((a, q) => a + q.total, 0);
  const totalPending  = quotes.filter(q => q.status === "pending").reduce((a, q) => a + q.total, 0);
  const closedCount   = quotes.filter(q => ["accepted", "rejected"].includes(q.status)).length;
  const acceptedCount = quotes.filter(q => q.status === "accepted").length;
  const closingRate   = closedCount > 0 ? Math.round((acceptedCount / closedCount) * 100) : null;

  const openView = (id: number) => { setSelectedId(id); setModal("view"); };
  const openEdit = async (id: number) => {
    const r = await authFetch(api(`/api/quotes/${id}`));
    const q = await r.json() as QuoteDetail;
    setEditQuote(q); setSelectedId(id); setModal("edit");
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Presupuestos
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {quotes.length} presupuestos
              {acceptedCount > 0 && ` · ${acceptedCount} aceptado${acceptedCount > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AIPriorityPanel onViewQuote={openView} />
            <Button onClick={() => { setEditQuote(null); setModal("create"); }}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo presupuesto
            </Button>
          </div>
        </div>
      </div>

      {/* ── Metric Cards ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-4 pb-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Enviado"
            value={new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalSent)}
            sub={`${quotes.filter(q => q.status === "sent").length} presupuesto${quotes.filter(q => q.status === "sent").length !== 1 ? "s" : ""}`}
            icon={Send}
            accentClass="border-blue-500/20"
          />
          <MetricCard
            label="Total Aceptado"
            value={new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalAccepted)}
            sub={`${acceptedCount} cerrado${acceptedCount !== 1 ? "s" : ""}`}
            icon={CheckCircle2}
            accentClass="border-emerald-500/20"
          />
          <MetricCard
            label="Total Pendiente"
            value={new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalPending)}
            sub={`${quotes.filter(q => q.status === "pending").length} en negociación`}
            icon={Clock}
            accentClass="border-amber-500/20"
          />
          <MetricCard
            label="Tasa de Cierre"
            value={closingRate !== null ? `${closingRate}%` : "—"}
            sub={closedCount > 0 ? `${acceptedCount} de ${closedCount} cerrados` : "Sin datos aún"}
            icon={TrendingUp}
            accentClass="border-primary/20"
          />
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-3 flex items-center gap-4">
        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                tab === t
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {TAB_LABELS[t]}
              <span className="ml-1.5 text-xs opacity-60">
                {t === "todos"
                  ? quotes.length
                  : quotes.filter(q => q.status === t).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Buscar presupuesto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── List ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Cargando presupuestos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <FileText className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {search ? "Sin resultados" : "No hay presupuestos"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {search
                ? "Prueba con otro término de búsqueda"
                : "Crea tu primer presupuesto para empezar"}
            </p>
            {!search && (
              <Button size="sm" onClick={() => { setEditQuote(null); setModal("create"); }}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Nuevo presupuesto
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(q => {
              const sm = STATUS_META[q.status] ?? STATUS_META["draft"];
              return (
                <button
                  key={q.id}
                  onClick={() => openView(q.id)}
                  className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{q.title}</p>
                      {(q.clientName || q.clientCompany) && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          <span className="inline-flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {q.clientName}
                            {q.clientCompany && ` · ${q.clientCompany}`}
                          </span>
                        </p>
                      )}
                    </div>
                    <Badge className={cn("shrink-0 text-xs border", sm.cls)}>{sm.label}</Badge>
                  </div>

                  <div className="flex items-end justify-between">
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        IVA {q.taxRate}%
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {fmt(q.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-lg font-bold text-primary">{eur(q.total)}</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {q.validUntil ? `Válido hasta ${fmt(q.validUntil)}` : "Sin fecha de vencimiento"}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {(modal === "create" || modal === "edit") && (
        <QuoteFormModal
          open
          onClose={() => { setModal(null); setEditQuote(null); }}
          clients={clients}
          editQuote={modal === "edit" ? editQuote : null}
        />
      )}

      {modal === "view" && selectedId !== null && (
        <QuoteDetailModal
          quoteId={selectedId}
          onClose={() => { setModal(null); setSelectedId(null); }}
          onEdit={() => openEdit(selectedId)}
        />
      )}
    </div>
  );
}
