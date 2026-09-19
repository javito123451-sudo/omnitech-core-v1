// ═══════════════════════════════════════════════════════════════════════════
//  Pricing registry — resolves the price of a provider/model AT A MOMENT.
//
//  Holds an in-memory snapshot of the ai_model_pricing rows so the Cost Engine
//  can stay synchronous (and the simulator pure). This file deliberately has
//  no database import: the snapshot is filled by pricingService.ts, which the
//  gateway and the routes call before computing costs. With no snapshot (or no
//  active row for a model) it falls back to the legacy defaults, and says so.
// ═══════════════════════════════════════════════════════════════════════════

import { FALLBACK_PRICING, LEGACY_PRICING, type ModelPricing } from "./pricing";

export interface PricingRow {
  id:              number;
  provider:        string;
  model:           string;
  inputCost:       number;
  outputCost:      number;
  cachedInputCost: number | null;
  reasoningCost:   number | null;
  imageCost:       number | null;
  audioCost:       number | null;
  videoCost:       number | null;
  effectiveFrom:   Date;
  effectiveTo:     Date | null;
  active:          boolean;
  /** Documento/URL oficial del precio. */
  source:          string | null;
  /** true = fila cargada pero aún sin validar: el coste sigue siendo provisional. */
  provisional:     boolean;
}

export type PriceSource = "db" | "legacy" | "fallback";

/**
 * Tres conceptos distintos:
 *   priceSource  de dónde salió el precio (db | legacy | fallback).
 *   priceKnown   el modelo tiene un precio explícito (fila en la BD o valor heredado); falso = tarifa de referencia.
 *   provisional  el coste/créditos NO están respaldados por un precio configurado en ai_model_pricing.
 * Solo una fila vigente de ai_model_pricing hace el precio definitivo: legacy y fallback son provisionales.
 */
export const isProvisionalSource = (source: PriceSource): boolean => source !== "db";

export interface ResolvedPricing {
  pricing: ModelPricing;
  known:   boolean;
  source:  PriceSource;
  rowId:   number | null;
  /** db validado → false. legacy, fallback o una fila db marcada provisional → true. */
  provisional: boolean;
}

let snapshot: PricingRow[] = [];
let loadedAt = 0;

export function setPricingSnapshot(rows: PricingRow[]): void {
  snapshot = rows;
  loadedAt = Date.now();
}
export const pricingSnapshotAgeMs = (): number => (loadedAt === 0 ? Infinity : Date.now() - loadedAt);
export const clearPricingSnapshot = (): void => { snapshot = []; loadedAt = 0; };

const opt = (n: number | null): number | undefined => (n === null ? undefined : n);

export function resolvePricing(provider: string, model: string, at: Date = new Date()): ResolvedPricing {
  const row = snapshot
    .filter((r) => r.active && r.provider === provider && r.model === model
      && r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo > at))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];

  if (row) {
    return {
      known: true, source: "db", rowId: row.id, provisional: row.provisional,
      pricing: {
        inputPer1M: row.inputCost, outputPer1M: row.outputCost,
        cachedInputPer1M: opt(row.cachedInputCost), reasoningPer1M: opt(row.reasoningCost),
        imagePerUnit: opt(row.imageCost), audioPerMinute: opt(row.audioCost), videoPerMinute: opt(row.videoCost),
      },
    };
  }
  const legacy = LEGACY_PRICING[provider]?.[model];
  if (legacy) return { pricing: legacy, known: true, source: "legacy", rowId: null, provisional: true };
  return { pricing: FALLBACK_PRICING, known: false, source: "fallback", rowId: null, provisional: true };
}
