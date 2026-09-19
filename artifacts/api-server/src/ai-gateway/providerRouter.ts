// ═══════════════════════════════════════════════════════════════════════════
//  AI Gateway — provider router
//
//  Decides which provider + model serve a call, and in what order to fall
//  back. Callers (agents, AVA CORE) never construct or import a provider;
//  adding one is a change here plus its entry in pricing.ts.
//
//  Selection precedence for the PRIMARY route (first source that specifies
//  anything wins; missing pieces come from the global default):
//      agent  →  workspace  →  plan default  →  global default (AI_PROVIDER env)
//  Then the agent's fallbacks and the workspace's fallbacks follow. Providers
//  that are unknown throw (a config bug); providers that are known but not
//  usable right now (stub, missing API key) are skipped — that's what makes
//  fallback meaningful.
//
//  Not implemented yet: routing by task complexity, and a stored per-workspace
//  policy (the workspace policy is accepted as input, there's no table for it).
// ═══════════════════════════════════════════════════════════════════════════

import { getProviderSingleton, type AIProvider } from "../ai/types";
import { OpenAIProvider } from "../ai/openaiProvider";
import { ClaudeProvider } from "../ai/claudeProvider";
import { GeminiProvider } from "../ai/geminiProvider";

export const DEFAULT_MODEL = "gpt-4o-mini";

export interface ModelChoice { provider?: string; model?: string }
export interface RoutingPolicy extends ModelChoice { fallbacks?: ModelChoice[] }
export interface RoutingContext {
  agent?:     RoutingPolicy;
  workspace?: RoutingPolicy;
  plan?:      string | null;
}

export interface ResolvedRoute {
  provider:   AIProvider;
  providerId: string;
  model:      string;
  timeoutMs:  number;
}

export class NoProviderAvailableError extends Error {
  constructor() {
    super("No hay ningún proveedor de IA disponible en este momento.");
    this.name = "NoProviderAvailableError";
  }
}

// Provider availability and per-provider limits, in one place.
export const PROVIDER_CONFIG: Record<string, { implemented: boolean; apiKeyEnv: string; timeoutMs: number }> = {
  openai: { implemented: true,  apiKeyEnv: "OPENAI_API_KEY",    timeoutMs: 60_000 },
  claude: { implemented: false, apiKeyEnv: "ANTHROPIC_API_KEY", timeoutMs: 60_000 },
  gemini: { implemented: false, apiKeyEnv: "GEMINI_API_KEY",    timeoutMs: 60_000 },
};

// Per-plan defaults. Same for every plan today; the hook exists so a plan can
// be pinned to a cheaper/pricier model without touching callers.
export const PLAN_DEFAULTS: Record<string, ModelChoice> = {
  starter:      { provider: "openai", model: "gpt-4o-mini" },
  professional: { provider: "openai", model: "gpt-4o-mini" },
  business:     { provider: "openai", model: "gpt-4o-mini" },
  enterprise:   { provider: "openai", model: "gpt-4o-mini" },
};

export function isProviderAvailable(providerId: string): boolean {
  const cfg = PROVIDER_CONFIG[providerId];
  return !!cfg && cfg.implemented && !!process.env[cfg.apiKeyEnv];
}

const instances = new Map<string, AIProvider>();

function instance(providerId: string): AIProvider {
  const cached = instances.get(providerId);
  if (cached) return cached;
  const envDefault = process.env["AI_PROVIDER"] ?? "openai";
  let built: AIProvider;
  if (providerId === envDefault) built = getProviderSingleton();
  else if (providerId === "openai") built = new OpenAIProvider(process.env["OPENAI_API_KEY"]);
  else if (providerId === "claude") built = new ClaudeProvider(process.env["ANTHROPIC_API_KEY"]);
  else built = new GeminiProvider(process.env["GEMINI_API_KEY"]);
  instances.set(providerId, built);
  return built;
}

function complete(choice: ModelChoice): { provider: string; model: string } {
  return { provider: choice.provider ?? (process.env["AI_PROVIDER"] ?? "openai"), model: choice.model ?? DEFAULT_MODEL };
}

function primaryChoice(ctx: RoutingContext): { provider: string; model: string } {
  const planDefault = ctx.plan ? PLAN_DEFAULTS[ctx.plan] : undefined;
  return complete([ctx.agent, ctx.workspace, planDefault].find((s) => s && (s.provider || s.model)) ?? {});
}

/** Which provider/model WOULD serve this context, without checking availability or building a provider. Used by the free simulator. */
export function previewRoute(ctx: RoutingContext = {}): { provider: string; model: string } {
  return primaryChoice(ctx);
}

export function resolveRoutes(ctx: RoutingContext = {}): ResolvedRoute[] {
  const candidates = [
    primaryChoice(ctx),
    ...(ctx.agent?.fallbacks ?? []).map(complete),
    ...(ctx.workspace?.fallbacks ?? []).map(complete),
  ];

  const seen = new Set<string>();
  const routes: ResolvedRoute[] = [];
  for (const c of candidates) {
    if (!PROVIDER_CONFIG[c.provider]) throw new Error(`Proveedor de IA desconocido: ${c.provider}`);
    const key = `${c.provider}/${c.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isProviderAvailable(c.provider)) continue;
    routes.push({ provider: instance(c.provider), providerId: c.provider, model: c.model, timeoutMs: PROVIDER_CONFIG[c.provider]!.timeoutMs });
  }
  if (routes.length === 0) throw new NoProviderAvailableError();
  return routes;
}
