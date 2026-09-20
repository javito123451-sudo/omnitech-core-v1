// Problemas estructurados de publicación y validación del modelo/proveedor contra el catálogo REAL.
//
// El catálogo de modelos es la misma fuente que GET /api/agents/catalog/models (catalogService.buildModelCatalog:
// PROVIDER_CONFIG + isProviderAvailable + getPricingReport). Aquí no hay ninguna lista de modelos ni de providers.
// La resolución de qué provider/modelo se usaría cuando falta uno de los dos la hace el router (previewRoute), no este código.

import type { AgentConfig } from "@workspace/db";
import { previewRoute } from "../ai-gateway/providerRouter";
import type { ModelCatalog } from "./catalogService";

export type PublishProblemCode =
  | "MISSING_NAME" | "MISSING_OBJECTIVE" | "MISSING_INSTRUCTIONS"
  | "UNKNOWN_PROVIDER" | "PROVIDER_UNAVAILABLE" | "UNKNOWN_MODEL"
  | "UNKNOWN_TOOL" | "TOOL_KIND_MISMATCH" | "DUPLICATE_TOOL" | "CONFIRMATION_REQUIRED"
  | "UNKNOWN_KNOWLEDGE_ENTRY";

/** `field` es la ruta dentro de la respuesta del agente (config.model.model, config.tools.read…), pensada para la UI. */
export interface PublishProblem {
  field:   string;
  code:    PublishProblemCode;
  message: string;
}

export const problemMessages = (problems: PublishProblem[]): string[] => problems.map((p) => p.message);

/** Quita repetidos por campo+código (p. ej. el mismo proveedor desconocido detectado por dos comprobaciones). */
export function dedupeProblems(problems: PublishProblem[]): PublishProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => { const k = `${p.field}|${p.code}|${p.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const hasChoice = (m: { provider?: string; model?: string }) => Boolean(m.provider?.trim() || m.model?.trim());

/**
 * Comprueba un par provider/modelo contra el catálogo. El par se RESUELVE con el router (previewRoute): si falta el proveedor
 * se usa el de por defecto y si falta el modelo, el de por defecto de ese proveedor, exactamente como al ejecutar.
 */
function checkChoice(choice: { provider?: string; model?: string }, fieldBase: string, catalog: ModelCatalog): PublishProblem[] {
  const resolved = previewRoute({ agent: choice });
  const providerField = `${fieldBase}.provider`;
  const modelField = `${fieldBase}.model`;
  const provider = catalog.providers.find((p) => p.id === resolved.provider);

  if (!provider) {
    return [{ field: choice.provider ? providerField : modelField, code: "UNKNOWN_PROVIDER", message: `Proveedor de IA desconocido: ${resolved.provider}` }];
  }
  if (!provider.available) {
    return [{ field: choice.provider ? providerField : modelField, code: "PROVIDER_UNAVAILABLE", message: `El proveedor de IA «${resolved.provider}» no está disponible en este momento.` }];
  }
  if (!catalog.models.some((m) => m.provider === resolved.provider && m.model === resolved.model)) {
    return [{ field: modelField, code: "UNKNOWN_MODEL", message: `El modelo «${resolved.model}» no está disponible para el proveedor «${resolved.provider}».` }];
  }
  return [];
}

/** ¿Hace falta consultar el catálogo? Un agente sin modelo ni fallbacks usa el comportamiento por defecto y no se valida. */
export const modelNeedsValidation = (model: AgentConfig["model"]): boolean =>
  hasChoice(model) || (model.fallbacks ?? []).length > 0;

/**
 * Valida config.model y cada fallback por separado; un fallback inválido impide publicar aunque el principal sea válido.
 * Sin modelo fijo (ni provider ni model) el principal no se valida: se mantiene el modelo por defecto actual.
 */
export function validateModelForPublish(model: AgentConfig["model"], catalog: ModelCatalog): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (hasChoice(model)) problems.push(...checkChoice(model, "config.model", catalog));
  (model.fallbacks ?? []).forEach((fb, i) => problems.push(...checkChoice(fb, `config.model.fallbacks[${i}]`, catalog)));
  return dedupeProblems(problems);
}
