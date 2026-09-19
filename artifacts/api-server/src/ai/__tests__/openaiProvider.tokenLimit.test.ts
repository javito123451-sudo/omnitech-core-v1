// GPT-5.x y los razonadores rechazan `max_tokens` (400: "Use 'max_completion_tokens' instead"); el resto
// de modelos sigue con `max_tokens`. Sin llamadas reales: el cliente de OpenAI está simulado.
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class { chat = { completions: { create } }; embeddings = { create: vi.fn() }; },
}));

import { OpenAIProvider, outputTokenLimit, usesMaxCompletionTokens } from "../openaiProvider";

const completion = { choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } } };
const messages = [{ role: "user" as const, content: "hola" }];
const sent = () => create.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => { create.mockReset(); create.mockResolvedValue(completion); });

describe("qué modelos usan max_completion_tokens", () => {
  it("GPT-5.x y los razonadores sí; gpt-4o y compañía no", () => {
    for (const m of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5", "gpt-5-mini", "GPT-5.6-Luna", " gpt-5.6-sol ", "o1", "o3-mini", "o4-mini"]) {
      expect(usesMaxCompletionTokens(m), m).toBe(true);
    }
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-3.5-turbo", "claude-x", "omni-moderation", "text-embedding-3-small"]) {
      expect(usesMaxCompletionTokens(m), m).toBe(false);
    }
  });

  it("outputTokenLimit devuelve exactamente un parámetro, el que corresponde", () => {
    expect(outputTokenLimit("gpt-5.6-luna", 64)).toEqual({ max_completion_tokens: 64 });
    expect(outputTokenLimit("gpt-4o-mini", 64)).toEqual({ max_tokens: 64 });
  });
});

describe("OpenAIProvider.generate", () => {
  it("con gpt-5.6-luna envía max_completion_tokens y NO max_tokens", async () => {
    await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-luna", maxTokens: 64 });
    expect(sent()).toMatchObject({ model: "gpt-5.6-luna", max_completion_tokens: 64 });
    expect(sent()).not.toHaveProperty("max_tokens");
  });

  it("con gpt-4o-mini sigue enviando max_tokens (sin cambios para los modelos actuales)", async () => {
    await new OpenAIProvider("k").generate(messages, { model: "gpt-4o-mini", maxTokens: 64 });
    expect(sent()).toMatchObject({ model: "gpt-4o-mini", max_tokens: 64 });
    expect(sent()).not.toHaveProperty("max_completion_tokens");
  });

  it("sin modelo indicado usa el de siempre (gpt-4o-mini) con max_tokens y el límite por defecto de 4000", async () => {
    await new OpenAIProvider("k").generate(messages);
    expect(sent()).toMatchObject({ model: "gpt-4o-mini", max_tokens: 4000 });
    expect(sent()).not.toHaveProperty("max_completion_tokens");
  });

  it("el límite por defecto de 4000 también se aplica con max_completion_tokens", async () => {
    await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-sol" });
    expect(sent()).toMatchObject({ max_completion_tokens: 4000 });
  });

  it("no cambia nada más de la petición ni de la respuesta: temperatura, mensajes y uso (con tokens cacheados)", async () => {
    const r = await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-luna", maxTokens: 64, temperature: 0.3 });
    expect(sent()).toMatchObject({ temperature: 0.3, messages: [expect.objectContaining({ role: "user", content: "hola" })] });
    expect(r).toMatchObject({ text: "OK", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, cachedTokens: 4 } });
  });
});

describe("OpenAIProvider.stream", () => {
  async function consume(model: string) {
    create.mockResolvedValue((async function* () { yield { choices: [{ delta: { content: "O" } }], usage: null }; })());
    const out: string[] = [];
    for await (const c of new OpenAIProvider("k").stream(messages, { model, maxTokens: 32 })) out.push(c.token);
    return out.join("");
  }

  it("aplica el mismo parámetro según el modelo", async () => {
    expect(await consume("gpt-5.6-terra")).toBe("O");
    expect(sent()).toMatchObject({ max_completion_tokens: 32, stream: true });
    expect(sent()).not.toHaveProperty("max_tokens");
    await consume("gpt-4o");
    expect(sent()).toMatchObject({ max_tokens: 32, stream: true });
    expect(sent()).not.toHaveProperty("max_completion_tokens");
  });
});
