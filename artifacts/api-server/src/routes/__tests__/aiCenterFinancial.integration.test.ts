// El informe financiero del AI Center (ingresos por plan vs. coste de IA) no debe tener su propia tabla
// de precios: los ingresos salen de credit_plans (OmniCredits), la fuente comercial única.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { getFinancialData } from "../ai-center-routes";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe("AI Center — ingresos por plan", () => {
  it("ya no existe la constante PLAN_REVENUE con precios propios (49, 200…)", () => {
    const src = readFileSync(fileURLToPath(new URL("../ai-center-routes.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/PLAN_REVENUE/);
    expect(src).toMatch(/listPlanConfigs/);
  });
});

describe.skipIf(!hasRealDb)("AI Center — getFinancialData usa los precios oficiales de credit_plans", () => {
  let orgs: number[] = [];
  const plans = ["starter", "professional", "business", "enterprise", "free", "growth"];
  beforeAll(async () => {
    orgs = await createTempOrgs(plans.length, "ai-center-fin");
    for (const [i, plan] of plans.entries()) await db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgs[i]!));
  });
  afterAll(async () => { await deleteTempOrgs(orgs); });

  it("Starter 149, Professional 349, Business 699; Enterprise a medida; free y nombres antiguos sin ingreso de catálogo", async () => {
    const rows = await getFinancialData();
    const byPlan = Object.fromEntries(plans.map((p, i) => [p, rows.find((r) => r.orgId === orgs[i])!]));
    expect(byPlan["starter"]).toMatchObject({ revenueEur: 149, priceCustom: false });
    expect(byPlan["professional"]).toMatchObject({ revenueEur: 349, priceCustom: false });
    expect(byPlan["business"]).toMatchObject({ revenueEur: 699, priceCustom: false });
    expect(byPlan["enterprise"]).toMatchObject({ revenueEur: 0, priceCustom: true });   // sin valor inventado
    expect(byPlan["free"]).toMatchObject({ revenueEur: 0, priceCustom: false });
    expect(byPlan["growth"]).toMatchObject({ revenueEur: 0, priceCustom: false });      // nombre antiguo: compatible, sin precio
  });
});
