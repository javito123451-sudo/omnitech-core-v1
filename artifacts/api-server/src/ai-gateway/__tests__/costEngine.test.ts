// El Cost Engine es la única fuente de costes técnicos y de la conversión a
// OmniCredits. Estos tests fijan (1) que no cambian los importes que ya se
// registraban, (2) el descuento por tokens cacheados, (3) que un modelo sin
// precio se marca en lugar de inventarse un coste, y (4) estimado ≠ final.
import { describe, it, expect, afterEach } from "vitest";
import { clearPricingSnapshot, resolvePricing, setPricingSnapshot, type PricingRow } from "../pricingRegistry";
import { computeCost, estimateCost, estimateTokens, usdToCredits, lookupPricing } from "../costEngine";
import { OMNICREDITS, PRICING } from "../pricing";
import { calculateCost } from "../../utils/aiUsageLogger";

describe("Cost Engine — coste técnico", () => {
  it("mantiene los importes históricos de gpt-4o-mini y gpt-4o", () => {
    // 1000 in / 500 out: antes 0.15/1K in + 0.60/1K out → 0.00015 + 0.0003
    expect(computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500 }).technicalCostUsd).toBeCloseTo(0.00045, 6);
    expect(computeCost({ provider: "openai", model: "gpt-4o", inputTokens: 1000, outputTokens: 500 }).technicalCostUsd).toBeCloseTo(0.0125, 6);
  });

  it("calculateCost (API antigua) da lo mismo que el motor", () => {
    expect(calculateCost("gpt-4o-mini", 1000, 500)).toBeCloseTo(0.00045, 6);
  });

  it("cobra los tokens cacheados a su precio y no dos veces", () => {
    const full   = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });
    const cached = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 });
    expect(full.technicalCostUsd).toBeCloseTo(0.15, 6);
    expect(cached.technicalCostUsd).toBeCloseTo(0.075, 6);
    expect(cached.lines.input).toBe(0);
  });

  it("nunca trata más tokens cacheados que tokens de entrada", () => {
    const c = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 0, cachedTokens: 5_000 });
    // 100 tokens cacheados × $0.075/1M = 0.0000075, redondeado a 6 decimales (la precisión de ai_usage_logs)
    expect(c.technicalCostUsd).toBe(0.000008);
  });

  it("cobra los tokens de razonamiento aparte del output", () => {
    const base = computeCost({ provider: "openai", model: "gpt-4o", inputTokens: 0, outputTokens: 1_000_000 });
    const withReasoning = computeCost({ provider: "openai", model: "gpt-4o", inputTokens: 0, outputTokens: 1_000_000, reasoningTokens: 1_000_000 });
    expect(withReasoning.technicalCostUsd).toBeCloseTo(base.technicalCostUsd * 2, 6);
  });

  it("marca un modelo sin precio en vez de inventarlo", () => {
    expect(lookupPricing("openai", "gpt-9-ultra").known).toBe(false);
    expect(lookupPricing("claude", "algo").known).toBe(false);
    const c = computeCost({ provider: "claude", model: "algo", inputTokens: 1000, outputTokens: 1000 });
    expect(c.priceKnown).toBe(false);
    expect(c.technicalCostUsd).toBeGreaterThan(0);
  });

  it("priceSource, priceKnown y provisional son conceptos distintos: solo una fila configurada es definitiva", () => {
    const legacy = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 1000 });
    expect(legacy).toMatchObject({ priceSource: "legacy", priceKnown: true, provisional: true });
    const fallback = computeCost({ provider: "claude", model: "algo", inputTokens: 1000, outputTokens: 1000 });
    expect(fallback).toMatchObject({ priceSource: "fallback", priceKnown: false, provisional: true });
    expect(estimateCost("openai", "gpt-4o-mini", { inputTokens: 10, maxOutputTokens: 10 }).provisional).toBe(true);
    setPricingSnapshot([row({})]);
    expect(computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 1000 })).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false });
    // un coste informado por el proveedor hereda la procedencia del precio del modelo, no la oculta
    expect(computeCost({ provider: "claude", model: "algo", inputTokens: 1, outputTokens: 1, providerReportedCostUsd: 0.5 }).provisional).toBe(true);
    clearPricingSnapshot();
  });

  it("si el proveedor informa su coste real, ese manda", () => {
    const c = computeCost({ provider: "openai", model: "gpt-4o", inputTokens: 1, outputTokens: 1, providerReportedCostUsd: 0.42 });
    expect(c.basis).toBe("provider_reported");
    expect(c.technicalCostUsd).toBe(0.42);
  });

  it("distingue estimado de final", () => {
    const est = estimateCost("openai", "gpt-4o-mini", { inputTokens: 1000, maxOutputTokens: 1000 });
    const fin = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 200 });
    expect(est.basis).toBe("estimated");
    expect(fin.basis).toBe("final");
    expect(est.technicalCostUsd).toBeGreaterThan(fin.technicalCostUsd); // el estimado usa el tope de salida
  });

  it("todos los precios viven en pricing.ts", () => {
    expect(Object.keys(PRICING)).toEqual(expect.arrayContaining(["openai", "claude", "gemini"]));
    expect(PRICING["claude"]).toEqual({}); // sin precios inventados para proveedores no implementados
  });
});

