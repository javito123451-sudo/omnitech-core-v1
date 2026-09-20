import { Check, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VersionDiff } from "@/components/agents/VersionDiff";
import { countChanges, diffVersions } from "@/lib/agents/versionDiff";
import { cn } from "@/lib/utils";
import type { AgentVersion } from "@/lib/agents/types";

type StepState = "done" | "pending" | "idle";

/** Cuántos cambios hay entre la base de revisión y el borrador (null = no hay con qué comparar). */
export function draftChangeCount(base: AgentVersion | null, draft: AgentVersion | null): number | null {
  if (!base || !draft) return null;
  return countChanges(diffVersions(base.config, draft.config));
}

function Step({ id, index, title, detail, state }: { id: string; index: number; title: string; detail: string; state: StepState }) {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-2" data-testid={`flow-step-${id}`} data-state={state}>
      <span className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
        state === "done" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-border text-muted-foreground",
      )}>
        {state === "done" ? <Check className="h-3 w-3" /> : state === "pending" ? <Circle className="h-2 w-2 fill-current" /> : index}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

/**
 * Recorrido BORRADOR → SIMULACIÓN → REVISIÓN → PUBLICACIÓN. Es una guía visual: no bloquea ninguna acción (el backend
 * no exige simular ni revisar para publicar) y nunca publica nada por sí mismo.
 */
export function VersioningFlow({ draft, simulationCurrent, changes, reviewBase, canPublish }: {
  draft: AgentVersion | null;
  simulationCurrent: boolean;
  changes: number | null;
  reviewBase: AgentVersion | null;
  canPublish: boolean;
}) {
  return (
    <Card data-testid="versioning-flow">
      <CardContent className="p-4">
        <ol className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Step id="draft" index={1} title="Borrador" state={draft ? "done" : "idle"}
            detail={draft ? `v${draft.versionNumber}, sin publicar` : "No hay borrador"} />
          <Step id="simulation" index={2} title="Simulación" state={simulationCurrent ? "done" : draft ? "pending" : "idle"}
            detail={simulationCurrent ? "Simulado con la configuración actual" : "Pendiente de simular"} />
          <Step id="review" index={3} title="Revisión" state={draft && reviewBase ? "pending" : "idle"}
            detail={!draft ? "Sin borrador" : !reviewBase ? "Primera versión: nada con lo que comparar"
              : changes === 0 ? `Sin cambios respecto a la v${reviewBase.versionNumber}` : `${changes} ${changes === 1 ? "cambio" : "cambios"} respecto a la v${reviewBase.versionNumber}`} />
          <Step id="publish" index={4} title="Publicación" state="idle"
            detail={!draft ? "Nada que publicar" : canPublish ? "Revisión, acceso efectivo y confirmación explícita" : "Requiere permiso de publicación"} />
        </ol>
      </CardContent>
    </Card>
  );
}

/** Tarjeta del borrador actual: identifica que NO está publicado y ofrece abrir, editar, simular. */
export function DraftCard({ draft, canEdit, onOpen, onEdit, onSimulate }: {
  draft: AgentVersion | null;
  canEdit: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onSimulate: () => void;
}) {
  if (!draft) {
    return (
      <Card data-testid="draft-card-empty">
        <CardContent className="p-4 text-sm text-muted-foreground">
          No hay borrador. La versión publicada no se edita directamente: al guardar un cambio se crea un borrador nuevo.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="draft-card" className="border-amber-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300" data-testid="draft-badge">BORRADOR</Badge>
          Versión v{draft.versionNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-amber-300" data-testid="draft-notice">Esta versión todavía no está publicada.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="draft-open" onClick={onOpen}>Abrir</Button>
          {canEdit && <Button type="button" variant="outline" size="sm" data-testid="draft-edit" onClick={onEdit}>Editar</Button>}
          <Button type="button" variant="outline" size="sm" data-testid="draft-simulate" onClick={onSimulate}>Simular</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Revisión antes de publicar: cambios del borrador respecto a la versión activa (o la última publicada). */
export function DraftReview({ draft, base }: { draft: AgentVersion; base: AgentVersion | null }) {
  return (
    <Card data-testid="draft-review">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Revisión antes de publicar</CardTitle>
        <p className="text-xs text-muted-foreground">
          {base ? `Cambios del borrador v${draft.versionNumber} respecto a la v${base.versionNumber}${base.publishedAt ? " (publicada)" : ""}.` : "Este agente todavía no tiene ninguna versión publicada."}
        </p>
      </CardHeader>
      <CardContent>
        {base ? <VersionDiff from={base} to={draft} /> : <p className="text-sm text-muted-foreground" data-testid="diff-no-base">Al publicar, este borrador será la primera versión publicada.</p>}
      </CardContent>
    </Card>
  );
}
