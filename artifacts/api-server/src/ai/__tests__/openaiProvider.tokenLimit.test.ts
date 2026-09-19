// GPT-5.x y los razonadores rechazan `max_tokens` (400: "Use 'max_completion_tokens' instead") y solo admiten la
// temperatura por defecto (400: "'temperature' does not support 0.3 with this model"); el resto de modelos sigue
// con `max_tokens` y su temperatura. Sin llamadas reales: el cliente de OpenAI está simulado.
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class { chat = { completions: { create } }; embeddings = { create: vi.fn() }; },
}));

import { OpenAIProvider, outputTokenLimit, temperatureParam, usesMaxCompletionTokens } from "../openaiProvider";

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

describe("temperatureParam", () => {
  it("omite la temperatura en GPT-5.x y razonadores, y la conserva en el resto", () => {
    for (const m of ["gpt-5.6-luna", "gpt-5", "o3-mini"]) expect(temperatureParam(m, 0.3), m).toEqual({});
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]) expect(temperatureParam(m, 0.3), m).toEqual({ temperature: 0.3 });
    expect(temperatureParam("gpt-4o-mini", 0)).toEqual({ temperature: 0 });   // 0 es un valor válido, no se pierde
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

  it("con gpt-5.6-luna NO envía temperature (solo admiten la por defecto), aunque el agente pida 0.3", async () => {
    await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-luna", maxTokens: 256, temperature: 0.3 });
    expect(sent()).not.toHaveProperty("temperature");
    expect(sent()).toMatchObject({ max_completion_tokens: 256 });
    await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-sol", maxTokens: 256 });      // ni siquiera el 0.7 por defecto
    expect(sent()).not.toHaveProperty("temperature");
  });

  it("con gpt-4o-mini conserva la temperatura pedida y el 0.7 por defecto (sin cambios)", async () => {
    await new OpenAIProvider("k").generate(messages, { model: "gpt-4o-mini", temperature: 0.3 });
    expect(sent()).toMatchObject({ temperature: 0.3 });
    await new OpenAIProvider("k").generate(messages, { model: "gpt-4o-mini" });
    expect(sent()).toMatchObject({ temperature: 0.7 });
    await new OpenAIProvider("k").generate(messages);
    expect(sent()).toMatchObject({ model: "gpt-4o-mini", temperature: 0.7 });
  });

  it("no cambia nada más de la petición ni de la respuesta: mensajes y uso (con tokens cacheados)", async () => {
    const r = await new OpenAIProvider("k").generate(messages, { model: "gpt-5.6-luna", maxTokens: 64, temperature: 0.3 });
    expect(sent()).toMatchObject({ model: "gpt-5.6-luna", max_completion_tokens: 64, messages: [expect.objectContaining({ role: "user", content: "hola" })] });
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

  it("aplica los mismos parámetros según el modelo", async () => {
    expect(await consume("gpt-5.6-terra")).toBe("O");
    expect(sent()).toMatchObject({ max_completion_tokens: 32, stream: true });
    expect(sent()).not.toHaveProperty("max_tokens");
    expect(sent()).not.toHaveProperty("temperature");
    await consume("gpt-4o");
    expect(sent()).toMatchObject({ max_tokens: 32, temperature: 0.7, stream: true });
    expect(sent()).not.toHaveProperty("max_completion_tokens");
  });
});
