import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/agents/format";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/**
 * Versiones del agente (de GET /api/agents/:id), en solo lectura. Una versión sin `publishedAt` es el borrador
 * editable; con fecha, está publicada y congelada. Sin acciones: restaurar/editar no forman parte de esta fase.
 */
export function AgentVersionList({ agent, versions, shownVersionId }: { agent: Agent; versions: AgentVersion[]; shownVersionId?: number | null }) {
  return (
    <Card data-testid="versions">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Versiones ({versions.length})</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid={`version-${v.versionNumber}`}>
              <span className="font-semibold">v{v.versionNumber}</span>
              <Badge variant="outline">{v.publishedAt ? "Publicada" : "Borrador"}</Badge>
              {v.id === agent.activeVersionId && <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Activa</Badge>}
              {v.id === shownVersionId && <span className="text-xs text-muted-foreground">(configuración mostrada)</span>}
              <span className="text-xs text-muted-foreground">
                {v.publishedAt ? `Publicada ${formatDateTime(v.publishedAt)}` : `Creada ${formatDateTime(v.createdAt)}`}
              </span>
              {v.notes && <span className="text-xs text-muted-foreground truncate">{v.notes}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
