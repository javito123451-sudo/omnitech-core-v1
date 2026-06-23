// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — OpenAI Provider
// ═══════════════════════════════════════════════════════════════════════════

import OpenAI from "openai";
import type {
  AIProvider, Message, GenerateOptions, GenerateResult, EmbedResult,
  ToolCall, StreamChunk,
} from "./types";

export class OpenAIProvider implements AIProvider {
  id   = "openai";
  name = "OpenAI";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async generate(messages: Message[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const model = options.model ?? "gpt-4o-mini";

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
      max_tokens:      options.maxTokens ?? 4000,
      temperature:     options.temperature ?? 0.7,
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
    const choice = resp.choices[0]!;
    const msg = choice.message;

    const toolCalls: ToolCall[] | undefined = msg.tool_calls
      ? msg.tool_calls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }))
      : undefined;

    return {
      text:       msg.content ?? "",
      toolCalls,
      usage:      resp.usage
        ? {
            promptTokens:     resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
            totalTokens:      resp.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(messages: Message[], options: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? "gpt-4o-mini";

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
      max_tokens:  options.maxTokens ?? 4000,
      temperature: options.temperature ?? 0.7,
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

    const stream = await this.client.chat.completions.create(body);
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
    const resp = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de intenciones. Dado un mensaje del usuario, clasifica la intención en una de estas categorías: ${validIntents.join(", ")}. Responde SOLO con JSON: {"intent": "...", "confidence": 0.0-1.0, "params": {}}`,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.0,
    });

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
