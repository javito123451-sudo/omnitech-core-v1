// ═══════════════════════════════════════════════════════════════════════════
//  AI pricing — defaults heredados + parámetros de conversión a OmniCredits.
//
//  Los precios REALES viven en la tabla ai_model_pricing (configurable, con
//  vigencia, sin filas iniciales) y se resuelven en pricingRegistry.ts. Este
//  archivo solo contiene:
//
//   1. LEGACY_PRICING: los valores que la app ya usaba antes de existir la
//      tabla (estaban en aiUsageLogger.ts). Se usan ÚNICAMENTE cuando no hay
//      una fila vigente en la base de datos, y el desglose lo marca
//      (priceSource: "legacy"). No se han verificado contra los precios
//      actuales de ningún proveedor: sustitúyelos configurando ai_model_pricing.
//
//   2. Los parámetros de conversión a OmniCredits y de reserva.
//
//  Unidades: USD por 1M de tokens; por unidad (imagen); por minuto (audio, vídeo).
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelPricing {
  inputPer1M:        number;
  outputPer1M:       number;
  /** Precio de los tokens de entrada cacheados; si falta, se cobran como entrada normal. */
  cachedInputPer1M?: number;
  /** Precio de los tokens de razonamiento; si falta, se cobran como salida. */
  reasoningPer1M?:   number;
  imagePerUnit?:     number;
  audioPerMinute?:   number;
  videoPerMinute?:   number;
}

const GPT_4O:      ModelPricing = { inputPer1M: 5,    outputPer1M: 15,  cachedInputPer1M: 2.5 };
const GPT_4O_MINI: ModelPricing = { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 };

/** Valores heredados. Ver la nota de cabecera: son un respaldo, no una fuente de verdad. */
export const LEGACY_PRICING: Record<string, Record<string, ModelPricing>> = {
  openai: {
    "gpt-4o":                 GPT_4O,
    "gpt-4o-2024-11-20":      GPT_4O,
    "gpt-4o-mini":            GPT_4O_MINI,
    "gpt-4o-mini-2024-07-18": GPT_4O_MINI,
    "text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0 },
    "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0 },
  },
  // Proveedores que existen como stub: sin precios inventados.
  claude: {},
  gemini: {},
};

/** Alias de compatibilidad para código y tests que ya importaban PRICING. */
export const PRICING = LEGACY_PRICING;

/** Se usa para un proveedor/modelo sin precio: el desglose lo marca priceKnown:false. */
export const FALLBACK_PRICING: ModelPricing = GPT_4O_MINI;

// ── Conversión a OmniCredits ─────────────────────────────────────────────────
// Parámetro comercial, no técnico: 1 OmniCredit NO es 1 token. creditsPerUsd
// convierte coste técnico a créditos y markup es el margen. Sobrescribibles por
// entorno hasta que negocio fije los valores definitivos.
export const OMNICREDITS = {
  creditsPerUsd: Number(process.env["OMNICREDITS_PER_USD"] ?? 1000),
  markup:        Number(process.env["OMNICREDITS_MARKUP"] ?? 1),
} as const;

// ── Reserva de créditos ──────────────────────────────────────────────────────
// Antes de llamar al proveedor se reserva el coste ESTIMADO por este factor, que
// cubre que la estimación de tokens de entrada es aproximada. Si el coste real
// supera igualmente la reserva, se registra el real y se marca el desvío.
export const HOLD_SAFETY_FACTOR = 1.2;
/** Una reserva que nadie liquida (proceso caído) deja de contar pasado este tiempo. */
export const HOLD_TTL_MS = 5 * 60 * 1000;
