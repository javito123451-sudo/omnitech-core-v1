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
import type { Agent } from "@/lib/agents/types";

/**
 * Publicar (POST /api/agents/:id/publish). Publica la versión borrador: pasa a ser la versión activa y el agente
 * queda «Publicado». Exige agents.publish y una confirmación explícita; nunca se publica solo. El backend valida
 * el borrador y, si no está listo, responde 422 con la lista de problemas, que se muestra tal cual.
 */
export function PublishAgentDialog({ agent }: { agent: Pick<Agent, "id" | "name" | "status"> }) {
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
