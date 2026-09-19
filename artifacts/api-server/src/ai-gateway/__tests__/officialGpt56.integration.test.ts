// Precios oficiales de OpenAI GPT-5.6 (Luna, Terra, Sol), STANDARD de contexto corto, cargados por la
// migración 0009. Se comprueba lo almacenado, el Cost Engine, una simulación y un consumo LIVE contra
// Postgres real (con proveedor de IA falso): el cálculo usa el precio de la base de datos y OmniCredits =
// coste técnico × 4000, nunca un precio legacy/fallback.
//
// Requiere ci-test con las migraciones 0004-0009. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, aiModelPricingTable, aiUsageLogsTable, creditLedgerTable, defaultAgentConfig } from "@workspace/db";
import { callAI, type GatewayDeps } from "../gateway";
import { ResponseCache } from "../responseCache";
import { computeCost, estimateCost, usdToCredits } from "../costEngine";
import { OMNICREDITS } from "../pricing";
import { getPricingReport, refreshPricing } from "../pricingService";
import { OFFICIAL_MODEL_PRICING_V1 } from "../officialPricing";
import { checkBudgetBlocked, logAiCall } from "../../utils/aiUsageLogger";
import { creditsPort, getBalance, grantCredits } from "../../credits/creditService";
import { simulateAgent } from "../../agents/simulator";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import type { AIProvider, GenerateResult } from "../../ai/types";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const M = 1_000_000;

// Valores oficiales (USD por 1M de tokens) y créditos esperados por 1M (× 4000).
const EXPECTED = {
  "gpt-5.6-luna":  { input: 0.2, cached: 0.02, output: 1.2,  credits: { input: 800,   cached: 80,   output: 4_800 } },
  "gpt-5.6-terra": { input: 2,   cached: 0.2,  output: 12,   credits: { input: 8_000, cached: 800,  output: 48_000 } },
  "gpt-5.6-sol":   { input: 4,   cached: 0.4,  output: 20,   credits: { input: 16_000, cached: 1_600, output: 80_000 } },
} as const;
type ModelId = keyof typeof EXPECTED;
const MODELS = Object.keys(EXPECTED) as ModelId[];

const fakeRoute = (model: string, usage: GenerateResult["usage"]) => ({
  provider: { id: "openai", name: "fake-openai", generate: async () => ({ text: "ok", usage }) } as unknown as AIProvider,
  providerId: "openai", model, timeoutMs: 1000,
});

