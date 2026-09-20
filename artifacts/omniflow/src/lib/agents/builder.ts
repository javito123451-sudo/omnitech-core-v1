// Lógica pura del Builder (sin React): valores del formulario, dirty state, validación y payload.
//
// QUÉ SE PUEDE EDITAR (contrato real, agentService.saveDraft / updateAgentMeta):
//   PATCH /:id        → name, description, avatarUrl
//   PUT   /:id/draft  → secciones de AgentConfig: identity, objective, personality, behavior, businessContext,
//                       parameters, channels. El backend sustituye la SECCIÓN entera, por eso se envía completa.
// SOLO LECTURA en el Builder (sin catálogo/UI soportados en esta fase): model, knowledge, tools, permissions.
// Nunca se envían: notes, limits, presupuestos, ni ninguna sección de solo lectura.

import { AGENT_CHANNELS, type AgentChannel, type AgentConfig, type SaveDraftInput, type UpdateAgentMetaInput, type ValidationIssue } from "./types";

/** Valores de un formulario. Los números son texto mientras se escribe; las listas, una entrada por línea. */
export interface BuilderValues {
  name: string;
  description: string;
  avatarUrl: string;
  identityRole: string;
  objectiveWhat: string;
  objectiveAudience: string;
  objectiveExpectedOutcome: string;
  personalityTone: string;
  personalityStyle: string;
  personalityLanguage: string;
  personalityFormality: string;
  behaviorInstructions: string;
  behaviorRules: string;
  behaviorRestrictions: string;
  behaviorAvoid: string;
  businessContext: string;
  paramTemperature: string;
  paramMaxOutputTokens: string;
  paramMaxToolRounds: string;
  paramMaxHistoryMessages: string;
  channels: AgentChannel[];
}
export type BuilderField = Exclude<keyof BuilderValues, "channels"> | "channels";

/** Límites de agentConfigSchema.parameters (lib/db/src/schema/ai-agents.ts). */
export const PARAM_LIMITS = {
  temperature:        { min: 0, max: 2,    integer: false },
  maxOutputTokens:    { min: 1, max: 8000, integer: true },
  maxToolRounds:      { min: 1, max: 10,   integer: true },
  maxHistoryMessages: { min: 0, max: 50,   integer: true },
} as const;

/** Valores por defecto del backend (defaultAgentConfig): solo para rellenar lo que una versión antigua no traiga. */
const D = {
  personality: { tone: "cercano y profesional", style: "claro y conciso", language: "es", formality: "medio" },
  parameters:  { temperature: 0.3, maxOutputTokens: 1024, maxToolRounds: 4, maxHistoryMessages: 12 },
};

const lines = (v: string[] | undefined) => (v ?? []).join("\n");

export function toBuilderValues(
  agent: { name: string; description: string | null; avatarUrl: string | null },
  config: Partial<AgentConfig> | null | undefined,
): BuilderValues {
  const c = config ?? {};
  return {
    name: agent.name,
    description: agent.description ?? "",
    avatarUrl: agent.avatarUrl ?? "",
    identityRole: c.identity?.role ?? "",
    objectiveWhat: c.objective?.what ?? "",
    objectiveAudience: c.objective?.audience ?? "",
    objectiveExpectedOutcome: c.objective?.expectedOutcome ?? "",
    personalityTone: c.personality?.tone ?? D.personality.tone,
    personalityStyle: c.personality?.style ?? D.personality.style,
    personalityLanguage: c.personality?.language ?? D.personality.language,
    personalityFormality: c.personality?.formality ?? D.personality.formality,
    behaviorInstructions: c.behavior?.instructions ?? "",
    behaviorRules: lines(c.behavior?.rules),
    behaviorRestrictions: lines(c.behavior?.restrictions),
    behaviorAvoid: lines(c.behavior?.avoid),
    businessContext: c.businessContext ?? "",
    paramTemperature: String(c.parameters?.temperature ?? D.parameters.temperature),
    paramMaxOutputTokens: String(c.parameters?.maxOutputTokens ?? D.parameters.maxOutputTokens),
    paramMaxToolRounds: String(c.parameters?.maxToolRounds ?? D.parameters.maxToolRounds),
    paramMaxHistoryMessages: String(c.parameters?.maxHistoryMessages ?? D.parameters.maxHistoryMessages),
    channels: [...(c.channels ?? [])],
  };
}

