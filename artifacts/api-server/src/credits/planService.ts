// ═══════════════════════════════════════════════════════════════════════════
//  Credit plans — configurable commercial rules per plan.
//
//  NOTHING here has a default commercial value: credit_plans starts empty and
//  a NULL field means "not configured" (no limit / no included credits). Until
//  business fills it in, the limit checks below are inert.
//
//  The plan of a workspace is resolved from what already exists: an active
//  license (license_plans) wins, otherwise organizations.plan.
//
//  This file imports no ledger code, so creditService can use it without a cycle.
// ═══════════════════════════════════════════════════════════════════════════

import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  db, creditPlansTable, creditLedgerTable, licensePlansTable, organizationsTable,
  type CreditPlan, type LicensePlan,
} from "@workspace/db";
import { CreditError, CreditLimitReachedError } from "./errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

export interface PlanConfig {
  plan:                 string;
  includedCredits:      number | null;
  monthlyLimit:         number | null;
  dailyLimit:           number | null;
  perAgentMonthlyLimit: number | null;
  rollover:             boolean;
  rolloverCap:          number | null;
  blockAtLimit:         boolean;
  alertThresholds:      number[];
  active:               boolean;
}

const n = (v: string | null): number | null => (v === null ? null : Number(v));

export const toPlanConfig = (r: CreditPlan): PlanConfig => ({
  plan: r.plan, includedCredits: n(r.includedCredits), monthlyLimit: n(r.monthlyLimit), dailyLimit: n(r.dailyLimit),
  perAgentMonthlyLimit: n(r.perAgentMonthlyLimit), rollover: r.rollover, rolloverCap: n(r.rolloverCap),
  blockAtLimit: r.blockAtLimit, alertThresholds: (r.alertThresholds as number[]) ?? [], active: r.active,
});

// ── Periodos (UTC, mes natural) ──────────────────────────────────────────────

