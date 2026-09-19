// El Cost Engine es la única fuente de costes técnicos y de la conversión a
// OmniCredits. Estos tests fijan (1) que no cambian los importes que ya se
// registraban, (2) el descuento por tokens cacheados, (3) que un modelo sin
// precio se marca en lugar de inventarse un coste, y (4) estimado ≠ final.
import { describe, it, expect } from "vitest";
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
