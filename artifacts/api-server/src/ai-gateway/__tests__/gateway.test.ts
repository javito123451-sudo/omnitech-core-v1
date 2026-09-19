// El AI Gateway mantiene bajo control el gasto de IA real de cualquier llamador.
// Se prueban las garantías: la simulación nunca llega a un proveedor, una org
// sin saldo/límite o bloqueada nunca llega a un proveedor, hay reintento y
// fallback ante fallos, una llamada fallida no cobra, el caché no cruza
// workspaces, y todo intento se registra. Proveedores y ledger son falsos e
// inyectados: sin llamadas a OpenAI y sin base de datos. (La atomicidad real de
// la reserva se prueba contra Postgres en reservations.integration.test.ts.)
import { describe, it, expect, vi } from "vitest";
import {
  callAI, AiBudgetBlockedError, AiSimulationModeError, AiProviderError, InsufficientCreditsError,
  AgentCreditLimitReachedError, CreditLimitReachedError, DuplicateRequestError, type GatewayDeps,
} from "../gateway";
import { HOLD_SAFETY_FACTOR } from "../pricing";
import { AI_USAGE_KINDS, NON_BILLABLE_OPERATIONS, NonBillableUsageError, isAiUsageKind } from "../usageKinds";
import { estimateCost, estimateTokens } from "../costEngine";
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
  reserve?: CreditsPort["reserve"]; settle?: CreditsPort["settle"];
} = {}) {
  const logAiCall = vi.fn(async (_p: unknown) => 77 as number | null);
  const checkBudgetBlocked = vi.fn(async () => o.budget ?? { blocked: false, reason: null, pct: 10 });
  const reserve = vi.fn(o.reserve ?? (async (i) => ({ holdId: 1, credits: i.credits, available: 100 })));
  const settle = vi.fn(o.settle ?? (async () => ({ entry: null, overrun: false, duplicate: false })));
  const release = vi.fn(async () => true);
  const sleep = vi.fn(async () => {});
  const ensurePricingLoaded = vi.fn(async () => {});
  const auditBlock = vi.fn(async () => {});
  const deps: GatewayDeps = {
    resolveRoutes: () => routes, checkBudgetBlocked, logAiCall: logAiCall as unknown as GatewayDeps["logAiCall"],
    credits: { reserve, settle, release } as CreditsPort, cache: new ResponseCache(), sleep, ensurePricingLoaded, auditBlock,
  };
  return { deps, logAiCall, checkBudgetBlocked, reserve, settle, release, sleep, ensurePricingLoaded, auditBlock };
}

const base = { mode: "live" as const, orgId: 7, functionName: "test_fn", messages: [{ role: "user" as const, content: "hola" }] };
const billed = { ...base, agentId: 9, billing: { ledger: true } };
const lastLog = (m: ReturnType<typeof vi.fn>) => m.mock.calls[m.mock.calls.length - 1]![0] as Record<string, any>;

describe("AI Gateway — guardas", () => {
  it("rechaza SIMULATION sin tocar proveedor, presupuesto, créditos ni log", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    await expect(callAI({ ...billed, mode: "simulation" }, d.deps)).rejects.toThrow(AiSimulationModeError);
    expect(a.generate).not.toHaveBeenCalled();
    expect(d.checkBudgetBlocked).not.toHaveBeenCalled();
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
    expect(d.logAiCall).not.toHaveBeenCalled();
  });

  it("no llama al proveedor si el presupuesto USD de la org está bloqueado, y lo registra y audita", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route], { budget: { blocked: true, reason: "Presupuesto agotado", pct: 100 } });
    await expect(callAI(billed, d.deps)).rejects.toThrow(AiBudgetBlockedError);
    expect(a.generate).not.toHaveBeenCalled();
    expect(d.reserve).not.toHaveBeenCalled();
    expect(lastLog(d.logAiCall)).toMatchObject({ orgId: 7, status: "blocked", errorMsg: "Presupuesto agotado" });
    expect(d.auditBlock).toHaveBeenCalledWith(7, "Presupuesto agotado", expect.objectContaining({ code: "BUDGET_BLOCKED" }));
  });

  it("uso de plataforma (orgId null) no pasa por presupuesto y se registra sin org", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route], { budget: { blocked: true, reason: "x", pct: 100 } });
    const r = await callAI({ ...base, orgId: null }, d.deps);
    expect(r.text).toBe("ok");
    expect(d.checkBudgetBlocked).not.toHaveBeenCalled();
    expect(lastLog(d.logAiCall)).toMatchObject({ orgId: null, status: "ok" });
  });

  it("billing.ledger sin orgId es un error de configuración", async () => {
    const d = makeDeps([fakeRoute("fake", async () => OK).route]);
    await expect(callAI({ ...base, orgId: null, billing: { ledger: true } }, d.deps)).rejects.toThrow(/orgId/);
  });

  it("carga los precios vigentes antes de calcular nada", async () => {
    const d = makeDeps([fakeRoute("fake", async () => OK).route]);
    await callAI(base, d.deps);
    expect(d.ensurePricingLoaded).toHaveBeenCalled();
  });
});

