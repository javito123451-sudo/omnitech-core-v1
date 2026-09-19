// ═══════════════════════════════════════════════════════════════════════════
//  OmniCredits — commercial ledger service
//
//  The ledger is the single source of truth for the commercial balance, and
//  the DATABASE enforces its integrity (triggers + CHECKs in migrations 0005
//  and 0006): rows are append-only, each one chains balance_before →
//  balance_after, and credit_accounts.balance changes only as a consequence of
//  inserting a ledger row. This service therefore has no "set balance" path:
//  there isn't one to call.
//
//  Concurrency: every write locks the org's account row (FOR UPDATE) inside one
//  transaction. Paid AI calls additionally RESERVE their estimated cost first
//  (reserveCredits), so two simultaneous requests can never spend more than is
//  available: the second one sees the first one's reservation and is refused
//  with INSUFFICIENT_CREDITS before any provider is called.
//
//  Real consumption may exceed the reservation (the estimate is approximate);
//  the real cost is always recorded and the overrun is flagged. What is refused
//  is STARTING a paid operation without enough available credits.
// ═══════════════════════════════════════════════════════════════════════════

import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import {
  db, creditAccountsTable, creditHoldsTable, creditLedgerTable,
  type CreditAccount, type CreditEntryType, type CreditLedgerEntry,
} from "@workspace/db";
import { HOLD_TTL_MS } from "../ai-gateway/pricing";
import { checkThresholdAlerts } from "./alerts";
import { CreditError, DuplicateRequestError, InsufficientCreditsError, ReferenceConflictError } from "./errors";
import { checkReserveLimits, monthBounds, type Tx } from "./planService";

export { CreditError, InsufficientCreditsError, CreditLimitReachedError, DuplicateRequestError, ReferenceConflictError } from "./errors";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const dec = (n: number) => round4(n).toFixed(4);

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

const POSITIVE: CreditEntryType[] = ["grant", "purchase", "subscription", "refund"];
const NEGATIVE: CreditEntryType[] = ["consumption", "expiration"];
const NEEDS_REASON: CreditEntryType[] = ["adjustment", "refund", "expiration"];
/**
 * Operaciones manuales: la referencia es la clave de idempotencia y es OBLIGATORIA,
 * para que un doble envío (doble clic, reintento) nunca genere un segundo movimiento.
 * El resto de tipos ya llevan la suya: consumo → requestId, compra → paymentReference,
 * suscripción → subscription:{org}:{YYYY-MM}, anulación/caducidad de compra → purchase-*:{id}.
 */
export const MANUAL_TYPES: CreditEntryType[] = ["grant", "adjustment", "refund", "expiration"];

function validate(input: EntryInput) {
  if (!Number.isFinite(input.credits) || round4(input.credits) === 0) throw new CreditError("El importe de créditos no es válido.");
  if (POSITIVE.includes(input.type) && input.credits < 0) throw new CreditError(`Un movimiento '${input.type}' debe sumar créditos.`);
  if (NEGATIVE.includes(input.type) && input.credits > 0) throw new CreditError(`Un movimiento '${input.type}' debe restar créditos.`);
  if (NEEDS_REASON.includes(input.type) && !String(input.metadata?.["reason"] ?? "").trim()) {
    throw new CreditError(`Un movimiento '${input.type}' requiere un motivo (metadata.reason).`);
  }
  if (MANUAL_TYPES.includes(input.type) && !String(input.reference ?? "").trim()) {
    throw new CreditError(`Un movimiento '${input.type}' requiere una referencia (clave de idempotencia) para que un doble envío no se aplique dos veces.`);
  }
}

async function ensureAccount(tx: Tx, orgId: number): Promise<CreditAccount> {
  await tx.insert(creditAccountsTable).values({ orgId }).onConflictDoNothing();
  const [account] = await tx.select().from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgId)).for("update");
  return account!;
}

