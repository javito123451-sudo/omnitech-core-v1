// ═══════════════════════════════════════════════════════════════════════════
//  AI pricing — the ONLY place provider prices and the OmniCredit conversion
//  live. Nothing else in the codebase should hard-code a price.
//
//  Prices are USD per 1M tokens (per unit for images, per minute for audio),
//  keyed by provider id (the `id` each AIProvider reports) and model. The
//  values for OpenAI are the ones that previously lived in aiUsageLogger.ts,
//  so existing cost figures don't change.
//
//  Adding a provider = adding a key here. Providers don't share one token
//  shape (cached / reasoning tokens are reported differently), so
//  normalizing a provider's usage into UsageInput is that provider adapter's
//  job — see the notes in costEngine.ts.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelPricing {
  inputPer1M:        number;
  outputPer1M:       number;
  /** Price of cached prompt tokens; falls back to inputPer1M when absent. */
  cachedInputPer1M?: number;
  /** Price of reasoning tokens; falls back to outputPer1M when absent. */
  reasoningPer1M?:   number;
  imagePerUnit?:     number;
  audioPerMinute?:   number;
}

const GPT_4O:      ModelPricing = { inputPer1M: 5,    outputPer1M: 15,  cachedInputPer1M: 2.5 };
const GPT_4O_MINI: ModelPricing = { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 };

export const PRICING: Record<string, Record<string, ModelPricing>> = {
  openai: {
    "gpt-4o":                 GPT_4O,
    "gpt-4o-2024-11-20":      GPT_4O,
    "gpt-4o-mini":            GPT_4O_MINI,
    "gpt-4o-mini-2024-07-18": GPT_4O_MINI,
    "text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0 },
    "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0 },
  },
  // Slots for providers that exist as stubs. No prices are invented here:
  // they get real entries when the provider is implemented.
  claude: {},
  gemini: {},
};

/** Used for an unknown provider/model, flagged priceKnown:false in the breakdown. */
export const FALLBACK_PRICING: ModelPricing = GPT_4O_MINI;

// ── OmniCredits conversion ───────────────────────────────────────────────────
// A commercial parameter, not a technical one: 1 OmniCredit is NOT 1 token.
// creditsPerUsd converts technical cost to credits; markup is the margin
// applied on top. Overridable by env until the commercial values are decided.
export const OMNICREDITS = {
  creditsPerUsd: Number(process.env["OMNICREDITS_PER_USD"] ?? 1000),
  markup:        Number(process.env["OMNICREDITS_MARKUP"] ?? 1),
} as const;