describe("AI Gateway — registro de coste (AI Usage Log)", () => {
  it("registra proveedor, agente, request id, cacheados, coste y de dónde salió el precio", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    const r = await callAI({ ...base, agentId: 42, agentVersionId: 5, userClerkId: "user_x", requestId: "req-1" }, d.deps);
    expect(r.requestId).toBe("req-1");
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.credits).toBeGreaterThan(0);
    const log = lastLog(d.logAiCall);
    expect(log).toMatchObject({ orgId: 7, userClerkId: "user_x", functionName: "test_fn", model: "gpt-4o-mini", tokensInput: 1000, tokensOutput: 500, status: "ok", costUsd: r.costUsd });
    expect(log["metadata"]).toMatchObject({
      provider: "fake", mode: "live", agentId: 42, agentVersionId: 5, requestId: "req-1", cachedTokens: 200, cache: false,
      credits: r.credits, priceSource: "fallback", provisional: true, pricingRowId: null,
    });
  });
});

describe("AI Gateway — timeout, reintento y fallback", () => {
  it("reintenta un error transitorio y termina sirviendo", async () => {
    let n = 0;
    const a = fakeRoute("fake", async () => { if (n++ === 0) throw Object.assign(new Error("rate limited"), { status: 429 }); return OK; });
    const d = makeDeps([a.route]);
    const r = await callAI(base, d.deps);
    expect(r.attempts).toBe(2);
    expect(a.generate).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it("no reintenta un error no transitorio en el mismo proveedor y lo registra", async () => {
    const a = fakeRoute("fake", async () => { throw Object.assign(new Error("bad request"), { status: 400 }); });
    const d = makeDeps([a.route]);
    await expect(callAI(base, d.deps)).rejects.toThrow(AiProviderError);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
    expect(lastLog(d.logAiCall)).toMatchObject({ status: "error", errorMsg: "bad request" });
  });

  it("cae al proveedor de fallback cuando el primero falla", async () => {
    const a = fakeRoute("primary", async () => { throw Object.assign(new Error("boom"), { status: 401 }); });
    const b = fakeRoute("backup", async () => OK, "other-model");
    const d = makeDeps([a.route, b.route]);
    const r = await callAI(base, d.deps);
    expect(r.provider).toBe("backup");
    expect(r.model).toBe("other-model");
    expect(r.fallbackUsed).toBe(true);
    expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ provider: "backup", fallbackFrom: "primary/gpt-4o-mini" });
  });

  it("aplica timeout: un proveedor colgado acaba en error controlado", async () => {
    const a = fakeRoute("slow", () => new Promise<GenerateResult>(() => {}));
    const d = makeDeps([a.route]);
    await expect(callAI({ ...base, timeoutMs: 20, maxRetries: 0 }, d.deps)).rejects.toThrow(/no respondió/);
  });

  it("si todos los proveedores fallan, lanza AiProviderError con el detalle de intentos", async () => {
    const a = fakeRoute("p1", async () => { throw Object.assign(new Error("e1"), { status: 400 }); });
    const b = fakeRoute("p2", async () => { throw Object.assign(new Error("e2"), { status: 400 }); });
    const d = makeDeps([a.route, b.route]);
    const err = await callAI(base, d.deps).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.attempts.map((x: { provider: string }) => x.provider)).toEqual(["p1", "p2"]);
  });
});

