import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { X, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Client { id: number; name: string; company: string | null; }
interface Quote  { id: number; title: string; total: string | number; }

interface LineItem { description: string; quantity: number; unitPrice: number; }

interface Props { onClose: () => void; }

export default function InvoiceModal({ onClose }: Props) {
  const qc   = useQueryClient();
  const { toast } = useToast();

  const [clientId, setClientId] = useState<number | "">("");
  const [quoteId,  setQuoteId]  = useState<number | "">("");
  const [currency, setCurrency] = useState("EUR");
  const [taxRate,  setTaxRate]  = useState(21);
  const [dueDate,  setDueDate]  = useState("");
  const [notes,    setNotes]    = useState("");
  const [items,    setItems]    = useState<LineItem[]>([{ description: "", quantity: 1, unitPrice: 0 }]);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients-simple"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/clients?limit=200`);
      const d = await r.json();
      return d.clients ?? d ?? [];
    },
  });

  const { data: quotes = [] } = useQuery<Quote[]>({
    queryKey: ["quotes-simple"],
    queryFn: async () => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/quotes?limit=200`);
      const d = await r.json();
      return d.quotes ?? d ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const validItems = items.filter(i => i.description.trim() && i.quantity > 0);
      if (!validItems.length) throw new Error("Añade al menos un ítem válido");

      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || undefined,
          quoteId:  quoteId  || undefined,
          currency, taxRate,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          items: validItems,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error al crear factura");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
      toast({ title: "Factura creada correctamente" });
      onClose();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const fromQuoteMut = useMutation({
    mutationFn: async (qId: number) => {
      const r = await authFetch(`${import.meta.env.BASE_URL}api/accounting/quotes/${qId}/to-invoice`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Error");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["accounting-summary"] });
      toast({ title: "Factura generada desde presupuesto" });
      onClose();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addItem = () => setItems(p => [...p, { description: "", quantity: 1, unitPrice: 0 }]);
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof LineItem, value: string | number) =>
    setItems(p => p.map((item, idx) => idx === i ? { ...item, [field]: field === "description" ? value : Number(value) } : item));

  const subtotal  = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = (subtotal * taxRate) / 100;
  const total     = subtotal + taxAmount;

  const fmt = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(n);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 className="font-semibold text-white">Nueva factura</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* From quote shortcut */}
          {quotes.length > 0 && (
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl flex items-center gap-3">
              <span className="text-xs text-cyan-300 font-medium">Crear desde presupuesto:</span>
              <select
                value=""
                onChange={e => { if (e.target.value) fromQuoteMut.mutate(Number(e.target.value)); }}
                className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="">Seleccionar presupuesto…</option>
                {quotes.map(q => (
                  <option key={q.id} value={q.id}>#{q.id} — {q.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Client */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Cliente</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="">Sin cliente</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ""}</option>
              ))}
            </select>
          </div>

          {/* Currency + Tax + Due date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Moneda</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
              >
                {["EUR", "USD", "GBP", "MXN"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">IVA (%)</label>
              <input
                type="number" min={0} max={100}
                value={taxRate}
                onChange={e => setTaxRate(Number(e.target.value))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Vencimiento</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-400">Líneas de factura</label>
              <button onClick={addItem} className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Añadir línea
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="col-span-6 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none placeholder:text-slate-600"
                    placeholder="Descripción"
                    value={item.description}
                    onChange={e => updateItem(idx, "description", e.target.value)}
                  />
                  <input
                    type="number" min={0.01} step={0.01}
                    className="col-span-2 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    placeholder="Cant."
                    value={item.quantity}
                    onChange={e => updateItem(idx, "quantity", e.target.value)}
                  />
                  <input
                    type="number" min={0} step={0.01}
                    className="col-span-3 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    placeholder="Precio"
                    value={item.unitPrice}
                    onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    className="col-span-1 p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals preview */}
          <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>IVA ({taxRate}%)</span><span>{fmt(taxAmount)}</span>
            </div>
            <div className="border-t border-white/10 pt-1.5 flex justify-between font-bold text-white">
              <span>Total</span><span className="text-cyan-400">{fmt(total)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notas (opcional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none resize-none"
              placeholder="Condiciones de pago, referencias…"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {createMut.isPending ? "Creando…" : "Crear factura"}
          </button>
        </div>
      </div>
    </div>
  );
}
