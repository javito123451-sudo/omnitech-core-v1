// Consentimientos y bajas. Un consentimiento es un registro append-only con base jurídica
// y evidencia; revocar = marcar revoked_at (nunca borrar: es la prueba).
// Las bajas se escriben en outreach_suppressions (lista única del ecosistema), con
// source='omni_review', para que una baja valga también para OmniSeller y viceversa.
import { and, eq, isNull, or, inArray } from "drizzle-orm";
import { db, reviewConsentsTable, reviewContactsTable, reviewEventsTable, outreachSuppressionsTable, type ReviewChannel } from "@workspace/db";

export const LEGAL_BASES = ["consent", "existing_customer_relationship", "other"] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

type Tx = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export async function recordConsent(tx: Tx, p: {
  orgId: number; contactId: number; channel: ReviewChannel; legalBasis: LegalBasis; evidence?: string | null; source?: string | null; createdBy?: number | null;
}) {
  await tx.insert(reviewConsentsTable).values({
    orgId: p.orgId, contactId: p.contactId, channel: p.channel, legalBasis: p.legalBasis,
    evidence: p.evidence ?? null, source: p.source ?? null, createdBy: p.createdBy ?? null,
  });
}

export async function hasActiveConsent(orgId: number, contactId: number, channel: ReviewChannel): Promise<boolean> {
  const [row] = await db.select({ id: reviewConsentsTable.id }).from(reviewConsentsTable).where(and(
    eq(reviewConsentsTable.orgId, orgId), eq(reviewConsentsTable.contactId, contactId),
    eq(reviewConsentsTable.channel, channel), isNull(reviewConsentsTable.revokedAt),
  )).limit(1);
  return !!row;
}

export async function listConsents(orgId: number, contactId: number) {
  return db.select().from(reviewConsentsTable)
    .where(and(eq(reviewConsentsTable.orgId, orgId), eq(reviewConsentsTable.contactId, contactId)))
    .orderBy(reviewConsentsTable.grantedAt);
}

/** Variantes con y sin "+" porque outreach_suppressions no impone un formato de teléfono. */
export function phoneVariants(e164: string): string[] {
  const d = e164.replace(/^\+/, "");
  return [`+${d}`, d];
}

export async function isAddressSuppressed(orgId: number, channel: ReviewChannel, address: string): Promise<boolean> {
  const byEmail = channel === "email";
  const values = byEmail ? [address] : phoneVariants(address);
  const col = byEmail ? outreachSuppressionsTable.email : outreachSuppressionsTable.phone;
  const [row] = await db.select({ id: outreachSuppressionsTable.id }).from(outreachSuppressionsTable).where(and(
    eq(outreachSuppressionsTable.orgId, orgId),
    or(isNull(outreachSuppressionsTable.channel), eq(outreachSuppressionsTable.channel, channel)),
    inArray(col, values),
  )).limit(1);
  return !!row;
}

async function suppress(tx: Tx, orgId: number, p: { email?: string | null; phone?: string | null }, reason: string, source: string, createdBy?: number | null) {
  const targets: { email?: string; phone?: string }[] = [];
  if (p.email) targets.push({ email: p.email });
  if (p.phone) targets.push({ phone: p.phone });
  for (const t of targets) {
    const col = t.email ? outreachSuppressionsTable.email : outreachSuppressionsTable.phone;
    const [exists] = await tx.select({ id: outreachSuppressionsTable.id }).from(outreachSuppressionsTable).where(and(
      eq(outreachSuppressionsTable.orgId, orgId), isNull(outreachSuppressionsTable.channel), eq(col, (t.email ?? t.phone)!),
    )).limit(1);
    if (!exists) await tx.insert(outreachSuppressionsTable).values({ orgId, ...t, channel: null, reason, source, createdBy: createdBy ?? null });
  }
}

/** Baja global del contacto (todos los canales): revoca consentimientos, suprime direcciones y cierra el contacto. Idempotente. */
export async function unsubscribeContact(orgId: number, contactId: number, opts: { source: string; createdBy?: number | null }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, contactId)));
    if (!c) return false;
    const now = new Date();
    await tx.update(reviewConsentsTable).set({ revokedAt: now })
      .where(and(eq(reviewConsentsTable.orgId, orgId), eq(reviewConsentsTable.contactId, contactId), isNull(reviewConsentsTable.revokedAt)));
    await suppress(tx, orgId, { email: c.emailNorm, phone: c.phoneE164 }, "opt_out", opts.source, opts.createdBy);
    if (c.status !== "erased") {
      await tx.update(reviewContactsTable).set({ status: "unsubscribed", lastActivityAt: now, updatedAt: now })
        .where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, contactId)));
    }
    await tx.insert(reviewEventsTable).values({ orgId, contactId, type: "unsubscribe", payload: { source: opts.source } });
    return true;
  });
}

/**
 * Supresión (art. 17 RGPD): se eliminan los datos personales del contacto (nombre, email, teléfono, servicio).
 * Excepción aplicable y documentada: se conserva la dirección en la lista de supresión (outreach_suppressions)
 * únicamente para no volver a contactarla si se reimporta (art. 21 RGPD / art. 21 LSSI: respetar la oposición),
 * y los registros de consentimiento/envío sin datos de contacto (prueba del cumplimiento, art. 17.3.e).
 */
export async function eraseContact(orgId: number, contactId: number, opts: { createdBy?: number | null }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, contactId)));
    if (!c) return false;
    if (c.status === "erased") return true;
    const now = new Date();
    await tx.update(reviewConsentsTable).set({ revokedAt: now })
      .where(and(eq(reviewConsentsTable.orgId, orgId), eq(reviewConsentsTable.contactId, contactId), isNull(reviewConsentsTable.revokedAt)));
    await suppress(tx, orgId, { email: c.emailNorm, phone: c.phoneE164 }, "opt_out", "omni_review_erasure", opts.createdBy);
    await tx.update(reviewContactsTable).set({
      name: null, email: null, emailNorm: null, phoneE164: null, service: null, serviceDate: null, clientId: null,
      status: "erased", erasureRequestedAt: now, anonymizedAt: now, updatedAt: now,
    }).where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, contactId)));
    await tx.insert(reviewEventsTable).values({ orgId, contactId, type: "erasure", payload: {} });
    return true;
  });
}
