import { Router } from "express";
import { db } from "@workspace/db";
import { aiUsageLogsTable, aiBudgetsTable, organizationsTable } from "@workspace/db";
import { eq, desc, sum, count, sql, and, gte, lt } from "drizzle-orm";
import { requireSuperAdmin } from "../middlewares/superAdmin";

export const aiCenterRouter = Router();
aiCenterRouter.use(requireSuperAdmin);

const USD_TO_EUR = 0.93;

const PLAN_REVENUE: Record<string, number> = {
  starter:      0,
  professional: 49,
  enterprise:   200,
  free:         0,
};

function monthRange() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

// ── GET /stats ─────────────────────────────────────────────────────────────────
aiCenterRouter.get("/stats", async (_req, res) => {
  const { start, end } = monthRange();

  const [allCalls]   = await db.select({ total: count(), tokens: sum(aiUsageLogsTable.tokensTotal), cost: sum(aiUsageLogsTable.costUsd) }).from(aiUsageLogsTable);
  const [monthCalls] = await db.select({ total: count(), tokens: sum(aiUsageLogsTable.tokensTotal), cost: sum(aiUsageLogsTable.costUsd) })
    .from(aiUsageLogsTable).where(and(gte(aiUsageLogsTable.createdAt, start), lt(aiUsageLogsTable.createdAt, end)));

  const modelBreakdown = await db.execute(sql`
    SELECT model, COUNT(*)::int AS calls, SUM(cost_usd)::float AS cost_usd
    FROM ai_usage_logs
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY model ORDER BY cost_usd DESC
  `);

  res.json({
    totalCalls:     Number(allCalls?.total   ?? 0),
    totalTokens:    Number(allCalls?.tokens  ?? 0),
    totalCostUsd:   Number(allCalls?.cost    ?? 0),
    monthCalls:     Number(monthCalls?.total  ?? 0),
    monthTokens:    Number(monthCalls?.tokens ?? 0),
    monthCostUsd:   Number(monthCalls?.cost   ?? 0),
    modelBreakdown: (modelBreakdown as { rows: Array<{ model: string; calls: number; cost_usd: number }> }).rows
      .map(r => ({ model: r.model, calls: r.calls, costUsd: Number(r.cost_usd ?? 0) })),
  });
});

// ── GET /usage ─────────────────────────────────────────────────────────────────
aiCenterRouter.get("/usage", async (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  const rows  = await db.select().from(aiUsageLogsTable).orderBy(desc(aiUsageLogsTable.createdAt)).limit(limit);

  // Join org names
  const orgs = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable);
  const orgMap = new Map(orgs.map(o => [o.id, o.name]));

  res.json(rows.map(r => ({ ...r, costUsd: String(r.costUsd), orgName: r.orgId ? (orgMap.get(r.orgId) ?? null) : null })));
});

// ── GET /budgets ───────────────────────────────────────────────────────────────
aiCenterRouter.get("/budgets", async (_req, res) => {
  const { start, end } = monthRange();
  const orgs    = await db.select().from(organizationsTable);
  const budgets = await db.select().from(aiBudgetsTable);

  const spendRows = await db.execute(sql`
    SELECT org_id, SUM(cost_usd)::float AS spend
    FROM ai_usage_logs
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY org_id
  `) as { rows: Array<{ org_id: number; spend: number }> };
  const spendMap = new Map(spendRows.rows.map(r => [r.org_id, Number(r.spend ?? 0)]));

  const result = orgs.map(org => {
    const b = budgets.find(x => x.orgId === org.id);
    const monthSpend = spendMap.get(org.id) ?? 0;
    const limit      = Number(b?.monthlyBudgetUsd ?? 10);
    const pct        = limit > 0 ? (monthSpend / limit) * 100 : 0;
    return {
      orgId: org.id, orgName: org.name,
      monthlyBudgetUsd: String(b?.monthlyBudgetUsd ?? "10.00"),
      alert80: b?.alert80 ?? true, alert90: b?.alert90 ?? true,
      blockAt100: b?.blockAt100 ?? true, isBlocked: b?.isBlocked ?? false,
      blockReason: b?.blockReason ?? null,
      currentMonthSpend: monthSpend, pct: Math.round(pct * 10) / 10,
    };
  });

  res.json(result);
});

// ── POST /budgets ──────────────────────────────────────────────────────────────
aiCenterRouter.post("/budgets", async (req, res) => {
  const { orgId, monthlyBudgetUsd, alert80, alert90, blockAt100 } = req.body as {
    orgId: number; monthlyBudgetUsd: number; alert80: boolean; alert90: boolean; blockAt100: boolean;
  };
  await db.insert(aiBudgetsTable)
    .values({ orgId, monthlyBudgetUsd: String(monthlyBudgetUsd), alert80, alert90, blockAt100, updatedBy: req.clerkUserId })
    .onConflictDoUpdate({
      target: [aiBudgetsTable.orgId],
      set: { monthlyBudgetUsd: String(monthlyBudgetUsd), alert80, alert90, blockAt100, updatedBy: req.clerkUserId!, updatedAt: new Date() },
    });
  // If budget raised, auto-unblock
  if (monthlyBudgetUsd > 0) {
    await db.update(aiBudgetsTable).set({ isBlocked: false, blockReason: null }).where(eq(aiBudgetsTable.orgId, orgId));
  }
  res.json({ ok: true });
});

// ── POST /budgets/unblock ──────────────────────────────────────────────────────
aiCenterRouter.post("/budgets/unblock", async (req, res) => {
  const { orgId } = req.body as { orgId: number };
  await db.update(aiBudgetsTable)
    .set({ isBlocked: false, blockReason: null, updatedAt: new Date() })
    .where(eq(aiBudgetsTable.orgId, orgId));
  res.json({ ok: true });
});

// ── GET /financial ─────────────────────────────────────────────────────────────
aiCenterRouter.get("/financial", async (_req, res) => {
  const { start, end } = monthRange();
  const orgs    = await db.select().from(organizationsTable);

  const spendRows = await db.execute(sql`
    SELECT org_id, SUM(cost_usd)::float AS spend, COUNT(*)::int AS calls
    FROM ai_usage_logs
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY org_id
  `) as { rows: Array<{ org_id: number; spend: number; calls: number }> };
  const spendMap = new Map(spendRows.rows.map(r => [r.org_id, { spend: Number(r.spend ?? 0), calls: Number(r.calls ?? 0) }]));

  const result = orgs.map(org => {
    const plan        = org.plan ?? "free";
    const revenueEur  = PLAN_REVENUE[plan] ?? 0;
    const aiData      = spendMap.get(org.id) ?? { spend: 0, calls: 0 };
    const aiCostUsd   = aiData.spend;
    const aiCostEur   = aiCostUsd * USD_TO_EUR;
    const marginEur   = revenueEur - aiCostEur;
    const marginPct   = revenueEur > 0 ? (marginEur / revenueEur) * 100 : marginEur < 0 ? -100 : 100;
    return { orgId: org.id, orgName: org.name, plan, revenueEur, aiCostUsd, aiCostEur, marginEur, marginPct, calls: aiData.calls };
  });

  res.json(result);
});
