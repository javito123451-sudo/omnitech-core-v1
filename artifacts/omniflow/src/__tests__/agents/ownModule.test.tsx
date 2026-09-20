// Omni Agent Factory es un módulo propio (omni_agent_factory), independiente de ai_agents (Memoria, Telegram, Conversaciones).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const session = vi.hoisted(() => ({ modules: {} as Record<string, boolean> }));
vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({ loading: false, canAccessModule: (k: string) => k === "crm" || session.modules[k] === true }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", () => {}] }));

import { ModuleGuard } from "@/components/ModuleGuard";

const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("Omni Agent Factory como módulo propio", () => {
  it("con ai_agents pero sin omni_agent_factory NO se ve la Fábrica", () => {
    session.modules = { ai_agents: true };
    render(<ModuleGuard moduleKey="omni_agent_factory"><p>fabrica</p></ModuleGuard>);
    expect(screen.queryByText("fabrica")).toBeNull();
    expect(screen.getByText("Omni Agent Factory")).toBeTruthy();
  });

  it("con omni_agent_factory se ve la Fábrica aunque ai_agents esté desactivado", () => {
    session.modules = { omni_agent_factory: true, ai_agents: false };
    render(<ModuleGuard moduleKey="omni_agent_factory"><p>fabrica</p></ModuleGuard>);
    expect(screen.getByText("fabrica")).toBeTruthy();
  });

  it("las rutas /agents y el menú Agentes usan omni_agent_factory; Memoria y Base de Conocimiento siguen en ai_agents", () => {
    const app = src("App.tsx");
    expect(app).toMatch(/moduleKey="omni_agent_factory">\s*<AgentsPage \/>/);
    expect(app).toMatch(/moduleKey="omni_agent_factory">\s*<AgentDetailPage \/>/);
    const layout = src("components/layout/MainLayout.tsx");
    const agentsItems = layout.split("\n").filter((l) => l.includes('href: "/agents"'));
    expect(agentsItems).toHaveLength(2);
    for (const l of agentsItems) expect(l).toContain('moduleKey: "omni_agent_factory"');
    for (const l of layout.split("\n").filter((l) => /href: "\/(memory|knowledge-base|telegram-inbox)"/.test(l))) expect(l).toContain('moduleKey: "ai_agents"');
  });
});
