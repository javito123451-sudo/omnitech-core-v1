// ═══════════════════════════════════════════════════════════════════════════
//  Credit plans — configurable commercial rules per plan.
//
//  The commercial values of each plan (price, included credits, daily limit, rollover,
//  alerts) live in credit_plans, seeded by migration 0008 and editable from Super Admin.
//  A NULL field means "not configured" (no limit / no included credits); ENTERPRISE
//  is custom, so its values stay NULL until they are agreed per customer.
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
import { AgentCreditLimitReachedError, CreditError, CreditLimitReachedError } from "./errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

export interface PlanConfig {
  plan:                 string;
  includedCredits:      number | null;
  monthlyLimit:         number | null;
  dailyLimit:           number | null;
  perAgentMonthlyLimit: number | null;
  rollover:             boolean;
  /** % de los créditos incluidos sin consumir que pasa al ciclo siguiente (0-100). null = usa solo `rollover` (todo el sobrante). */
  rolloverPct:          number | null;
  rolloverCap:          number | null;
  blockAtLimit:         boolean;
  alertThresholds:      number[];
  active:               boolean;
  displayName:          string | null;
  priceAmount:          number | null;
  currency:             string;
  /** Precio a medida (Enterprise): no hay precio de catálogo. */
  priceCustom:          boolean;
  agentLimit:           number | null;
  workspaceLimit:       number | null;
}

/**
 * Cuánto de lo incluido sin consumir pasa como rollover. Con rolloverPct manda el porcentaje;
 * sin él, el booleano `rollover` conserva todo el sobrante. En ambos casos rolloverCap acota.
 */
export function rolloverCarry(cfg: Pick<PlanConfig, "rollover" | "rolloverPct" | "rolloverCap">, leftover: number): number {
  const pct = cfg.rolloverPct !== null ? cfg.rolloverPct / 100 : cfg.rollover ? 1 : 0;
  if (!(leftover > 0) || pct <= 0) return 0;
  const carried = Math.round(leftover * pct * 1e4) / 1e4;
  return cfg.rolloverCap !== null ? Math.min(carried, cfg.rolloverCap) : carried;
}

const n = (v: string | null): number | null => (v === null ? null : Number(v));

export const toPlanConfig = (r: CreditPlan): PlanConfig => ({
  plan: r.plan, includedCredits: n(r.includedCredits), monthlyLimit: n(r.monthlyLimit), dailyLimit: n(r.dailyLimit),
  perAgentMonthlyLimit: n(r.perAgentMonthlyLimit), rollover: r.rollover, rolloverPct: n(r.rolloverPct), rolloverCap: n(r.rolloverCap),
  displayName: r.displayName, priceAmount: n(r.priceAmount), currency: r.currency, priceCustom: r.priceCustom,
  agentLimit: r.agentLimit, workspaceLimit: r.workspaceLimit,
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
  if (patch.rolloverPct !== undefined && patch.rolloverPct !== null && (!Number.isFinite(patch.rolloverPct) || patch.rolloverPct < 0 || patch.rolloverPct > 100)) {
    throw new CreditError("rolloverPct debe estar entre 0 y 100 (o null).");
  }
  if (patch.priceAmount !== undefined && patch.priceAmount !== null && (!Number.isFinite(patch.priceAmount) || patch.priceAmount < 0)) {
    throw new CreditError("priceAmount debe ser un número mayor o igual que 0 (o null).");
  }
  if (patch.currency !== undefined && !/^[A-Z]{3}$/.test(patch.currency)) throw new CreditError("currency debe ser un código de 3 letras.");
  for (const f of ["agentLimit", "workspaceLimit"] as const) {
    const v = patch[f];
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) throw new CreditError(`${f} debe ser un entero mayor o igual que 0 (o null).`);
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
      ...(patch.rolloverPct !== undefined ? { rolloverPct: patch.rolloverPct === null ? null : patch.rolloverPct.toFixed(2) } : {}),
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.priceAmount !== undefined ? { priceAmount: patch.priceAmount === null ? null : patch.priceAmount.toFixed(2) } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.priceCustom !== undefined ? { priceCustom: patch.priceCustom } : {}),
      ...(patch.agentLimit !== undefined ? { agentLimit: patch.agentLimit } : {}),
      ...(patch.workspaceLimit !== undefined ? { workspaceLimit: patch.workspaceLimit } : {}),
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
  /**
   * Presupuestos propios del agente (ai_agents): mensual, diario y por ejecución. Aplican aunque el
   * plan no esté configurado. NULL/ausente = sin tope. executionUsed = créditos ya gastados en la
   * ejecución en curso (varias llamadas al gateway pueden formar una misma ejecución).
   */
  agentLimits?: { monthly?: number | null; daily?: number | null; perExecution?: number | null; executionUsed?: number };
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
    const lim = input.agentLimits ?? {};
    // Por ejecución: no hace falta consultar nada, se acumula en la propia ejecución.
    if (lim.perExecution != null) {
      const used = lim.executionUsed ?? 0;
      if (used + input.credits > lim.perExecution) throw new AgentCreditLimitReachedError("agent_execution", used, lim.perExecution, input.credits);
    }
    if (lim.daily != null) {
      const used = await consumedBetween(tx, input.orgId, day.start, day.end, input.agentId);
      if (used + input.heldAgent + input.credits > lim.daily) {
        throw new AgentCreditLimitReachedError("agent_daily", used + input.heldAgent, lim.daily, input.credits);
      }
    }
    const monthlyCaps = [lim.monthly ?? null, enforce ? cfg.perAgentMonthlyLimit : null].filter((c): c is number => c !== null);
    if (monthlyCaps.length > 0) {
      const cap = Math.min(...monthlyCaps);
      const used = await consumedBetween(tx, input.orgId, month.start, month.end, input.agentId);
      if (used + input.heldAgent + input.credits > cap) {
        throw new AgentCreditLimitReachedError("agent_monthly", used + input.heldAgent, cap, input.credits);
      }
    }
  }
}