describe("AI Gateway — OmniCredits: reserva → llamada → liquidación", () => {
  it("reserva antes de llamar, con la referencia de la petición y un margen sobre la estimación", async () => {
    const order: string[] = [];
    const a = fakeRoute("fake", async () => { order.push("provider"); return OK; });
    const d = makeDeps([a.route], { reserve: async (i) => { order.push("reserve"); return { holdId: 1, credits: i.credits, available: 1 }; } });
    await callAI({ ...billed, requestId: "req-7", userClerkId: "u1", billing: { ledger: true, agentLimits: { monthly: 50 } } }, d.deps);
    expect(order).toEqual(["reserve", "provider"]);

    const estimate = estimateCost("fake", "gpt-4o-mini", {
      inputTokens: estimateTokens(JSON.stringify(base.messages)), maxOutputTokens: 1024,
    }).credits;
    const held = d.reserve.mock.calls[0]![0];
    expect(held).toMatchObject({ orgId: 7, reference: "req-7", agentId: 9, userClerkId: "u1", agentLimits: { monthly: 50 } });
    expect(held.credits).toBeGreaterThanOrEqual(estimate * HOLD_SAFETY_FACTOR - 1e-4);
  });

  it("al terminar liquida el consumo real, enlazado al registro técnico", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    const r = await callAI({ ...billed, requestId: "req-9" }, d.deps);
    expect(d.release).not.toHaveBeenCalled();
    expect(d.settle).toHaveBeenCalledTimes(1);
    expect(d.settle.mock.calls[0]![0]).toMatchObject({
      orgId: 7, agentId: 9, credits: r.credits, technicalCostUsd: r.costUsd, provider: "fake", model: "gpt-4o-mini",
      usageLogId: 77, reference: "req-9", estimatedCredits: r.estimatedCredits,
    });
    expect(r.estimatedCredits).toBeGreaterThan(0);
  });

  it("el agente/feature nunca calcula créditos: los da el Cost Engine del gateway", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    const r = await callAI(billed, d.deps);
    expect(d.settle.mock.calls[0]![0].credits).toBe(r.credits);
    expect(r.credits).toBeGreaterThan(0);
  });

  it("INSUFFICIENT_CREDITS: no llama al proveedor, no liquida, registra el intento y lo audita", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route], { reserve: async () => { throw new InsufficientCreditsError(3, 1, 5); } });
    const err = await callAI(billed, d.deps).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.code).toBe("INSUFFICIENT_CREDITS");
    expect(a.generate).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
    expect(lastLog(d.logAiCall)).toMatchObject({ status: "blocked" });
    expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(d.auditBlock).toHaveBeenCalledWith(7, expect.any(String), expect.objectContaining({ code: "INSUFFICIENT_CREDITS", available: 1, required: 5 }));
  });

  it("CREDIT_LIMIT_REACHED y DUPLICATE_REQUEST tampoco llegan al proveedor", async () => {
    for (const thrown of [new CreditLimitReachedError("workspace_daily", 99, 100, 5), new AgentCreditLimitReachedError("agent_monthly", 99, 100, 5), new DuplicateRequestError("req-x")]) {
      const a = fakeRoute("fake", async () => OK);
      const d = makeDeps([a.route], { reserve: async () => { throw thrown; } });
      await expect(callAI(billed, d.deps)).rejects.toBe(thrown);
      expect(a.generate).not.toHaveBeenCalled();
      expect(d.settle).not.toHaveBeenCalled();
    }
  });

  it("si la llamada falla del todo, libera la reserva y no cobra nada", async () => {
    const a = fakeRoute("fake", async () => { throw Object.assign(new Error("bad"), { status: 400 }); });
    const d = makeDeps([a.route]);
    await expect(callAI({ ...billed, requestId: "req-f" }, d.deps)).rejects.toThrow(AiProviderError);
    expect(d.release).toHaveBeenCalledWith(7, "req-f");
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("un fallo al liquidar no rompe la respuesta ya producida", async () => {
    const a = fakeRoute("fake", async () => OK);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = makeDeps([a.route], { settle: async () => { throw new Error("db down"); } });
    const r = await callAI(billed, d.deps);
    expect(r.text).toBe("ok");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("los callers que no piden ledger no reservan ni consumen créditos", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    await callAI(base, d.deps);
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
  });
});

describe("AI Gateway — caché", () => {
  const cached = { ...base, agentId: 3, agentVersionId: 1, cache: { ttlSeconds: 60 }, billing: { ledger: true } };

  it("una respuesta cacheada no llama al proveedor, no reserva ni consume créditos y se registra como caché", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    const first = await callAI(cached, d.deps);
    const second = await callAI(cached, d.deps);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.credits).toBe(0);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(d.reserve).toHaveBeenCalledTimes(1);
    expect(d.settle).toHaveBeenCalledTimes(1);
    expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ cache: true });
  });

  it("el caché nunca cruza workspaces", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    await callAI({ ...cached, orgId: 1 }, d.deps);
    const other = await callAI({ ...cached, orgId: 2 }, d.deps);
    expect(other.cached).toBe(false);
    expect(a.generate).toHaveBeenCalledTimes(2);
  });

  it("no se cachean las respuestas con llamadas a herramientas", async () => {
    const withTools = fakeRoute("fake", async () => ({ text: "", toolCalls: [{ id: "1", type: "function" as const, function: { name: "x", arguments: "{}" } }] }));
    const d = makeDeps([withTools.route]);
    await callAI(cached, d.deps);
    await callAI(cached, d.deps);
    expect(withTools.generate).toHaveBeenCalledTimes(2);
  });
});

