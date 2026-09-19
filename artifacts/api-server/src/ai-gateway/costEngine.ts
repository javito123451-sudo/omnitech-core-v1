// ═══════════════════════════════════════════════════════════════════════════
//  AI Cost Engine — turns a usage record into a technical cost (USD) and a
//  commercial cost (OmniCredits), with enough detail to audit it.
//
//  Two moments, deliberately separate (estimate and real cost are not
//  assumed equal):
//    estimateCost()  before the call, from an input-size guess and the
//                    output cap   -> basis "estimated"
//    computeCost()   after the call, from the provider's real usage
//                    -> basis "final", or "provider_reported" when the
//                    provider itself returned a cost
//
//  Token conventions this engine expects (provider adapters normalize to it):
//    inputTokens      total prompt tokens INCLUDING cached ones (OpenAI style)
//    cachedTokens     the subset of inputTokens served from the provider cache
//    outputTokens     completion tokens EXCLUDING reasoning tokens
//    reasoningTokens  billed separately, so it must not also be in outputTokens
// ═══════════════════════════════════════════════════════════════════════════

import { FALLBACK_PRICING, OMNICREDITS, PRICING, type ModelPricing } from "./pricing";

export interface UsageInput {
  provider:                 string;
  model:                    string;
  inputTokens:              number;
  outputTokens:             number;
  cachedTokens?:            number;
  reasoningTokens?:         number;
  images?:                  number;
  audioSeconds?:            number;
  durationMs?:              number;
  toolCalls?:               string[];
  providerReportedCostUsd?: number;
}

export type CostBasis = "estimated" | "final" | "provider_reported";

export interface CostBreakdown {
  technicalCostUsd: number;
  credits:          number;
  basis:            CostBasis;
  priceKnown:       boolean;
  lines: {
    input: number; cachedInput: number; output: number; reasoning: number; images: number; audio: number;
  };
}

export function lookupPricing(provider: string, model: string): { pricing: ModelPricing; known: boolean } {
  const found = PRICING[provider]?.[model];
  return found ? { pricing: found, known: true } : { pricing: FALLBACK_PRICING, known: false };
}

export function usdToCredits(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  const raw = costUsd * OMNICREDITS.creditsPerUsd * OMNICREDITS.markup;
  return Math.ceil(raw * 1e4) / 1e4; // never round a real cost down to nothing
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const perMillion = (tokens: number, price: number) => (Math.max(0, tokens) / 1_000_000) * price;

export function computeCost(usage: UsageInput, basis: "estimated" | "final" = "final"): CostBreakdown {
  const { pricing, known } = lookupPricing(usage.provider, usage.model);

  if (usage.providerReportedCostUsd !== undefined && usage.providerReportedCostUsd >= 0) {
    const cost = round6(usage.providerReportedCostUsd);
    return {
      technicalCostUsd: cost, credits: usdToCredits(cost), basis: "provider_reported", priceKnown: known,
      lines: { input: 0, cachedInput: 0, output: 0, reasoning: 0, images: 0, audio: 0 },
    };
  }

  const cached    = Math.min(Math.max(0, usage.cachedTokens ?? 0), Math.max(0, usage.inputTokens));
  const uncached  = Math.max(0, usage.inputTokens) - cached;
  const lines = {
    input:       perMillion(uncached, pricing.inputPer1M),
    cachedInput: perMillion(cached, pricing.cachedInputPer1M ?? pricing.inputPer1M),
    output:      perMillion(usage.outputTokens, pricing.outputPer1M),
    reasoning:   perMillion(usage.reasoningTokens ?? 0, pricing.reasoningPer1M ?? pricing.outputPer1M),
    images:      (usage.images ?? 0) * (pricing.imagePerUnit ?? 0),
    audio:       ((usage.audioSeconds ?? 0) / 60) * (pricing.audioPerMinute ?? 0),
  };
  const technicalCostUsd = round6(lines.input + lines.cachedInput + lines.output + lines.reasoning + lines.images + lines.audio);
  return { technicalCostUsd, credits: usdToCredits(technicalCostUsd), basis, priceKnown: known, lines };
}

/** Pre-call estimate: assumes the worst case for output (the cap) and no cache hits. */
export function estimateCost(provider: string, model: string, input: { inputTokens: number; maxOutputTokens: number }): CostBreakdown {
  return computeCost({ provider, model, inputTokens: input.inputTokens, outputTokens: input.maxOutputTokens }, "estimated");
}

/** Rough token count for a pre-call estimate (~4 chars/token). Not used for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