describe("Cost Engine — OmniCredits", () => {
  it("convierte coste a créditos con el parámetro comercial y redondea hacia arriba", () => {
    const usd = 0.00045;
    expect(usdToCredits(usd)).toBe(Math.ceil(usd * OMNICREDITS.creditsPerUsd * OMNICREDITS.markup * 1e4) / 1e4);
    expect(usdToCredits(0.000000001)).toBeGreaterThan(0); // un coste real nunca se redondea a 0
  });

  it("coste cero o inválido no consume créditos", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(-1)).toBe(0);
    expect(usdToCredits(Number.NaN)).toBe(0);
  });

  it("un crédito no equivale a un token", () => {
    const c = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500 });
    expect(c.credits).not.toBe(1500);
  });

  it("estimateTokens da una cifra razonable", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

const row = (over: Partial<PricingRow> = {}): PricingRow => ({
  id: 1, provider: "openai", model: "gpt-4o-mini", inputCost: 1, outputCost: 2, cachedInputCost: null, reasoningCost: null,
  imageCost: null, audioCost: null, videoCost: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, active: true, ...over,
});

describe("Cost Engine — precios configurables (ai_model_pricing)", () => {
  afterEach(() => clearPricingSnapshot());
  const usage = { provider: "openai", model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("una fila vigente manda sobre los valores heredados, y cambiarla cambia el coste sin tocar nada más", () => {
    expect(computeCost(usage).priceSource).toBe("legacy");
    setPricingSnapshot([row({ inputCost: 1, outputCost: 2 })]);
    const a = computeCost(usage);
    expect(a.technicalCostUsd).toBe(3);
    expect(a).toMatchObject({ priceSource: "db", pricingRowId: 1, priceKnown: true });

    setPricingSnapshot([row({ id: 2, inputCost: 10, outputCost: 20 })]);
    expect(computeCost(usage).technicalCostUsd).toBe(30); // mismo uso, otro precio configurado
  });

  it("respeta la vigencia: fuera de effective_from/effective_to la fila no aplica", () => {
    setPricingSnapshot([row({ effectiveFrom: new Date("2026-03-01"), effectiveTo: new Date("2026-06-01") })]);
    expect(computeCost(usage, "final", new Date("2026-02-01")).priceSource).toBe("legacy");
    expect(computeCost(usage, "final", new Date("2026-04-01")).priceSource).toBe("db");
    expect(computeCost(usage, "final", new Date("2026-06-01")).priceSource).toBe("legacy"); // effective_to es exclusivo
  });

  it("con dos filas vigentes usa la más reciente, y una inactiva nunca aplica", () => {
    setPricingSnapshot([
      row({ id: 1, inputCost: 1, outputCost: 1, effectiveFrom: new Date("2026-01-01") }),
      row({ id: 2, inputCost: 5, outputCost: 5, effectiveFrom: new Date("2026-02-01") }),
      row({ id: 3, inputCost: 99, outputCost: 99, effectiveFrom: new Date("2026-03-01"), active: false }),
    ]);
    const c = computeCost(usage, "final", new Date("2026-04-01"));
    expect(c.pricingRowId).toBe(2);
    expect(c.technicalCostUsd).toBe(10);
  });

  it("soporta imagen, audio y vídeo, y tokens cacheados/razonamiento desde la fila", () => {
    setPricingSnapshot([row({ imageCost: 0.5, audioCost: 6, videoCost: 12, cachedInputCost: 0.25, reasoningCost: 4 })]);
    const c = computeCost({ ...usage, inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000, reasoningTokens: 1_000_000, images: 4, audioSeconds: 30, videoSeconds: 60 });
    expect(c.lines).toMatchObject({ input: 0, cachedInput: 0.25, reasoning: 4, images: 2, audio: 3, video: 12 });
    expect(c.technicalCostUsd).toBeCloseTo(21.25, 6);
  });

  it("no inventa precios: un proveedor sin fila ni valores heredados se marca como tarifa de referencia", () => {
    const r = resolvePricing("claude", "algo");
    expect(r).toMatchObject({ known: false, source: "fallback", rowId: null });
    expect(computeCost({ provider: "claude", model: "algo", inputTokens: 1000, outputTokens: 1000 }).priceKnown).toBe(false);
  });

  it("el estimado también usa el precio configurado", () => {
    setPricingSnapshot([row({ inputCost: 2, outputCost: 4 })]);
    const est = estimateCost("openai", "gpt-4o-mini", { inputTokens: 1_000_000, maxOutputTokens: 1_000_000 });
    expect(est.technicalCostUsd).toBe(6);
    expect(est.priceSource).toBe("db");
  });
});
