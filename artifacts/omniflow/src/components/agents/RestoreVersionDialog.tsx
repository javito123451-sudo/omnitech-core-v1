import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { useAgentPermissions, useRestoreVersion } from "@/lib/agents/hooks";
import { findDraft } from "@/lib/agents/versioning";
import type { AgentVersion } from "@/lib/agents/types";

/**
 * «Restaurar en borrador» (POST /:id/versions/:versionId/restore, agents.write).
 * Contrato real: copia la configuración COMPLETA de la versión elegida al borrador (lo reemplaza; si no hay borrador,
 * crea la versión siguiente) y deja las notas «Restaurada desde la versión N». No toca ninguna versión publicada,
 * no publica y no ejecuta nada. Es destructivo sobre el borrador, por eso exige confirmación explícita.
 */
export function RestoreVersionDialog({ agentId, version, versions, hasUnsavedEdits, onRestored }: {
  agentId: number;
  version: AgentVersion;
  versions: AgentVersion[];
  hasUnsavedEdits: boolean;
  onRestored: (saved: AgentVersion) => void;
}) {
  const { canWrite } = useAgentPermissions();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const restore = useRestoreVersion(agentId);
  const draft = findDraft(versions);

  // El borrador no se restaura sobre sí mismo.
  if (!canWrite || version.publishedAt === null) return null;

  function confirm() {
    if (restore.isPending) return;
    restore.mutate(version.id, {
      onSuccess: (saved) => {
        toast({ title: "Versión restaurada en el borrador", description: `El borrador v${saved.versionNumber} ahora tiene el contenido de la v${version.versionNumber}. No se ha publicado nada.` });
        setOpen(false);
        restore.reset();
        onRestored(saved);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) restore.reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="restore-button"><RotateCcw className="h-4 w-4 mr-1.5" /> Restaurar en borrador</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restaurar la versión v{version.versionNumber} en el borrador</DialogTitle>
          <DialogDescription data-testid="restore-explanation">
            {draft
              ? `Esto reemplazará el contenido del borrador actual (v${draft.versionNumber}) por esta versión.`
              : "Ahora no hay borrador: se creará uno nuevo con el contenido de esta versión."}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Se copia toda la configuración de la v{version.versionNumber}; lo que había en el borrador se pierde.</li>
          <li>La versión v{version.versionNumber} y las demás versiones publicadas no se modifican.</li>
          <li>No se publica nada: podrás simularlo y revisarlo antes de publicar.</li>
          {hasUnsavedEdits && <li className="text-amber-400" data-testid="restore-unsaved-warning">Tienes cambios sin guardar en el editor: no se guardan y seguirán pendientes en el formulario.</li>}
        </ul>
        {restore.isError && <ApiErrorAlert error={restore.error} />}
        <DialogFooter>
          <Button type="button" variant="outline" data-testid="restore-cancel-button" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" data-testid="restore-confirm-button" disabled={restore.isPending} onClick={confirm}>
            {restore.isPending ? "Restaurando…" : "Restaurar en borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
