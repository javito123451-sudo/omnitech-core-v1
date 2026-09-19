// Carga de precios OFICIALES de modelos, con procedencia obligatoria.
//
// Regla de negocio: solo entran en ai_model_pricing precios oficiales validados, con su
// fuente (documento o URL) y provisional=false. Nada de precios inventados ni estimados.
// Los modelos antiguos que ya estaban configurados NO se borran: siguen resolviéndose como
// legacy/provisional (pricing.ts) hasta que se revisen.
//
// Uso: applyOfficialPricing([...]) es todo-o-nada (una transacción lógica por modelo, con el
// mismo histórico con vigencia que setModelPricing) y devuelve qué cambió. Los valores los
// aporta negocio; este archivo NO lleva ninguno.

import { PricingError, setModelPricing, type PricingInput } from "./pricingService";

export interface OfficialPriceInput {
  provider:        string;
  model:           string;
  /** USD por 1.000.000 de tokens. */
  inputCost:       number;
  cachedInputCost: number;
  outputCost:      number;
  effectiveFrom?:  Date;
  /** Documento o URL oficial del que salen los tres precios. */
  source:          string;
}

/** Precios oficiales v1 validados por negocio. Vacío hasta que se aporten los valores reales. */
export const OFFICIAL_MODEL_PRICING_V1: OfficialPriceInput[] = [];

function assertOfficial(e: OfficialPriceInput) {
  const label = `${e.provider}/${e.model}`;
  if (!e.source?.trim()) throw new PricingError(`${label}: falta 'source' (documento o URL oficial del precio).`);
  for (const k of ["inputCost", "cachedInputCost", "outputCost"] as const) {
    if (typeof e[k] !== "number" || !Number.isFinite(e[k]) || e[k] < 0) throw new PricingError(`${label}: ${k} debe ser un número mayor o igual que 0.`);
  }
}

export async function applyOfficialPricing(entries: OfficialPriceInput[], userClerkId: string | null) {
  if (entries.length === 0) throw new PricingError("No hay precios oficiales que aplicar.");
  entries.forEach(assertOfficial); // valida TODO antes de escribir nada
  const applied = [];
  for (const e of entries) {
    const input: PricingInput = {
      provider: e.provider, model: e.model, inputCost: e.inputCost, cachedInputCost: e.cachedInputCost, outputCost: e.outputCost,
      effectiveFrom: e.effectiveFrom, source: e.source, provisional: false, notes: "Precio oficial v1",
    };
    applied.push(await setModelPricing(input, userClerkId));
  }
  return applied;
}
