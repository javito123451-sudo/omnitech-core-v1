import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2, QrCode, CheckCircle2, Clock } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VerifactuInvoice {
  id: number;
  invoiceNumber: string;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
  verifactuHash: string | null;
  verifactuHashAnterior: string | null;
  verifactuQrUrl: string | null;
  verifactuRegisteredAt: string | null;
}

interface VerifactuResponse {
  total: number;
  registeredCount: number;
  pendingCount: number;
  invoices: VerifactuInvoice[];
}

export default function Verifactu() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<VerifactuResponse>({
    queryKey: ["verifactu"],
    queryFn: () => authFetch(`${BASE}/api/tax/verifactu`).then(r => r.json()),
  });

  const registerMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      authFetch(`${BASE}/api/tax/verifactu/register/${invoiceId}`, { method: "POST" })
        .then(async r => {
          if (!r.ok) throw new Error((await r.json()).error ?? "Error al registrar");
          return r.json();
        }),
    onSuccess: () => {
      toast({ title: "Factura registrada en Verifactu" });
      queryClient.invalidateQueries({ queryKey: ["verifactu"] });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo registrar", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando estado de Verifactu…
      </div>
    );
  }

  const invoices = data?.invoices ?? [];
  const pending = invoices.filter(i => !i.verifactuRegisteredAt);
  const registered = invoices.filter(i => i.verifactuRegisteredAt);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-500" />
          Verifactu — RD 1007/2023
        </h1>
        <p className="text-sm text-muted-foreground">
          Registro de facturación verificable: hash encadenado + código QR, no borrable.
        </p>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-800 p-4 rounded-lg">
        <p className="font-bold text-yellow-800 dark:text-yellow-300">
          ⚠️ Obligatorio desde 1 julio 2026 — Multa hasta 50.000€
        </p>
        <p className="text-sm text-yellow-700 dark:text-yellow-400">
          Cada factura registrada queda encadenada a la anterior mediante hash SHA-256, con QR de verificación AEAT.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total facturas</p>
          <p className="text-2xl font-bold">{data?.total ?? 0}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Registradas en Verifactu</p>
          <p className="text-2xl font-bold text-emerald-500">{data?.registeredCount ?? 0}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Pendientes de registrar</p>
          <p className="text-2xl font-bold text-amber-500">{data?.pendingCount ?? 0}</p>
        </div>
      </div>

      {invoices.length === 0 && (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          Aún no hay facturas emitidas. Crea y emite una factura desde Contabilidad para poder registrarla aquí.
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" /> Pendientes de registrar
          </h2>
          <div className="space-y-2">
            {pending.map(inv => (
              <div key={inv.id} className="border rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{inv.invoiceNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    {inv.total} {inv.currency} · estado: {inv.status}
                  </p>
                </div>
                <button
                  onClick={() => registerMutation.mutate(inv.id)}
                  disabled={registerMutation.isPending || inv.status === "draft"}
                  className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {registerMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Registrar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {registered.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Registradas
          </h2>
          <div className="space-y-2">
            {registered.map(inv => (
              <div key={inv.id} className="border rounded-lg p-3">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                >
                  <div>
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <p className="text-sm text-muted-foreground">
                      {inv.total} {inv.currency} · registrada el{" "}
                      {inv.verifactuRegisteredAt && new Date(inv.verifactuRegisteredAt).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                  <QrCode className="w-4 h-4 text-muted-foreground" />
                </div>
                {expandedId === inv.id && (
                  <div className="mt-3 pt-3 border-t text-xs space-y-1 font-mono break-all">
                    <p><span className="text-muted-foreground">Hash:</span> {inv.verifactuHash}</p>
                    <p><span className="text-muted-foreground">Hash anterior:</span> {inv.verifactuHashAnterior || "(primera factura de la cadena)"}</p>
                    {inv.verifactuQrUrl && (
                      <a href={inv.verifactuQrUrl} target="_blank" rel="noreferrer" className="text-blue-500 underline block">
                        Ver enlace de validación QR (AEAT)
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

