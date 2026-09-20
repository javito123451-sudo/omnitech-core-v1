// El frontend no importa @workspace/db, así que las listas cerradas de Agent Factory se repiten en
// lib/agents/types.ts. Este test las compara con el esquema real para que no se desincronicen en silencio.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_CHANNELS, AGENT_STATUSES, type AgentConfig } from "@/lib/agents/types";
import { AGENT_STATUS_DEFS, getAgentStatusDef } from "@/lib/agents/agentStatus";

const schema = readFileSync(resolve(process.cwd(), "../../lib/db/src/schema/ai-agents.ts"), "utf8");

const list = (name: string): string[] => {
  const m = schema.match(new RegExp(`${name} = \\[([^\\]]*)\\] as const`));
  expect(m, `no se encontró ${name} en el esquema`).toBeTruthy();
  return [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
};

describe("tipos de Agent Factory frente al esquema real", () => {
  it("AGENT_STATUSES coincide con el backend", () => {
    expect([...AGENT_STATUSES]).toEqual(list("AGENT_STATUSES"));
  });

  it("AGENT_CHANNELS coincide con el backend", () => {
    expect([...AGENT_CHANNELS]).toEqual(list("AGENT_CHANNELS"));
  });

  it("AgentConfig tiene exactamente las secciones de agentConfigSchema", () => {
    const block = schema.slice(schema.indexOf("export const agentConfigSchema = z.object({"));
    const end = block.indexOf("\n});");
    const keys = [...block.slice(0, end).matchAll(/^  (\w+):/gm)].map((m) => m[1]!).sort();

    // Objeto tipado: si AgentConfig gana o pierde una sección, TypeScript falla aquí.
    const sample: AgentConfig = {
      identity: { role: "" }, objective: { what: "", audience: "", expectedOutcome: "" },
      personality: { tone: "", style: "", language: "", formality: "" },
      behavior: { instructions: "", rules: [], restrictions: [], avoid: [] }, businessContext: "",
      model: {}, parameters: { temperature: 0, maxOutputTokens: 1, maxToolRounds: 1, maxHistoryMessages: 0 },
      knowledge: { workspace: false, entryIds: [], categories: [] }, tools: { read: [], write: [] },
      permissions: { writesRequireConfirmation: true }, channels: [],
    };
    expect(Object.keys(sample).sort()).toEqual(keys);
  });
});

describe("estados de agente", () => {
  it("hay definición visual para cada estado real, y un estado desconocido se muestra con estilo neutro (no se oculta)", () => {
    for (const s of AGENT_STATUSES) expect(AGENT_STATUS_DEFS[s].label).toBeTruthy();
    expect(getAgentStatusDef("draft").label).toBe("Borrador");
    expect(getAgentStatusDef("published").label).toBe("Publicado");
    expect(getAgentStatusDef("paused").label).toBe("Pausado");
    expect(getAgentStatusDef("archived").label).toBe("Archivado");
    expect(getAgentStatusDef("otro")).toMatchObject({ label: "otro" });
  });

  it("los colores reutilizan la paleta de commercialStatus.ts (no hay colores nuevos)", () => {
    const commercial = readFileSync(resolve(process.cwd(), "src/lib/commercialStatus.ts"), "utf8");
    for (const s of AGENT_STATUSES) expect(commercial).toContain(AGENT_STATUS_DEFS[s].color);
  });
});
