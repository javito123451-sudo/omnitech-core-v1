import type { UseQueryResult } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { CatalogError, CatalogLoading, NOT_IN_CATALOG } from "@/components/agents/CatalogNotice";
import type { AgentToolCatalogItem } from "@/lib/agents/types";

type Bucket = "read" | "write";

/**
 * Herramientas que declara la versión, descritas con el catálogo real (GET /api/agents/catalog/tools). SOLO LECTURA: no se
 * puede añadir, quitar ni cambiar ninguna herramienta, ni su tipo, permiso o módulo (los define el backend). El acceso
 * efectivo lo calcula el backend en cada ejecución (herramienta ∩ permiso del usuario ∩ módulo del workspace).
 */
export function ToolsCatalogPanel({ tools, catalog }: {
  tools: { read: string[]; write: string[] };
  catalog: UseQueryResult<AgentToolCatalogItem[]>;
}) {
  const declared: Array<{ id: string; bucket: Bucket }> = [
    ...tools.read.map((id) => ({ id, bucket: "read" as const })),
    ...tools.write.map((id) => ({ id, bucket: "write" as const })),
  ];
  const byId = new Map((catalog.data ?? []).map((t) => [t.id, t]));

  return (
    <div className="space-y-3 sm:col-span-2" data-testid="tools-panel">
      <p className="text-xs text-muted-foreground" data-testid="tools-readonly-note">
        Solo lectura: las herramientas y sus permisos los define el sistema y todavía no se pueden editar desde aquí.
      </p>

      {catalog.isPending && <CatalogLoading name="tools" label="Cargando el catálogo de herramientas…" />}
      {catalog.isError && <CatalogError name="tools" error={catalog.error} onRetry={() => void catalog.refetch()} />}

      {declared.length === 0 && <p className="text-sm text-muted-foreground" data-testid="tools-none">Esta versión no declara herramientas.</p>}

      {declared.length > 0 && (
        <ul className="space-y-2">
          {declared.map(({ id, bucket }) => {
            const item = byId.get(id);
            if (!catalog.isSuccess) {
              return <li key={`${bucket}-${id}`} className="rounded-lg border border-border p-3 text-sm" data-testid={`tool-${id}`}><code>{id}</code></li>;
            }
            if (!item) {
              return (
                <li key={`${bucket}-${id}`} className="rounded-lg border border-amber-500/30 p-3 text-sm" data-testid={`tool-legacy-${id}`}>
                  <code>{id}</code> <span className="text-xs text-amber-400">{NOT_IN_CATALOG}</span>
                </li>
              );
            }
            const mismatch = (bucket === "read") !== (item.kind === "read");
            return (
              <li key={`${bucket}-${id}`} className="space-y-1.5 rounded-lg border border-border p-3 text-sm" data-testid={`tool-${id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground" data-testid={`tool-name-${id}`}>{item.name}</span>
                  <Badge variant="outline" data-testid={`tool-kind-${id}`}>{item.kind === "read" ? "Lectura" : "Acción"}</Badge>
                  <code className="text-xs text-muted-foreground">{item.id}</code>
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p className="text-xs text-muted-foreground" data-testid={`tool-meta-${id}`}>
                  Permiso: <code>{item.permission}</code> · Módulo: <code>{item.module}</code>
                </p>
                {mismatch && (
                  <p className="text-xs text-amber-400" data-testid={`tool-mismatch-${id}`}>
                    Declarada como {bucket === "read" ? "lectura" : "acción"}, pero es de tipo {item.kind === "read" ? "lectura" : "acción"}: el backend no la usará hasta corregirlo.
                  </p>
                )}
                {item.params.length > 0 && (
                  <details className="text-xs text-muted-foreground" data-testid={`tool-params-${id}`}>
                    <summary className="cursor-pointer">Parámetros ({item.params.length})</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {item.params.map((p) => (
                        <li key={p.name}><code>{p.name}</code> ({p.type}{p.required ? ", obligatorio" : ""}): {p.description}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
