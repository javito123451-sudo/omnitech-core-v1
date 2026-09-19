// ═══════════════════════════════════════════════════════════════════════════
//  AI Gateway — the single entry point for real (LIVE) AI calls.
//
//    caller → callAI() → mode guard → route → budget check → provider → usage log
//
//  - SIMULATION never reaches a provider: callAI() refuses it outright, so a
//    simulation can't cost anything even if a caller forgets to branch.
//  - The org budget is enforced here, for every caller, instead of each route
//    remembering to call checkBudgetBlocked() (only routes/chat.ts did).
//  - Every attempt — success, provider error, or budget-blocked — is logged to
//    ai_usage_logs via the existing logAiCall, with provider / agent / mode /
//    cached tokens in metadata (no schema change).
//  - orgId === null means platform-level usage (e.g. Ava Super Admin): logged
//    without an org and not subject to any workspace's budget.
// ═══════════════════════════════════════════════════════════════════════════

import type { GenerateOptions, GenerateResult, Message } from "../ai/types";
import { calculateCost, checkBudgetBlocked, logAiCall } from "../utils/aiUsageLogger";
import { resolveRoute, type ModelPolicy } from "./providerRouter";

export type AiExecutionMode = "simulation" | "live";

export interface GatewayRequest {
  mode:          AiExecutionMode;
  orgId:         number | null;
  userClerkId?:  string | null;
  functionName:  string;
  agentId?:      number | string | null;
  messages:      Message[];
  options?:      Omit<GenerateOptions, "model">;
  modelPolicy?:  ModelPolicy;
}

export interface GatewayResult extends GenerateResult {
  provider:   string;
  model:      string;
  costUsd:    number;
  durationMs: number;
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

export interface GatewayDeps {
  resolveRoute:       typeof resolveRoute;
  checkBudgetBlocked: typeof checkBudgetBlocked;
  logAiCall:          typeof logAiCall;
}

const defaultDeps: GatewayDeps = { resolveRoute, checkBudgetBlocked, logAiCall };

export async function callAI(req: GatewayRequest, deps: GatewayDeps = defaultDeps): Promise<GatewayResult> {
  if (req.mode !== "live") throw new AiSimulationModeError();

  const route = deps.resolveRoute(req.modelPolicy);
  const baseLog = {
    orgId:        req.orgId,
    userClerkId:  req.userClerkId ?? null,
    functionName: req.functionName,
    model:        route.model,
  };
  const baseMeta = { provider: route.providerId, mode: req.mode, agentId: req.agentId ?? null };

  if (req.orgId !== null) {
    const budget = await deps.checkBudgetBlocked(req.orgId);
    if (budget.blocked) {
      const reason = budget.reason ?? "Presupuesto de IA agotado";
      await deps.logAiCall({
        ...baseLog, tokensInput: 0, tokensOutput: 0, status: "blocked", errorMsg: reason, metadata: baseMeta,
      });
      throw new AiBudgetBlockedError(reason, budget.pct);
    }
  }

  const started = Date.now();
  let result: GenerateResult;
  try {
    result = await route.provider.generate(req.messages, { ...req.options, model: route.model });
  } catch (err) {
    await deps.logAiCall({
      ...baseLog, tokensInput: 0, tokensOutput: 0, durationMs: Date.now() - started,
      status: "error", errorMsg: String(err instanceof Error ? err.message : err), metadata: baseMeta,
    });
    throw err;
  }

  const durationMs   = Date.now() - started;
  const tokensInput  = result.usage?.promptTokens ?? 0;
  const tokensOutput = result.usage?.completionTokens ?? 0;
  const cachedTokens = result.usage?.cachedTokens;

  await deps.logAiCall({
    ...baseLog, tokensInput, tokensOutput, durationMs, status: "ok",
    metadata: cachedTokens !== undefined ? { ...baseMeta, cachedTokens } : baseMeta,
  });

  return {
    ...result,
    provider: route.providerId,
    model:    route.model,
    costUsd:  calculateCost(route.model, tokensInput, tokensOutput),
    durationMs,
  };
}
