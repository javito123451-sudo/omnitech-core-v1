import { db, aiUsageLogsTable, aiBudgetsTable } from "@workspace/db";
import { eq, and, gte, lt, sum, sql } from "drizzle-orm";
import { computeCost } from "../ai-gateway/costEngine";

// Prices live in ai-gateway/pricing.ts (single source); this keeps the old
// signature for callers that only know model + token counts (OpenAI-priced).
export function calculateCost(model: string, tokensInput: number, tokensOutput: number): number {
  return computeCost({ provider: "openai", model, inputTokens: tokensInput, outputTokens: tokensOutput }).technicalCostUsd;
}

export interface AiCallParams {
  orgId:        number | null;
  userClerkId?: string | null;
  functionName: string;
  model:        string;
  tokensInput:  number;
  tokensOutput: number;
  /** Final technical cost from the Cost Engine. Computed from the tokens when omitted. */
  costUsd?:     number;
  durationMs?:  number;
  status?:      "ok" | "error" | "blocked";
  errorMsg?:    string;
  metadata?:    Record<string, unknown>;
}

// ── Log a completed AI call (fire-and-forget safe) ────────────────────────────
// Returns the ai_usage_logs id so the OmniCredits ledger can point at it.
export async function logAiCall(params: AiCallParams): Promise<number | null> {
  try {
    const tokensTotal = params.tokensInput + params.tokensOutput;
    const costUsd     = params.costUsd ?? calculateCost(params.model, params.tokensInput, params.tokensOutput);

    const [inserted] = await db.insert(aiUsageLogsTable).values({
      orgId:        params.orgId,
      userClerkId:  params.userClerkId ?? null,
      functionName: params.functionName,
      model:        params.model,
      tokensInput:  params.tokensInput,
      tokensOutput: params.tokensOutput,
      tokensTotal,
      costUsd:      String(costUsd.toFixed(6)),
      durationMs:   params.durationMs ?? null,
      status:       params.status ?? "ok",
      errorMsg:     params.errorMsg ?? null,
      metadata:     params.metadata ?? null,
    }).returning({ id: aiUsageLogsTable.id });

    // After logging, check budget threshold and maybe block
    if (params.orgId && costUsd > 0) {
      checkAndUpdateBudget(params.orgId).catch(() => {});
    }
    return inserted?.id ?? null;
  } catch (err) {
    console.error("[AiUsageLogger] Failed to log AI call:", err);
    return null;
  }
}

// ── Get current month spend for an org ────────────────────────────────────────
export async function getMonthSpend(orgId: number): Promise<number> {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [row] = await db
    .select({ total: sum(aiUsageLogsTable.costUsd) })
    .from(aiUsageLogsTable)
    .where(
      and(
        eq(aiUsageLogsTable.orgId, orgId),
        gte(aiUsageLogsTable.createdAt, start),
        lt(aiUsageLogsTable.createdAt, end),
      ),
    );
  return Number(row?.total ?? 0);
}

// ── Check budget and auto-block if needed ─────────────────────────────────────
async function checkAndUpdateBudget(orgId: number): Promise<void> {
  const [budget] = await db.select().from(aiBudgetsTable).where(eq(aiBudgetsTable.orgId, orgId));
  if (!budget) return;

  const monthSpend  = await getMonthSpend(orgId);
  const limit       = Number(budget.monthlyBudgetUsd ?? 10);
  const pct         = limit > 0 ? (monthSpend / limit) * 100 : 0;

  if (budget.blockAt100 && pct >= 100 && !budget.isBlocked) {
    await db.update(aiBudgetsTable)
      .set({ isBlocked: true, blockReason: `Límite mensual alcanzado ($${monthSpend.toFixed(4)} / $${limit})`, updatedAt: new Date() })
      .where(eq(aiBudgetsTable.orgId, orgId));
    console.warn(`[AiBudget] org=${orgId} BLOCKED — spend=$${monthSpend.toFixed(4)} limit=$${limit} (${pct.toFixed(1)}%)`);
  }

  if (pct >= 80) {
    console.warn(`[AiBudget] org=${orgId} alert — ${pct.toFixed(1)}% of monthly budget used ($${monthSpend.toFixed(4)}/$${limit})`);
  }
}

// ── Check if org is blocked (call at start of AI request) ─────────────────────
export async function checkBudgetBlocked(orgId: number): Promise<{ blocked: boolean; reason: string | null; pct: number }> {
  try {
    const [budget] = await db.select().from(aiBudgetsTable).where(eq(aiBudgetsTable.orgId, orgId));
    if (!budget) return { blocked: false, reason: null, pct: 0 };

    if (budget.isBlocked) return { blocked: true, reason: budget.blockReason, pct: 100 };

    const monthSpend = await getMonthSpend(orgId);
    const limit      = Number(budget.monthlyBudgetUsd ?? 10);
    const pct        = limit > 0 ? (monthSpend / limit) * 100 : 0;

    if (budget.blockAt100 && pct >= 100) {
      return { blocked: true, reason: `Presupuesto mensual agotado (${pct.toFixed(0)}%)`, pct };
    }
    return { blocked: false, reason: null, pct };
  } catch {
    return { blocked: false, reason: null, pct: 0 };
  }
}
