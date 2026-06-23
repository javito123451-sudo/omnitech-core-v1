// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Claude Provider (stub)
//  Implementación pendiente — placeholder para futura integración
// ═══════════════════════════════════════════════════════════════════════════

import type { AIProvider, Message, GenerateOptions, GenerateResult, EmbedResult } from "./types";

export class ClaudeProvider implements AIProvider {
  id   = "claude";
  name = "Anthropic Claude";

  constructor(_apiKey?: string) {
    console.log("[ClaudeProvider] Initialized (stub — not yet implemented)");
  }

  async generate(_messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> {
    throw new Error("ClaudeProvider.generate() not yet implemented. Set AI_PROVIDER=openai.");
  }

  async embed(_text: string, _model?: string): Promise<EmbedResult> {
    throw new Error("ClaudeProvider.embed() not yet implemented. Set AI_PROVIDER=openai.");
  }

  async classifyIntent(_text: string, _validIntents: string[]): Promise<{
    intent: string;
    confidence: number;
    params: Record<string, unknown>;
  }> {
    throw new Error("ClaudeProvider.classifyIntent() not yet implemented.");
  }
}