/** Inserta un movimiento dentro de una transacción ya abierta. El saldo lo actualiza el trigger. */
export async function insertEntry(tx: Tx, input: EntryInput, account?: CreditAccount): Promise<{ entry: CreditLedgerEntry; balance: number; duplicate: boolean }> {
  validate(input);
  const acc = account ?? await ensureAccount(tx, input.orgId);

  if (input.reference) {
    const [existing] = await tx.select().from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.orgId, input.orgId), eq(creditLedgerTable.reference, input.reference)));
    if (existing) {
      // Mismo envío repetido → no hace nada. Misma referencia para OTRA operación manual → error claro,
      // nunca un descarte silencioso.
      if (MANUAL_TYPES.includes(input.type) && (existing.entryType !== input.type || round4(Number(existing.credits)) !== round4(input.credits))) {
        throw new ReferenceConflictError(input.reference, `${existing.entryType} ${existing.credits}, no ${input.type} ${dec(input.credits)}`);
      }
      return { entry: existing, balance: Number(acc.balance), duplicate: true };
    }
  }

  const credits = round4(input.credits);
  const before = Number(acc.balance);
  const after = round4(before + credits);
  const [entry] = await tx.insert(creditLedgerTable).values({
    orgId: input.orgId, accountId: acc.id, entryType: input.type,
    credits: dec(credits), balanceBefore: dec(before), balanceAfter: dec(after),
    agentId: input.agentId ?? null, agentVersionId: input.agentVersionId ?? null, userClerkId: input.userClerkId ?? null,
    provider: input.provider ?? null, model: input.model ?? null,
    technicalCostUsd: input.technicalCostUsd != null ? input.technicalCostUsd.toFixed(6) : null,
    estimatedCredits: input.estimatedCredits != null ? dec(input.estimatedCredits) : null,
    usageLogId: input.usageLogId ?? null, reference: input.reference ?? null,
    source: input.source ?? "system", metadata: input.metadata ?? null,
  }).returning();
  return { entry: entry!, balance: after, duplicate: false };
}

export async function appendEntry(input: EntryInput) {
  return db.transaction((tx) => insertEntry(tx, input));
}

// ── Movimientos comerciales ──────────────────────────────────────────────────

export interface EntryOptions {
  userClerkId?: string | null; reference?: string | null; source?: string; reason?: string;
  agentId?: number | null; metadata?: Record<string, unknown>;
}

const commercial = (type: CreditEntryType, orgId: number, credits: number, o: EntryOptions = {}) =>
  appendEntry({
    orgId, type, credits, userClerkId: o.userClerkId, reference: o.reference, agentId: o.agentId,
    source: o.source ?? "manual", metadata: { ...(o.metadata ?? {}), ...(o.reason ? { reason: o.reason } : {}) },
  });

/** GRANT: créditos concedidos (promoción, compensación…). */
export const grantCredits = (orgId: number, credits: number, o?: EntryOptions) => commercial("grant", orgId, credits, o);
/** PURCHASE: créditos comprados. Para el flujo completo con precio y caducidad, ver purchaseService. */
export const purchaseCredits = (orgId: number, credits: number, o?: EntryOptions) => commercial("purchase", orgId, credits, o);
/** ADJUSTMENT: ajuste manual con signo. Requiere motivo. */
export const adjustCredits = (orgId: number, credits: number, o: EntryOptions & { reason: string }) => commercial("adjustment", orgId, credits, o);
/** REFUND: devolución de créditos al workspace. Requiere motivo. */
export const refundCredits = (orgId: number, credits: number, o: EntryOptions & { reason: string }) => commercial("refund", orgId, credits, o);
/** EXPIRATION: créditos que caducan (se pasa la cantidad en positivo). Requiere motivo. */
export const expireCredits = (orgId: number, credits: number, o: EntryOptions & { reason: string }) => commercial("expiration", orgId, -Math.abs(credits), o);

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function getBalance(orgId: number): Promise<number> {
  const [account] = await db.select({ balance: creditAccountsTable.balance }).from(creditAccountsTable).where(eq(creditAccountsTable.orgId, orgId));
  return account ? Number(account.balance) : 0;
}

