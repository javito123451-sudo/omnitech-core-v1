import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  RefreshCw,
  Save,
  Mail,
  MessageCircle,
  FileDown,
  CheckCircle2,
  ChevronRight,
  Building2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
}
interface AIQuoteResult {
  title: string;
  items: QuoteItem[];
  notes: string;
  client: {
    id: number;
    name: string;
    company?: string | null;
    email: string;
    phone?: string | null;
  };
  validUntil: string;
  generatedAt: string;
}
interface SavedQuote {
  id: number;
  title: string;
  total: number;
}

export interface AIQuoteModalProps {
  clientId: number;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientCompany?: string | null;
  defaultValue?: number | null;
  onClose: () => void;
  onSaved?: (quoteId: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtEur(n: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Quote Preview ─────────────────────────────────────────────────────────────
function QuotePreview({ q, quoteNum }: { q: AIQuoteResult; quoteNum: string }) {
  const subtotal = q.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = subtotal * 0.21;
  const total = subtotal + tax;
  const today = fmtDate(q.generatedAt);
  const valid = fmtDate(q.validUntil);

  return (
    <div
      className="bg-white text-slate-900 rounded-xl overflow-hidden text-[12px] shadow-lg"
      id="quote-preview"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-black tracking-tight">OmniTech Core</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Plataforma de Automatización Empresarial
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">
            Presupuesto
          </div>
          <div className="text-xl font-black text-white">#{quoteNum}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{today}</div>
        </div>
      </div>

      {/* Client + validity */}
      <div className="grid grid-cols-2 gap-0 border-b border-slate-200">
        <div className="px-6 py-4 border-r border-slate-200">
          <div className="text-[9px] uppercase tracking-widest text-slate-400 mb-2 font-semibold">
            Para
          </div>
          <div className="font-bold text-slate-800 text-sm">
            {q.client.name}
          </div>
          {q.client.company && (
            <div className="text-slate-500">{q.client.company}</div>
          )}
          <div className="text-slate-500 mt-1">{q.client.email}</div>
          {q.client.phone && (
            <div className="text-slate-500">{q.client.phone}</div>
          )}
        </div>
        <div className="px-6 py-4">
          <div className="text-[9px] uppercase tracking-widest text-slate-400 mb-2 font-semibold">
            Detalles
          </div>
          <div className="space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Fecha</span>
              <span className="font-medium text-slate-700">{today}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Válido hasta</span>
              <span className="font-medium text-slate-700">{valid}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Divisa</span>
              <span className="font-medium text-slate-700">EUR €</span>
            </div>
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="px-6 pt-4 pb-2">
        <h3 className="text-sm font-bold text-slate-800">{q.title}</h3>
      </div>

      {/* Items table */}
      <div className="px-6 pb-4">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 text-[9px] uppercase tracking-widest text-slate-400 font-semibold">
                Descripción
              </th>
              <th className="text-center py-2 text-[9px] uppercase tracking-widest text-slate-400 font-semibold w-14">
                Cant.
              </th>
              <th className="text-right py-2 text-[9px] uppercase tracking-widest text-slate-400 font-semibold w-24">
                Precio unit.
              </th>
              <th className="text-right py-2 text-[9px] uppercase tracking-widest text-slate-400 font-semibold w-24">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2.5 text-slate-700 leading-snug pr-4">
                  {item.description}
                </td>
                <td className="py-2.5 text-center text-slate-600">
                  {item.quantity}
                </td>
                <td className="py-2.5 text-right text-slate-600">
                  {fmtEur(item.unitPrice)}
                </td>
                <td className="py-2.5 text-right font-semibold text-slate-800">
                  {fmtEur(item.quantity * item.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="px-6 pb-4 flex justify-end">
        <div className="w-56 space-y-1">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{fmtEur(subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>IVA (21%)</span>
            <span>{fmtEur(tax)}</span>
          </div>
          <div className="flex justify-between font-black text-base border-t-2 border-slate-800 pt-2 mt-2 text-slate-900">
            <span>TOTAL</span>
            <span>{fmtEur(total)}</span>
          </div>
        </div>
      </div>

      {/* Conditions */}
      {q.notes && (
        <div className="px-6 pb-5 border-t border-slate-100 pt-4">
          <div className="text-[9px] uppercase tracking-widest text-slate-400 mb-2 font-semibold">
            Condiciones y alcance
          </div>
          <div className="text-slate-600 leading-relaxed whitespace-pre-wrap">
            {q.notes}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-between items-center">
        <div className="text-[10px] text-slate-400">
          Generado con OmniTech Core
        </div>
        <div className="text-[10px] text-slate-400">
          Válido 30 días desde la fecha de emisión
        </div>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export function AIQuoteModal({
  clientId,
  clientName,
  clientEmail,
  clientPhone,
  clientCompany,
  defaultValue,
  onClose,
  onSaved,
}: AIQuoteModalProps) {
  console.log("AIQuoteModal mounted");
  const [step, setStep] = useState<
    "input" | "generating" | "preview" | "saving" | "saved"
  >("input");
  const [service, setService] = useState("");
  const [estValue, setEstValue] = useState(
    defaultValue ? String(defaultValue) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AIQuoteResult | null>(null);
  const [saved, setSaved] = useState<SavedQuote | null>(null);

  const quoteNum = saved ? String(saved.id).padStart(5, "0") : "PREV";

  const generate = useCallback(async () => {
    console.log("STEP 1 - start", { service, estValue, clientId });
    if (!service.trim()) {
      setError("Describe el servicio a presupuestar");
      return;
    }
    setError(null);
    setStep("generating");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("STEP 2b - TIMEOUT after 10s, aborting fetch");
      controller.abort();
    }, 10000);

    console.log("STEP 2 - calling fetch", BASE + "/api/quotes/ai-generate");
    try {
      const r = await fetch(`${BASE}/api/quotes/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          clientId,
          serviceDescription: service,
          estimatedValue: estValue ? parseFloat(estValue) : null,
        }),
      });
      clearTimeout(timeoutId);
      console.log("STEP 3 - fetch completed", { status: r.status, ok: r.ok });
      if (!r.ok) {
        const e = (await r.json()) as { error?: string };
        console.log("STEP 3b - error body", e);
        throw new Error(e.error ?? "Error");
      }
      console.log("STEP 4 - parsing JSON");
      const data = (await r.json()) as AIQuoteResult;
      console.log("STEP 5 - json parsed", { title: data.title, items: data.items?.length });
      setResult(data);
      console.log("STEP 6 - result set, moving to preview");
      setStep("preview");
    } catch (e) {
      clearTimeout(timeoutId);
      console.log("ERROR", e instanceof Error ? e.message : e);
      setError(e instanceof Error ? e.message : "Error al generar");
      setStep("input");
    }
  }, [service, estValue, clientId]);

  const saveTocrm = useCallback(async () => {
    if (!result) return;
    setStep("saving");
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId,
          title: result.title,
          items: result.items,
          notes: result.notes,
          taxRate: 21,
          validUntil: result.validUntil,
        }),
      });
      if (!r.ok) {
        const e = (await r.json()) as { error?: string };
        throw new Error(e.error ?? "Error");
      }
      const q = (await r.json()) as SavedQuote;
      setSaved(q);
      setStep("saved");
      onSaved?.(q.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
      setStep("preview");
    }
  }, [result, clientId, onSaved]);

  const openPdf = () => {
    if (saved) window.open(`${BASE}/api/quotes/${saved.id}/pdf`, "_blank");
  };

  const sendEmail = () => {
    if (!result || !saved) return;
    const subject = encodeURIComponent(result.title);
    const subtotal = result.items.reduce(
      (s, i) => s + i.quantity * i.unitPrice,
      0,
    );
    const total = subtotal * 1.21;
    const body = encodeURIComponent(
      "Estimado/a " +
        clientName +
        ",\n\n" +
        "Adjunto encontrará el presupuesto #" +
        String(saved.id).padStart(5, "0") +
        " por importe de " +
        fmtEur(total) +
        ".\n\n" +
        "Título: " +
        result.title +
        "\n" +
        "Válido hasta: " +
        fmtDate(result.validUntil) +
        "\n\n" +
        "Quedo a su disposición para cualquier consulta.\n\nUn saludo.",
    );
    window.open(
      "mailto:" + clientEmail + "?subject=" + subject + "&body=" + body,
    );
  };

  const shareWhatsApp = () => {
    if (!result || !saved) return;
    const subtotal = result.items.reduce(
      (s, i) => s + i.quantity * i.unitPrice,
      0,
    );
    const total = subtotal * 1.21;
    const text = encodeURIComponent(
      "Hola " +
        clientName +
        ", te envío el presupuesto #" +
        String(saved.id).padStart(5, "0") +
        " por " +
        fmtEur(total) +
        ". " +
        "Válido 30 días. ¿Cualquier duda estoy disponible!",
    );
    const phone = (clientPhone ?? "").replace(/\D/g, "");
    const url = phone
      ? "https://wa.me/" + phone + "?text=" + text
      : "https://wa.me/?text=" + text;
    window.open(url, "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/75 backdrop-blur-sm overflow-y-auto py-6 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-slate-950 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] bg-gradient-to-r from-primary/10 to-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/25 flex items-center justify-center">
              <span className="text-base leading-none">📄</span>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                Presupuesto IA
              </div>
              <div className="text-sm font-bold text-foreground">
                {clientName}
                {clientCompany ? " · " + clientCompany : ""}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-0 px-6 py-3 border-b border-white/[0.05] bg-white/[0.01]">
          {(["input", "preview", "saved"] as const).map((s, i) => {
            const labels = ["Datos", "Vista previa", "Guardado"];
            const done =
              step === "preview"
                ? i <= 1
                : step === "saved" || step === "saving"
                  ? true
                  : i === 0;
            const active =
              step === "generating"
                ? i === 0
                : step === "saving"
                  ? i === 1
                  : step === s;
            return (
              <div key={s} className="flex items-center gap-0">
                {i > 0 && (
                  <ChevronRight className="w-3 h-3 text-white/10 mx-1" />
                )}
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-semibold transition-colors",
                    done
                      ? "text-primary"
                      : active
                        ? "text-foreground"
                        : "text-white/20",
                  )}
                >
                  {done && <CheckCircle2 className="w-3 h-3" />}
                  {labels[i]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* ── Step: input ── */}
            {(step === "input" || step === "generating") && (
              <div>
                <div className="space-y-4">
                  {/* Client info read-only */}
                  <div className="flex items-center gap-3 p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                    <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary/70" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {clientName}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {clientEmail}
                      </div>
                    </div>
                    {clientCompany && (
                      <div className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        {clientCompany}
                      </div>
                    )}
                  </div>

                  {/* Service description */}
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                      Servicio a presupuestar *
                    </label>
                    <textarea
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      placeholder="Ej: Implementación de sistema CRM con automatización de emails, seguimiento de leads y reportes mensuales..."
                      rows={4}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 resize-none transition-colors"
                    />
                  </div>

                  {/* Estimated value */}
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                      Valor estimado (€) — opcional
                    </label>
                    <input
                      type="number"
                      value={estValue}
                      onChange={(e) => setEstValue(e.target.value)}
                      placeholder="Ej: 2500"
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 transition-colors"
                    />
                    <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                      La IA ajustará los precios de cada partida para
                      aproximarse a este total.
                    </p>
                  </div>

                  {error && (
                    <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={() => void generate()}
                    disabled={step === "generating" || !service.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-sm transition-all bg-gradient-to-r from-primary to-violet-600 border-primary/50 text-white hover:from-primary/90 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                  >
                    {step === "generating" ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Generando presupuesto…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />✨ Generar Presupuesto
                        con IA
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step: preview / saving / saved ── */}
            {(step === "preview" || step === "saving" || step === "saved") &&
              result && (
                <div>
                  <div className="space-y-4">
                    {/* Quote preview */}
                    <div className="max-h-[55vh] overflow-y-auto rounded-xl ring-1 ring-white/10">
                      <QuotePreview q={result} quoteNum={quoteNum} />
                    </div>

                    {error && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                        {error}
                      </div>
                    )}

                    {/* Action buttons */}
                    {step === "saved" && saved ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-4 h-4" />
                          Guardado como #{String(saved.id).padStart(
                            5,
                            "0",
                          )} — {fmtEur(saved.total)}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            onClick={openPdf}
                            className="flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border border-primary/25 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold transition-colors"
                          >
                            <FileDown className="w-4 h-4" />
                            Guardar PDF
                          </button>
                          <button
                            onClick={sendEmail}
                            className="flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border border-blue-500/25 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-semibold transition-colors"
                          >
                            <Mail className="w-4 h-4" />
                            Enviar Email
                          </button>
                          <button
                            onClick={shareWhatsApp}
                            className="flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold transition-colors"
                          >
                            <MessageCircle className="w-4 h-4" />
                            WhatsApp
                          </button>
                        </div>
                        <button
                          onClick={onClose}
                          className="w-full py-2.5 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 text-sm transition-colors"
                        >
                          Cerrar
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setStep("input");
                          }}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Regenerar
                        </button>
                        <button
                          onClick={() => void saveTocrm()}
                          disabled={step === "saving"}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm font-bold transition-colors disabled:opacity-50"
                        >
                          {step === "saving" ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Guardando en CRM…
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              💾 Guardar en CRM
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
