import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentConfigSummary } from "@/components/agents/AgentConfigSummary";
import { RestoreVersionDialog } from "@/components/agents/RestoreVersionDialog";
import { VersionDiff } from "@/components/agents/VersionDiff";
import { formatDateTime } from "@/lib/agents/format";
import { sortVersions } from "@/lib/agents/versioning";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/**
 * Detalle de UNA versión, con su propia configuración (nunca datos actuales del agente mezclados) y comparación con
 * otra versión. Aquí también se restaura (solo con agents.write y agente no archivado).
 */
export function VersionDetailPanel({ agent, versions, selectedId, canRestore, hasUnsavedEdits, onClose, onRestored }: {
  agent: Agent;
  versions: AgentVersion[];
  selectedId: number;
  canRestore: boolean;
  hasUnsavedEdits: boolean;
  onClose: () => void;
  onRestored: (saved: AgentVersion) => void;
}) {
  const sorted = sortVersions(versions);
  const version = sorted.find((v) => v.id === selectedId) ?? null;
  const older = version ? sorted.find((v) => v.versionNumber < version.versionNumber) ?? null : null;
  const [compareId, setCompareId] = useState<number | null>(older?.id ?? null);

  // Al cambiar de versión seleccionada, la comparación por defecto es con la inmediatamente anterior.
  useEffect(() => { setCompareId(older?.id ?? null); }, [version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!version) {
    return (
      <Alert data-testid="version-not-found">
        <AlertTitle>Versión no encontrada</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>La versión seleccionada no existe en este agente.</p>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Volver al historial</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const isDraft = version.publishedAt === null;
  const isActive = version.id === agent.activeVersionId;
  const compareWith = sorted.find((v) => v.id === compareId && v.id !== version.id) ?? null;

  return (
    <Card data-testid="version-detail" data-version-id={version.id} className={isDraft ? "border-amber-500/40" : undefined}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span data-testid="version-detail-title">Versión v{version.versionNumber}</span>
            {isDraft
              ? <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300" data-testid="version-detail-state">BORRADOR</Badge>
              : <Badge variant="outline" data-testid="version-detail-state">Publicada</Badge>}
            {isActive && <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Activa</Badge>}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {canRestore && <RestoreVersionDialog agentId={agent.id} version={version} versions={versions} hasUnsavedEdits={hasUnsavedEdits} onRestored={onRestored} />}
            <Button type="button" variant="ghost" size="sm" data-testid="version-detail-close" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" /> Volver al historial</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {version.publishedAt ? `Publicada ${formatDateTime(version.publishedAt)}. Está congelada: no se puede modificar.` : `Creada ${formatDateTime(version.createdAt)}.`}
          {version.notes ? ` Notas: ${version.notes}` : ""}
        </p>
        {isDraft && <p className="text-sm font-medium text-amber-300" data-testid="version-detail-unpublished">Esta versión todavía no está publicada.</p>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="compare-select" className="text-sm font-medium text-foreground">Comparar con</label>
            <select
              id="compare-select" data-testid="compare-select"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={compareWith?.id ?? ""} onChange={(e) => setCompareId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— ninguna —</option>
              {sorted.filter((v) => v.id !== version.id).map((v) => (
                <option key={v.id} value={v.id}>v{v.versionNumber} · {v.publishedAt ? "publicada" : "borrador"}</option>
              ))}
            </select>
          </div>
          {compareWith
            ? <VersionDiff from={compareWith} to={version} />
            : <p className="text-sm text-muted-foreground" data-testid="diff-no-base">{sorted.length < 2 ? "Es la única versión: no hay otra con la que comparar." : "Elige una versión para ver los cambios."}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground" data-testid="version-config-title">Configuración de la v{version.versionNumber}</p>
          <AgentConfigSummary config={version.config} />
        </div>
      </CardContent>
    </Card>
  );
}
