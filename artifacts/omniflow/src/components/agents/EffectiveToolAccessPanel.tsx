import type { UseQueryResult } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CatalogError, CatalogLoading } from "@/components/agents/CatalogNotice";
import type { AgentToolCatalogItem, EffectiveAccessResponse, EffectiveReason } from "@/lib/agents/types";

const STATE: Record<EffectiveReason, { label: string; ok: boolean }> = {
  allowed:               { label: "Disponible", ok: true },
  confirmation_required: { label: "Disponible con confirmación", ok: true },
  missing_permission:    { label: "Sin permiso", ok: false },
  module_disabled:       { label: "Módulo desactivado", ok: false },
  unknown_tool:          { label: "Herramienta desconocida", ok: false },
  duplicate_declaration: { label: "Declarada dos veces", ok: false },
  kind_mismatch:         { label: "Tipo incorrecto", ok: false },
  not_declared:          { label: "No declarada", ok: false },
};

/**
 * Qué podría hacer REALMENTE este agente para TI: herramientas declaradas ∩ tu permiso ∩ módulo del workspace ∩ registro.
 * Es solo informativo: el backend lo calcula con las mismas reglas que usa al ejecutar; aquí no se puede cambiar ningún
 * permiso, módulo ni tipo. Consultarlo no ejecuta nada, no usa IA y no gasta créditos.
 */
export function EffectiveToolAccessPanel({ access, catalog }: {
  access: UseQueryResult<EffectiveAccessResponse>;
  /** Opcional: para mostrar el nombre de cada herramienta; sin él se muestra el id. */
  catalog?: UseQueryResult<AgentToolCatalogItem[]>;
}) {
  const names = new Map((catalog?.data ?? []).map((t) => [t.id, t.name]));
  const data = access.data;

  return (
    <div className="space-y-2 sm:col-span-2" data-testid="effective-access">
      <p className="text-sm font-medium text-foreground">Acceso efectivo</p>
      <p className="text-xs text-muted-foreground">Solo informativo: lo que este agente podría hacer con tu rol y los módulos de este workspace.</p>

      {access.isPending && <CatalogLoading name="access" label="Calculando el acceso efectivo…" />}
      {access.isError && <CatalogError name="access" error={access.error} onRetry={() => void access.refetch()} />}

      {data && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="access-summary">
            Calculado para el rol «{data.role}» sobre {data.version.isDraft ? "el borrador" : "la versión activa"} v{data.version.versionNumber}: {data.summary.allowed} de {data.summary.declared} disponibles
            {data.summary.requireConfirmation > 0 ? `, ${data.summary.requireConfirmation} con confirmación humana` : ""}.
          </p>

          {data.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="access-empty">Este agente no declara herramientas, así que no puede consultar ni cambiar datos.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr><th className="px-3 py-2">Herramienta</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Permiso</th><th className="px-3 py-2">Módulo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Motivo</th></tr>
                </thead>
                <tbody>
                  {data.tools.map((t, i) => {
                    const s = STATE[t.reason];
                    return (
                      <tr key={`${t.toolId}-${i}`} className="border-t border-border" data-testid={`access-row-${t.toolId}`} data-allowed={t.allowed ? "true" : "false"} data-reason={t.reason}>
                        <td className="px-3 py-2"><span className="font-medium text-foreground">{names.get(t.toolId) ?? t.toolId}</span> <code className="text-muted-foreground">{t.toolId}</code></td>
                        <td className="px-3 py-2"><Badge variant="outline" data-testid={`access-kind-${t.toolId}`}>{t.kind === "action" ? "ACTION" : t.kind === "read" ? "READ" : "—"}</Badge></td>
                        <td className="px-3 py-2"><code>{t.permission ?? "—"}</code></td>
                        <td className="px-3 py-2"><code>{t.module ?? "—"}</code></td>
                        <td className="px-3 py-2" data-testid={`access-state-${t.toolId}`}>
                          <span className={`inline-flex items-center gap-1 ${s.ok ? "text-emerald-400" : "text-rose-400"}`}>
                            {s.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{s.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