const heldSum = async (tx: Tx | typeof db, orgId: number, now: Date, agentId?: number) => {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${creditHoldsTable.credits}), 0)` }).from(creditHoldsTable)
    .where(and(
      eq(creditHoldsTable.orgId, orgId), eq(creditHoldsTable.status, "held"), gt(creditHoldsTable.expiresAt, now),
      agentId !== undefined ? eq(creditHoldsTable.agentId, agentId) : undefined,
    ));
  return Number(row?.total ?? 0);
};

/** Saldo menos lo reservado por peticiones en curso: lo que de verdad se puede gastar ahora. */
export async function getAvailable(orgId: number): Promise<{ balance: number; held: number; available: number }> {
  const balance = await getBalance(orgId);
  const held = await heldSum(db, orgId, new Date());
  return { balance, held, available: round4(balance - held) };
}

export async function getAgentMonthUsage(orgId: number, agentId: number): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(-${creditLedgerTable.credits}), 0)` }).from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.orgId, orgId), eq(creditLedgerTable.agentId, agentId),
      eq(creditLedgerTable.entryType, "consumption"), gte(creditLedgerTable.createdAt, monthBounds().start),
    ));
  return Number(row?.total ?? 0);
}

export async function listLedger(orgId: number, opts: { limit?: number; agentId?: number; type?: CreditEntryType } = {}) {
  return db.select().from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.orgId, orgId),
      opts.agentId ? eq(creditLedgerTable.agentId, opts.agentId) : undefined,
      opts.type ? eq(creditLedgerTable.entryType, opts.type) : undefined,
    ))
    .orderBy(desc(creditLedgerTable.id))
    .limit(Math.min(opts.limit ?? 50, 500));
}

export interface IntegrityReport { ok: boolean; issues: string[]; accountBalance: number; ledgerBalance: number; entries: number }

/** Recorre el ledger de la org y comprueba la cadena de saldos y que el saldo de la cuenta coincide con la suma. */
export async function verifyLedgerIntegrity(orgId: number): Promise<IntegrityReport> {
  const rows = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.orgId, orgId)).orderBy(creditLedgerTable.id);
  const issues: string[] = [];
  let running = 0;
  for (const r of rows) {
    if (round4(Number(r.balanceBefore)) !== round4(running)) issues.push(`#${r.id}: balance_before ${r.balanceBefore} ≠ saldo esperado ${running}`);
    if (round4(Number(r.balanceBefore) + Number(r.credits)) !== round4(Number(r.balanceAfter))) issues.push(`#${r.id}: balance_after no cuadra con balance_before + credits`);
    running = Number(r.balanceAfter);
  }
  const accountBalance = await getBalance(orgId);
  if (round4(accountBalance) !== round4(running)) issues.push(`El saldo de la cuenta (${accountBalance}) no coincide con el último saldo del ledger (${running})`);
  return { ok: issues.length === 0, issues, accountBalance, ledgerBalance: round4(running), entries: rows.length };
}

// ── Reserva / liquidación de una llamada de IA ───────────────────────────────

export interface ReserveInput {
  orgId:        number;
  credits:      number;
  /** Id de la petición: identifica la reserva y luego el movimiento de consumo (idempotencia). */
  reference:    string;
  agentId?:     number | null;
  userClerkId?: string | null;
  agentCap?:    number | null;
  ttlMs?:       number;
}

