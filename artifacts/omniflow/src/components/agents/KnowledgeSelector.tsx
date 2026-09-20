import type { UseQueryResult } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CatalogError, CatalogLoading, NOT_IN_CATALOG } from "@/components/agents/CatalogNotice";
import type { AgentKnowledgeCatalogItem } from "@/lib/agents/types";

/**
 * Selector de conocimiento alimentado SOLO por GET /api/agents/catalog/knowledge (título y categoría; nunca el contenido).
 * Edita exactamente `config.knowledge.entryIds`. Los IDs guardados que el catálogo ya no devuelve (borrados, inactivos…)
 * se conservan y se marcan como configuración existente: solo desaparecen si el usuario los desmarca.
 */
export function KnowledgeSelector({ selectedIds, baselineIds, workspaceAll, catalog, onChange }: {
  selectedIds: number[];
  baselineIds: number[];
  /** config.knowledge.workspace: el agente ya usa todo el conocimiento activo. */
  workspaceAll: boolean;
  catalog: UseQueryResult<AgentKnowledgeCatalogItem[]>;
  onChange: (ids: number[]) => void;
}) {
  const items = catalog.data ?? [];
  const catalogIds = new Set(items.map((i) => i.id));
  const known = catalog.isSuccess;
  const selected = new Set(selectedIds);

  // Valores existentes que el catálogo no contiene (los seleccionados y los que había guardados, para poder volver a marcarlos).
  const legacy = known ? [...new Set([...selectedIds, ...baselineIds])].filter((id) => !catalogIds.has(id)).sort((a, b) => a - b) : [];

  function toggle(id: number, on: boolean) {
    onChange(on ? [...selectedIds.filter((x) => x !== id), id] : selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2 sm:col-span-2" data-testid="knowledge-selector">
      <Label>Entradas de conocimiento</Label>

      {workspaceAll && (
        <p className="text-xs text-muted-foreground" data-testid="knowledge-workspace-note">
          Este agente usa todo el conocimiento activo del workspace: la selección de entradas no lo limita.
        </p>
      )}

      {catalog.isPending && <CatalogLoading name="knowledge" label="Cargando conocimiento del workspace…" />}
      {catalog.isError && <CatalogError name="knowledge" error={catalog.error} onRetry={() => void catalog.refetch()} />}

      {known && items.length === 0 && legacy.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="knowledge-empty">
          Este workspace no tiene entradas de conocimiento activas.
        </p>
      )}

      {known && (items.length > 0 || legacy.length > 0) && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2" data-testid="knowledge-list">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2" data-testid={`knowledge-item-${i.id}`}>
              <Checkbox id={`kb-${i.id}`} checked={selected.has(i.id)} onCheckedChange={(on) => toggle(i.id, on === true)} />
              <Label htmlFor={`kb-${i.id}`} className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                <span className="truncate">{i.title}</span>
                <Badge variant="outline" className="shrink-0">{i.category}</Badge>
              </Label>
            </li>
          ))}
          {legacy.map((id) => (
            <li key={`legacy-${id}`} className="flex items-center gap-2" data-testid={`knowledge-legacy-${id}`}>
              <Checkbox id={`kb-${id}`} checked={selected.has(id)} onCheckedChange={(on) => toggle(id, on === true)} />
              <Label htmlFor={`kb-${id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-normal">
                <span>Entrada #{id}</span>
                <span className="text-xs text-amber-400">{NOT_IN_CATALOG}</span>
              </Label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
