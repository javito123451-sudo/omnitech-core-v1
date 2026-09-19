// Precios de modelos como configuración: cambiar un precio no toca agentes,
// planes, frontend ni canales, solo una fila de ai_model_pricing.
// Se usa un proveedor ficticio para no interferir con precios reales.
//
// Requiere ci-test con la migración 0006. Se omite limpiamente si no hay.
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, aiModelPricingTable } from "@workspace/db";
import { deactivateModelPricing, getPricingReport, listPricing, PricingError, refreshPricing, setModelPricing } from "../pricingService";
import { applyOfficialPricing, OFFICIAL_MODEL_PRICING_V1 } from "../officialPricing";
import { computeCost, estimateCost } from "../costEngine";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const PROVIDER = `smoke-prov-${Date.now()}`;
const MODEL = "modelo-x";
const HOUR = 3_600_000;

describe.skipIf(!hasRealDb)("Precios de modelos (ai_model_pricing)", () => {
  afterAll(async () => {
    await db.delete(aiModelPricingTable).where(like(aiModelPricingTable.provider, "smoke-prov-%"));
    await refreshPricing();
  });

  it("sin fila vigente el modelo se marca como precio no configurado, sin inventar un precio", () => {
    const c = computeCost({ provider: PROVIDER, model: MODEL, inputTokens: 1_000_000, outputTokens: 0 });
    expect(c.priceSource).not.toBe("db");
    expect(c.pricingRowId).toBeNull();
  });

  it("una fila vigente se usa y queda referenciada en el desglose", async () => {
    const { previous, current } = await setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 2, outputCost: 8, cachedInputCost: 1, source: "documento-oficial-test" }, "admin");
    expect(previous).toBeNull();
    const c = computeCost({ provider: PROVIDER, model: MODEL, inputTokens: 1_000_000, outputTokens: 500_000, cachedTokens: 200_000 });
    expect(c.priceSource).toBe("db");
    expect(c.pricingRowId).toBe(current.id);
    // 800k × 2 + 200k × 1 (cacheados) + 500k × 8 por millón
    expect(c.technicalCostUsd).toBeCloseTo(1.6 + 0.2 + 4, 6);
    expect(c.credits).toBeGreaterThan(0);
  });

  it("cambiar el precio cierra el anterior y crea uno nuevo: el histórico sigue siendo reproducible", async () => {
    const before = await listPricing({ provider: PROVIDER, model: MODEL });
    const old = before[0]!;
    const from = new Date(old.effectiveFrom.getTime() + HOUR);
    const { previous, current } = await setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 4, outputCost: 16, effectiveFrom: from, source: "documento-oficial-test" }, "admin2");
    expect(previous!.id).toBe(old.id);
    expect(current.id).not.toBe(old.id);
    expect(current.createdBy).toBe("admin2");

    const rows = await listPricing({ provider: PROVIDER, model: MODEL });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === old.id)!.effectiveTo!.getTime()).toBe(from.getTime());

    const usage = { provider: PROVIDER, model: MODEL, inputTokens: 1_000_000, outputTokens: 0 };
    expect(computeCost(usage, "final", new Date(old.effectiveFrom.getTime() + 60_000)).technicalCostUsd).toBeCloseTo(2, 6);  // precio antiguo
    expect(computeCost(usage, "final", new Date(from.getTime() + 60_000)).technicalCostUsd).toBeCloseTo(4, 6);               // precio nuevo
    expect(estimateCost(PROVIDER, MODEL, { inputTokens: 0, maxOutputTokens: 1_000_000 }).technicalCostUsd).toBeGreaterThan(0);
  });

  it("rechaza precios no válidos y fechas que no avanzan", async () => {
    await expect(setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: -1, outputCost: 1 }, "u")).rejects.toThrow(PricingError);
    await expect(setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 1, outputCost: Number.NaN }, "u")).rejects.toThrow(PricingError);
    await expect(setModelPricing({ provider: " ", model: MODEL, inputCost: 1, outputCost: 1 }, "u")).rejects.toThrow(PricingError);
    await expect(setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 1, outputCost: 1, currency: "euro" }, "u")).rejects.toThrow(PricingError);
    await expect(setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 1, outputCost: 1, effectiveFrom: new Date(0) }, "u")).rejects.toThrow(PricingError);
  });

  it("desactivar una fila la retira del cálculo sin borrarla", async () => {
    const rows = await listPricing({ provider: PROVIDER, model: MODEL });
    const live = rows.find((r) => r.effectiveTo === null)!;
    expect(await deactivateModelPricing(live.id)).toMatchObject({ id: live.id, active: false });
    expect(await deactivateModelPricing(live.id)).toBeNull(); // ya inactiva
    const [still] = await db.select().from(aiModelPricingTable).where(eq(aiModelPricingTable.id, live.id));
    expect(still).toBeTruthy();
    const c = computeCost({ provider: PROVIDER, model: MODEL, inputTokens: 1_000_000, outputTokens: 0 });
    expect(c.pricingRowId).not.toBe(live.id);
  });

  it("un precio definitivo exige su fuente; solo entra sin fuente como provisional", async () => {
    await expect(setModelPricing({ provider: PROVIDER + "-nosrc", model: MODEL, inputCost: 1, outputCost: 2 }, "u")).rejects.toThrow(/source/);
    await expect(setModelPricing({ provider: PROVIDER + "-nosrc", model: MODEL, inputCost: 1, outputCost: 2, source: "  " }, "u")).rejects.toThrow(PricingError);
    const { current } = await setModelPricing({ provider: PROVIDER + "-prov", model: MODEL, inputCost: 1, outputCost: 2, provisional: true }, "u");
    expect(current).toMatchObject({ provisional: true, source: null });
    // una fila en la BD marcada provisional sigue produciendo un coste provisional, y no oculta que viene de la BD
    const c = computeCost({ provider: PROVIDER + "-prov", model: MODEL, inputTokens: 1_000_000, outputTokens: 0 });
    expect(c).toMatchObject({ priceSource: "db", provisional: true, pricingRowId: current.id });
  });

  it("precio oficial validado: db => provisional=false, con procedencia y sin tocar los modelos antiguos", async () => {
    const official = { provider: PROVIDER + "-off", model: MODEL, inputCost: 2, cachedInputCost: 0.5, outputCost: 8, source: "https://docs.example.test/pricing" };
    const [applied] = await applyOfficialPricing([official], "admin");
    expect(applied!.current).toMatchObject({ provider: official.provider, model: MODEL, source: official.source, provisional: false });
    expect(Number(applied!.current.cachedInputCost)).toBe(0.5);
    const c = computeCost({ provider: official.provider, model: MODEL, inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000 });
    expect(c).toMatchObject({ priceSource: "db", provisional: false, priceKnown: true });
    expect(c.technicalCostUsd).toBeCloseTo(0.5 + 8, 6);

    // los modelos antiguos siguen ahí, como legacy/provisional, hasta que exista un precio oficial
    expect(computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 1000 })).toMatchObject({ priceSource: "legacy", provisional: true });
    const report = await getPricingReport();
    expect(report.official.map((r) => r.provider)).toContain(official.provider);
    expect(report.legacyProvisional).toEqual(expect.arrayContaining([{ provider: "openai", model: "gpt-4o-mini", priceSource: "legacy", provisional: true }]));
    expect(report.dbProvisional.map((r) => r.provider)).toContain(PROVIDER + "-prov");
  });

  it("la carga oficial es todo-o-nada: una entrada sin fuente o con importe no válido no escribe NADA", async () => {
    const ok = { provider: PROVIDER + "-atom", model: MODEL, inputCost: 1, cachedInputCost: 0.1, outputCost: 2, source: "doc" };
    await expect(applyOfficialPricing([ok, { ...ok, model: "otro", source: "" }], "u")).rejects.toThrow(/source/);
    await expect(applyOfficialPricing([ok, { ...ok, model: "otro", outputCost: -1 }], "u")).rejects.toThrow(PricingError);
    await expect(applyOfficialPricing([ok, { ...ok, model: "otro", cachedInputCost: Number.NaN }], "u")).rejects.toThrow(PricingError);
    await expect(applyOfficialPricing([], "u")).rejects.toThrow(/No hay precios/);
    expect(await listPricing({ provider: PROVIDER + "-atom" })).toEqual([]);
  });

  it("la lista oficial v1 no lleva precios inventados: cada entrada que exista lleva fuente y costes válidos", () => {
    for (const e of OFFICIAL_MODEL_PRICING_V1) {
      expect(e.source.trim()).not.toBe("");
      for (const k of ["inputCost", "cachedInputCost", "outputCost"] as const) expect(e[k]).toBeGreaterThanOrEqual(0);
    }
  });
});
