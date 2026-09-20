import { useMemo, useState } from "react";
import { Rocket } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { PublishReview } from "@/components/agents/PublishReview";
import {
  useAgentEffectiveAccess, useAgentKnowledgeCatalog, useAgentModelCatalog, useAgentPermissions, useAgentToolCatalog, usePublishAgent,
} from "@/lib/agents/hooks";
import { publishBlockers } from "@/lib/agents/publishReadiness";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/**
 * Publicar (POST /api/agents/:id/publish). Flujo: revisar → acceso efectivo → confirmar → publicar.
 * Publica la versión borrador: pasa a ser la versión activa y el agente queda «Publicado». Exige agents.publish y una
 * confirmación explícita; nunca se publica solo. Antes de permitir confirmar se verifica, con los catálogos reales y el
 * acceso efectivo, que la configuración no dependa de nada «no disponible actualmente»; si no se puede verificar, no se puede
 * confirmar. El backend valida otra vez y, si el borrador no es válido, responde 422 con los problemas (se muestran tal cual).
 * Publicar no ejecuta herramientas, no usa IA y no consume OmniCredits.
 */
export function PublishAgentDialog({ agent, draft = null, changes = null, reviewBase = null }: {
  agent: Pick<Agent, "id" | "name" | "status" | "monthlyCreditLimit" | "dailyCreditLimit" | "perExecutionCreditLimit">;
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

  // Solo se piden los catálogos y el acceso efectivo con el diálogo abierto.
  const active = open && canPublish;
  const models = useAgentModelCatalog(active);
  const knowledge = useAgentKnowledgeCatalog(active);
  const tools = useAgentToolCatalog(active);
  const access = useAgentEffectiveAccess(agent.id, `${draft?.id ?? 0}:${JSON.stringify(draft?.config.tools ?? {})}`, active && draft !== null);

  const blockers = useMemo(() => {
    if (!draft || !models.data || !knowledge.data || !tools.data || !access.data) return null;
    return publishBlockers({ config: draft.config, models: models.data, knowledge: knowledge.data, tools: tools.data, access: access.data });
  }, [draft, models.data, knowledge.data, tools.data, access.data]);

  if (!canPublish) return null;

  const queries = [models, knowledge, tools, access];
  const verifying = draft !== null && queries.some((q) => q.isPending);
  const verifyFailed = draft !== null && !verifying && queries.some((q) => q.isError);
  const canConfirm = confirmed && !publish.isPending && blockers !== null && blockers.length === 0;

  function reset() { setConfirmed(false); publish.reset(); }

  function submit() {
    if (!canConfirm) return;
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
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

        {draft && <PublishReview agent={agent} draft={draft} models={models} knowledge={knowledge} tools={tools} access={access} blockers={blockers} />}

        {verifying && <p className="text-sm text-muted-foreground" data-testid="publish-verifying" aria-busy="true">Verificando la configuración…</p>}
        {verifyFailed && (
          <Alert variant="destructive" data-testid="publish-verify-failed">
            <AlertTitle>No se ha podido verificar la configuración</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>Hasta poder revisar el modelo, el conocimiento, las herramientas y el acceso efectivo no se puede confirmar la publicación. Tu borrador no se ha perdido.</p>
              <Button type="button" variant="outline" size="sm" data-testid="publish-verify-retry" onClick={() => queries.filter((q) => q.isError).forEach((q) => void q.refetch())}>Reintentar</Button>
            </AlertDescription>
          </Alert>
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
          <Button type="button" data-testid="publish-confirm-button" disabled={!canConfirm} onClick={submit}>
            {publish.isPending ? "Publicando…" : "Publicar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
