import { useState } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { useAgentPermissions, usePublishAgent } from "@/lib/agents/hooks";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/**
 * Publicar (POST /api/agents/:id/publish). Publica la versión borrador: pasa a ser la versión activa y el agente
 * queda «Publicado». Exige agents.publish y una confirmación explícita; nunca se publica solo. El backend valida
 * el borrador y, si no está listo, responde 422 con la lista de problemas, que se muestra tal cual.
 */
export function PublishAgentDialog({ agent, draft = null, changes = null, reviewBase = null }: {
  agent: Pick<Agent, "id" | "name" | "status">;
  /** Borrador que se va a publicar (para resumirlo antes de confirmar). */
  draft?: AgentVersion | null;
  /** Nº de cambios del borrador respecto a `reviewBase`, si se conoce. */
  changes?: number | null;
  reviewBase?: AgentVersion | null;
}) {
  const { canPublish } = useAgentPermissions();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { toast } = useToast();
  const publish = usePublishAgent(agent.id);

  if (!canPublish) return null;

  function reset() { setConfirmed(false); publish.reset(); }

  function submit() {
    if (!confirmed || publish.isPending) return;
    publish.mutate(undefined, {
      onSuccess: (r) => {
        toast({ title: "Agente publicado", description: `«${r.agent.name}» ahora usa la versión v${r.publishedVersionNumber}.` });
        setOpen(false);
        reset();
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="publish-agent-button"><Rocket className="h-4 w-4 mr-1.5" /> Publicar</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publicar «{agent.name}»</DialogTitle>
          <DialogDescription>
            Publicar cambia el estado operativo del agente: la versión borrador pasará a ser la versión activa y el agente quedará como «Publicado».
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-center gap-2 text-sm text-muted-foreground">Estado actual: <AgentStatusBadge status={agent.status} /></p>

        {draft && (
          <div className="space-y-1 rounded-lg border border-border p-3 text-sm" data-testid="publish-summary">
            <p className="font-medium text-foreground">Se publicará la versión v{draft.versionNumber} (estado: borrador)</p>
            <p className="text-xs text-muted-foreground">Rol: {draft.config.identity?.role || "—"}</p>
            <p className="text-xs text-muted-foreground">Objetivo: {draft.config.objective?.what || "—"}</p>
            <p className="text-xs text-muted-foreground">Canales: {draft.config.channels?.length ? draft.config.channels.join(", ") : "ninguno"}</p>
            {changes !== null && reviewBase && (
              <p className="text-xs text-muted-foreground" data-testid="publish-changes">{changes === 0 ? `Sin cambios respecto a la v${reviewBase.versionNumber}` : `${changes} ${changes === 1 ? "cambio" : "cambios"} respecto a la v${reviewBase.versionNumber}`}</p>
            )}
            <p className="text-xs text-amber-400" data-testid="publish-warning">Al publicar, la v{draft.versionNumber} pasará a ser la versión publicada y activa, y quedará congelada: no se podrá modificar.</p>
          </div>
        )}

        <div className="flex items-start gap-2">
          <Checkbox id="publish-confirm" checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} />
          <Label htmlFor="publish-confirm" className="text-sm font-normal leading-snug">
            Entiendo que publicar cambia el estado del agente y quiero publicarlo.
          </Label>
        </div>

        {publish.isError && <ApiErrorAlert error={publish.error} />}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" data-testid="publish-confirm-button" disabled={!confirmed || publish.isPending} onClick={submit}>
            {publish.isPending ? "Publicando…" : "Publicar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
