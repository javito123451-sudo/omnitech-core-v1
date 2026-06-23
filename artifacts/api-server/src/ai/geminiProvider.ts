// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Gemini Provider (stub)
//  Implementación pendiente — placeholder para futura integración
// ═══════════════════════════════════════════════════════════════════════════

import type { AIProvider, Message, GenerateOptions, GenerateResult, EmbedResult, StreamChunk } from "./types";

export class GeminiProvider implements AIProvider {
  id   = "gemini";
  name = "Google Gemini";

  constructor(_apiKey?: string) {
    console.log("[GeminiProvider] Initialized (stub — not yet implemented)");
  }

  async generate(_messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> {
    throw new Error("GeminiProvider.generate() not yet implemented. Set AI_PROVIDER=openai.");
  }

  async embed(_text: string, _model?: string): Promise<EmbedResult> {
    throw new Error("GeminiProvider.embed() not yet implemented. Set AI_PROVIDER=openai.");
  }

  async classifyIntent(_text: string, _validIntents: string[]): Promise<{
    intent: string;
    confidence: number;
    params: Record<string, unknown>;
  }> {
    throw new Error("GeminiProvider.classifyIntent() not yet implemented.");
  }

  async *stream(_messages: Message[], _options?: GenerateOptions): AsyncGenerator<StreamChunk> {
    throw new Error("GeminiProvider.stream() not yet implemented. Set AI_PROVIDER=openai.");
  }
}
