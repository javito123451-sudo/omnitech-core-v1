// Tipos de Agent Factory en el frontend.
//
// Salen de las respuestas REALES del backend (routes/agents.ts → agents/agentService.ts, credits/reporting.ts,
// agents/defaultAgents.ts) tal como viajan por JSON: las fechas llegan como cadenas ISO y los numeric de
// Postgres que el backend ya convierte llegan como números. El frontend no importa `@workspace/db`, así que
// las listas cerradas (estados y canales) se repiten aquí; un test las compara con lib/db/src/schema/ai-agents.ts
// para que no puedan desincronizarse en silencio.
//
// Solo lo que existe hoy: nada de tipos de simulación, LIVE ni de endpoints que aún no existen.

/** lib/db/src/schema/ai-agents.ts → AGENT_STATUSES */
export const AGENT_STATUSES = ["draft", "published", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** lib/db/src/schema/ai-agents.ts → AGENT_CHANNELS */
export const AGENT_CHANNELS = ["web", "crm", "super_admin", "telegram", "whatsapp", "email"] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

/** Clave del agente por defecto que vale para todo el workspace (DEFAULT_AGENT_ALL_CHANNELS). */
export const DEFAULT_AGENT_ALL_CHANNELS = "all";

/** Configuración de UNA versión (agentConfigSchema). */
export interface AgentConfig {
  identity:        { role: string };
  objective:       { what: string; audience: string; expectedOutcome: string };
  personality:     { tone: string; style: string; language: string; formality: string };
  behavior:        { instructions: string; rules: string[]; restrictions: string[]; avoid: string[] };
  businessContext: string;
  model:           { provider?: string; model?: string; fallbacks?: Array<{ provider?: string; model?: string }> };
  parameters:      { temperature: number; maxOutputTokens: number; maxToolRounds: number; maxHistoryMessages: number };
  knowledge:       { workspace: boolean; entryIds: number[]; categories: string[] };
  tools:           { read: string[]; write: string[] };
  permissions:     { writesRequireConfirmation: boolean };
  channels:        AgentChannel[];
}

/** Fila de ai_agents. `status` llega como texto: el backend solo escribe los valores de AgentStatus. */
export interface Agent {
  id:          number;
  orgId:       number;
  name:        string;
  description: string | null;
  avatarUrl:   string | null;
  status:      AgentStatus;
  activeVersionId: number | null;
  limits:      Record<string, unknown>;
  /** Presupuestos de créditos del agente. null = sin tope. */
  monthlyCreditLimit:      number | null;
  dailyCreditLimit:        number | null;
  perExecutionCreditLimit: number | null;
  createdBy:   string | null;
  createdAt:   string;
  updatedAt:   string;
}

/** Fila de ai_agent_versions. publishedAt null = borrador editable; con fecha = congelada. */
export interface AgentVersion {
  id:            number;
  agentId:       number;
  orgId:         number;
  versionNumber: number;
  config:        AgentConfig;
  notes:         string | null;
  publishedAt:   string | null;
  createdBy:     string | null;
  createdAt:     string;
}

/** GET /api/agents → cada agente lleva además el número de su versión activa. */
export type AgentListItem = Agent & { activeVersionNumber: number | null };
export type AgentListResponse = AgentListItem[];

/** GET /api/agents/:id */
export interface AgentDetailResponse {
  agent:    Agent;
  versions: AgentVersion[];   // de la más reciente a la más antigua
}

/** POST /api/agents (201). Sin `config`, el backend crea la versión 1 con la configuración por defecto. */
export interface CreateAgentInput {
  name:         string;
  description?: string | null;
  avatarUrl?:   string | null;
  config?:      Partial<AgentConfig>;
}
export interface CreateAgentResponse {
  agent:   Agent;
  version: AgentVersion;
}

/** GET /api/agents/credits/balance (agents/creditService.getAvailable). */
export interface CreditsBalance {
  balance:   number;
  /** Reservas en curso (créditos retenidos por llamadas de IA que aún no han terminado). */
  held:      number;
  available: number;
}

/** Fila de credit_alerts (umbral de plan o consumo anómalo). */
export interface CreditAlert {
  id:        number;
  orgId:     number;
  kind:      "threshold" | "anomaly" | string;
  threshold: number;
  periodKey: string;
  details:   Record<string, unknown> | null;
  createdAt: string;
}

/**
 * GET /api/agents/credits (credits/reporting.getDashboard) SIN modo técnico: créditos, nunca tokens ni costes
 * en dinero. El frontend de cliente no pide `?technical=1`.
 */
export interface CreditsDashboard {
  plan:      string | null;
  balance:   number;
  held:      number;
  available: number;
  period:    { key: string; start: string; end: string; renewsAt: string };
  included:  number | null;
  used:      number;
  usedToday: number;
  pctConsumed: number | null;
  limits:    { monthly: number | null; daily: number | null; perAgentMonthly: number | null; blockAtLimit: boolean } | null;
  pricing:   { provisionalCredits: number; provisionalRuns: number; provisional: boolean };

  // Datos listos para mostrar
  creditsUsed:        number;
  creditsRemaining:   number;
  monthlyCredits:     number | null;
  rolloverCredits:    number;
  extraCredits:       number;
  includedRemaining:  number;
  usagePercentage:    number | null;
  renewalDate:        string;
  provisionalCredits: number;
  usedByOrigin:       { included: number; rollover: number; extra: number };

  // Desgloses
  byAgent:   Array<{ agentId: number | null; credits: number; runs: number }>;
  byModel:   Array<{ provider: string | null; model: string | null; credits: number; runs: number }>;
  byFeature: Array<{ feature: string; credits: number; runs: number }>;
  daily:     Array<{ day: string; credits: number }>;
  byDay:     Array<{ day: string; credits: number }>;
  monthly:   Array<{ month: string; credits: number }>;
  forecast:  { projectedMonthCredits: number; basis: "linear" };
  alerts:    CreditAlert[];
}

/** Fila de ai_agent_defaults: agente por defecto del workspace ("all") o de un canal. */
export interface DefaultAgent {
  id:        number;
  orgId:     number;
  channel:   string;
  agentId:   number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export type DefaultAgentsResponse = DefaultAgent[];

/** POST /api/agents/:id/publish (agents.publish) → agentService.publishAgent. Los fallos llevan `{ error, problems? }` (404/409/422). */
export interface PublishAgentResponse {
  agent:                  Agent;
  publishedVersionNumber: number;
}

/** POST /api/agents/:id/simulate (agents.read). Body: un `message` (o un scenarioId, no usado por esta UI). */
export interface SimulateAgentInput {
  message:    string;
  versionId?: number;
}

/**
 * Respuesta de POST /api/agents/:id/simulate en la vista de CLIENTE (sin ?technical=1): el backend quita
 * `tokensEstimated` y los importes en dinero de `estimate` (stripTechnical), y añade `denied` (herramientas
 * excluidas). Es una simulación: `simulated` es siempre true, no llama a ningún proveedor, no gasta créditos.
 */
export interface SimulationResult {
  simulated:      true;
  agent:          { id: number; name: string; versionNumber: number | null };
  route:          { provider: string; model: string };
  toolsSelected:  string[];
  proposedAction: { toolId: string; params: Record<string, unknown>; requiresConfirmation: true } | null;
  estimate: {
    typicalCredits: number;
    maxCredits:     number;
    priceKnown:     boolean;
    priceSource:    "db" | "legacy" | "fallback";
    provisional:    boolean;
  };
  reply:  string;
  notes:  string[];
  denied: Array<{ toolId: string; reason: string }>;
}

/**
 * PUT /api/agents/:id/draft (agents.write) → agentService.saveDraft. Devuelve la versión guardada (AgentVersion).
 * `config` es PARCIAL: se valida con agentConfigSchema.partial() y se mezcla a nivel de SECCIÓN (`{...base, ...patch}`),
 * es decir, cada sección enviada sustituye a la anterior completa y las no enviadas se conservan.
 * Con borrador: se actualiza ese borrador. Sin borrador: se crea una versión nueva (nº + 1) a partir de la última.
 * Un agente archivado responde 409; published/paused sí se pueden editar (siempre sobre un borrador).
 */
export interface SaveDraftInput {
  config: Partial<AgentConfig>;
  notes?: string | null;
}

/** PATCH /api/agents/:id (agents.write) → devuelve el Agent actualizado. Solo estos campos los usa el Builder. */
export interface UpdateAgentMetaInput {
  name?:        string;
  description?: string | null;
  avatarUrl?:   string | null;
}

/** Incidencia de validación de zod que el backend devuelve en un 400: `{ error: "Configuración no válida.", issues }`. */
export interface ValidationIssue {
  path:    Array<string | number>;
  message: string;
}

// ── Catálogos read-only (artifacts/api-server/src/agents/catalogService.ts) ─────────────────────────

/** Un parámetro de una tool, tal como lo describe el Skill Engine. `default` solo viene si es serializable. */
export interface AgentToolParamCatalogItem {
  name:        string;
  type:        "string" | "number" | "boolean" | "date" | "time" | "object" | "array";
  description: string;
  required:    boolean;
  default?:    unknown;
}

/** GET /api/agents/catalog/tools → AgentToolCatalogItem[] (global: TOOL_REGISTRY ∩ Skill Engine). */
export interface AgentToolCatalogItem {
  id:          string;
  kind:        "read" | "action";
  name:        string;
  description: string;
  /** Permiso RBAC que debe tener quien ejecuta. Informativo: el acceso efectivo lo calcula el backend. */
  permission:  string;
  /** Módulo del workspace que debe estar habilitado. */
  module:      string;
  params:      AgentToolParamCatalogItem[];
  keywords:    string[];
}

/** Providers IMPLEMENTADOS. `available:false` = falta la clave en este despliegue (sus modelos no se ofrecen). */
export interface AgentProviderCatalogItem {
  id:        string;
  available: boolean;
}

/** Sin precios: solo si el precio es provisional y de dónde sale (fila de la BD o valor heredado). */
export interface AgentModelCatalogItem {
  provider:    string;
  model:       string;
  provisional: boolean;
  priceKnown:  boolean;
  priceSource: "db" | "legacy";
  source:      string | null;
}

/** GET /api/agents/catalog/models */
export interface AgentModelCatalog {
  providers: AgentProviderCatalogItem[];
  models:    AgentModelCatalogItem[];
}

/** GET /api/agents/catalog/knowledge → AgentKnowledgeCatalogItem[] (solo entradas activas del workspace; nunca `content`). */
export interface AgentKnowledgeCatalogItem {
  id:       number;
  title:    string;
  category: string;
}
