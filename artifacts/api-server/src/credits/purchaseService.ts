// OmniCredits EXTRA: compras de créditos independientes del plan.
//
// Una compra crea su fila en credit_purchases y su movimiento PURCHASE en el
// ledger en la misma transacción. Sin integración de pago: paymentReference es
// solo la referencia externa (y la clave de idempotencia si se informa).
//
// Caducidad: expiresAt se guarda y se puede consultar (listPurchasesDueForExpiry),
// pero NO se descuenta automáticamente. Repartir el consumo entre créditos que
// caducan y los que no es una decisión de negocio pendiente; mientras tanto la
// caducidad se aplica de forma explícita con expirePurchase().

import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { db, creditPurchasesTable, creditLedgerTable, type CreditPurchase } from "@workspace/db";
import { CreditError } from "./errors";
import { insertEntry } from "./creditService";

export interface PurchaseInput {
  orgId:            number;
  credits:          number;
  priceAmount?:     number | null;
  currency?:        string;
  paymentReference?: string | null;
  expiresAt?:       Date | null;
  purchasedAt?:     Date;
  userClerkId?:     string | null;
  metadata?:        Record<string, unknown>;
}

export async function recordPurchase(input: PurchaseInput) {
  if (!Number.isFinite(input.credits) || input.credits <= 0) throw new CreditError("credits debe ser mayor que 0.");
  if (input.priceAmount != null && (!Number.isFinite(input.priceAmount) || input.priceAmount < 0)) throw new CreditError("priceAmount no es válido.");
  if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) throw new CreditError("currency debe ser un código de 3 letras.");
  if (input.expiresAt && input.expiresAt <= (input.purchasedAt ?? new Date())) throw new CreditError("expiresAt debe ser posterior a la fecha de compra.");

  return db.transaction(async (tx) => {
    if (input.paymentReference) {
      const [existing] = await tx.select().from(creditPurchasesTable)
        .where(and(eq(creditPurchasesTable.orgId, input.orgId), eq(creditPurchasesTable.paymentReference, input.paymentReference)));
      if (existing) return { purchase: existing, entry: null, duplicate: true };
    }
    const [purchase] = await tx.insert(creditPurchasesTable).values({
      orgId: input.orgId, credits: input.credits.toFixed(4),
      priceAmount: input.priceAmount != null ? input.priceAmount.toFixed(2) : null,
      currency: input.currency ?? "EUR", purchasedAt: input.purchasedAt ?? new Date(), expiresAt: input.expiresAt ?? null,
      paymentReference: input.paymentReference ?? null, createdBy: input.userClerkId ?? null, metadata: input.metadata ?? null,
    }).returning();
    const { entry } = await insertEntry(tx, {
      orgId: input.orgId, type: "purchase", credits: input.credits, reference: `purchase:${purchase!.id}`,
      source: "purchase", userClerkId: input.userClerkId ?? null,
      metadata: { purchaseId: purchase!.id, priceAmount: input.priceAmount ?? null, currency: input.currency ?? "EUR", paymentReference: input.paymentReference ?? null },
    });
    await tx.update(creditPurchasesTable).set({ ledgerEntryId: entry.id }).where(eq(creditPurchasesTable.id, purchase!.id));
    return { purchase: { ...purchase!, ledgerEntryId: entry.id } as CreditPurchase, entry, duplicate: false };
  });
}

/** Anula una compra (p. ej. reembolso del pago): marca la compra y descuenta sus créditos con un AJUSTE negativo. */
export async function reversePurchase(orgId: number, purchaseId: number, o: { reason: string; userClerkId?: string | null }) {
  if (!o.reason?.trim()) throw new CreditError("Anular una compra requiere un motivo.");
  return db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(creditPurchasesTable)
      .where(and(eq(creditPurchasesTable.id, purchaseId), eq(creditPurchasesTable.orgId, orgId))).for("update");
    if (!purchase) throw new CreditError("Compra no encontrada.");
    if (purchase.status === "reversed") throw new CreditError("La compra ya estaba anulada.");
    await tx.update(creditPurchasesTable).set({ status: "reversed" }).where(eq(creditPurchasesTable.id, purchaseId));
    const { entry } = await insertEntry(tx, {
      orgId, type: "adjustment", credits: -Number(purchase.credits), reference: `purchase-reversal:${purchaseId}`,
      source: "purchase", userClerkId: o.userClerkId ?? null, metadata: { reason: o.reason, purchaseId },
    });
    return { purchase: { ...purchase, status: "reversed" }, entry };
  });
}

export const listPurchases = (orgId: number, limit = 50) =>
  db.select().from(creditPurchasesTable).where(eq(creditPurchasesTable.orgId, orgId)).orderBy(desc(creditPurchasesTable.id)).limit(limit);

/** Compras con fecha de caducidad ya vencida y sin movimiento de caducidad registrado. */
export async function listPurchasesDueForExpiry(at: Date = new Date(), orgId?: number) {
  const due = await db.select().from(creditPurchasesTable)
    .where(and(eq(creditPurchasesTable.status, "completed"), isNotNull(creditPurchasesTable.expiresAt), lte(creditPurchasesTable.expiresAt, at),
      orgId !== undefined ? eq(creditPurchasesTable.orgId, orgId) : undefined));
  const expired = await db.select({ ref: creditLedgerTable.reference }).from(creditLedgerTable).where(eq(creditLedgerTable.entryType, "expiration"));
  const done = new Set(expired.map((e) => e.ref));
  return due.filter((p) => !done.has(`purchase-expiry:${p.id}`));
}

/** Aplica la caducidad de una compra con la cantidad que decida quien llama (la política de reparto es de negocio). */
export async function expirePurchase(orgId: number, purchaseId: number, credits: number, o: { reason: string; userClerkId?: string | null }) {
  const [purchase] = await db.select().from(creditPurchasesTable)
    .where(and(eq(creditPurchasesTable.id, purchaseId), eq(creditPurchasesTable.orgId, orgId)));
  if (!purchase) throw new CreditError("Compra no encontrada.");
  return db.transaction((tx) => insertEntry(tx, {
    orgId, type: "expiration", credits: -Math.abs(credits), reference: `purchase-expiry:${purchaseId}`,
    source: "expiration", userClerkId: o.userClerkId ?? null, metadata: { reason: o.reason, purchaseId },
  }));
}
