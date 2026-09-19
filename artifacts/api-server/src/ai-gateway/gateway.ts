// ═══════════════════════════════════════════════════════════════════════════
//  AI Gateway — the single entry point for real (LIVE) AI calls.
//
//   caller → callAI():
//     mode guard → route(s) → cache → preflight (org budget, credits, agent cap)
//     → provider call (timeout / retry / fallback) → Cost Engine
//     → ai_usage_logs (technical) → OmniCredits ledger (commercial)
//
//  - SIMULATION never reaches a provider: callAI() refuses it outright.
//  - Preflight can only refuse to START a paid call. Once the provider has
//    answered, the real cost is always recorded, even if it exceeds the
//    estimate (the difference is kept: estimatedCredits vs credits).
//  - Every attempt — ok / error / blocked / cache hit — leaves an
//    ai_usage_logs row with provider, agent, request id and cost detail in
//    metadata, so Super Admin observability needs no extra instrumentation.
//  - orgId === null is platform-level usage (Ava Super Admin): logged without
//    an org, never subject to a workspace's budget or credits.
//  - The ledger is charged only when the caller opts in with billing.ledger
//    (agent runs). Existing callers (AVA CORE, chat…) are logged but not
//    charged in credits yet.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import type { GenerateOptions, GenerateResult, Message } from "../ai/types";
import { checkBudgetBlocked, logAiCall } from "../utils/aiUsageLogger";
import { creditsPort, InsufficientCreditsError, type CreditsPort } from "../credits/creditService";
import { computeCost, estimateCost, estimateTokens } from "./costEngine";
import { resolveRoutes, type ResolvedRoute, type RoutingContext } from "./providerRouter";
import { ResponseCache, responseCache } from "./responseCache";

export { InsufficientCreditsError };

export type AiExecutionMode = "simulation" | "live";

export interface GatewayRequest {
  mode:            AiExecutionMode;
  orgId:           number | null;
  userClerkId?:    string | null;
  functionName:    string;
  agentId?:        number | null;
  agentVersionId?: number | null;
  messages:        Message[];
  options?:        Omit<GenerateOptions, "model">;
  routing?:        RoutingContext;
  /** Charge the OmniCredits ledger (and enforce credits) for this call. */
  billing?:        { ledger: boolean; monthlyCreditLimit?: number | null };
  cache?:          { ttlSeconds: number };
  timeoutMs?:      number;
  maxRetries?:     number;
  requestId?:      string;
}

export interface GatewayResult extends GenerateResult {
  requestId:        string;
  provider:         string;
  model:            string;
  costUsd:          number;
  credits:          number;
  estimatedCredits: number | null;
  cached:           boolean;
  attempts:         number;
  fallbackUsed:     boolean;
  durationMs:       number;
}

export class AiBudgetBlockedError extends Error {
  constructor(public readonly reason: string, public readonly pct: number) {
    super(reason);
    this.name = "AiBudgetBlockedError";
  }
}

export class AiSimulationModeError extends Error {
  constructor() {
    super("El AI Gateway solo atiende llamadas LIVE; la simulación no debe llegar a un proveedor.");
    this.name = "AiSimulationModeError";
  }
}

export class AgentCreditLimitError extends Error {
  constructor(public readonly used: number, public readonly limit: number) {
    super(`El agente alcanzó su límite mensual de créditos (${used.toFixed(2)} / ${limit}).`);
    this.name = "AgentCreditLimitError";
  }
}

export class AiTimeoutError extends Error {
  constructor(ms: number) { super(`El proveedor de IA no respondió en ${ms} ms.`); this.name = "AiTimeoutError"; }
}

export interface ProviderAttempt { provider: string; model: string; error?: string }

