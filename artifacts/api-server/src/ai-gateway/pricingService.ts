// ═══════════════════════════════════════════════════════════════════════════
//  Model pricing — persistence of ai_model_pricing.
//
//  A price is never edited in place. setModelPricing() closes the model's
//  current row (effective_to) and inserts a new one in the same transaction,
//  so at any instant at most one row is in force and the price history of
//  every model is intact. Callers (Control Center) audit each change with the
//  old and new values.
// ═══════════════════════════════════════════════════════════════════════════

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, aiModelPricingTable, type AiModelPricing } from "@workspace/db";
import { LEGACY_PRICING } from "./pricing";
import { pricingSnapshotAgeMs, setPricingSnapshot, type PricingRow } from "./pricingRegistry";

const SNAPSHOT_TTL_MS = 60_000;

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const toRow = (r: AiModelPricing): PricingRow => ({
  id: r.id, provider: r.provider, model: r.model,
  inputCost: Number(r.inputCost), outputCost: Number(r.outputCost),
  cachedInputCost: num(r.cachedInputCost), reasoningCost: num(r.reasoningCost),
  imageCost: num(r.imageCost), audioCost: num(r.audioCost), videoCost: num(r.videoCost),
  effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, active: r.active,
  source: r.source, provisional: r.provisional,
});

export async function refreshPricing(): Promise<PricingRow[]> {
  const rows = (await db.select().from(aiModelPricingTable).where(eq(aiModelPricingTable.active, true))).map(toRow);
  setPricingSnapshot(rows);
  return rows;
}

/** Carga los precios si el snapshot está viejo. Barato: una consulta cada minuto como mucho. */
export async function ensurePricingLoaded(maxAgeMs = SNAPSHOT_TTL_MS): Promise<void> {
  if (pricingSnapshotAgeMs() < maxAgeMs) return;
  try { await refreshPricing(); } catch (err) { console.error("[Pricing] no se pudieron cargar los precios:", err); }
}

export interface PricingInput {
  provider:         string;
  model:            string;
  inputCost:        number;
  outputCost:       number;
  cachedInputCost?: number | null;
  reasoningCost?:   number | null;
  imageCost?:       number | null;
  audioCost?:       number | null;
  videoCost?:       number | null;
  currency?:        string;
  effectiveFrom?:   Date;
  notes?:           string | null;
  /** Documento/URL oficial del precio. Obligatorio si el precio es definitivo (provisional=false). */
  source?:          string | null;
  /** Por defecto false (precio validado). true = cargado pero pendiente de revisión. */
  provisional?:     boolean;
}

export class PricingError extends Error {
  constructor(message: string) { super(message); this.name = "PricingError"; }
}

function validate(input: PricingInput) {
  if (!input.provider?.trim() || !input.model?.trim()) throw new PricingError("provider y model son obligatorios.");
  const costs: Array<[string, number | null | undefined]> = [
    ["inputCost", input.inputCost], ["outputCost", input.outputCost], ["cachedInputCost", input.cachedInputCost],
    ["reasoningCost", input.reasoningCost], ["imageCost", input.imageCost], ["audioCost", input.audioCost], ["videoCost", input.videoCost],
  ];
  for (const [name, v] of costs) {
    if (v === null || v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) throw new PricingError(`${name} debe ser un número mayor o igual que 0.`);
  }
  if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) throw new PricingError("currency debe ser un código de 3 letras (p. ej. USD).");
  // Nunca un precio definitivo sin procedencia: sin fuente, solo puede entrar como provisional.
  if (input.provisional !== true && !input.source?.trim()) {
    throw new PricingError("Un precio definitivo (provisional=false) requiere 'source': el documento o URL oficial del precio.");
  }
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toFixed(6));

export async function setModelPricing(input: PricingInput, userClerkId: string | null) {
  validate(input);
  const from = input.effectiveFrom ?? new Date();

  const result = await db.transaction(async (tx) => {
    const current = await tx.select().from(aiModelPricingTable)
      .where(and(eq(aiModelPricingTable.provider, input.provider), eq(aiModelPricingTable.model, input.model),
        eq(aiModelPricingTable.active, true), isNull(aiModelPricingTable.effectiveTo)))
      .for("update");
    for (const row of current) {
      if (from <= row.effectiveFrom) throw new PricingError("effectiveFrom debe ser posterior al inicio del precio vigente.");
      await tx.update(aiModelPricingTable).set({ effectiveTo: from }).where(eq(aiModelPricingTable.id, row.id));
    }
    const [created] = await tx.insert(aiModelPricingTable).values({
      provider: input.provider, model: input.model,
      inputCost: fmt(input.inputCost)!, outputCost: fmt(input.outputCost)!,
      cachedInputCost: fmt(input.cachedInputCost), reasoningCost: fmt(input.reasoningCost),
      imageCost: fmt(input.imageCost), audioCost: fmt(input.audioCost), videoCost: fmt(input.videoCost),
      currency: input.currency ?? "USD", effectiveFrom: from, notes: input.notes ?? null, createdBy: userClerkId,
      source: input.source?.trim() || null, provisional: input.provisional === true,
    }).returning();
    return { previous: current[0] ?? null, current: created! };
  });
  await refreshPricing();
  return result;
}

export async function deactivateModelPricing(id: number): Promise<AiModelPricing | null> {
  const [row] = await db.update(aiModelPricingTable)
    .set({ active: false, effectiveTo: new Date() })
    .where(and(eq(aiModelPricingTable.id, id), eq(aiModelPricingTable.active, true))).returning();
  await refreshPricing();
  return row ?? null;
}

export async function listPricing(filter: { provider?: string; model?: string } = {}) {
  const conds = [
    filter.provider ? eq(aiModelPricingTable.provider, filter.provider) : undefined,
    filter.model ? eq(aiModelPricingTable.model, filter.model) : undefined,
  ].filter((c) => c !== undefined);
  return db.select().from(aiModelPricingTable).where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(aiModelPricingTable.provider), asc(aiModelPricingTable.model), desc(aiModelPricingTable.effectiveFrom));
}

/**
 * Estado del pricing: qué modelos tienen precio oficial validado y cuáles siguen provisionales
 * (fila marcada provisional, valor heredado o tarifa de referencia). Para Super Admin.
 */
export async function getPricingReport(at: Date = new Date()) {
  const rows = (await db.select().from(aiModelPricingTable).where(eq(aiModelPricingTable.active, true)))
    .filter((r) => r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo > at));
  const key = (p: string, m: string) => `${p}/${m}`;
  const official = rows.filter((r) => !r.provisional);
  const officialKeys = new Set(official.map((r) => key(r.provider, r.model)));
  return {
    official: official.map((r) => ({ provider: r.provider, model: r.model, source: r.source, effectiveFrom: r.effectiveFrom, provisional: false })),
    dbProvisional: rows.filter((r) => r.provisional).map((r) => ({ provider: r.provider, model: r.model, source: r.source, effectiveFrom: r.effectiveFrom, provisional: true })),
    // Modelos heredados: se conservan, pero como legacy/provisional hasta que exista un precio oficial.
    legacyProvisional: Object.entries(LEGACY_PRICING)
      .flatMap(([provider, models]) => Object.keys(models).map((model) => ({ provider, model })))
      .filter((m) => !officialKeys.has(key(m.provider, m.model)))
      .map((m) => ({ ...m, priceSource: "legacy" as const, provisional: true })),
  };
}