describe.skipIf(!hasRealDb)("Pricing oficial OpenAI GPT-5.6 (standard, contexto corto)", () => {
  let org = 0;
  const FN = `smoke_gpt56_${Date.now()}`;
  beforeAll(async () => {
    [org] = await createTempOrgs(1, "gpt56");
    await refreshPricing(); // el Cost Engine lee un snapshot de ai_model_pricing
  });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(eq(aiUsageLogsTable.functionName, FN));
    await deleteTempOrgs([org]);
  });

  // ── 1. Lo almacenado ──────────────────────────────────────────────────────

  describe("filas almacenadas", () => {
    it("existen exactamente las tres filas, con IDs exactos y valores exactos", async () => {
      const rows = await db.select().from(aiModelPricingTable).where(and(eq(aiModelPricingTable.provider, "openai"), eq(aiModelPricingTable.active, true)));
      const gpt56 = rows.filter((r) => r.model.startsWith("gpt-5.6-")).sort((a, b) => a.model.localeCompare(b.model));
      expect(gpt56.map((r) => r.model)).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);
      for (const r of gpt56) {
        const e = EXPECTED[r.model as ModelId];
        expect({
          provider: r.provider, currency: r.currency,
          inputCost: Number(r.inputCost), cachedInputCost: Number(r.cachedInputCost), outputCost: Number(r.outputCost),
          source: r.source, provisional: r.provisional, active: r.active, effectiveTo: r.effectiveTo,
        }).toEqual({
          provider: "openai", currency: "USD",
          inputCost: e.input, cachedInputCost: e.cached, outputCost: e.output,
          source: `https://developers.openai.com/api/docs/models/${r.model}`, provisional: false, active: true, effectiveTo: null,
        });
        // solo la tarifa standard: nada de reasoning/imagen/audio/vídeo, ni una segunda fila (Batch/Flex/Priority/contexto largo)
        expect([r.reasoningCost, r.imageCost, r.audioCost, r.videoCost]).toEqual([null, null, null, null]);
        expect(r.notes).toMatch(/STANDARD/);
        expect(rows.filter((x) => x.model === r.model)).toHaveLength(1);
      }
    });

    it("la lista oficial del código coincide con la base de datos", async () => {
      expect(OFFICIAL_MODEL_PRICING_V1.map((e) => e.model).sort()).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);
      const rows = await db.select().from(aiModelPricingTable).where(eq(aiModelPricingTable.provider, "openai"));
      for (const e of OFFICIAL_MODEL_PRICING_V1) {
        const r = rows.find((x) => x.model === e.model && x.active)!;
        expect([Number(r.inputCost), Number(r.cachedInputCost), Number(r.outputCost), r.source]).toEqual([e.inputCost, e.cachedInputCost, e.outputCost, e.source]);
      }
    });

    it("la migración es idempotente: volver a ejecutar su SQL no duplica ni pisa las filas", async () => {
      const sqlText = readFileSync(fileURLToPath(new URL("../../../../../lib/db/drizzle/0009_official_openai_gpt56_pricing.sql", import.meta.url)), "utf8");
      const before = await db.select({ id: aiModelPricingTable.id }).from(aiModelPricingTable).where(eq(aiModelPricingTable.provider, "openai"));
      await db.execute(sql.raw(sqlText));
      const after = await db.select({ id: aiModelPricingTable.id }).from(aiModelPricingTable).where(eq(aiModelPricingTable.provider, "openai"));
      expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    });

    it("gpt-4o y gpt-4o-mini siguen registrados como legacy/provisional y no se han tocado", async () => {
      for (const model of ["gpt-4o", "gpt-4o-mini"]) {
        expect(computeCost({ provider: "openai", model, inputTokens: M, outputTokens: M })).toMatchObject({ priceSource: "legacy", provisional: true, priceKnown: true, pricingRowId: null });
      }
      const report = await getPricingReport();
      expect(report.official.filter((r) => r.provider === "openai").map((r) => r.model)).toEqual(expect.arrayContaining(MODELS));
      expect(report.official.every((r) => r.provisional === false)).toBe(true);
      expect(report.legacyProvisional).toEqual(expect.arrayContaining([
        { provider: "openai", model: "gpt-4o", priceSource: "legacy", provisional: true },
        { provider: "openai", model: "gpt-4o-mini", priceSource: "legacy", provisional: true },
      ]));
      expect(report.legacyProvisional.some((m) => MODELS.includes(m.model as ModelId))).toBe(false);
    });
  });

  // ── 2. Cost Engine ────────────────────────────────────────────────────────

  describe("Cost Engine", () => {
    it("usa la unidad oficial: 1 USD = 4.000 OmniCredits, markup 1", () => {
      if (!process.env["OMNICREDITS_PER_USD"] && !process.env["OMNICREDITS_MARKUP"]) expect(OMNICREDITS).toEqual({ creditsPerUsd: 4000, markup: 1 });
    });

    for (const model of MODELS) {
      it(`${model}: 1M de entrada, de entrada cacheada y de salida dan el coste y los OmniCredits esperados, con precio de la BD`, async () => {
        const e = EXPECTED[model];
        const row = (await db.select().from(aiModelPricingTable).where(and(eq(aiModelPricingTable.model, model), eq(aiModelPricingTable.active, true))))[0]!;
        const cases = [
          ["input",  { inputTokens: M, outputTokens: 0 }, e.input, e.credits.input],
          ["cached", { inputTokens: M, outputTokens: 0, cachedTokens: M }, e.cached, e.credits.cached],
          ["output", { inputTokens: 0, outputTokens: M }, e.output, e.credits.output],
        ] as const;
        for (const [, usage, usd, credits] of cases) {
          const c = computeCost({ provider: "openai", model, ...usage });
          expect(c.technicalCostUsd).toBeCloseTo(usd, 6);
          expect(c.credits).toBe(credits);                                   // coste técnico × 4000
          expect(c.credits).toBe(usdToCredits(usd));
          expect(c).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false, pricingRowId: row.id });
        }
      });
    }

    it("una mezcla real suma cada línea a su precio y NO usa el precio de otro modelo ni el legacy", () => {
      // 1M entrada (200k cacheados) + 500k salida en Luna: 800k×0,20 + 200k×0,02 + 500k×1,20 = 0,16 + 0,004 + 0,6 = 0,764 USD
      const c = computeCost({ provider: "openai", model: "gpt-5.6-luna", inputTokens: M, cachedTokens: 200_000, outputTokens: 500_000 });
      expect(c.technicalCostUsd).toBeCloseTo(0.764, 6);
      expect(c.credits).toBe(3056);                                          // 0,764 × 4000
      // el mismo uso con gpt-4o-mini (legacy) daría OTRO importe, y con Sol otro distinto
      const legacy = computeCost({ provider: "openai", model: "gpt-4o-mini", inputTokens: M, cachedTokens: 200_000, outputTokens: 500_000 });
      expect(legacy.credits).not.toBe(c.credits);
      expect(computeCost({ provider: "openai", model: "gpt-5.6-sol", inputTokens: M, cachedTokens: 200_000, outputTokens: 500_000 }).credits).toBe(53_120); // 3,2 + 0,08 + 10 = 13,28 USD
    });

    it("los tokens de razonamiento se cobran como salida (no hay precio de razonamiento aparte)", () => {
      const c = computeCost({ provider: "openai", model: "gpt-5.6-terra", inputTokens: 0, outputTokens: 0, reasoningTokens: M });
      expect(c.technicalCostUsd).toBeCloseTo(12, 6);
      expect(c.credits).toBe(48_000);
    });

    it("la estimación previa de una llamada también usa el precio de la BD", () => {
      const e = estimateCost("openai", "gpt-5.6-sol", { inputTokens: M, maxOutputTokens: M });
      expect(e).toMatchObject({ priceSource: "db", provisional: false, basis: "estimated" });
      expect(e.technicalCostUsd).toBeCloseTo(24, 6);
      expect(e.credits).toBe(96_000);
    });
  });

  // ── 3. Simulación ─────────────────────────────────────────────────────────

  describe("simulación", () => {
    for (const model of MODELS) {
      it(`${model}: estima con precio oficial (db, no provisional), sin proveedor ni créditos consumidos`, async () => {
        const config = defaultAgentConfig();
        config.model = { provider: "openai", model };
        const r = simulateAgent({ agent: { id: 1, name: "Ana" }, versionNumber: 1, config, message: "Quiero un presupuesto", readTools: [], actionTools: [] });
        expect(r.route).toMatchObject({ provider: "openai", model });
        expect(r.estimate).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false });
        expect(r.notes.join(" ")).not.toMatch(/PROVISIONAL/);
        expect(r.estimate.typicalCredits).toBeCloseTo(r.estimate.typicalCostUsd * 4000, 3);
        expect(r.estimate.maxCredits).toBeCloseTo(r.estimate.maxCostUsd * 4000, 3);
        expect(await getBalance(org)).toBe(0);                                // la simulación no consume nada
      });
    }

    it("con un modelo legacy la misma simulación sigue marcada como provisional", () => {
      const config = defaultAgentConfig();
      config.model = { provider: "openai", model: "gpt-4o-mini" };
      const r = simulateAgent({ agent: { id: 1, name: "Ana" }, versionNumber: 1, config, message: "hola", readTools: [], actionTools: [] });
      expect(r.estimate).toMatchObject({ priceSource: "legacy", provisional: true });
      expect(r.notes.join(" ")).toMatch(/PROVISIONAL/);
    });
  });

  // ── 4. Consumo LIVE contra Postgres ───────────────────────────────────────

  describe("consumo LIVE (gateway + Cost Engine + ai_usage_logs + ledger)", () => {
    const deps = (route: ReturnType<typeof fakeRoute>): GatewayDeps => ({
      resolveRoutes: () => [route], checkBudgetBlocked, logAiCall, credits: creditsPort, cache: new ResponseCache(),
      sleep: async () => {}, ensurePricingLoaded: () => refreshPricing().then(() => {}), auditBlock: async () => {},
    });
    const live = (model: string, usage: GenerateResult["usage"], requestId: string) => callAI({
      mode: "live", orgId: org, userClerkId: "smoke", functionName: FN, requestId,
      messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
    }, deps(fakeRoute(model, usage)));

    it("cada modelo: el consumo se calcula como coste técnico × 4000 con precio db (no legacy/fallback) y queda trazado", async () => {
      await grantCredits(org, 1_000_000, { reference: "gpt56-grant" });
      let expectedSpent = 0;
      for (const model of MODELS) {
        const e = EXPECTED[model];
        const r = await live(model, { promptTokens: M, completionTokens: M, totalTokens: 2 * M, cachedTokens: 0 }, `live-${model}`);

        const usd = e.input + e.output;                                        // 1M entrada + 1M salida
        const credits = e.credits.input + e.credits.output;
        expect(r.costUsd).toBeCloseTo(usd, 6);
        expect(r.credits).toBe(credits);
        expect(r).toMatchObject({ provider: "openai", model, provisional: false });
        expectedSpent += credits;

        const [entry] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.reference, `live-${model}`));
        expect(Number(entry!.credits)).toBe(-credits);
        expect(Number(entry!.technicalCostUsd)).toBeCloseTo(usd, 6);
        expect(Number(entry!.credits)).toBeCloseTo(-Number(entry!.technicalCostUsd) * 4000, 3);   // créditos = coste técnico × 4000
        expect(entry!.metadata).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false });
        expect(entry).toMatchObject({ entryType: "consumption", provider: "openai", model });

        const [log] = await db.select().from(aiUsageLogsTable).where(and(eq(aiUsageLogsTable.functionName, FN), eq(aiUsageLogsTable.model, model)));
        expect(Number(log!.costUsd)).toBeCloseTo(usd, 6);
        expect(log!.metadata).toMatchObject({ priceSource: "db", priceKnown: true, provisional: false, credits });
      }
      expect(await getBalance(org)).toBe(1_000_000 - expectedSpent);           // 5.600 + 56.000 + 96.000
      expect(expectedSpent).toBe(157_600);
    });

    it("con tokens cacheados: usa el precio de entrada cacheada de la BD", async () => {
      const before = await getBalance(org);
      const r = await live("gpt-5.6-luna", { promptTokens: M, completionTokens: 0, totalTokens: M, cachedTokens: M }, "live-cached");
      expect(r.credits).toBe(80);                                              // 1M cacheados = $0,02 = 80 OmniCredits
      expect(await getBalance(org)).toBe(before - 80);
    });

    it("un modelo legacy en la misma base SIGUE marcándose provisional (no se confunde con el oficial)", async () => {
      const r = await live("gpt-4o-mini", { promptTokens: M, completionTokens: M, totalTokens: 2 * M }, "live-legacy");
      expect(r).toMatchObject({ model: "gpt-4o-mini", provisional: true });
      const [entry] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.reference, "live-legacy"));
      expect(entry!.metadata).toMatchObject({ priceSource: "legacy", provisional: true });
    });
  });
});
