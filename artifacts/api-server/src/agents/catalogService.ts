// ═══════════════════════════════════════════════════════════════════════════
//  Catálogos de solo lectura de Agent Factory.
//
//  Cada catálogo se CONSTRUYE a partir de una fuente que ya existe; aquí no hay
//  listas propias ni tablas nuevas:
//
//    tools      TOOL_REGISTRY (agents/toolRegistry.ts) ∩ Skill Engine (skills/index.ts)
//    models     PROVIDER_CONFIG + isProviderAvailable (ai-gateway/providerRouter.ts)
//               + getPricingReport() (ai-gateway/pricingService.ts): filas vigentes de ai_model_pricing y modelos
//                 heredados tal y como los resuelve el pricingRegistry. Un test de arquitectura (finalAudit) impide
//                 leer la tabla de valores heredados fuera de la capa de precios, por eso se pasa por el informe
//    knowledge  knowledge_base del workspace (la misma tabla que lee el runtime, agents/knowledge.ts)
//
//  Son DESCRIPTIVOS: decir que algo está en el catálogo no da acceso a nada. El acceso efectivo de un
//  agente a una tool lo calcula resolveToolAccess (agents/authorization.ts) en cada ejecución.
//
//  Las funciones build* son puras (reciben sus fuentes) para poder probarse sin base de datos.
// ═══════════════════════════════════════════════════════════════════════════