export function monthBounds(at: Date = new Date()) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end, key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}` };
}

export function dayBounds(at: Date = new Date()) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: start.toISOString().slice(0, 10) };
}

// ── Configuración ────────────────────────────────────────────────────────────

export async function getPlanConfig(plan: string, conn: Db = db): Promise<PlanConfig | null> {
  const [row] = await conn.select().from(creditPlansTable).where(eq(creditPlansTable.plan, plan));
  return row ? toPlanConfig(row) : null;
}

export async function listPlanConfigs(): Promise<PlanConfig[]> {
  return (await db.select().from(creditPlansTable).orderBy(creditPlansTable.plan)).map(toPlanConfig);
}

export type PlanPatch = Partial<Omit<PlanConfig, "plan">>;

const AMOUNT_FIELDS = ["includedCredits", "monthlyLimit", "dailyLimit", "perAgentMonthlyLimit", "rolloverCap"] as const;

function validatePatch(patch: PlanPatch) {
  for (const f of AMOUNT_FIELDS) {
    const v = patch[f];
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(v) || v < 0) throw new CreditError(`${f} debe ser un número mayor o igual que 0 (o null = sin configurar).`);
  }
  if (patch.alertThresholds !== undefined) {
    const t = patch.alertThresholds;
    if (!Array.isArray(t) || t.some((x) => !Number.isInteger(x) || x < 1 || x > 1000)) {
      throw new CreditError("alertThresholds debe ser una lista de porcentajes enteros entre 1 y 1000.");
    }
  }
}

const d = (v: number | null): string | null => (v === null ? null : v.toFixed(4));

/** Crea o actualiza la configuración de un plan. Devuelve antes y después, para poder auditarlo. */
export async function upsertPlanConfig(plan: string, patch: PlanPatch, userClerkId: string | null) {
  if (!plan.trim()) throw new CreditError("plan es obligatorio.");
  validatePatch(patch);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(creditPlansTable).where(eq(creditPlansTable.plan, plan)).for("update");
    const set = {
      ...(patch.includedCredits !== undefined ? { includedCredits: d(patch.includedCredits) } : {}),
      ...(patch.monthlyLimit !== undefined ? { monthlyLimit: d(patch.monthlyLimit) } : {}),
      ...(patch.dailyLimit !== undefined ? { dailyLimit: d(patch.dailyLimit) } : {}),
      ...(patch.perAgentMonthlyLimit !== undefined ? { perAgentMonthlyLimit: d(patch.perAgentMonthlyLimit) } : {}),
      ...(patch.rolloverCap !== undefined ? { rolloverCap: d(patch.rolloverCap) } : {}),
      ...(patch.rollover !== undefined ? { rollover: patch.rollover } : {}),
      ...(patch.blockAtLimit !== undefined ? { blockAtLimit: patch.blockAtLimit } : {}),
      ...(patch.alertThresholds !== undefined ? { alertThresholds: [...new Set(patch.alertThresholds)].sort((a, b) => a - b) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedBy: userClerkId, updatedAt: new Date(),
    };
    const [saved] = existing
      ? await tx.update(creditPlansTable).set(set).where(eq(creditPlansTable.id, existing.id)).returning()
      : await tx.insert(creditPlansTable).values({ plan, ...set }).returning();
    return { previous: existing ? toPlanConfig(existing) : null, current: toPlanConfig(saved!) };
  });
}

// ── Plan de un workspace ─────────────────────────────────────────────────────

export async function resolveOrgPlan(orgId: number, conn: Db = db, at: Date = new Date()): Promise<{ plan: string | null; license: LicensePlan | null }> {
  const [license] = await conn.select().from(licensePlansTable)
    .where(and(eq(licensePlansTable.orgId, orgId), eq(licensePlansTable.isActive, true)));
  if (license && (!license.validUntil || license.validUntil > at)) return { plan: license.plan, license };
  const [org] = await conn.select({ plan: organizationsTable.plan }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return { plan: org?.plan ?? null, license: null };
}

// ── Consumo acumulado (siempre desde el ledger) ──────────────────────────────

export async function consumedBetween(conn: Db, orgId: number, from: Date, to: Date, agentId?: number): Promise<number> {
  const [row] = await conn.select({ total: sql<string>`coalesce(sum(-${creditLedgerTable.credits}), 0)` })
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.entryType, "consumption"),
      gte(creditLedgerTable.createdAt, from), lt(creditLedgerTable.createdAt, to),
      agentId !== undefined ? eq(creditLedgerTable.agentId, agentId) : undefined,
    ));
  return Number(row?.total ?? 0);
}

// ── Límites en el momento de reservar ────────────────────────────────────────

export interface LimitCheckInput {
  orgId:     number;
  agentId?:  number | null;
  /** Créditos que la operación quiere reservar. */
  credits:   number;
  /** Tope propio del agente (ai_agents.monthly_credit_limit). Aplica aunque el plan no esté configurado. */
  agentCap?: number | null;
  /** Reservas vigentes de la org y del agente (las calcula el llamador dentro de la misma transacción). */
  heldOrg:   number;
  heldAgent: number;
  at?:       Date;
}

/**
 * Comprueba los límites de consumo (mensual, diario, por agente). Se ejecuta
 * dentro de la transacción de reserva, con la cuenta bloqueada, así que dos
 * peticiones simultáneas no pueden pasar a la vez por debajo de un límite.
 * Un límite que no está configurado (NULL) no se comprueba. Si el plan tiene
 * blockAtLimit=false, el límite no bloquea (solo alerta, en otro punto).
 */
export async function checkReserveLimits(tx: Tx, input: LimitCheckInput): Promise<void> {
  const at = input.at ?? new Date();
  const { plan } = await resolveOrgPlan(input.orgId, tx, at);
  const cfg = plan ? await getPlanConfig(plan, tx) : null;
  const enforce = cfg && cfg.active && cfg.blockAtLimit;

  const month = monthBounds(at);
  const day = dayBounds(at);

  if (enforce && cfg.monthlyLimit !== null) {
    const used = await consumedBetween(tx, input.orgId, month.start, month.end);
    if (used + input.heldOrg + input.credits > cfg.monthlyLimit) {
      throw new CreditLimitReachedError("workspace_monthly", used + input.heldOrg, cfg.monthlyLimit, input.credits);
    }
  }
  if (enforce && cfg.dailyLimit !== null) {
    const used = await consumedBetween(tx, input.orgId, day.start, day.end);
    if (used + input.heldOrg + input.credits > cfg.dailyLimit) {
      throw new CreditLimitReachedError("workspace_daily", used + input.heldOrg, cfg.dailyLimit, input.credits);
    }
  }

  if (input.agentId != null) {
    const caps = [
      input.agentCap ?? null,
      enforce ? cfg.perAgentMonthlyLimit : null,
    ].filter((c): c is number => c !== null);
    if (caps.length > 0) {
      const cap = Math.min(...caps);
      const used = await consumedBetween(tx, input.orgId, month.start, month.end, input.agentId);
      if (used + input.heldAgent + input.credits > cap) {
        throw new CreditLimitReachedError("agent_monthly", used + input.heldAgent, cap, input.credits);
      }
    }
  }
}
