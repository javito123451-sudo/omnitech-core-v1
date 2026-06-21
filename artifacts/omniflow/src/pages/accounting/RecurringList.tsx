import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { RefreshCw, Plus, X, Pause, Play, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface RecurringItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface RecurringInvoice {
  id: number;
  clientId: number | null;
  clientName: string | null;
  description: string;
  frequency: string;
  currency: string;
  taxRate: number;
  total: number;
  isActive: boolean;
  sendOnCreate: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  items: RecurringItem[];
}

interface Client { id: number; name: string; }

const FREQ_LABELS: Record<string, string> = {
  weekly:    "Semanal",
  bimonthly: "Quincenal",
  monthly:   "Mensual",
  quarterly: "Trimestral",
  yearly:    "Anual",
};

const FREQS = ["weekly", "bimonthly", "monthly", "quarterly", "yearly"];

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function calcTotal(items: RecurringItem[], taxRate: number) {
  const sub = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  return sub + sub * taxRate / 100;
}

export default function RecurringList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [clientId,     setClientId]     = useState<number | "">("");
  const [description,  setDescription]  = useState("");
  const [frequency,    setFrequency]    = useState("monthly");
  const [currency,     setCurrency]     = useState("EUR");
  const [taxRate,      setTaxRate]      = useState(21);
  const [sendOnCreate, setSendOnCreate] = useState(false);
  const [nextRunAt,    setNextRunAt]    = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [items, setItems] = useState<RecurringItem[]>([
    { description: "", quantity: 1, unitPrice: 0 }
  ]);

  const { data, isLoading } = useQuery<{ recurring: RecurringInvoice[]; total: number }>({
    queryKey: ["recurring-invoices"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/recurring?limit=100`);
      return r.json();
    },
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients-simple"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/clients?limit=200`);
      const d = await r.json();
      return d.clients ?? d ?? [];
    },
    enabled: showModal,
  });

  function resetForm() {
    setClientId(""); setDescription(""); setFrequency("monthly");
    setCurrency("EUR"); setTaxRate(21); setSendOnCreate(false);
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    setNextRunAt(d.toISOString().slice(0, 10));
    setItems([{ description: "", quantity: 1, unitPrice: 0 }]);
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!description.trim()) throw new Error("El nombre de la plantilla es obligatorio");
      if (items.some(i => !i.description.trim())) throw new Error("Todas las líneas necesitan descripción");
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/recurring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || null,
          description: description.trim(),
          frequency,
          currency,
          taxRate,
          sendOnCreate,
          nextRunAt: new Date(nextRunAt).toISOString(),
          items: items.filter(i => i.description.trim()),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-invoices"] });
      toast({ title: "Plantilla recurrente creada" });
      setShowModal(false); resetForm();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Error");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-invoices"] }),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await authFetch(`${import.meta.env.BASE_URL}api/accounting/recurring/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-invoices"] });
      toast({ title: "Plantilla eliminada" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addItem    = () => setItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof RecurringItem, val: string | number) =>
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const previewTotal = calcTotal(items, taxRate);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">Las facturas se generan automáticamente según la frecuencia configurada</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva plantilla
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.recurring.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Sin plantillas recurrentes</p>
          <p className="text-slate-500 text-sm">Crea una plantilla y el sistema generará facturas automáticamente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.recurring.map(r => (
            <div
              key={r.id}
              className={cn(
                "bg-slate-900/40 border rounded-xl p-4",
                r.isActive ? "border-white/5" : "border-white/[0.02] opacity-60"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white">{r.description}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium",
                      r.isActive
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-slate-700/50 text-slate-500"
                    )}>
                      {r.isActive ? "Activa" : "Pausada"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-400">
                      {FREQ_LABELS[r.frequency] ?? r.frequency}
                    </span>
                    {r.sendOnCreate && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                        Envío auto
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                    <span>{r.clientName ?? "Sin cliente asignado"}</span>
                    <span>Próxima: <span className="text-slate-300">{fmtDate(r.nextRunAt)}</span></span>
                    {r.lastRunAt && <span>Última: {fmtDate(r.lastRunAt)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-white font-bold">{fmt(r.total, r.currency)}</span>
                  <button
                    onClick={() => toggleMut.mutate({ id: r.id, isActive: !r.isActive })}
                    disabled={toggleMut.isPending}
                    className={cn(
                      "p-1.5 rounded-lg transition-colors",
                      r.isActive
                        ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                        : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    )}
                    title={r.isActive ? "Pausar" : "Activar"}
                  >
                    {r.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => { if (confirm(`¿Eliminar "${r.description}"?`)) deleteMut.mutate(r.id); }}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-cyan-400" /> Nueva plantilla recurrente
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre de la plantilla <span className="text-red-400">*</span></label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="ej. Mantenimiento mensual, Suscripción CRM…"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Frecuencia</label>
                  <select
                    value={frequency}
                    onChange={e => setFrequency(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {FREQS.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Primera ejecución</label>
                  <input
                    type="date"
                    value={nextRunAt}
                    onChange={e => setNextRunAt(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Cliente</label>
                  <select
                    value={clientId}
                    onChange={e => setClientId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="">Sin cliente</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">IVA (%)</label>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={taxRate}
                    onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Line items */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Líneas de factura <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={item.description}
                        onChange={e => updateItem(idx, "description", e.target.value)}
                        placeholder="Descripción"
                        className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                      />
                      <input
                        type="number" min="0.01" step="0.01"
                        value={item.quantity}
                        onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 1)}
                        className="w-16 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none"
                        title="Cantidad"
                      />
                      <input
                        type="number" min="0" step="0.01"
                        value={item.unitPrice}
                        onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                        className="w-24 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none"
                        title="Precio unitario"
                      />
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addItem} className="mt-2 flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
                  <Plus className="w-3.5 h-3.5" /> Añadir línea
                </button>
              </div>

              {/* Preview total */}
              {previewTotal > 0 && (
                <div className="flex items-center justify-between p-3 bg-slate-800/60 rounded-lg">
                  <span className="text-xs text-slate-400">Total estimado por factura</span>
                  <span className="text-white font-bold">{fmt(previewTotal, currency)}</span>
                </div>
              )}

              {/* Options */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setSendOnCreate(v => !v)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                    sendOnCreate ? "bg-cyan-600" : "bg-slate-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                    sendOnCreate ? "left-5" : "left-0.5"
                  )} />
                </div>
                <span className="text-sm text-slate-300">Marcar como "Enviada" al generarse (status=sent)</span>
              </label>

              <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-300">
                  La factura se generará automáticamente el <strong>{new Date(nextRunAt).toLocaleDateString("es-ES")}</strong> y se repetirá cada <strong>{FREQ_LABELS[frequency]?.toLowerCase()}</strong>.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !description.trim()}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {createMut.isPending ? "Creando…" : "Crear plantilla"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
