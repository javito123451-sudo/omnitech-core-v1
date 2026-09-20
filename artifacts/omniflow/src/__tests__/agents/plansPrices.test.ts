// La página /plans debe mostrar exclusivamente los precios comerciales oficiales (fuente: credit_plans / OmniCredits).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLANS } from "@/pages/plans";

describe("plans.tsx — precios oficiales", () => {
  it("Starter 149, Professional 349, Business 699 y Enterprise a medida", () => {
    expect(Object.fromEntries(PLANS.map((p) => [p.key, p.price]))).toEqual({
      starter: "149€/mes", professional: "349€/mes", business: "699€/mes", enterprise: "A medida",
    });
  });

  it("los nombres internos de los planes no cambian (compatibilidad)", () => {
    expect(PLANS.map((p) => [p.key, p.name])).toEqual([
      ["starter", "Starter"], ["professional", "Professional"], ["business", "Business"], ["enterprise", "Enterprise"],
    ]);
  });

  it("no queda ningún precio antiguo en el código de la página", () => {
    const src = readFileSync(resolve(process.cwd(), "src/pages/plans.tsx"), "utf8");
    expect(src).not.toMatch(/(?<!\d)99\s?€/);        // Starter 99
    expect(src).not.toMatch(/(?<!\d)299\s?€/);       // Business 299
    expect(src).not.toMatch(/1\.000\s?€/);           // Enterprise 1.000€+
    expect(src).not.toMatch(/€\s?\+/);
    // 149 solo es de Starter y 349 de Professional (antes 149 era el precio de Professional)
    expect(PLANS.filter((p) => p.price.includes("149"))).toHaveLength(1);
    expect(PLANS.find((p) => p.key === "professional")!.price).not.toContain("149");
  });

  it("Enterprise no tiene un importe inventado", () => {
    expect(PLANS.find((p) => p.key === "enterprise")!.price).not.toMatch(/\d/);
  });
});