export async function reserveCredits(input: ReserveInput): Promise<{ holdId: number; credits: number; available: number }> {
  const credits = round4(input.credits);
  if (!(credits > 0)) throw new CreditError("La reserva debe ser mayor que 0.");

  return db.transaction(async (tx) => {
    const account = await ensureAccount(tx, input.orgId); // bloquea la cuenta: serializa las reservas de esta org
    const now = new Date();

    const [hold] = await tx.select().from(creditHoldsTable)
      .where(and(eq(creditHoldsTable.orgId, input.orgId), eq(creditHoldsTable.reference, input.reference))).for("update");
    const [consumed] = await tx.select({ id: creditLedgerTable.id }).from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.orgId, input.orgId), eq(creditLedgerTable.reference, input.reference)));
    if (consumed || (hold && hold.status !== "released")) throw new DuplicateRequestError(input.reference);

    const heldOrg = await heldSum(tx, input.orgId, now);
    const balance = Number(account.balance);
    const available = round4(balance - heldOrg);
    if (available < credits) throw new InsufficientCreditsError(balance, available, credits);

    const heldAgent = input.agentId != null ? await heldSum(tx, input.orgId, now, input.agentId) : 0;
    await checkReserveLimits(tx, { orgId: input.orgId, agentId: input.agentId, credits, agentCap: input.agentCap, heldOrg, heldAgent, at: now });

    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? HOLD_TTL_MS));
    const values = {
      orgId: input.orgId, accountId: account.id, credits: dec(credits), status: "held", reference: input.reference,
      agentId: input.agentId ?? null, userClerkId: input.userClerkId ?? null, expiresAt, settledCredits: null, updatedAt: now,
    };
    const [saved] = hold
      ? await tx.update(creditHoldsTable).set(values).where(eq(creditHoldsTable.id, hold.id)).returning()
      : await tx.insert(creditHoldsTable).values(values).returning();
    return { holdId: saved!.id, credits, available: round4(available - credits) };
  });
}

export interface SettleInput extends Omit<EntryInput, "type" | "credits" | "reference"> {
  reference: string;
  /** Créditos realmente consumidos (positivo). */
  credits:   number;
}

/**
 * Convierte una reserva en el consumo real: inserta el movimiento CONSUMPTION y
 * marca la reserva como liquidada, en una sola transacción. Idempotente por
 * referencia. Devuelve overrun=true si el consumo real superó lo reservado.
 */
export async function settleCredits(input: SettleInput): Promise<{ entry: CreditLedgerEntry | null; overrun: boolean; duplicate: boolean }> {
  const actual = round4(Math.abs(input.credits));
  return db.transaction(async (tx) => {
    const account = await ensureAccount(tx, input.orgId);
    const [hold] = await tx.select().from(creditHoldsTable)
      .where(and(eq(creditHoldsTable.orgId, input.orgId), eq(creditHoldsTable.reference, input.reference))).for("update");
    const overrun = !!hold && actual > Number(hold.credits);

    let entry: CreditLedgerEntry | null = null;
    let duplicate = false;
    if (actual > 0) {
      const res = await insertEntry(tx, {
        ...input, type: "consumption", credits: -actual, source: "usage",
        metadata: { ...(input.metadata ?? {}), ...(hold ? { reservedCredits: Number(hold.credits), overrun } : {}) },
      }, account);
      entry = res.entry; duplicate = res.duplicate;
    }
    if (hold && hold.status === "held") {
      await tx.update(creditHoldsTable).set({ status: "settled", settledCredits: dec(actual), updatedAt: new Date() }).where(eq(creditHoldsTable.id, hold.id));
    }
    return { entry, overrun, duplicate };
  });
}

/** Libera una reserva sin cobrar (la llamada falló). Devuelve false si no había reserva viva. */
export async function releaseHold(orgId: number, reference: string): Promise<boolean> {
  const rows = await db.update(creditHoldsTable).set({ status: "released", updatedAt: new Date() })
    .where(and(eq(creditHoldsTable.orgId, orgId), eq(creditHoldsTable.reference, reference), eq(creditHoldsTable.status, "held")))
    .returning({ id: creditHoldsTable.id });
  return rows.length > 0;
}

// ── Puerto que usa el AI Gateway ─────────────────────────────────────────────

export interface CreditsPort {
  reserve(input: ReserveInput): Promise<{ holdId: number; credits: number; available: number }>;
  settle(input: SettleInput): Promise<{ entry: CreditLedgerEntry | null; overrun: boolean; duplicate: boolean }>;
  release(orgId: number, reference: string): Promise<boolean>;
}

export const creditsPort: CreditsPort = {
  reserve: reserveCredits,
  release: releaseHold,
  async settle(input) {
    const result = await settleCredits(input);
    // Alertas de umbral: nunca deben afectar a la respuesta ya servida.
    void checkThresholdAlerts(input.orgId).catch((err) => console.error("[Credits] alertas:", err));
    return result;
  },
};
