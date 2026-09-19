// Alertas de consumo: umbrales del plan y consumo anómalo. Cada alerta se guarda
// una sola vez por periodo (restricción única) y deja rastro en audit_logs.
// Solo lee del ledger; no toca saldos.

import { and, eq, gte, sql } from "drizzle-orm";
import { db, creditAlertsTable, creditLedgerTable, type CreditAlert } from "@workspace/db";
import { logAuditSystem } from "../utils/auditLogger";
import { consumedBetween, dayBounds, getPlanConfig, monthBounds, resolveOrgPlan } from "./planService";

async function persist(orgId: number, kind: "threshold" | "anomaly", threshold: number, periodKey: string, details: Record<string, unknown>): Promise<CreditAlert | null> {
  const [row] = await db.insert(creditAlertsTable)
    .values({ orgId, kind, threshold, periodKey, details })
    .onConflictDoNothing().returning();
  if (!row) return null; // ya se avisó en este periodo
  await logAuditSystem({
    actorClerkId: "system", action: `credits_alert_${kind}`, resource: "credit_alerts", resourceId: row.id, orgId,
    details: { threshold, periodKey, ...details }, severity: "warning",
  });
  return row;
}

/** Avisa cuando el consumo del mes cruza un umbral del plan (% del tope mensual, o de los créditos incluidos). */
export async function checkThresholdAlerts(orgId: number, at: Date = new Date()): Promise<CreditAlert[]> {
  const { plan } = await resolveOrgPlan(orgId, db, at);
  const cfg = plan ? await getPlanConfig(plan) : null;
  if (!cfg || !cfg.active || cfg.alertThresholds.length === 0) return [];
  const base = cfg.monthlyLimit ?? cfg.includedCredits;
  if (!base || base <= 0) return [];

  const month = monthBounds(at);
  const consumed = await consumedBetween(db, orgId, month.start, month.end);
  const pct = (consumed / base) * 100;

  const created: CreditAlert[] = [];
  for (const t of cfg.alertThresholds.filter((x) => pct >= x)) {
    const alert = await persist(orgId, "threshold", t, month.key, { plan, consumed, base, pct: Math.round(pct * 10) / 10 });
    if (alert) created.push(alert);
  }
  return created;
}

// Heurística de ingeniería, no un valor comercial: hoy frente a la media diaria
// de los días anteriores. Los tres números son ajustables por quien llame.
export const ANOMALY_DEFAULTS = { factor: 3, minCredits: 50, lookbackDays: 7 } as const;

export interface Anomaly { orgId: number; today: number; dailyAverage: number; ratio: number | null }

export async function detectAnomalies(opts: { orgIds?: number[]; at?: Date; factor?: number; minCredits?: number; lookbackDays?: number } = {}): Promise<Anomaly[]> {
  const at = opts.at ?? new Date();
  const factor = opts.factor ?? ANOMALY_DEFAULTS.factor;
  const minCredits = opts.minCredits ?? ANOMALY_DEFAULTS.minCredits;
  const lookback = opts.lookbackDays ?? ANOMALY_DEFAULTS.lookbackDays;
  const today = dayBounds(at);
  const from = new Date(today.start.getTime() - lookback * 24 * 60 * 60 * 1000);

  const orgFilter = opts.orgIds?.length ? sql`and ${creditLedgerTable.orgId} in (${sql.join(opts.orgIds.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const rows = await db.execute(sql`
    select ${creditLedgerTable.orgId} as org_id,
      coalesce(sum(-${creditLedgerTable.credits}) filter (where ${creditLedgerTable.createdAt} >= ${today.start} and ${creditLedgerTable.createdAt} < ${today.end}), 0) as today,
      coalesce(sum(-${creditLedgerTable.credits}) filter (where ${creditLedgerTable.createdAt} >= ${from} and ${creditLedgerTable.createdAt} < ${today.start}), 0) as previous
    from ${creditLedgerTable}
    where ${creditLedgerTable.entryType} = 'consumption' and ${creditLedgerTable.createdAt} >= ${from} ${orgFilter}
    group by ${creditLedgerTable.orgId}`);

  return (rows.rows as Array<{ org_id: number; today: string; previous: string }>)
    .map((r) => {
      const t = Number(r.today), avg = Number(r.previous) / lookback;
      return { orgId: Number(r.org_id), today: t, dailyAverage: avg, ratio: avg > 0 ? t / avg : null };
    })
    .filter((a) => a.today >= minCredits && (a.ratio === null || a.ratio > factor));
}

/** Detecta y registra (una vez al día por org) las alertas de consumo anómalo. */
export async function raiseAnomalyAlerts(opts: Parameters<typeof detectAnomalies>[0] = {}): Promise<CreditAlert[]> {
  const day = dayBounds(opts.at).key;
  const raised: CreditAlert[] = [];
  for (const a of await detectAnomalies(opts)) {
    const alert = await persist(a.orgId, "anomaly", 0, day, { today: a.today, dailyAverage: a.dailyAverage, ratio: a.ratio });
    if (alert) raised.push(alert);
  }
  return raised;
}

export async function listAlerts(orgId: number, opts: { since?: Date; limit?: number } = {}) {
  return db.select().from(creditAlertsTable)
    .where(and(eq(creditAlertsTable.orgId, orgId), opts.since ? gte(creditAlertsTable.createdAt, opts.since) : undefined))
    .orderBy(sql`${creditAlertsTable.id} desc`).limit(opts.limit ?? 50);
}
