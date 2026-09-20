import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/agents/format";
import { sortVersions } from "@/lib/agents/versioning";
import { cn } from "@/lib/utils";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/**
 * Historial de versiones (de GET /api/agents/:id), la más reciente primero. Una versión sin `publishedAt` es el
 * BORRADOR (lo único editable); con fecha está publicada y congelada. Con `onSelect` cada fila se puede abrir.
 */
export function AgentVersionList({ agent, versions, shownVersionId, selectedId, onSelect }: {
  agent: Agent;
  versions: AgentVersion[];
  shownVersionId?: number | null;
  selectedId?: number | null;
  onSelect?: (versionId: number) => void;
}) {
  const sorted = sortVersions(versions);
  return (
    <Card data-testid="versions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Historial de versiones</CardTitle>
        <p className="text-xs text-muted-foreground">Versiones ({sorted.length}), la más reciente primero. Las publicadas son inmutables.</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {sorted.map((v) => {
            const isDraft = v.publishedAt === null;
            return (
              <li
                key={v.id}
                data-testid={`version-${v.versionNumber}`}
                data-selected={v.id === selectedId ? "true" : "false"}
                className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm", v.id === selectedId && "bg-muted/40 rounded-md px-2")}
              >
                <span className="font-semibold">v{v.versionNumber}</span>
                <Badge variant="outline" className={isDraft ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : undefined}>{isDraft ? "Borrador" : "Publicada"}</Badge>
                {v.id === agent.activeVersionId && <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Activa</Badge>}
                {v.id === shownVersionId && <span className="text-xs text-muted-foreground">(configuración mostrada)</span>}
                <span className="text-xs text-muted-foreground">
                  {v.publishedAt ? `Publicada ${formatDateTime(v.publishedAt)}` : `Creada ${formatDateTime(v.createdAt)} · aún no publicada`}
                </span>
                {v.notes && <span className="text-xs text-muted-foreground truncate">{v.notes}</span>}
                {onSelect && (
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" data-testid={`version-select-${v.versionNumber}`} aria-pressed={v.id === selectedId} onClick={() => onSelect(v.id)}>
                    {v.id === selectedId ? "Seleccionada" : "Ver"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