import { db, knowledgeBaseTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { SkillDefinition, SkillParam } from "../skills/types";
import type { ToolKind, AgentTool } from "./toolRegistry";
import type { PriceSource } from "../ai-gateway/pricingRegistry";

// ── Tools ────────────────────────────────────────────────────────────────────

export interface ToolCatalogParam {
  name:        string;
  type:        SkillParam["type"];
  description: string;
  required:    boolean;
  /** Solo si el valor por defecto es JSON serializable. */
  default?:    unknown;
}

export interface ToolCatalogEntry {
  id:          string;
  kind:        ToolKind;
  /** Nombre y descripción de la skill (Skill Engine). */
  name:        string;
  description: string;
  /** Permiso RBAC real que debe tener el usuario que ejecuta. */
  permission:  string;
  /** Módulo del workspace que debe estar habilitado. */
  module:      string;
  params:      ToolCatalogParam[];
  /** Frases que usa el simulador gratuito para elegir la tool. */
  keywords:    string[];
}

/** Un valor por defecto solo sale en el catálogo si sobrevive a JSON (nada de funciones ni referencias internas). */
function serializableDefault(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return { ok: false };
  try {
    const round = JSON.parse(JSON.stringify(value)) as unknown;
    return { ok: true, value: round };
  } catch { return { ok: false }; }
}

/**
 * Una tool está en el catálogo solo si existe en el registro de Agent Factory Y en el Skill Engine: es exactamente la
 * condición con la que publishAgent la acepta, así el cliente nunca ve (ni puede declarar) una tool que no existe.
 */
export function buildToolCatalog(registry: AgentTool[], skills: Array<Pick<SkillDefinition, "id" | "name" | "description" | "params">>): ToolCatalogEntry[] {
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const out: ToolCatalogEntry[] = [];
  for (const t of registry) {
    const skill = skillById.get(t.id);
    if (!skill) continue;
    out.push({
      id: t.id,
      kind: t.kind,
      name: skill.name,
      description: skill.description,
      permission: t.permission,
      module: t.module,
      params: skill.params.map((p): ToolCatalogParam => {
        const def = serializableDefault(p.default);
        return {
          name: p.name, type: p.type, description: p.description, required: p.required === true,
          ...(def.ok ? { default: def.value } : {}),
        };
      }),
      keywords: [...t.keywords],
    });
  }
  return out;
}

// ── Modelos y providers ──────────────────────────────────────────────────────

export interface CatalogProvider {
  id: string;
  /** Hay implementación y clave configurada: solo entonces se puede elegir. */
  available: boolean;
}

export interface CatalogModel {
  provider:    string;
  model:       string;
  /** true = el precio no está validado (fila marcada provisional o valor heredado). */
  provisional: boolean;
  /** true = el modelo tiene un precio explícito (fila en BD o valor heredado). */
  priceKnown:  boolean;
  /** De dónde sale el precio: fila de ai_model_pricing («db») o valor heredado («legacy»). */
  priceSource: Exclude<PriceSource, "fallback">;
  /** Documento o URL oficial del precio (solo filas «db»). */
  source:      string | null;
}

export interface ModelCatalog {
  /** Solo providers IMPLEMENTADOS (los stubs no salen). `available:false` = falta la clave en este despliegue. */
  providers: CatalogProvider[];
  /** Solo modelos de providers disponibles, para poder elegirlos. */
  models:    CatalogModel[];
}

/** Lo que necesita el catálogo del informe de precios (getPricingReport): solo provider, model y fuente. */
export interface PricingReportLike {
  /** Filas vigentes de ai_model_pricing con precio validado. */
  official:          Array<{ provider: string; model: string; source: string | null }>;
  /** Filas vigentes de ai_model_pricing marcadas provisionales. */
  dbProvisional:     Array<{ provider: string; model: string; source: string | null }>;
  /** Modelos con valor heredado (anterior a ai_model_pricing) sin precio oficial. */
  legacyProvisional: Array<{ provider: string; model: string }>;
}

export interface ModelCatalogSources {
  providerConfig: Record<string, { implemented: boolean }>;
  isAvailable:    (providerId: string) => boolean;
  report:         PricingReportLike;
}

/**
 * Los modelos de embeddings tienen precio pero no sirven para generar respuestas: un agente no puede usarlos.
 * No existe una marca de capacidad en el backend, así que se excluyen por el prefijo estándar de OpenAI.
 */
const isEmbeddingModel = (model: string) => /^text-embedding-/i.test(model);

/**
 * Modelos que el sistema puede resolver de verdad, con la misma prioridad que pricingRegistry.resolvePricing:
 * una fila vigente de ai_model_pricing manda sobre el valor heredado (getPricingReport ya filtra activas y vigentes). Sin precios (USD) ni tarifas: son datos
 * técnicos de negocio y el cliente ve créditos, no dólares (mismo criterio que credits/customerView.ts).
 */
export function buildModelCatalog(src: ModelCatalogSources): ModelCatalog {
  const providers: CatalogProvider[] = Object.entries(src.providerConfig)
    .filter(([, cfg]) => cfg.implemented)
    .map(([id]) => ({ id, available: src.isAvailable(id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const selectable = new Set(providers.filter((p) => p.available).map((p) => p.id));

  const byKey = new Map<string, CatalogModel>();
  const add = (m: CatalogModel) => {
    const k = `${m.provider}/${m.model}`;
    if (selectable.has(m.provider) && !isEmbeddingModel(m.model) && !byKey.has(k)) byKey.set(k, m);
  };

  // Orden de prioridad = el de resolvePricing: fila vigente de la BD (validada o provisional) y, si no hay, valor heredado.
  for (const r of src.report.official) add({ provider: r.provider, model: r.model, provisional: false, priceKnown: true, priceSource: "db", source: r.source });
  for (const r of src.report.dbProvisional) add({ provider: r.provider, model: r.model, provisional: true, priceKnown: true, priceSource: "db", source: r.source });
  for (const r of src.report.legacyProvisional) add({ provider: r.provider, model: r.model, provisional: true, priceKnown: true, priceSource: "legacy", source: null });

  const models = [...byKey.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  return { providers, models };
}

// ── Knowledge ────────────────────────────────────────────────────────────────

export interface KnowledgeCatalogEntry {
  id:       number;
  title:    string;
  category: string;
}

/**
 * Entradas de knowledge_base que un agente de ESTE workspace puede usar: las activas, igual que el runtime
 * (agents/knowledge.ts ignora las inactivas). Nunca selecciona el contenido y filtra siempre por orgId.
 */
export function knowledgeCatalogQuery(orgId: number) {
  return db.select({ id: knowledgeBaseTable.id, title: knowledgeBaseTable.title, category: knowledgeBaseTable.category })
    .from(knowledgeBaseTable)
    .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true)))
    .orderBy(asc(knowledgeBaseTable.sortOrder), asc(knowledgeBaseTable.id))
    .limit(1000);
}

export async function listKnowledgeCatalog(orgId: number): Promise<KnowledgeCatalogEntry[]> {
  return knowledgeCatalogQuery(orgId);
}
