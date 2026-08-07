/**
 * VeriFactu — RD 1007/2023 / Reglamento RRSIF
 *
 * Toda la lógica de cumplimiento (hash SHA-256 encadenado, XML, QR, envío a
 * AEAT) vive en el servidor: @workspace/connector-verifactu vía
 * artifacts/api-server/src/services/verifactuService.ts. Esta página SOLO
 * consume la API — no calcula ni conoce ningún dato criptográfico.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, FileWarning, Send, RefreshCw, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VerifactuRecord {
  invoiceId: number;
  invoiceNumber: string;
  hash: string;
  previousHash: string | null;
  totals: { taxBase: number; taxAmount: number; total: number };
  generatedAt: string;
  qrUrl: string;
  mode: string;
  submitted: boolean;
  aeatStatus: string | null;
  aeatCsv: string | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  status: string;
  total: number;
  clientName: string | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${BASE}${url}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? `Error ${r.status}`);
  return body as T;
}

export default function Verifactu() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: recordsData, isLoading: loadingRecords } = useQuery({
    queryKey: ["verifactu-records"],
    queryFn: () => fetchJson<{ records: VerifactuRecord[] }>("/api/verifactu/records"),
  });

  const { data: invoicesData } = useQuery({
    queryKey: ["accounting-invoices-for-verifactu"],
    queryFn: () => fetchJson<{ invoices: Invoice[] }>("/api/accounting/invoices?limit=50"),
  });

  const generateMut = useMutation({
    mutationFn: (invoiceId: number) =>
      fetchJson(`/api/verifactu/invoices/${invoiceId}/generate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Registro generado", description: "Huella encadenada creada correctamente." });
      queryClient.invalidateQueries({ queryKey: ["verifactu-records"] });
    },
    onError: (err: Error) => toast({ title: "Error al generar", description: err.message, variant: "destructive" }),
  });

  const submitMut = useMutation({
    mutationFn: (invoiceId: number) =>
      fetchJson(`/api/verifactu/invoices/${invoiceId}/submit`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Enviado", description: "Registro procesado por VeriFactu." });
      queryClient.invalidateQueries({ queryKey: ["verifactu-records"] });
    },
    onError: (err: Error) => toast({ title: "Error al enviar", description: err.message, variant: "destructive" }),
  });

  const records = recordsData?.records ?? [];
  const recordedNumbers = new Set(records.map((r) => r.invoiceNumber));
  const pendingInvoices = (invoicesData?.invoices ?? []).filter((inv) => !recordedNumbers.has(inv.invoiceNumber));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="text-emerald-400" size={24} />
          VeriFactu
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Registro de facturación encadenado (RD 1007/2023 / Reglamento RRSIF). El cálculo de huella,
          XML y QR se realiza en el servidor.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3">
        <FileWarning className="text-amber-400 shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-amber-200">
          El calendario de obligatoriedad de VeriFactu se ha aplazado más de una vez (RD-ley 15/2025).
          Este módulo genera y conserva registros conformes ya mismo; confirma la fecha exacta que aplica
          a tu organización y el endpoint de producción de AEAT antes de activar el envío en tiempo real.
        </p>
      </div>

      {/* ── Facturas pendientes de registro ─────────────────────────────── */}
      {pendingInvoices.length > 0 && (
        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Facturas sin registro VeriFactu</h2>
          <div className="space-y-2">
            {pendingInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                <div className="text-sm text-slate-300">
                  <span className="font-medium text-white">{inv.invoiceNumber}</span>
                  {inv.clientName && <span className="text-slate-500"> · {inv.clientName}</span>}
                </div>
                <button
                  onClick={() => generateMut.mutate(inv.id)}
                  disabled={generateMut.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  Generar registro
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Cadena de registros ──────────────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Cadena de registros ({records.length})</h2>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["verifactu-records"] })}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {loadingRecords ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay registros generados.</p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <div key={r.hash} className="bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white text-sm">{r.invoiceNumber}</span>
                  <span className="text-xs text-slate-500">{new Date(r.generatedAt).toLocaleString("es-ES")}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500 font-mono break-all">
                  huella: {r.hash.slice(0, 24)}…
                  {r.previousHash && <span className="ml-2 text-slate-600">← {r.previousHash.slice(0, 12)}…</span>}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-sm text-slate-300">{r.totals.total.toFixed(2)} €</span>
                  <a
                    href={r.qrUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn("text-xs flex items-center gap-1 text-slate-400 hover:text-white")}
                  >
                    <QrCode size={12} /> Ver QR
                  </a>
                  <span className="ml-auto">
                    {r.submitted ? (
                      <span className="text-xs px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Enviado a AEAT{r.aeatCsv ? ` · CSV ${r.aeatCsv}` : ""}
                      </span>
                    ) : r.mode === "verifactu_activo" ? (
                      <button
                        onClick={() => submitMut.mutate(r.invoiceId)}
                        disabled={submitMut.isPending}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                      >
                        <Send size={12} /> Enviar a AEAT
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">Modo no_verifactu — conservado localmente</span>
                    )}
                  </span>
                </div>
                {r.aeatStatus === "rechazado" && (
                  <p className="mt-1 text-xs text-rose-400">Rechazado por AEAT — revisa el registro.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
