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
              <option value="starter">Starter — 297 € ahora (3 meses) · después 149 €/mes</option>
              <option value="professional">Professional — 747 € ahora (3 meses) · después 249 €/mes</option>
              <option value="enterprise">Enterprise — 3.000 € ahora (3 meses) · después 1.000 €/mes</option>
            </select>
          </div>
          {plan === "enterprise" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={annual} onChange={e => setAnnual(e.target.checked)} />
              Contratación anual — 10.000 € + IVA (cobro anual inmediato)
            </label>
          )}
          <label className="flex items-start gap-2 text-sm leading-relaxed">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1" />
            Como operador, confirmo que dispongo de la aceptación expresa del cliente para el importe, el cobro inicial, el mes gratuito posterior, la renovación automática y el método de pago. Esta casilla no sustituye la prueba documental de dicha aceptación.
          </label>
          <div className="rounded-md border border-border bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
            {annual ? <p>Se cobrarán 10.000 € ahora y después 10.000 € cada año, más IVA si corresponde.</p> : <p>{plan === "starter" ? "Se cobrarán 297 € ahora." : plan === "professional" ? "Se cobrarán 747 € ahora." : "Se cobrarán 3.000 € ahora."} Ese importe cubre 3 meses. Después hay 1 mes gratuito y, al terminar el cuarto mes desde el pago, comienza la renovación automática mensual de {plan === "starter" ? "149 €" : plan === "professional" ? "249 €" : "1.000 €"} + IVA si corresponde.</p>}
            <p className="mt-1">Importes sin IVA. El IVA no se está calculando automáticamente hasta verificar el registro y la configuración fiscal de Stripe. El alta del servicio queda pendiente de completar el espacio de trabajo del cliente.</p>
          </div>
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
