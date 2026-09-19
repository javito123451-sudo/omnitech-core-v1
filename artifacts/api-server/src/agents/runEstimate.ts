// Estimación de lo que costaría ejecutar un agente. Función pura sobre el Cost
// Engine: la usan la simulación (sin coste) y las estadísticas del agente, para
// que "coste estimado por ejecución" sea SIEMPRE el mismo cálculo. No conoce
// precios: los resuelve el Cost Engine.

import type { AgentConfig } from "@workspace/db";
import { computeCost, estimateTokens } from "../ai-gateway/costEngine";
import { previewRoute, type RoutingContext } from "../ai-gateway/providerRouter";
import { buildSystemPrompt } from "./promptBuilder";

/** Salida típica de una respuesta (tokens). Referencia de ingeniería para estimar, no un valor comercial. */
export const TYPICAL_OUTPUT_TOKENS = 150;
/** Longitud típica de un mensaje de usuario (tokens), cuando no se conoce el mensaje. */
export const TYPICAL_MESSAGE_TOKENS = 40;

export interface RunEstimate {
  route:         { provider: string; model: string };
  tokens:        { input: number; outputTypical: number; outputMax: number };
  typical:       { costUsd: number; credits: number };
  max:           { costUsd: number; credits: number };
  priceKnown:    boolean;
  priceSource:   "db" | "legacy" | "fallback";
  /** true si el precio no está configurado en ai_model_pricing: estimación provisional, no un coste comercial definitivo. */
  provisional:   boolean;
}

export function estimateRunCost(input: {
  agent:      { name: string; description?: string | null };
  config:     AgentConfig;
  toolIds:    string[];
  knowledge?: string;
  message?:   string;
  routing?:   Pick<RoutingContext, "plan" | "workspace">;
}): RunEstimate {
  const route = previewRoute({ agent: input.config.model, workspace: input.routing?.workspace, plan: input.routing?.plan });
  const prompt = buildSystemPrompt(input.agent, input.config, input.knowledge ?? "", input.toolIds);
  const inputTokens = estimateTokens(prompt) + (input.message ? estimateTokens(input.message) : TYPICAL_MESSAGE_TOKENS);
  const outputMax = input.config.parameters.maxOutputTokens;

  const typical = computeCost({ provider: route.provider, model: route.model, inputTokens, outputTokens: TYPICAL_OUTPUT_TOKENS }, "estimated");
  const max = computeCost({ provider: route.provider, model: route.model, inputTokens, outputTokens: outputMax }, "estimated");
  return {
    route,
    tokens: { input: inputTokens, outputTypical: TYPICAL_OUTPUT_TOKENS, outputMax },
    typical: { costUsd: typical.technicalCostUsd, credits: typical.credits },
    max: { costUsd: max.technicalCostUsd, credits: max.credits },
    priceKnown: typical.priceKnown, priceSource: typical.priceSource, provisional: typical.provisional,
  };
}