describe("AI Gateway — qué consume créditos (usageKind)", () => {
  it("registra el tipo de uso: agent_execution si hay agente, llm_response si no, y lo lleva al ledger", async () => {
    const a = fakeRoute("fake", async () => OK);
    const d = makeDeps([a.route]);
    await callAI({ ...billed, requestId: "k-1" }, d.deps);                                  // con agente
    expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ usageKind: "agent_execution" });
    expect(d.settle.mock.calls[0]![0]).toMatchObject({ metadata: expect.objectContaining({ usageKind: "agent_execution" }) });

    const d2 = makeDeps([a.route]);
    await callAI({ ...base, billing: { ledger: true }, requestId: "k-2" }, d2.deps);         // sin agente
    expect(lastLog(d2.logAiCall)["metadata"]).toMatchObject({ usageKind: "llm_response" });
  });

  it("acepta todos los tipos de uso de IA y los cobra", async () => {
    for (const kind of AI_USAGE_KINDS) {
      const a = fakeRoute("fake", async () => OK);
      const d = makeDeps([a.route]);
      await callAI({ ...base, usageKind: kind, billing: { ledger: true }, requestId: `kind-${kind}` }, d.deps);
      expect(d.settle).toHaveBeenCalledTimes(1);
      expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ usageKind: kind });
    }
    expect([...AI_USAGE_KINDS]).toEqual([
      "agent_execution", "llm_response", "ai_analysis", "ai_content_generation", "ai_document_processing",
      "ocr", "image_generation", "audio_generation", "external_ai_tool",
    ]);
  });

  it("no cobra operaciones que no son IA: CRUD, navegación, consultas directas, tareas manuales", async () => {
    for (const notAi of NON_BILLABLE_OPERATIONS) {
      const a = fakeRoute("fake", async () => OK);
      const d = makeDeps([a.route]);
      await expect(callAI({ ...base, usageKind: notAi as never, billing: { ledger: true } }, d.deps)).rejects.toBeInstanceOf(NonBillableUsageError);
      expect(a.generate).not.toHaveBeenCalled();
      expect(d.reserve).not.toHaveBeenCalled();
      expect(d.settle).not.toHaveBeenCalled();
      expect(isAiUsageKind(notAi)).toBe(false);
    }
  });

  it("un presupuesto de agente agotado llega al gateway como AGENT_CREDIT_LIMIT_REACHED, sin proveedor ni cobro", async () => {
    const a = fakeRoute("fake", async () => OK);
    const thrown = new AgentCreditLimitReachedError("agent_execution", 8, 10, 4);
    const d = makeDeps([a.route], { reserve: async () => { throw thrown; } });
    await expect(callAI({ ...billed, billing: { ledger: true, agentLimits: { perExecution: 10, executionUsed: 8 } } }, d.deps)).rejects.toBe(thrown);
    expect(a.generate).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
    expect(lastLog(d.logAiCall)).toMatchObject({ status: "blocked" });
    expect(lastLog(d.logAiCall)["metadata"]).toMatchObject({ code: "AGENT_CREDIT_LIMIT_REACHED" });
    expect(d.reserve.mock.calls[0]![0]).toMatchObject({ agentLimits: { perExecution: 10, executionUsed: 8 } });
  });
});
