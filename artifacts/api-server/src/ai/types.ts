// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — AI Provider Layer
//  Interchangeable LLM providers
// ═══════════════════════════════════════════════════════════════════════════

export interface ImageContent {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "high" | "low" };
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface Message {
  role:    "system" | "user" | "assistant" | "tool";
  content: string | (TextContent | ImageContent)[];
  name?:   string;
  tool_call_id?: string;
  tool_calls?: ToolCall[]; // For assistant messages with pending tool calls (round-trip loops)
}

export interface ToolCall {
  id:       string;
  type:     "function";
  function: {
    name:      string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name:        string;
    description: string;
    parameters:  {
      type:       "object";
      properties: Record<string, unknown>;
      required?:  string[];
    };
  };
}

export interface GenerateOptions {
  model?:       string;
  maxTokens?:   number;
  temperature?: number;
  tools?:       ToolDefinition[];
  toolChoice?:  "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface GenerateResult {
  text:       string;
  toolCalls?: ToolCall[];
  usage?:     { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface EmbedResult {
  embedding: number[];
  usage?:    { promptTokens: number; totalTokens: number };
}

export interface StreamChunk {
  token: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface AIProvider {
  id: string;
  name: string;

  // Chat completion
  generate(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;

  // Streaming chat completion
  stream(messages: Message[], options?: GenerateOptions): AsyncGenerator<StreamChunk>;

  // Embeddings
  embed(text: string, model?: string): Promise<EmbedResult>;

  // Intent classification (lightweight, for Intent Engine fallback)
  classifyIntent(text: string, validIntents: string[]): Promise<{
    intent: string;
    confidence: number;
    params: Record<string, unknown>;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider factory
// ═══════════════════════════════════════════════════════════════════════════

import { OpenAIProvider } from "./openaiProvider";
import { ClaudeProvider }  from "./claudeProvider";
import { GeminiProvider }  from "./geminiProvider";

export function getProvider(): AIProvider {
  const providerId = process.env.AI_PROVIDER ?? "openai";
  const apiKey     = process.env.OPENAI_API_KEY;

  switch (providerId) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "claude":
      return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    case "gemini":
      return new GeminiProvider(process.env.GEMINI_API_KEY);
    default:
      console.warn(`[AIProvider] Unknown provider "${providerId}", falling back to OpenAI`);
      return new OpenAIProvider(apiKey);
  }
}

// Global singleton (lazy init)
let _provider: AIProvider | null = null;
export function getProviderSingleton(): AIProvider {
  if (!_provider) _provider = getProvider();
  return _provider;
}

export function resetProvider(): void {
  _provider = null;
}
