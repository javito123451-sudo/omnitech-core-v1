// Comprobación PREVIA (solo de ayuda) de si un borrador se puede publicar, con los catálogos reales del backend.
//
// El backend es la autoridad: al publicar vuelve a validar modelo, proveedor, fallbacks, conocimiento y herramientas y
// responde 422 si algo no es válido. Esto solo evita ofrecer «Publicar» cuando ya se sabe que va a fallar, y explica por qué.
// No hay ninguna lista propia: todo se compara con lo que devuelven GET /catalog/models, /catalog/knowledge, /catalog/tools
// y GET /:id/effective-access. Los valores ya guardados que el catálogo no contiene NO se tocan: bloquean la publicación
// hasta que el usuario los cambie.

import type {
  AgentConfig, AgentKnowledgeCatalogItem, AgentModelCatalog, AgentToolCatalogItem, EffectiveAccessResponse,
} from "./types";

export const NOT_AVAILABLE_NOW = "Configuración existente no disponible actualmente";

export interface PublishBlocker {
  /** Estable, para claves de React y tests. */
  key:    string;
  area:   "model" | "fallback" | "knowledge" | "tool" | "permissions";
  label:  string;
  detail: string;
}

export interface ReadinessInput {
  config:    Pick<AgentConfig, "model" | "knowledge" | "tools" | "permissions">;
  models:    AgentModelCatalog;
  knowledge: AgentKnowledgeCatalogItem[];
  tools:     AgentToolCatalogItem[];
  access:    EffectiveAccessResponse;
}

type Choice = { provider?: string; model?: string };
const has = (c: Choice) => Boolean(c.provider?.trim() || c.model?.trim());

/** Sin provider o sin modelo no se puede resolver el valor por defecto en el frontend (lo decide el router): se comprueba lo que se pueda. */
function choiceBlocker(c: Choice, catalog: AgentModelCatalog, key: string, area: "model" | "fallback", label: string): PublishBlocker | null {
  const name = `${c.provider || "—"} / ${c.model || "—"}`;
  const block = (detail: string): PublishBlocker => ({ key, area, label: `${label}: ${name}`, detail });

  if (c.provider) {
    const p = catalog.providers.find((x) => x.id === c.provider);
    if (!p) return block(`${NOT_AVAILABLE_NOW}: el proveedor no está en el catálogo.`);
    if (!p.available) return block(`${NOT_AVAILABLE_NOW}: el proveedor no está disponible en este momento.`);
    if (c.model && !catalog.models.some((m) => m.provider === c.provider && m.model === c.model)) {
      return block(`${NOT_AVAILABLE_NOW}: el modelo no está en el catálogo.`);
    }
    return null;
  }
  if (c.model && !catalog.models.some((m) => m.model === c.model)) return block(`${NOT_AVAILABLE_NOW}: el modelo no está en el catálogo.`);
  return null;
}

export function publishBlockers(input: ReadinessInput): PublishBlocker[] {
  const out: PublishBlocker[] = [];
  const { config } = input;

  if (has(config.model)) {
    const b = choiceBlocker(config.model, input.models, "model", "model", "Modelo");
    if (b) out.push(b);
  }
  (config.model.fallbacks ?? []).forEach((fb, i) => {
    const b = choiceBlocker(fb, input.models, `fallback-${i}`, "fallback", `Modelo de respaldo ${i + 1}`);
    if (b) out.push(b);
  });

  const kb = new Set(input.knowledge.map((k) => k.id));
  for (const id of config.knowledge.entryIds) {
    if (!kb.has(id)) out.push({ key: `knowledge-${id}`, area: "knowledge", label: `Conocimiento #${id}`, detail: `${NOT_AVAILABLE_NOW}: la entrada no existe o no está activa en este workspace.` });
  }

  const byId = new Map(input.tools.map((t) => [t.id, t]));
  const declared = [...config.tools.read.map((id) => ({ id, bucket: "read" as const })), ...config.tools.write.map((id) => ({ id, bucket: "action" as const }))];
  for (const { id, bucket } of declared) {
    const t = byId.get(id);
    if (!t) out.push({ key: `tool-${id}`, area: "tool", label: `Herramienta ${id}`, detail: `${NOT_AVAILABLE_NOW}: la herramienta no está en el catálogo.` });
    else if (t.kind !== bucket) out.push({ key: `tool-${id}-kind`, area: "tool", label: `Herramienta ${t.name}`, detail: `Está declarada como ${bucket === "read" ? "lectura" : "acción"} pero es de tipo ${t.kind === "read" ? "lectura" : "acción"}.` });
  }
  // Lo que el backend evalúa como estructuralmente inválido (no como falta de permiso del usuario, que es solo un aviso).
  for (const a of input.access.tools) {
    if (a.reason === "duplicate_declaration") out.push({ key: `tool-${a.toolId}-dup`, area: "tool", label: `Herramienta ${a.toolId}`, detail: "Está declarada dos veces." });
  }
  if (!config.permissions.writesRequireConfirmation) {
    out.push({ key: "confirmation", area: "permissions", label: "Confirmación de acciones", detail: "Ejecutar acciones sin confirmación humana no está soportado." });
  }
  return out;
}

/** Herramientas que el usuario actual NO podría usar (permiso o módulo): no bloquea, es información. */
export const deniedByAccess = (access: EffectiveAccessResponse) =>
  access.tools.filter((t) => !t.allowed && (t.reason === "missing_permission" || t.reason === "module_disabled"));
