// Catálogo de OmniCredits extra (packs). Configurable desde Super Admin: cambiar un precio o añadir
// un pack no toca código. Sin integración de pago todavía (Stripe/Hotmart): esto solo deja preparado
// el catálogo y la compra idempotente. Cada compra usa paymentReference como clave de idempotencia.
//
// El precio y los créditos del pack se COPIAN a la compra en el momento de comprar: cambiar el
// catálogo después no reescribe el historial.

import { asc, eq } from "drizzle-orm";
import { db, creditPacksTable, type CreditPack } from "@workspace/db";
import { CreditError } from "./errors";
import { recordPurchase } from "./purchaseService";

export interface PackConfig {
  code: string; credits: number; priceAmount: number; currency: string; active: boolean; sortOrder: number;
}
const toConfig = (r: CreditPack): PackConfig => ({
  code: r.code, credits: Number(r.credits), priceAmount: Number(r.priceAmount), currency: r.currency, active: r.active, sortOrder: r.sortOrder,
});

export async function listPacks(opts: { activeOnly?: boolean } = {}): Promise<PackConfig[]> {
  const rows = await db.select().from(creditPacksTable).orderBy(asc(creditPacksTable.sortOrder), asc(creditPacksTable.credits));
  return rows.map(toConfig).filter((p) => !opts.activeOnly || p.active);
}

export type PackPatch = Partial<Omit<PackConfig, "code">>;

/** Crea o actualiza un pack. Devuelve antes y después, para poder auditarlo. */
export async function upsertPack(code: string, patch: PackPatch, userClerkId: string | null) {
  if (!/^[a-z0-9_]{2,40}$/.test(code)) throw new CreditError("code debe ser minúsculas, números o _ (2-40 caracteres).");
  if (patch.credits !== undefined && (!Number.isFinite(patch.credits) || patch.credits <= 0)) throw new CreditError("credits debe ser mayor que 0.");
  if (patch.priceAmount !== undefined && (!Number.isFinite(patch.priceAmount) || patch.priceAmount < 0)) throw new CreditError("priceAmount debe ser mayor o igual que 0.");
  if (patch.currency !== undefined && !/^[A-Z]{3}$/.test(patch.currency)) throw new CreditError("currency debe ser un código de 3 letras.");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(creditPacksTable).where(eq(creditPacksTable.code, code)).for("update");
    if (!existing && (patch.credits === undefined || patch.priceAmount === undefined)) {
      throw new CreditError("Un pack nuevo requiere credits y priceAmount.");
    }
    const set = {
      ...(patch.credits !== undefined ? { credits: patch.credits.toFixed(4) } : {}),
      ...(patch.priceAmount !== undefined ? { priceAmount: patch.priceAmount.toFixed(2) } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      updatedBy: userClerkId, updatedAt: new Date(),
    };
    const [saved] = existing
      ? await tx.update(creditPacksTable).set(set).where(eq(creditPacksTable.id, existing.id)).returning()
      : await tx.insert(creditPacksTable).values({ code, credits: set.credits!, priceAmount: set.priceAmount!, ...set }).returning();
    return { previous: existing ? toConfig(existing) : null, current: toConfig(saved!) };
  });
}

/**
 * Compra de un pack del catálogo para un workspace. `paymentReference` es OBLIGATORIA y es la clave
 * de idempotencia: repetir el mismo envío no duplica créditos. Los créditos entran como "extra".
 */
export async function purchasePack(input: { orgId: number; packCode: string; paymentReference: string; userClerkId?: string | null; expiresAt?: Date | null }) {
  const [pack] = await db.select().from(creditPacksTable).where(eq(creditPacksTable.code, input.packCode));
  if (!pack) throw new CreditError(`El pack '${input.packCode}' no existe.`);
  if (!pack.active) throw new CreditError(`El pack '${input.packCode}' no está disponible.`);
  return recordPurchase({
    orgId: input.orgId, credits: Number(pack.credits), priceAmount: Number(pack.priceAmount), currency: pack.currency,
    paymentReference: input.paymentReference, userClerkId: input.userClerkId ?? null, expiresAt: input.expiresAt ?? null,
    metadata: { packCode: pack.code, packId: pack.id },
  });
}
