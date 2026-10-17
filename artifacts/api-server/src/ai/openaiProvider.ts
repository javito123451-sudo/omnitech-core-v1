// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — OpenAI Provider
// ═══════════════════════════════════════════════════════════════════════════

import OpenAI from "openai";
import type {
  AIProvider, Message, GenerateOptions, GenerateResult, EmbedResult,
  ToolCall, StreamChunk,
} from "./types";
import { trackLLMDirectCall } from "../utils/avaMetrics";

/**
 * Los modelos GPT-5/GPT-6 y los razonadores (o1, o3, o4…) usan `max_completion_tokens`;
 * los modelos GPT-4o siguen usando `max_tokens`. En los modelos de razonamiento, el límite
 * de salida puede incluir tokens de razonamiento.
 */
export function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-(5|6)|o[0-9])/i.test(model.trim());
}

/** El parámetro de límite de salida que corresponde al modelo. */
export function outputTokenLimit(model: string, limit: number): { max_tokens: number } | { max_completion_tokens: number } {
  return usesMaxCompletionTokens(model) ? { max_completion_tokens: limit } : { max_tokens: limit };
}

/**
 * GPT-5 y los modelos de razonamiento con esfuerzo distinto de "none" no aceptan temperatura
 * personalizada. GPT-6 Luna se usa con reasoning_effort="none", por lo que puede conservar temperature.
 */
export function temperatureParam(model: string, temperature: number): { temperature?: number } {
  return usesMaxCompletionTokens(model) && !/^gpt-6-luna$/i.test(model.trim()) ? {} : { temperature };
}

/**
 * GPT-6 Luna supports Chat Completions function calling only with reasoning_effort="none".
 * Higher-reasoning GPT-6 models must use the Responses API for tool calling.
 */
export function reasoningEffortParam(model: string): { reasoning_effort?: "none" } {
  return /^gpt-6-luna$/i.test(model.trim()) ? { reasoning_effort: "none" } : {};
}

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_DEFAULT_MODEL ?? "gpt-6-luna";

export class OpenAIProvider implements AIProvider {
  id   = "openai";
  name = "OpenAI";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async generate(messages: Message[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const model = options.model ?? DEFAULT_OPENAI_MODEL;

    const body: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messages.map(m => {
        const msg: any = {
          role: m.role,
          name: m.name,
          tool_call_id: m.tool_call_id,
        };
        // Support multimodal content (array of text/image_url objects)
        if (typeof m.content === "string") {
          msg.content = m.content;
        } else if (Array.isArray(m.content)) {
          msg.content = m.content.map(c => {
            if (c.type === "image_url") {
              return { type: "image_url", image_url: { url: c.image_url.url, detail: c.image_url.detail } };
            }
            return { type: "text", text: c.text };
          });
        }
        // Forward tool_calls for round-trip assistant messages
        if (m.tool_calls && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }
        return msg;
      }) as any,
      ...outputTokenLimit(model, options.maxTokens ?? 4000),
      ...temperatureParam(model, options.temperature ?? 0.7),
      ...reasoningEffortParam(model),
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      if (options.toolChoice) {
        if (options.toolChoice === "auto" || options.toolChoice === "none") {
          body.tool_choice = options.toolChoice;
        } else {
          body.tool_choice = options.toolChoice as any;
        }
      }
    }

    const resp = await this.client.chat.completions.create(body);
    trackLLMDirectCall();
    const choice = resp.choices[0]!;
    const msg = choice.message;

    const toolCalls: ToolCall[] | undefined = msg.tool_calls
      ? msg.tool_calls.map(tc => {
          const tcAny = tc as unknown as { id: string; function: { name: string; arguments: string } };
          return {
            id: tcAny.id,
            type: "function" as const,
            function: {
              name: tcAny.function.name,
              arguments: tcAny.function.arguments,
            },
          };
        })
      : undefined;

    return {
      text:       msg.content ?? "",
      toolCalls,
      usage:      resp.usage
        ? {
            promptTokens:     resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
            totalTokens:      resp.usage.total_tokens,
            cachedTokens:     resp.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
    };
  }

  async *stream(messages: Message[], options: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? DEFAULT_OPENAI_MODEL;

    const body: any = {
      model,
      messages: messages.map(m => {
        const msg: any = {
          role: m.role,
          name: m.name,
          tool_call_id: m.tool_call_id,
        };
        if (typeof m.content === "string") {
          msg.content = m.content;
        } else if (Array.isArray(m.content)) {
          msg.content = m.content.map(c => {
            if (c.type === "image_url") {
              return { type: "image_url", image_url: { url: c.image_url.url, detail: c.image_url.detail } };
            }
            return { type: "text", text: c.text };
          });
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }
        return msg;
      }),
      ...outputTokenLimit(model, options.maxTokens ?? 4000),
      ...temperatureParam(model, options.temperature ?? 0.7),
      ...reasoningEffortParam(model),
      stream:      true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      if (options.toolChoice) {
        if (options.toolChoice === "auto" || options.toolChoice === "none") {
          body.tool_choice = options.toolChoice;
        } else {
          body.tool_choice = options.toolChoice;
        }
      }
    }

    const stream = await this.client.chat.completions.create(body) as unknown as AsyncIterable<{
      choices: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
    }>;
    trackLLMDirectCall();
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      const usage = chunk.usage
        ? {
            promptTokens:     chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens:      chunk.usage.total_tokens,
          }
        : undefined;
      yield { token, usage };
    }
  }

  async embed(text: string, model?: string): Promise<EmbedResult> {
    const resp = await this.client.embeddings.create({
      model: model ?? "text-embedding-3-small",
      input: text.slice(0, 500),
    });
    trackLLMDirectCall();
    return {
      embedding: resp.data[0]!.embedding,
      usage:     resp.usage
        ? { promptTokens: resp.usage.prompt_tokens, totalTokens: resp.usage.total_tokens }
        : undefined,
    };
  }

  async classifyIntent(text: string, validIntents: string[]): Promise<{
    intent: string;
    confidence: number;
    params: Record<string, unknown>;
  }> {
    const model = DEFAULT_OPENAI_MODEL;
    const resp = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de intenciones. Dado un mensaje del usuario, clasifica la intención en una de estas categorías: ${validIntents.join(", ")}. Responde SOLO con JSON: {"intent": "...", "confidence": 0.0-1.0, "params": {}}`,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      ...outputTokenLimit(model, 200),
      ...temperatureParam(model, 0.0),
      ...reasoningEffortParam(model),
    });
    trackLLMDirectCall();

    const content = resp.choices[0]!.message.content ?? "{}";
    try {
      const parsed = JSON.parse(content);
      return {
        intent:     parsed.intent ?? "UNKNOWN",
        confidence: parsed.confidence ?? 0.5,
        params:     parsed.params ?? {},
      };
    } catch {
      return { intent: "UNKNOWN", confidence: 0.0, params: {} };
    }
  }
}
