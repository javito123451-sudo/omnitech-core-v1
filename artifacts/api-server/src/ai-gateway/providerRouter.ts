// ═══════════════════════════════════════════════════════════════════════════
//  AI Gateway — provider router
//  Decides which provider + model serves a call. Callers (agents, AVA CORE)
//  never construct or import a provider themselves; swapping OpenAI for
//  another provider later is a change here, not in every caller.
//
//  v1 policy is deliberately minimal: an explicit provider/model wins,
//  otherwise the process-wide default provider (AI_PROVIDER env, as before).
//  Routing by task complexity is not implemented yet.
// ═══════════════════════════════════════════════════════════════════════════

import { getProviderSingleton, type AIProvider } from "../ai/types";
import { OpenAIProvider } from "../ai/openaiProvider";
import { ClaudeProvider } from "../ai/claudeProvider";
import { GeminiProvider } from "../ai/geminiProvider";

export const DEFAULT_MODEL = "gpt-4o-mini";

export interface ModelPolicy {
  provider?: string;
  model?:    string;
}

export interface ResolvedRoute {
  provider:   AIProvider;
  providerId: string;
  model:      string;
}

const explicitProviders = new Map<string, AIProvider>();

function buildProvider(id: string): AIProvider | null {
  switch (id) {
    case "openai": return new OpenAIProvider(process.env.OPENAI_API_KEY);
    case "claude": return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    case "gemini": return new GeminiProvider(process.env.GEMINI_API_KEY);
    default:       return null;
  }
}

export function resolveRoute(policy: ModelPolicy = {}): ResolvedRoute {
  if (!policy.provider) {
    const provider = getProviderSingleton();
    return { provider, providerId: provider.id, model: policy.model ?? DEFAULT_MODEL };
  }

  let provider = explicitProviders.get(policy.provider);
  if (!provider) {
    const built = buildProvider(policy.provider);
    if (!built) throw new Error(`Proveedor de IA desconocido: ${policy.provider}`);
    explicitProviders.set(policy.provider, built);
    provider = built;
  }
  return { provider, providerId: provider.id, model: policy.model ?? DEFAULT_MODEL };
}
