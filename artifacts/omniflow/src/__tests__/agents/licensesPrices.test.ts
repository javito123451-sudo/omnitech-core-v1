// Control Center → Licencias debe mostrar la misma tarifa oficial que /plans y credit_plans.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("control-center/licenses.tsx — precios oficiales", () => {
  const src = readFileSync(resolve(process.cwd(), "src/pages/control-center/licenses.tsx"), "utf8");
  it("Starter 149, Professional 349, Business 699 y Enterprise a medida", () => {
    expect(src).toContain('price: "€149/mes"');
    expect(src).toContain('price: "€349/mes"');
    expect(src).toContain('price: "€699/mes"');
    expect(src).toContain('price: "A medida"');
  });
  it("no queda la tarifa antigua (99 / 299 / 1.000+)", () => {
    expect(src).not.toMatch(/€99\/mes/);
    expect(src).not.toMatch(/€299\/mes/);
    expect(src).not.toMatch(/1\.000\+/);
  });
});
