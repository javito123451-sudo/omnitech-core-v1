// The AI Gateway is what keeps real AI spend under control for every caller.
// These tests pin the guarantees: simulation never reaches a provider, a
// blocked org never reaches a provider, and every attempt is logged.
// Fakes are injected through GatewayDeps — no OpenAI calls, no database.
import { describe, it, expect, vi } from "vitest";
import { callAI, AiBudgetBlockedError, AiSimulationModeError, type GatewayDeps } from "../gateway";
import { resolveRoute } from "../providerRouter";
import type { AIProvider, GenerateResult } from "../../ai/types";

function makeDeps(overrides: {
  generate?: () => Promise<GenerateResult>;
  budget?: { blocked: boolean; reason: string | null; pct: number };
} = {}) {
  const generate = vi.fn(overrides.generate ?? (async () => ({
    text: "ok",
    usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedTokens: 200 },
  })));
  const provider = { id: "fake", name: "Fake", generate } as unknown as AIProvider;
  const logAiCall = vi.fn(async () => {});
  const checkBudgetBlocked = vi.fn(async () => overrides.budget ?? { blocked: false, reason: null, pct: 10 });
  const deps: GatewayDeps = {
    resolveRoute: () => ({ provider, providerId: "fake", model: "gpt-4o-mini" }),
    checkBudgetBlocked,
    logAiCall,
  };
  return { deps, generate, logAiCall, checkBudgetBlocked };
}

const base = { mode: "live" as const, orgId: 7, functionName: "test_fn", messages: [{ role: "user" as const, content: "hola" }] };

describe("AI Gateway — callAI", () => {
  it("refuses SIMULATION mode without touching the provider, budget or log", async () => {
    const { deps, generate, logAiCall, checkBudgetBlocked } = makeDeps();
    await expect(callAI({ ...base, mode: "simulation" }, deps)).rejects.toThrow(AiSimulationModeError);
    expect(generate).not.toHaveBeenCalled();
    expect(checkBudgetBlocked).not.toHaveBeenCalled();
    expect(logAiCall).not.toHaveBeenCalled();
  });

  it("does not call the provider when the org budget is blocked, and logs the blocked attempt", async () => {
    const { deps, generate, logAiCall } = makeDeps({ budget: { blocked: true, reason: "Presupuesto agotado", pct: 100 } });
    await expect(callAI(base, deps)).rejects.toThrow(AiBudgetBlockedError);
    expect(generate).not.toHaveBeenCalled();
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7, status: "blocked", errorMsg: "Presupuesto agotado" }));
  });

  it("logs a successful call with provider, agent, mode and cached tokens, and returns its cost", async () => {
    const { deps, logAiCall } = makeDeps();
    const result = await callAI({ ...base, agentId: 42, userClerkId: "user_x" }, deps);
    expect(result.text).toBe("ok");
    expect(result.provider).toBe("fake");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 7, userClerkId: "user_x", functionName: "test_fn", model: "gpt-4o-mini",
      tokensInput: 1000, tokensOutput: 500, status: "ok",
      metadata: { provider: "fake", mode: "live", agentId: 42, cachedTokens: 200 },
    }));
  });

  it("logs a provider error and rethrows it", async () => {
    const { deps, logAiCall } = makeDeps({ generate: async () => { throw new Error("provider down"); } });
    await expect(callAI(base, deps)).rejects.toThrow("provider down");
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ status: "error", errorMsg: "provider down" }));
  });

  it("platform-level usage (orgId null) skips the budget check and is logged without an org", async () => {
    const { deps, checkBudgetBlocked, logAiCall } = makeDeps({ budget: { blocked: true, reason: "x", pct: 100 } });
    const result = await callAI({ ...base, orgId: null }, deps);
    expect(result.text).toBe("ok");
    expect(checkBudgetBlocked).not.toHaveBeenCalled();
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ orgId: null, status: "ok" }));
  });
});

describe("AI Gateway — provider router", () => {
  it("rejects an unknown explicit provider", () => {
    expect(() => resolveRoute({ provider: "nope" })).toThrow(/desconocido/);
  });

  it("an explicit model overrides the default", () => {
    expect(resolveRoute({ provider: "openai", model: "gpt-4o" }).model).toBe("gpt-4o");
  });
});
