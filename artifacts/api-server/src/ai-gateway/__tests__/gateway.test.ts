// El AI Gateway mantiene bajo control el gasto de IA real de cualquier llamador.
// Se prueban las garantías: la simulación nunca llega a un proveedor, una org
// bloqueada o sin créditos nunca llega a un proveedor, hay reintento y
// fallback ante fallos, el caché no cruza workspaces, y todo intento se
// registra. Los proveedores y el ledger son falsos e inyectados: sin llamadas
// a OpenAI y sin base de datos.
import { describe, it, expect, vi } from "vitest";
import {
  callAI, AiBudgetBlockedError, AiSimulationModeError, AiProviderError, AgentCreditLimitError,
  InsufficientCreditsError, type GatewayDeps,
} from "../gateway";
import { ResponseCache } from "../responseCache";
import type { AIProvider, GenerateResult } from "../../ai/types";
import type { ResolvedRoute } from "../providerRouter";
import type { CreditsPort } from "../../credits/creditService";

const OK: GenerateResult = { text: "ok", usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedTokens: 200 } };

function fakeRoute(id: string, generate: () => Promise<GenerateResult>, model = "gpt-4o-mini"): { route: ResolvedRoute; generate: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(generate);
  return { route: { provider: { id, name: id, generate: fn } as unknown as AIProvider, providerId: id, model, timeoutMs: 1000 }, generate: fn };
}

function makeDeps(routes: ResolvedRoute[], o: {
  budget?: { blocked: boolean; reason: string | null; pct: number };
  balance?: number; agentUsage?: number; recordUsage?: CreditsPort["recordUsage"];
} = {}) {
  const logAiCall = vi.fn(async (_p: unknown) => 77 as number | null);
  const checkBudgetBlocked = vi.fn(async () => o.budget ?? { blocked: false, reason: null, pct: 10 });
  const recordUsage = vi.fn(o.recordUsage ?? (async () => {}));
  const credits: CreditsPort = {
    getBalance: vi.fn(async () => o.balance ?? 1_000_000),
    getAgentMonthUsage: vi.fn(async () => o.agentUsage ?? 0),
    recordUsage,
  };
  const sleep = vi.fn(async () => {});
  const deps: GatewayDeps = { resolveRoutes: () => routes, checkBudgetBlocked, logAiCall: logAiCall as unknown as GatewayDeps["logAiCall"], credits, cache: new ResponseCache(), sleep };
  return { deps, logAiCall, checkBudgetBlocked, credits, recordUsage, sleep };
}

const base = { mode: "live" as const, orgId: 7, functionName: "test_fn", messages: [{ role: "user" as const, content: "hola" }] };
const lastLog = (m: ReturnType<typeof vi.fn>) => m.mock.calls[m.mock.calls.length - 1]![0] as Record<string, any>;

describe("AI Gateway — guardas", () => {
  it("rechaza SIMULATION sin tocar proveedor, presupuesto ni log", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, logAiCall, checkBudgetBlocked } = makeDeps([a.route]);
    await expect(callAI({ ...base, mode: "simulation" }, deps)).rejects.toThrow(AiSimulationModeError);
    expect(a.generate).not.toHaveBeenCalled();
    expect(checkBudgetBlocked).not.toHaveBeenCalled();
    expect(logAiCall).not.toHaveBeenCalled();
  });

  it("no llama al proveedor si el presupuesto de la org está bloqueado, y lo registra", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, logAiCall } = makeDeps([a.route], { budget: { blocked: true, reason: "Presupuesto agotado", pct: 100 } });
    await expect(callAI(base, deps)).rejects.toThrow(AiBudgetBlockedError);
    expect(a.generate).not.toHaveBeenCalled();
    expect(lastLog(logAiCall)).toMatchObject({ orgId: 7, status: "blocked", errorMsg: "Presupuesto agotado" });
  });

  it("uso de plataforma (orgId null) no pasa por presupuesto y se registra sin org", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, checkBudgetBlocked, logAiCall } = makeDeps([a.route], { budget: { blocked: true, reason: "x", pct: 100 } });
    const r = await callAI({ ...base, orgId: null }, deps);
    expect(r.text).toBe("ok");
    expect(checkBudgetBlocked).not.toHaveBeenCalled();
    expect(lastLog(logAiCall)).toMatchObject({ orgId: null, status: "ok" });
  });

  it("billing.ledger sin orgId es un error de configuración", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps } = makeDeps([a.route]);
    await expect(callAI({ ...base, orgId: null, billing: { ledger: true } }, deps)).rejects.toThrow(/orgId/);
  });
});

describe("AI Gateway — registro de coste", () => {
  it("registra proveedor, agente, request id, tokens cacheados y coste del Cost Engine", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, logAiCall } = makeDeps([a.route]);
    const r = await callAI({ ...base, agentId: 42, agentVersionId: 5, userClerkId: "user_x", requestId: "req-1" }, deps);
    expect(r.requestId).toBe("req-1");
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.credits).toBeGreaterThan(0);
    const log = lastLog(logAiCall);
    expect(log).toMatchObject({ orgId: 7, userClerkId: "user_x", functionName: "test_fn", model: "gpt-4o-mini", tokensInput: 1000, tokensOutput: 500, status: "ok", costUsd: r.costUsd });
    expect(log["metadata"]).toMatchObject({ provider: "fake", mode: "live", agentId: 42, agentVersionId: 5, requestId: "req-1", cachedTokens: 200, cache: false, credits: r.credits });
  });
});

