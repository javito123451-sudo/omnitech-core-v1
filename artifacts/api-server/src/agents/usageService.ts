// Consumo de un agente para la Fábrica: lo que ha gastado (del ledger) y lo que
// costaría una ejecución (del Cost Engine). No calcula costes por su cuenta.

import { and, eq, gte, sql } from "drizzle-orm";
import { db, creditLedgerTable } from "@workspace/db";
import { monthBounds } from "../credits/planService";
import { getAgentDetail, readConfig } from "./agentService";
import { estimateRunCost } from "./runEstimate";

const num = (v: string | null | undefined) => Number(v ?? 0);

export async function getAgentUsage(orgId: number, agentId: number, at: Date = new Date()) {
  const { agent, versions } = await getAgentDetail(orgId, agentId); // 404 si es de otra org
  const month = monthBounds(at);
  const mine = and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.agentId, agentId), eq(creditLedgerTable.entryType, "consumption"));
  const credits = sql<string>`coalesce(sum(-${creditLedgerTable.credits}), 0)`;
  const costUsd = sql<string>`coalesce(sum(${creditLedgerTable.technicalCostUsd}), 0)`;

  const provisional = sql<string>`coalesce(sum(-${creditLedgerTable.credits}) filter (where ${creditLedgerTable.metadata}->>'provisional' = 'true'), 0)`;

  const [[all], [period], byModel] = await Promise.all([
    db.select({ credits, costUsd, runs: sql<string>`count(*)`, last: sql<Date | null>`max(${creditLedgerTable.createdAt})` })
      .from(creditLedgerTable).where(mine),
    db.select({ credits, costUsd, runs: sql<string>`count(*)`, provisionalCredits: provisional })
      .from(creditLedgerTable).where(and(mine, gte(creditLedgerTable.createdAt, month.start))),
    db.select({ provider: creditLedgerTable.provider, model: creditLedgerTable.model, credits, costUsd, runs: sql<string>`count(*)` })
      .from(creditLedgerTable).where(and(mine, gte(creditLedgerTable.createdAt, month.start)))
      .groupBy(creditLedgerTable.provider, creditLedgerTable.model),
  ]);

  const version = versions.find((v) => v.id === agent.activeVersionId) ?? versions[0];
  const estimate = version
    ? (() => {
        const config = readConfig(version);
        return estimateRunCost({ agent, config, toolIds: [...config.tools.read, ...config.tools.write] });
      })()
    : null;

  return {
    agentId, period: month.key,
    estimatedPerRun: estimate,
    accumulated: { credits: num(all?.credits), technicalCostUsd: num(all?.costUsd), runs: num(all?.runs), lastRunAt: all?.last ?? null },
    thisPeriod:  { credits: num(period?.credits), technicalCostUsd: num(period?.costUsd), runs: num(period?.runs), provisionalCredits: num(period?.provisionalCredits) },
    byModel: byModel.map((r) => ({ provider: r.provider, model: r.model, credits: num(r.credits), technicalCostUsd: num(r.costUsd), runs: num(r.runs) })),
    monthlyCreditLimit: agent.monthlyCreditLimit,
  };
}
