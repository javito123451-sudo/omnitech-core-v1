// Precios de modelos como configuración: cambiar un precio no toca agentes,
// planes, frontend ni canales, solo una fila de ai_model_pricing.
// Se usa un proveedor ficticio para no interferir con precios reales.
//
// Requiere ci-test con la migración 0006. Se omite limpiamente si no hay.
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, aiModelPricingTable } from "@workspace/db";
import { deactivateModelPricing, listPricing, PricingError, refreshPricing, setModelPricing } from "../pricingService";
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
    const { previous, current } = await setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 2, outputCost: 8, cachedInputCost: 1 }, "admin");
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
    const { previous, current } = await setModelPricing({ provider: PROVIDER, model: MODEL, inputCost: 4, outputCost: 16, effectiveFrom: from }, "admin2");
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
});