describe("AI Gateway — timeout, reintento y fallback", () => {
  it("reintenta un error transitorio y termina sirviendo", async () => {
    let n = 0;
    const a = fakeRoute("fake", async () => { if (n++ === 0) throw Object.assign(new Error("rate limited"), { status: 429 }); return OK; });
    const { deps, sleep } = makeDeps([a.route]);
    const r = await callAI(base, deps);
    expect(r.attempts).toBe(2);
    expect(a.generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("no reintenta un error no transitorio en el mismo proveedor y lo registra", async () => {
    const a = fakeRoute("fake", async () => { throw Object.assign(new Error("bad request"), { status: 400 }); });
    const { deps, logAiCall, sleep } = makeDeps([a.route]);
    await expect(callAI(base, deps)).rejects.toThrow(AiProviderError);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(lastLog(logAiCall)).toMatchObject({ status: "error", errorMsg: "bad request" });
  });

  it("cae al proveedor de fallback cuando el primero falla", async () => {
    const a = fakeRoute("primary", async () => { throw Object.assign(new Error("boom"), { status: 401 }); });
    const b = fakeRoute("backup", async () => OK, "other-model");
    const { deps, logAiCall } = makeDeps([a.route, b.route]);
    const r = await callAI(base, deps);
    expect(r.provider).toBe("backup");
    expect(r.model).toBe("other-model");
    expect(r.fallbackUsed).toBe(true);
    expect(lastLog(logAiCall)["metadata"]).toMatchObject({ provider: "backup", fallbackFrom: "primary/gpt-4o-mini" });
  });

  it("aplica timeout: un proveedor colgado acaba en error controlado", async () => {
    const a = fakeRoute("slow", () => new Promise<GenerateResult>(() => {}));
    const { deps } = makeDeps([a.route]);
    await expect(callAI({ ...base, timeoutMs: 20, maxRetries: 0 }, deps)).rejects.toThrow(/no respondió/);
  });

  it("si todos los proveedores fallan, lanza AiProviderError con el detalle de intentos", async () => {
    const a = fakeRoute("p1", async () => { throw Object.assign(new Error("e1"), { status: 400 }); });
    const b = fakeRoute("p2", async () => { throw Object.assign(new Error("e2"), { status: 400 }); });
    const { deps } = makeDeps([a.route, b.route]);
    const err = await callAI(base, deps).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.attempts.map((x: { provider: string }) => x.provider)).toEqual(["p1", "p2"]);
  });
});

describe("AI Gateway — OmniCredits", () => {
  const billed = { ...base, agentId: 9, billing: { ledger: true } };

  it("sin créditos suficientes NO llama al proveedor y devuelve un error controlado", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, logAiCall, recordUsage } = makeDeps([a.route], { balance: 0 });
    await expect(callAI(billed, deps)).rejects.toThrow(InsufficientCreditsError);
    expect(a.generate).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(lastLog(logAiCall)).toMatchObject({ status: "blocked" });
  });

  it("respeta el límite mensual de créditos del agente", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps } = makeDeps([a.route], { agentUsage: 99.99 });
    await expect(callAI({ ...billed, billing: { ledger: true, monthlyCreditLimit: 100 } }, deps)).rejects.toThrow(AgentCreditLimitError);
    expect(a.generate).not.toHaveBeenCalled();
  });

  it("con créditos, ejecuta y carga el ledger enlazado al registro técnico", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, recordUsage } = makeDeps([a.route]);
    const r = await callAI({ ...billed, userClerkId: "u1", requestId: "req-9" }, deps);
    expect(r.estimatedCredits).toBeGreaterThan(0);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0]![0]).toMatchObject({
      orgId: 7, agentId: 9, credits: r.credits, technicalCostUsd: r.costUsd, provider: "fake", model: "gpt-4o-mini",
      usageLogId: 77, reference: "req-9", estimatedCredits: r.estimatedCredits,
    });
  });

  it("un fallo al escribir el ledger no rompe la respuesta ya producida", async () => {
    const a = fakeRoute("fake", async () => OK);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeDeps([a.route], { recordUsage: async () => { throw new Error("db down"); } });
    const r = await callAI(billed, deps);
    expect(r.text).toBe("ok");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("los callers que no piden ledger no consumen créditos", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, recordUsage, credits } = makeDeps([a.route], { balance: 0 });
    await callAI(base, deps);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(credits.getBalance).not.toHaveBeenCalled();
  });
});

describe("AI Gateway — caché", () => {
  const cached = { ...base, agentId: 3, agentVersionId: 1, cache: { ttlSeconds: 60 }, billing: { ledger: true } };

  it("una respuesta cacheada no llama al proveedor, no consume créditos y se registra como caché", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps, recordUsage, logAiCall } = makeDeps([a.route]);
    const first = await callAI(cached, deps);
    const second = await callAI(cached, deps);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.credits).toBe(0);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(lastLog(logAiCall)["metadata"]).toMatchObject({ cache: true });
  });

  it("el caché nunca cruza workspaces", async () => {
    const a = fakeRoute("fake", async () => OK);
    const { deps } = makeDeps([a.route]);
    await callAI({ ...cached, orgId: 1 }, deps);
    const other = await callAI({ ...cached, orgId: 2 }, deps);
    expect(other.cached).toBe(false);
    expect(a.generate).toHaveBeenCalledTimes(2);
  });

  it("no se cachean las respuestas con llamadas a herramientas", async () => {
    const withTools = fakeRoute("fake", async () => ({ text: "", toolCalls: [{ id: "1", type: "function" as const, function: { name: "x", arguments: "{}" } }] }));
    const { deps } = makeDeps([withTools.route]);
    await callAI(cached, deps);
    await callAI(cached, deps);
    expect(withTools.generate).toHaveBeenCalledTimes(2);
  });
});
