// Lectura de consumo comercial: el panel de créditos de un workspace y la vista
// global de Super Admin. Solo lee (ledger, ai_usage_logs, compras, alertas) y
// no duplica ninguna lógica de coste: los importes ya vienen calculados por el
// Cost Engine cuando se registró cada movimiento.

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db, creditLedgerTable, creditPurchasesTable, creditAlertsTable, aiUsageLogsTable, organizationsTable,
} from "@workspace/db";
import { listAlerts } from "./alerts";
import { getAvailable } from "./creditService";
import { consumedBetween, dayBounds, getPlanConfig, monthBounds, resolveOrgPlan } from "./planService";

const DAY = 24 * 60 * 60 * 1000;
const num = (v: string | null | undefined) => Number(v ?? 0);
const neg = sql<string>`sum(-${creditLedgerTable.credits})`;
const cost = sql<string>`coalesce(sum(${creditLedgerTable.technicalCostUsd}), 0)`;

export async function getDashboard(orgId: number, at: Date = new Date()) {
  const { plan, license } = await resolveOrgPlan(orgId, db, at);
  const cfg = plan ? await getPlanConfig(plan) : null;
  const month = monthBounds(at);
  const day = dayBounds(at);
  const consumption = and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.entryType, "consumption"));
  const inMonth = and(consumption, gte(creditLedgerTable.createdAt, month.start));

  const [balances, used, usedToday, byAgent, byModel, byFeature, daily, monthly, alerts] = await Promise.all([
    getAvailable(orgId),
    consumedBetween(db, orgId, month.start, month.end),
    consumedBetween(db, orgId, day.start, day.end),
    db.select({ agentId: creditLedgerTable.agentId, credits: neg, costUsd: cost, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(inMonth).groupBy(creditLedgerTable.agentId).orderBy(desc(neg)),
    db.select({ provider: creditLedgerTable.provider, model: creditLedgerTable.model, credits: neg, costUsd: cost, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(inMonth).groupBy(creditLedgerTable.provider, creditLedgerTable.model).orderBy(desc(neg)),
    db.select({ feature: sql<string>`coalesce(${creditLedgerTable.metadata}->>'functionName', 'sin_clasificar')`, credits: neg, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(inMonth).groupBy(sql`1`).orderBy(desc(neg)),
    db.select({ day: sql<string>`to_char(date_trunc('day', ${creditLedgerTable.createdAt}), 'YYYY-MM-DD')`, credits: neg })
      .from(creditLedgerTable).where(and(consumption, gte(creditLedgerTable.createdAt, new Date(day.start.getTime() - 29 * DAY))))
      .groupBy(sql`1`).orderBy(sql`1`),
    db.select({ month: sql<string>`to_char(date_trunc('month', ${creditLedgerTable.createdAt}), 'YYYY-MM')`, credits: neg })
      .from(creditLedgerTable).where(and(consumption, gte(creditLedgerTable.createdAt, new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 5, 1)))))
      .groupBy(sql`1`).orderBy(sql`1`),
    listAlerts(orgId, { since: month.start }),
  ]);

  const base = cfg?.includedCredits ?? cfg?.monthlyLimit ?? null;
  const daysInMonth = (month.end.getTime() - month.start.getTime()) / DAY;
  const elapsed = Math.max((at.getTime() - month.start.getTime()) / DAY, 1 / 24);

  return {
    plan,
    ...balances,
    period: { key: month.key, start: month.start, end: month.end, renewsAt: license?.validUntil ?? month.end },
    included: cfg?.includedCredits ?? null,
    used, usedToday,
    pctConsumed: base ? Math.round((used / base) * 1000) / 10 : null,
    limits: cfg ? { monthly: cfg.monthlyLimit, daily: cfg.dailyLimit, perAgentMonthly: cfg.perAgentMonthlyLimit, blockAtLimit: cfg.blockAtLimit } : null,
    byAgent:   byAgent.map((r) => ({ agentId: r.agentId, credits: num(r.credits), technicalCostUsd: num(r.costUsd), runs: num(r.runs) })),
    byModel:   byModel.map((r) => ({ provider: r.provider, model: r.model, credits: num(r.credits), technicalCostUsd: num(r.costUsd), runs: num(r.runs) })),
    byFeature: byFeature.map((r) => ({ feature: r.feature, credits: num(r.credits), runs: num(r.runs) })),
    daily:     daily.map((r) => ({ day: r.day, credits: num(r.credits) })),
    monthly:   monthly.map((r) => ({ month: r.month, credits: num(r.credits) })),
    forecast:  { projectedMonthCredits: Math.round((used / elapsed) * daysInMonth * 100) / 100, basis: "linear" as const },
    alerts,
  };
}

/** Vista global para Super Admin: todo lo que se ha concedido, consumido, ajustado, comprado y fallado. */
export async function getGlobalOverview(opts: { days?: number; orgIds?: number[]; at?: Date } = {}) {
  const at = opts.at ?? new Date();
  const since = new Date(at.getTime() - (opts.days ?? 30) * DAY);
  const ledgerOrg = opts.orgIds?.length ? inArray(creditLedgerTable.orgId, opts.orgIds) : undefined;
  const inWindow = and(gte(creditLedgerTable.createdAt, since), ledgerOrg);
  const consumptionWindow = and(inWindow, eq(creditLedgerTable.entryType, "consumption"));

  const [byType, byModel, topWorkspaces, topAgents, errors, purchases, alerts] = await Promise.all([
    db.select({ type: creditLedgerTable.entryType, entries: sql<string>`count(*)`, credits: sql<string>`sum(${creditLedgerTable.credits})` })
      .from(creditLedgerTable).where(inWindow).groupBy(creditLedgerTable.entryType),
    db.select({ provider: creditLedgerTable.provider, model: creditLedgerTable.model, credits: neg, costUsd: cost, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(consumptionWindow).groupBy(creditLedgerTable.provider, creditLedgerTable.model).orderBy(desc(neg)),
    db.select({ orgId: creditLedgerTable.orgId, name: organizationsTable.name, credits: neg, costUsd: cost })
      .from(creditLedgerTable).innerJoin(organizationsTable, eq(organizationsTable.id, creditLedgerTable.orgId))
      .where(consumptionWindow).groupBy(creditLedgerTable.orgId, organizationsTable.name).orderBy(desc(neg)).limit(10),
    db.select({ orgId: creditLedgerTable.orgId, agentId: creditLedgerTable.agentId, credits: neg, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(and(consumptionWindow, sql`${creditLedgerTable.agentId} is not null`))
      .groupBy(creditLedgerTable.orgId, creditLedgerTable.agentId).orderBy(desc(neg)).limit(10),
    // Errores de consumo: llamadas de IA fallidas o bloqueadas (sin saldo, presupuesto…).
    db.select({ status: aiUsageLogsTable.status, functionName: aiUsageLogsTable.functionName, count: sql<string>`count(*)` })
      .from(aiUsageLogsTable)
      .where(and(gte(aiUsageLogsTable.createdAt, since), inArray(aiUsageLogsTable.status, ["error", "blocked"]),
        opts.orgIds?.length ? inArray(aiUsageLogsTable.orgId, opts.orgIds) : undefined))
      .groupBy(aiUsageLogsTable.status, aiUsageLogsTable.functionName).orderBy(desc(sql`count(*)`)).limit(20),
    db.select({ currency: creditPurchasesTable.currency, purchases: sql<string>`count(*)`, credits: sql<string>`sum(${creditPurchasesTable.credits})`, amount: sql<string>`coalesce(sum(${creditPurchasesTable.priceAmount}), 0)` })
      .from(creditPurchasesTable)
      .where(and(gte(creditPurchasesTable.createdAt, since), opts.orgIds?.length ? inArray(creditPurchasesTable.orgId, opts.orgIds) : undefined))
      .groupBy(creditPurchasesTable.currency),
    db.select().from(creditAlertsTable)
      .where(and(gte(creditAlertsTable.createdAt, since), opts.orgIds?.length ? inArray(creditAlertsTable.orgId, opts.orgIds) : undefined))
      .orderBy(desc(creditAlertsTable.id)).limit(20),
  ]);

  const total = (types: string[]) => byType.filter((r) => types.includes(r.type)).reduce((s, r) => s + num(r.credits), 0);
  return {
    windowDays: opts.days ?? 30,
    totals: {
      granted:     total(["grant", "subscription"]),
      purchased:   total(["purchase"]),
      consumed:    -total(["consumption"]),
      refunded:    total(["refund"]),
      adjustments: total(["adjustment"]),
      expired:     -total(["expiration"]),
    },
    byType:  byType.map((r) => ({ type: r.type, entries: num(r.entries), credits: num(r.credits) })),
    byModel: byModel.map((r) => ({ provider: r.provider, model: r.model, credits: num(r.credits), technicalCostUsd: num(r.costUsd), runs: num(r.runs) })),
    topWorkspaces: topWorkspaces.map((r) => ({ orgId: r.orgId, name: r.name, credits: num(r.credits), technicalCostUsd: num(r.costUsd) })),
    topAgents: topAgents.map((r) => ({ orgId: r.orgId, agentId: r.agentId, credits: num(r.credits), runs: num(r.runs) })),
    errors: errors.map((r) => ({ status: r.status, functionName: r.functionName, count: num(r.count) })),
    purchases: purchases.map((r) => ({ currency: r.currency, purchases: num(r.purchases), credits: num(r.credits), amount: num(r.amount) })),
    alerts,
  };
}