const list = (v: string): string[] => v.split("\n").map((l) => l.trim()).filter(Boolean);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Grupos de campos: cada sección de configuración se compara y se envía entera.
const SECTIONS = {
  identity:        ["identityRole"],
  objective:       ["objectiveWhat", "objectiveAudience", "objectiveExpectedOutcome"],
  personality:     ["personalityTone", "personalityStyle", "personalityLanguage", "personalityFormality"],
  behavior:        ["behaviorInstructions", "behaviorRules", "behaviorRestrictions", "behaviorAvoid"],
  businessContext: ["businessContext"],
  parameters:      ["paramTemperature", "paramMaxOutputTokens", "paramMaxToolRounds", "paramMaxHistoryMessages"],
  channels:        ["channels"],
} as const satisfies Record<string, readonly (keyof BuilderValues)[]>;
type SectionKey = keyof typeof SECTIONS;

/** Normaliza para comparar: lo que el usuario ve como igual no cuenta como cambio (espacios, líneas vacías). */
function normalized(v: BuilderValues): Record<keyof BuilderValues, unknown> {
  return {
    ...v,
    name: v.name.trim(), description: v.description.trim(), avatarUrl: v.avatarUrl.trim(),
    behaviorRules: list(v.behaviorRules), behaviorRestrictions: list(v.behaviorRestrictions), behaviorAvoid: list(v.behaviorAvoid),
    channels: [...v.channels].sort(),
  };
}

function changedKeys(current: BuilderValues, baseline: BuilderValues): Set<keyof BuilderValues> {
  const a = normalized(current), b = normalized(baseline);
  return new Set((Object.keys(a) as (keyof BuilderValues)[]).filter((k) => !same(a[k], b[k])));
}

export const isDirty = (current: BuilderValues, baseline: BuilderValues) => changedKeys(current, baseline).size > 0;

// ── Validación (espejo de agentConfigSchema y de lo que PATCH acepta) ─────────────────────────────────

export type BuilderErrors = Partial<Record<BuilderField, string>>;

export function validate(v: BuilderValues): BuilderErrors {
  const errors: BuilderErrors = {};
  if (!v.name.trim()) errors.name = "El nombre es obligatorio.";
  const num = (field: BuilderField, raw: string, lim: { min: number; max: number; integer: boolean }) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) { errors[field] = "Introduce un número."; return; }
    if (lim.integer && !Number.isInteger(n)) { errors[field] = "Debe ser un número entero."; return; }
    if (n < lim.min || n > lim.max) errors[field] = `Debe estar entre ${lim.min} y ${lim.max}.`;
  };
  num("paramTemperature", v.paramTemperature, PARAM_LIMITS.temperature);
  num("paramMaxOutputTokens", v.paramMaxOutputTokens, PARAM_LIMITS.maxOutputTokens);
  num("paramMaxToolRounds", v.paramMaxToolRounds, PARAM_LIMITS.maxToolRounds);
  num("paramMaxHistoryMessages", v.paramMaxHistoryMessages, PARAM_LIMITS.maxHistoryMessages);
  for (const c of v.channels) if (!(AGENT_CHANNELS as readonly string[]).includes(c)) errors.channels = `Canal no válido: ${c}`;
  return errors;
}

// ── Payload ──────────────────────────────────────────────────────────────────────────────────────────

