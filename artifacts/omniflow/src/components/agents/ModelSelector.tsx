import type { UseQueryResult } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { CatalogError, CatalogLoading, NOT_IN_CATALOG } from "@/components/agents/CatalogNotice";
import type { AgentModelCatalog } from "@/lib/agents/types";

export interface ModelValue { provider: string; model: string }

const catalogKey = (m: ModelValue) => `${m.provider}/${m.model}`;
const LEGACY_PREFIX = "legacy:";

/**
 * Selector de modelo alimentado SOLO por GET /api/agents/catalog/models. El proveedor no se escribe: se deriva del modelo
 * elegido. No se puede elegir nada fuera del catálogo; el único valor «fuera» que aparece es el que ya estaba guardado en
 * la configuración (se conserva y se avisa, no se borra ni se migra). Sin precios: solo si el precio es provisional.
 */
export function ModelSelector({ value, baseline, catalog, onChange }: {
  value: ModelValue;
  /** Lo que hay guardado en el servidor: si no está en el catálogo, se muestra como configuración existente. */
  baseline: ModelValue;
  catalog: UseQueryResult<AgentModelCatalog>;
  onChange: (next: ModelValue) => void;
}) {
  const models = catalog.data?.models ?? [];
  const inCatalog = (m: ModelValue) => models.some((x) => x.provider === m.provider && x.model === m.model);
  const isSet = (m: ModelValue) => m.provider !== "" || m.model !== "";

  // Solo hay valores heredados cuando el catálogo ya cargó (mientras carga no se puede afirmar que falten).
  const known = catalog.isSuccess;
  const baselineLegacy = known && isSet(baseline) && !inCatalog(baseline) ? baseline : null;
  const currentIsLegacy = known && isSet(value) && !inCatalog(value);

  const selectedKey = !isSet(value) ? "" : currentIsLegacy ? `${LEGACY_PREFIX}${catalogKey(value)}` : catalogKey(value);

  function handle(next: string) {
    if (next === "") { onChange({ provider: "", model: "" }); return; }
    if (next.startsWith(LEGACY_PREFIX)) { if (baselineLegacy) onChange(baselineLegacy); return; }
    const found = models.find((m) => catalogKey(m) === next);
    if (found) onChange({ provider: found.provider, model: found.model });          // el proveedor sale del modelo
  }

  const unavailable = catalog.data?.providers.filter((p) => !p.available).map((p) => p.id) ?? [];
  const disabled = !known || (models.length === 0 && !baselineLegacy);

  return (
    <div className="space-y-2 sm:col-span-2" data-testid="model-selector">
      <Label htmlFor="f-model">Modelo</Label>

      {catalog.isPending && <CatalogLoading name="models" label="Cargando modelos disponibles…" />}
      {catalog.isError && <CatalogError name="models" error={catalog.error} onRetry={() => void catalog.refetch()} />}

      <select
        id="f-model" data-testid="model-select" disabled={disabled}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
        value={known ? selectedKey : ""}
        onChange={(e) => handle(e.target.value)}
      >
        <option value="">Predeterminado del sistema (sin modelo fijo)</option>
        {baselineLegacy && (
          <option value={`${LEGACY_PREFIX}${catalogKey(baselineLegacy)}`}>
            {`${baselineLegacy.provider || "—"} / ${baselineLegacy.model || "—"} · ${NOT_IN_CATALOG}`}
          </option>
        )}
        {models.map((m) => (
          <option key={catalogKey(m)} value={catalogKey(m)} data-provisional={m.provisional ? "true" : "false"}>
            {`${m.provider} / ${m.model}${m.provisional ? " · precio provisional" : ""}`}
          </option>
        ))}
      </select>

      {catalog.isSuccess && models.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="model-empty">
          No hay modelos disponibles en este entorno.
          {unavailable.length > 0 && ` El proveedor ${unavailable.join(", ")} no está disponible.`}
        </p>
      )}

      {currentIsLegacy && (
        <p className="text-xs text-amber-400" data-testid="model-legacy-notice">
          {NOT_IN_CATALOG}: {value.provider || "—"} / {value.model || "—"}. Se conserva hasta que elijas otro modelo del catálogo.
        </p>
      )}

      <p className="text-xs text-muted-foreground" data-testid="model-provider">
        Proveedor: {isSet(value) ? (value.provider || "—") : "el predeterminado del sistema"} (se deduce del modelo).
      </p>
    </div>
  );
}
