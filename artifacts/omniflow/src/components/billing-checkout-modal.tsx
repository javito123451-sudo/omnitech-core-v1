import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Plan = "starter" | "professional" | "enterprise";

export function BillingCheckoutModal({ quoteId, onClose }: { quoteId: number; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan>("starter");
  const [annual, setAnnual] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async () => {
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      // The operator confirms that the customer has actually accepted the offer
      // and the recurring billing terms. This is not a substitute for customer consent.
      const status = await authFetch(`${import.meta.env.BASE_URL}api/quotes/${quoteId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      });
      if (!status.ok) {
        const body = await status.json() as { error?: string };
        throw new Error(body.error ?? "No se pudo registrar la aceptación");
      }
      const response = await authFetch(`${import.meta.env.BASE_URL}api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, plan, recurringConsent: true, annual }),
      });
      const body = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !body.checkoutUrl) throw new Error(body.error ?? "No se pudo crear el Checkout");
      window.location.assign(body.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al iniciar el pago");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Activar contratación con Stripe</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Presupuesto #{String(quoteId).padStart(5, "0")}. Solo continúa si el cliente ya ha aceptado la oferta y las condiciones de cobro recurrente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Plan</label>
            <select value={plan} onChange={e => { setPlan(e.target.value as Plan); setAnnual(false); }} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="starter">Starter — 99 € promoción / 149 € mensual</option>
              <option value="professional">Professional — 249 € / mes</option>
              <option value="enterprise">Enterprise — 1.000 € / mes</option>
            </select>
          </div>
          {plan === "enterprise" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={annual} onChange={e => setAnnual(e.target.checked)} />
              Contratación anual — 10.000 € + IVA
            </label>
          )}
          <label className="flex items-start gap-2 text-sm leading-relaxed">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1" />
            Confirmo que el cliente ha aceptado este presupuesto, conoce el importe, la periodicidad y la renovación automática, y ha autorizado expresamente el método de pago.
          </label>
          <p className="text-xs text-muted-foreground">Los precios se muestran sin IVA. Stripe añadirá los impuestos que correspondan cuando la configuración fiscal esté habilitada. No se activa el servicio hasta que Stripe confirme el pago.</p>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void startCheckout()} disabled={!accepted || busy}>
              {busy ? "Conectando con Stripe…" : "Continuar a pago seguro"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