const SECTION_BUILDERS: { [K in SectionKey]: (v: BuilderValues) => Partial<AgentConfig> } = {
  identity:        (v) => ({ identity: { role: v.identityRole.trim() } }),
  objective:       (v) => ({ objective: { what: v.objectiveWhat.trim(), audience: v.objectiveAudience.trim(), expectedOutcome: v.objectiveExpectedOutcome.trim() } }),
  personality:     (v) => ({ personality: { tone: v.personalityTone.trim(), style: v.personalityStyle.trim(), language: v.personalityLanguage.trim(), formality: v.personalityFormality.trim() } }),
  behavior:        (v) => ({ behavior: { instructions: v.behaviorInstructions.trim(), rules: list(v.behaviorRules), restrictions: list(v.behaviorRestrictions), avoid: list(v.behaviorAvoid) } }),
  businessContext: (v) => ({ businessContext: v.businessContext.trim() }),
  parameters:      (v) => ({ parameters: {
    temperature: Number(v.paramTemperature), maxOutputTokens: Number(v.paramMaxOutputTokens),
    maxToolRounds: Number(v.paramMaxToolRounds), maxHistoryMessages: Number(v.paramMaxHistoryMessages),
  } }),
  channels:        (v) => ({ channels: [...v.channels] }),
};

export interface BuilderPayload {
  /** PATCH /:id, solo con los campos que cambiaron. null = nada que enviar. */
  meta: UpdateAgentMetaInput | null;
  /** PUT /:id/draft, solo con las secciones que cambiaron (completas). null = nada que enviar. */
  config: SaveDraftInput | null;
}

/** Payload mínimo: solo lo que cambió respecto a `baseline`, y solo campos que el backend soporta. */
export function buildPayload(current: BuilderValues, baseline: BuilderValues): BuilderPayload {
  const changed = changedKeys(current, baseline);

  const meta: UpdateAgentMetaInput = {};
  if (changed.has("name")) meta.name = current.name.trim();
  if (changed.has("description")) meta.description = current.description.trim() || null;
  if (changed.has("avatarUrl")) meta.avatarUrl = current.avatarUrl.trim() || null;

  const config: Partial<AgentConfig> = {};
  for (const section of Object.keys(SECTIONS) as SectionKey[]) {
    if (SECTIONS[section].some((k) => changed.has(k))) Object.assign(config, SECTION_BUILDERS[section](current));
  }

  return {
    meta: Object.keys(meta).length ? meta : null,
    config: Object.keys(config).length ? { config } : null,
  };
}

// ── Errores del backend por campo ────────────────────────────────────────────────────────────────────

const ISSUE_FIELD: Record<string, BuilderField> = {
  "identity.role": "identityRole",
  "objective.what": "objectiveWhat", "objective.audience": "objectiveAudience", "objective.expectedOutcome": "objectiveExpectedOutcome",
  "personality.tone": "personalityTone", "personality.style": "personalityStyle", "personality.language": "personalityLanguage", "personality.formality": "personalityFormality",
  "behavior.instructions": "behaviorInstructions", "behavior.rules": "behaviorRules", "behavior.restrictions": "behaviorRestrictions", "behavior.avoid": "behaviorAvoid",
  businessContext: "businessContext",
  "parameters.temperature": "paramTemperature", "parameters.maxOutputTokens": "paramMaxOutputTokens",
  "parameters.maxToolRounds": "paramMaxToolRounds", "parameters.maxHistoryMessages": "paramMaxHistoryMessages",
  channels: "channels",
};

/** Reparte las incidencias del backend: las que corresponden a un campo del formulario y las que no. */
export function mapIssues(issues: ValidationIssue[]): { fields: BuilderErrors; other: string[] } {
  const fields: BuilderErrors = {};
  const other: string[] = [];
  for (const i of issues) {
    const path = i.path.map(String);
    // channels.0 → channels; behavior.rules.2 → behavior.rules
    const field = ISSUE_FIELD[path.join(".")] ?? ISSUE_FIELD[path.slice(0, 2).join(".")] ?? ISSUE_FIELD[path[0] ?? ""];
    if (field && !fields[field]) fields[field] = i.message;
    else other.push(`${path.join(".") || "configuración"}: ${i.message}`);
  }
  return { fields, other };
}