export class AiProviderError extends Error {
  constructor(message: string, public readonly attempts: ProviderAttempt[]) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface GatewayDeps {
  resolveRoutes:      typeof resolveRoutes;
  checkBudgetBlocked: typeof checkBudgetBlocked;
  logAiCall:          typeof logAiCall;
  credits:            CreditsPort;
  cache:              ResponseCache;
  sleep:              (ms: number) => Promise<void>;
}

const defaultDeps: GatewayDeps = {
  resolveRoutes, checkBudgetBlocked, logAiCall, credits: creditsPort, cache: responseCache,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; name?: string; message?: string } | null;
  if (e?.name === "AiTimeoutError") return true;
  if (typeof e?.status === "number") return e.status === 408 || e.status === 429 || e.status >= 500;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(e?.message ?? "");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AiTimeoutError(ms)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const errMsg = (err: unknown) => String(err instanceof Error ? err.message : err);

export async function callAI(req: GatewayRequest, deps: GatewayDeps = defaultDeps): Promise<GatewayResult> {
  if (req.mode !== "live") throw new AiSimulationModeError();
  const ledger = req.billing?.ledger === true;
  if (ledger && req.orgId === null) throw new Error("billing.ledger requiere un orgId.");

  const requestId = req.requestId ?? randomUUID();
  const routes = deps.resolveRoutes(req.routing);
  const primary = routes[0]!;
  const baseLog = { orgId: req.orgId, userClerkId: req.userClerkId ?? null, functionName: req.functionName };
  const baseMeta = { requestId, mode: req.mode, agentId: req.agentId ?? null, agentVersionId: req.agentVersionId ?? null };
  const blocked = async (reason: string) => deps.logAiCall({
    ...baseLog, model: primary.model, tokensInput: 0, tokensOutput: 0, status: "blocked", errorMsg: reason,
    metadata: { ...baseMeta, provider: primary.providerId },
  });

  // ── Cache (opt-in; the key is scoped to the org) ───────────────────────────
  let cacheKey: string | null = null;
  if (req.cache && req.orgId !== null) {
    cacheKey = ResponseCache.key(req.orgId, `${req.agentId ?? ""}:${req.agentVersionId ?? ""}`,
      { provider: primary.providerId, model: primary.model }, req.messages, req.options);
    const hit = deps.cache.get(cacheKey);
    if (hit) {
      await deps.logAiCall({
        ...baseLog, model: hit.model, tokensInput: 0, tokensOutput: 0, costUsd: 0, durationMs: 0, status: "ok",
        metadata: { ...baseMeta, provider: hit.provider, cache: true, credits: 0 },
      });
      return { ...hit, requestId, costUsd: 0, credits: 0, estimatedCredits: null, cached: true, attempts: 0, fallbackUsed: false, durationMs: 0 };
    }
  }

  // ── Preflight: can we START this paid call? ────────────────────────────────
  let estimatedCredits: number | null = null;
  if (req.orgId !== null) {
    const budget = await deps.checkBudgetBlocked(req.orgId);
    if (budget.blocked) {
      const reason = budget.reason ?? "Presupuesto de IA agotado";
      await blocked(reason);
      throw new AiBudgetBlockedError(reason, budget.pct);
    }
  }
  if (ledger) {
    const toolsSize = req.options?.tools ? JSON.stringify(req.options.tools).length / 4 : 0;
    const estimate = estimateCost(primary.providerId, primary.model, {
      inputTokens: estimateTokens(JSON.stringify(req.messages)) + Math.ceil(toolsSize),
      maxOutputTokens: req.options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    });
    estimatedCredits = estimate.credits;

    const balance = await deps.credits.getBalance(req.orgId!);
    if (balance < estimate.credits) {
      await blocked(`Créditos insuficientes (saldo ${balance}, estimado ${estimate.credits})`);
      throw new InsufficientCreditsError(balance, estimate.credits);
    }
    const cap = req.billing?.monthlyCreditLimit;
    if (cap != null && req.agentId != null) {
      const used = await deps.credits.getAgentMonthUsage(req.orgId!, req.agentId);
      if (used + estimate.credits > cap) {
        await blocked(`Límite mensual del agente alcanzado (${used} / ${cap})`);
        throw new AgentCreditLimitError(used, cap);
      }
    }
  }

  // ── Provider call: timeout, retry on transient errors, then fallback ──────
  const maxRetries = req.maxRetries ?? 1;
  const attempts: ProviderAttempt[] = [];
  const started = Date.now();
  let result: GenerateResult | null = null;
  let used: ResolvedRoute | null = null;

  routeLoop:
  for (const route of routes) {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        result = await withTimeout(
          route.provider.generate(req.messages, { ...req.options, model: route.model }),
          req.timeoutMs ?? route.timeoutMs,
        );
        used = route;
        attempts.push({ provider: route.providerId, model: route.model });
        break routeLoop;
      } catch (err) {
        attempts.push({ provider: route.providerId, model: route.model, error: errMsg(err) });
        if (!isRetryable(err) || i === maxRetries) break;
        await deps.sleep(200 * 2 ** i);
      }
    }
  }
  const durationMs = Date.now() - started;

  if (!result || !used) {
    const last = attempts[attempts.length - 1]?.error ?? "sin detalle";
    await deps.logAiCall({
      ...baseLog, model: primary.model, tokensInput: 0, tokensOutput: 0, durationMs, status: "error", errorMsg: last,
      metadata: { ...baseMeta, provider: primary.providerId, attempts },
    });
    throw new AiProviderError(`Ningún proveedor de IA pudo responder: ${last}`, attempts);
  }

  // ── Cost Engine → technical log → commercial ledger ────────────────────────
  const inputTokens  = result.usage?.promptTokens ?? 0;
  const outputTokens = result.usage?.completionTokens ?? 0;
  const cachedTokens = result.usage?.cachedTokens;
  const cost = computeCost({ provider: used.providerId, model: used.model, inputTokens, outputTokens, cachedTokens, durationMs }, "final");
  const fallbackUsed = used !== primary;

  const usageLogId = await deps.logAiCall({
    ...baseLog, model: used.model, tokensInput: inputTokens, tokensOutput: outputTokens,
    costUsd: cost.technicalCostUsd, durationMs, status: "ok",
    metadata: {
      ...baseMeta, provider: used.providerId, cache: false,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      costBasis: cost.basis, priceKnown: cost.priceKnown, credits: cost.credits, estimatedCredits,
      attempts: attempts.length, ...(fallbackUsed ? { fallbackFrom: `${primary.providerId}/${primary.model}` } : {}),
    },
  });

  if (ledger) {
    try {
      await deps.credits.recordUsage({
        orgId: req.orgId!, credits: cost.credits, agentId: req.agentId ?? null, agentVersionId: req.agentVersionId ?? null,
        userClerkId: req.userClerkId ?? null, provider: used.providerId, model: used.model,
        technicalCostUsd: cost.technicalCostUsd, estimatedCredits, usageLogId, reference: requestId,
        metadata: { functionName: req.functionName, costBasis: cost.basis, priceKnown: cost.priceKnown },
      });
    } catch (err) {
      // The answer was already produced and paid for: don't fail the user's
      // request, but make the gap loud so it can be reconciled from ai_usage_logs.
      console.error(`[AiGateway] LEDGER WRITE FAILED requestId=${requestId} org=${req.orgId} credits=${cost.credits}:`, err);
    }
  }

  if (cacheKey && req.cache) {
    deps.cache.set(cacheKey, { ...result, provider: used.providerId, model: used.model }, req.cache.ttlSeconds);
  }

  return {
    ...result, requestId, provider: used.providerId, model: used.model,
    costUsd: cost.technicalCostUsd, credits: cost.credits, estimatedCredits,
    cached: false, attempts: attempts.length, fallbackUsed, durationMs,
  };
}
