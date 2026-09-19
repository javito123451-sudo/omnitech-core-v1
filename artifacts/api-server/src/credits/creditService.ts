// ═══════════════════════════════════════════════════════════════════════════
//  OmniCredits — ledger service
//
//  Commercial record of AI consumption, independent of ai_usage_logs (which
//  stays the technical record). Every change goes through appendEntry(): one
//  transaction that locks the org's account, inserts an immutable ledger row
//  and updates the cached balance. Corrections are new entries (adjustment /
//  refund), never edits — the database trigger in migration 0005 enforces it.
//
//  Consumption may take the balance below zero by the difference between the
//  pre-call estimate and the real cost: the service was already rendered, so
//  the real cost is always recorded. What is blocked is STARTING a paid
//  operation without enough credits (see the AI Gateway preflight).
// ═══════════════════════════════════════════════════════════════════════════

import { db, creditAccountsTable, creditLedgerTable, type CreditEntryType, type CreditLedgerEntry } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export class CreditError extends Error {
  constructor(message: string) { super(message); this.name = "CreditError"; }
}

export class InsufficientCreditsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super(`Créditos insuficientes: saldo ${balance}, se necesitan ~${required}.`);
    this.name = "InsufficientCreditsError";
  }
}

export interface EntryInput {
  orgId:             number;
  type:              CreditEntryType;
  /** Con signo: positivo suma, negativo resta. */
  credits:           number;
  agentId?:          number | null;
  agentVersionId?:   number | null;
  userClerkId?:      string | null;
  provider?:         string | null;
  model?:            string | null;
  technicalCostUsd?: number | null;
  estimatedCredits?: number | null;
  usageLogId?:       number | null;
  reference?:        string | null;
  source?:           string;
  metadata?:         Record<string, unknown>;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

function validate(input: EntryInput) {
  if (!Number.isFinite(input.credits) || input.credits === 0) throw new CreditError("El importe de créditos no es válido.");
  const positive = input.credits > 0;
  if (input.type === "usage" && positive) throw new CreditError("El consumo debe restar créditos.");
  if ((input.type === "grant" || input.type === "topup" || input.type === "refund") && !positive) {
    throw new CreditError(`Un movimiento '${input.type}' debe sumar créditos.`);
  }
  if ((input.type === "adjustment" || input.type === "refund") && !String(input.metadata?.["reason"] ?? "").trim()) {
    throw new CreditError(`Un movimiento '${input.type}' requiere un motivo (metadata.reason).`);
  }
}

export async function appendEntry(input: EntryInput): Promise<{ entry: CreditLedgerEntry; balance: number; duplicate: boolean }> {
  validate(input);
  const credits = round4(input.credits);

  return db.transaction(async (tx) => {
    await tx.insert(creditAccountsTable).values({ orgId: input.orgId }).onConflictDoNothing();
    const [account] = await tx.select().from(creditAccountsTable)
      .where(eq(creditAccountsTable.orgId, input.orgId)).for("update");

    if (input.reference) {
      const [existing] = await tx.select().from(creditLedgerTable)
        .where(and(eq(creditLedgerTable.orgId, input.orgId), eq(creditLedgerTable.reference, input.reference)));
      if (existing) return { entry: existing, balance: Number(account!.balance), duplicate: true };
    }

    const balance = round4(Number(account!.balance) + credits);
    const [entry] = await tx.insert(creditLedgerTable).values({
      orgId: input.orgId,
      accountId: account!.id,
      entryType: input.type,
      credits: credits.toFixed(4),
      balanceAfter: balance.toFixed(4),
      agentId: input.agentId ?? null,
      agentVersionId: input.agentVersionId ?? null,
      userClerkId: input.userClerkId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      technicalCostUsd: input.technicalCostUsd != null ? input.technicalCostUsd.toFixed(6) : null,
      estimatedCredits: input.estimatedCredits != null ? round4(input.estimatedCredits).toFixed(4) : null,
      usageLogId: input.usageLogId ?? null,
      reference: input.reference ?? null,
      source: input.source ?? "system",
      metadata: input.metadata ?? null,
    }).returning();
    await tx.update(creditAccountsTable)
      .set({ balance: balance.toFixed(4), updatedAt: new Date() })
      .where(eq(creditAccountsTable.id, account!.id));
    return { entry: entry!, balance, duplicate: false };
  });
}

// ── Movimientos de alta / ajuste ─────────────────────────────────────────────

interface AdminEntryOptions { userClerkId?: string | null; reference?: string | null; source?: string; reason?: string; metadata?: Record<string, unknown> }

const admin = (type: CreditEntryType, orgId: number, credits: number, o: AdminEntryOptions = {}) =>
  appendEntry({
    orgId, type, credits, userClerkId: o.userClerkId, reference: o.reference,
    source: o.source ?? "manual", metadata: { ...(o.metadata ?? {}), ...(o.reason ? { reason: o.reason } : {}) },
  });

/** Créditos incluidos en un plan. */
export const grantCredits = (orgId: number, credits: number, o?: AdminEntryOptions) => admin("grant", orgId, credits, { source: "plan", ...o });
/** Recarga / créditos adicionales. */
export const topUpCredits = (orgId: number, credits: number, o?: AdminEntryOptions) => admin("topup", orgId, credits, o);
/** Ajuste manual (con signo). Requiere motivo. */
export const adjustCredits = (orgId: number, credits: number, o: AdminEntryOptions & { reason: string }) => admin("adjustment", orgId, credits, o);
/** Devolución de créditos. Requiere motivo. */
export const refundCredits = (orgId: number, credits: number, o: AdminEntryOptions & { reason: string }) => admin("refund", orgId, credits, o);

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function getBalance(orgId: number): Promise<number> {
  const [account] = await db.select({ balance: creditAccountsTable.balance }).from(creditAccountsTable)
    .where(eq(creditAccountsTable.orgId, orgId));
  return account ? Number(account.balance) : 0;
}

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export async function getAgentMonthUsage(orgId: number, agentId: number): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(-${creditLedgerTable.credits}), 0)` })
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.agentId, agentId),
      eq(creditLedgerTable.entryType, "usage"), gte(creditLedgerTable.createdAt, monthStart()),
    ));
  return Number(row?.total ?? 0);
}

export async function listLedger(orgId: number, opts: { limit?: number; agentId?: number } = {}) {
  return db.select().from(creditLedgerTable)
    .where(opts.agentId ? and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.agentId, opts.agentId)) : eq(creditLedgerTable.orgId, orgId))
    .orderBy(desc(creditLedgerTable.id))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function getSummary(orgId: number) {
  const since = monthStart();
  const usageWhere = and(eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.entryType, "usage"), gte(creditLedgerTable.createdAt, since));
  const [byAgent, byModel] = await Promise.all([
    db.select({ agentId: creditLedgerTable.agentId, credits: sql<string>`sum(-${creditLedgerTable.credits})`, technicalCostUsd: sql<string>`sum(${creditLedgerTable.technicalCostUsd})` })
      .from(creditLedgerTable).where(usageWhere).groupBy(creditLedgerTable.agentId),
    db.select({ provider: creditLedgerTable.provider, model: creditLedgerTable.model, credits: sql<string>`sum(-${creditLedgerTable.credits})`, technicalCostUsd: sql<string>`sum(${creditLedgerTable.technicalCostUsd})` })
      .from(creditLedgerTable).where(usageWhere).groupBy(creditLedgerTable.provider, creditLedgerTable.model),
  ]);
  const num = (v: string | null) => Number(v ?? 0);
  return {
    balance: await getBalance(orgId),
    month: {
      credits: byAgent.reduce((s, r) => s + num(r.credits), 0),
      byAgent: byAgent.map((r) => ({ agentId: r.agentId, credits: num(r.credits), technicalCostUsd: num(r.technicalCostUsd) })),
      byModel: byModel.map((r) => ({ provider: r.provider, model: r.model, credits: num(r.credits), technicalCostUsd: num(r.technicalCostUsd) })),
    },
  };
}

// ── Puerto que usa el AI Gateway ─────────────────────────────────────────────

export interface UsageEntryInput {
  orgId: number; credits: number; agentId?: number | null; agentVersionId?: number | null;
  userClerkId?: string | null; provider: string; model: string; technicalCostUsd: number;
  estimatedCredits?: number | null; usageLogId?: number | null; reference: string; metadata?: Record<string, unknown>;
}

export interface CreditsPort {
  getBalance(orgId: number): Promise<number>;
  getAgentMonthUsage(orgId: number, agentId: number): Promise<number>;
  recordUsage(input: UsageEntryInput): Promise<void>;
}

export const creditsPort: CreditsPort = {
  getBalance,
  getAgentMonthUsage,
  async recordUsage(input) {
    if (!(input.credits > 0)) return; // una operación sin coste no genera movimiento
    await appendEntry({ ...input, type: "usage", credits: -Math.abs(input.credits), source: "usage" });
  },
};
