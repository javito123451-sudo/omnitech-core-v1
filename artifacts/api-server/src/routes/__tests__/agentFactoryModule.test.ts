// Omni Agent Factory tiene su propio módulo (omni_agent_factory); ai_agents sigue gobernando Memoria y Telegram.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("módulo omni_agent_factory", () => {
  it("/agents exige omni_agent_factory; /memory y /telegram siguen exigiendo ai_agents", () => {
    const idx = src("routes/index.ts");
    expect(idx).toMatch(/router\.use\("\/agents",\s+requireModule\("omni_agent_factory"\)/);
    expect(idx).toMatch(/router\.use\("\/memory",\s+requireModule\("ai_agents"\)/);
    expect(idx).toMatch(/router\.use\("\/telegram",\s+requireModule\("ai_agents"\)/);
  });

  it("está en el catálogo de Control Center, en la matriz y en el alta de workspaces", () => {
    const cc = src("routes/control-center.ts");
    expect(cc.match(/slug: "omni_agent_factory"/g)).toHaveLength(2);
    expect(cc).toContain('"ai_agents", "omni_agent_factory", "automations"');
  });

  it("el estado por plan y el módulo enviado al frontend lo incluyen; la migración hereda de ai_agents sin sobrescribir", () => {
    const auth = src("routes/auth.ts");
    expect(auth.match(/"omni_agent_factory"/g)!.length).toBeGreaterThanOrEqual(4);
    const mig = src("utils/startupMigrations.ts");
    expect(mig).toMatch(/SELECT mc\.org_id, 'omni_agent_factory', mc\.is_enabled, 'system-fix-ag'/);
    expect(mig).toMatch(/module_slug = 'ai_agents'\s+ON CONFLICT \(org_id, module_slug\) DO NOTHING/);
  });
});
