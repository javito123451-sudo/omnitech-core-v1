import { useState, type FormEvent } from "react";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { formatCredits } from "@/lib/agents/format";
import { useSimulateAgent } from "@/lib/agents/hooks";

/**
 * SIMULATION MODE (POST /api/agents/:id/simulate). Es gratis: no llama a ningún proveedor de IA, no consume
 * OmniCredits, no ejecuta herramientas, no envía mensajes y no modifica datos. Lo que muestra sobre coste es una
 * ESTIMACIÓN de lo que costaría una ejecución real, nunca un consumo. No hay botón de ejecución real.
 */
export function SimulationPanel({ agentId }: { agentId: number }) {
  const [message, setMessage] = useState("");
  const sim = useSimulateAgent(agentId);
  const trimmed = message.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || sim.isPending) return;
    sim.mutate({ message: trimmed });
  }

  const r = sim.data;
  return (
    <Card data-testid="simulation-panel" className="border-sky-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-sky-400" /> Probar el agente
          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-300" data-testid="simulation-mode-badge">SIMULATION MODE</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground" data-testid="simulation-notice">
          Modo simulación: no consume OmniCredits, no llama a ninguna IA real, no ejecuta herramientas, no envía mensajes y no modifica datos de tu negocio.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor="simulation-message">Mensaje de prueba</Label>
          <Textarea id="simulation-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="¿Cuánto cuesta? Necesito un presupuesto." />
          <Button type="submit" variant="outline" disabled={!trimmed || sim.isPending} data-testid="simulate-button">
            {sim.isPending ? "Simulando…" : "Simular"}
          </Button>
        </form>

        {sim.isError && <ApiErrorAlert error={sim.error} />}

        {r && (
          <div className="space-y-3 rounded-lg border border-border p-3" data-testid="simulation-result">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-300">Resultado simulado</Badge>
              <span className="text-xs text-muted-foreground">
                Versión {r.agent.versionNumber !== null ? `v${r.agent.versionNumber}` : "—"} · Modelo previsto: {r.route.provider}/{r.route.model}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words" data-testid="simulation-reply">{r.reply}</p>

            {r.proposedAction && (
              <p className="text-xs text-amber-300" data-testid="simulation-action">
                Acción propuesta: «{r.proposedAction.toolId}» — requiere confirmación humana y no se ha ejecutado.
              </p>
            )}
            {r.toolsSelected.length > 0 && (
              <p className="text-xs text-muted-foreground">Herramientas que usaría: {r.toolsSelected.join(", ")}</p>
            )}

            <p className="text-xs text-muted-foreground" data-testid="simulation-estimate">
              Estimación (no es un consumo): ~{formatCredits(r.estimate.typicalCredits)} créditos por respuesta típica, hasta {formatCredits(r.estimate.maxCredits)} como máximo.
              {r.estimate.provisional && " Precio provisional."}
            </p>
            <p className="text-xs font-medium text-emerald-400" data-testid="simulation-no-charge">Créditos consumidos por esta simulación: 0</p>

            {r.denied.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-5" data-testid="simulation-denied">
                {r.denied.map((d) => <li key={d.toolId}>{d.toolId}: {d.reason}</li>)}
              </ul>
            )}
            {r.notes.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-5" data-testid="simulation-notes">
                {r.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
