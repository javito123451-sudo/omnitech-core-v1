import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildModelCatalog, buildToolCatalog, knowledgeCatalogQuery } from "../catalogService";
import { TOOL_REGISTRY, type AgentTool } from "../toolRegistry";
import { listSkills } from "../../skills";
import { PROVIDER_CONFIG, isProviderAvailable } from "../../ai-gateway/providerRouter";

const cfg = { openai: { implemented: true }, claude: { implemented: false }, gemini: { implemented: false } };

describe("catálogo de tools", () => {
  const catalog = buildToolCatalog(TOOL_REGISTRY, listSkills());

  it("devuelve las 22 tools registradas: 11 de lectura y 11 de acción", () => {
    expect(catalog).toHaveLength(22);
    expect(catalog.filter((t) => t.kind === "read")).toHaveLength(11);
    expect(catalog.filter((t) => t.kind === "action")).toHaveLength(11);
  });

  it("los ids son únicos y coinciden exactamente con TOOL_REGISTRY y con el Skill Engine", () => {
    const ids = catalog.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(TOOL_REGISTRY.map((t) => t.id));
    expect(new Set(ids)).toEqual(new Set(listSkills().map((s) => s.id)));
  });

  it("read/action, permiso y módulo salen tal cual del registro (no se duplica ni se reinterpreta)", () => {
    for (const t of catalog) {
      const source = TOOL_REGISTRY.find((r) => r.id === t.id)!;
      expect(t.kind).toBe(source.kind);
      expect(t.permission).toBe(source.permission);
      expect(t.module).toBe(source.module);
      expect(t.permission).toBeTruthy();
      expect(t.module).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
    expect(catalog.find((t) => t.id === "create_task")).toMatchObject({ kind: "action", permission: "crm.write", module: "crm" });
    expect(catalog.find((t) => t.id === "list_tasks")).toMatchObject({ kind: "read", permission: "crm.read" });
  });

  it("los params vienen del Skill Engine y son serializables", () => {
    for (const t of catalog) {
      const skill = listSkills().find((s) => s.id === t.id)!;
      expect(t.params.map((p) => p.name)).toEqual(skill.params.map((p) => p.name));
      for (const p of t.params) {
        expect(typeof p.required).toBe("boolean");
        expect(typeof p.type).toBe("string");
      }
    }
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  it("no expone funciones ni implementación interna", () => {
    const walk = (v: unknown, path: string): void => {
      expect(typeof v, path).not.toBe("function");
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(catalog, "catalog");
    for (const t of catalog) expect(Object.keys(t).sort()).toEqual(["description", "id", "keywords", "kind", "module", "name", "params", "permission"]);
    expect(JSON.stringify(catalog)).not.toMatch(/execute|=>|function\s*\(/);
  });

  it("solo incluye tools que existen en AMBOS sitios: una del registro sin skill no sale", () => {
    const orphan: AgentTool = { id: "no_such_skill", kind: "read", permission: "crm.read", module: "crm", keywords: [] };
    const out = buildToolCatalog([...TOOL_REGISTRY, orphan], listSkills());
    expect(out.map((t) => t.id)).not.toContain("no_such_skill");
    expect(buildToolCatalog(TOOL_REGISTRY.slice(0, 3), listSkills())).toHaveLength(3);
  });

  it("un valor por defecto no serializable no se filtra al catálogo", () => {
    const skills = [{ id: "list_tasks", name: "n", description: "d", params: [
      { name: "a", type: "string" as const, description: "x", default: () => 1 },
      { name: "b", type: "number" as const, description: "y", default: 5 },
    ] }];
    const [t] = buildToolCatalog([TOOL_REGISTRY.find((x) => x.id === "list_tasks")!], skills);
    expect(t!.params[0]).not.toHaveProperty("default");
    expect(t!.params[1]).toMatchObject({ default: 5, required: false });
  });

  it("no modifica TOOL_REGISTRY ni el Skill Engine (solo lectura)", () => {
    const before = JSON.stringify(TOOL_REGISTRY);
    buildToolCatalog(TOOL_REGISTRY, listSkills());
    expect(JSON.stringify(TOOL_REGISTRY)).toBe(before);
    catalog[0]!.keywords.push("mutado");
    expect(TOOL_REGISTRY[0]!.keywords).not.toContain("mutado");
  });
});

describe("catálogo de modelos y providers", () => {
  const emptyReport = { official: [], dbProvisional: [], legacyProvisional: [] };
  const on = () => true;

  it("solo aparecen los providers implementados; los stubs (claude, gemini) nunca", () => {
    const c = buildModelCatalog({ providerConfig: cfg, isAvailable: on, report: emptyReport });
    expect(c.providers).toEqual([{ id: "openai", available: true }]);
    expect(JSON.stringify(c)).not.toMatch(/claude|gemini/);
  });

  it("un provider implementado sin clave se marca available:false y ninguno de sus modelos se ofrece", () => {
    const c = buildModelCatalog({ providerConfig: cfg, isAvailable: () => false, report: { ...emptyReport, official: [{ provider: "openai", model: "gpt-x", source: "s" }] } });
    expect(c.providers).toEqual([{ id: "openai", available: false }]);
    expect(c.models).toEqual([]);
  });

  it("los modelos con fila vigente salen del informe de ai_model_pricing, con su provisional y su fuente (nada de gpt-5.6 escrito en el catálogo)", () => {
    const c = buildModelCatalog({
      providerConfig: cfg, isAvailable: on,
      report: { ...emptyReport,
        official: [{ provider: "openai", model: "gpt-5.6-luna", source: "https://docs.example/luna" }],
        dbProvisional: [{ provider: "openai", model: "modelo-nuevo", source: null }] },
    });
    expect(c.models).toEqual([
      { provider: "openai", model: "gpt-5.6-luna", provisional: false, priceKnown: true, priceSource: "db", source: "https://docs.example/luna" },
      { provider: "openai", model: "modelo-nuevo", provisional: true, priceKnown: true, priceSource: "db", source: null },
    ]);
    expect(readFileSync(fileURLToPath(new URL("../catalogService.ts", import.meta.url)), "utf8")).not.toMatch(/gpt-5/i);
  });

  it("los heredados salen como provisionales y una fila de la BD manda sobre el heredado del mismo modelo", () => {
    const c = buildModelCatalog({
      providerConfig: cfg, isAvailable: on,
      report: {
        official: [], dbProvisional: [{ provider: "openai", model: "gpt-4o-mini", source: "s" }],
        legacyProvisional: [{ provider: "openai", model: "gpt-4o-mini" }, { provider: "openai", model: "gpt-4o" }],
      },
    });
    expect(c.models.filter((m) => m.model === "gpt-4o-mini")).toHaveLength(1);
    expect(c.models.find((m) => m.model === "gpt-4o-mini")).toMatchObject({ priceSource: "db", source: "s" });
    expect(c.models.find((m) => m.model === "gpt-4o")).toMatchObject({ priceSource: "legacy", provisional: true, priceKnown: true, source: null });
  });

  it("un modelo con precio validado gana a la misma fila marcada provisional", () => {
    const c = buildModelCatalog({
      providerConfig: cfg, isAvailable: on,
      report: { official: [{ provider: "openai", model: "m", source: "a" }], dbProvisional: [{ provider: "openai", model: "m", source: "b" }], legacyProvisional: [] },
    });
    expect(c.models).toEqual([{ provider: "openai", model: "m", provisional: false, priceKnown: true, priceSource: "db", source: "a" }]);
  });

  it("los modelos de embeddings no se ofrecen para un agente", () => {
    const c = buildModelCatalog({
      providerConfig: cfg, isAvailable: on,
      report: { official: [{ provider: "openai", model: "text-embedding-3-large", source: "s" }], dbProvisional: [], legacyProvisional: [{ provider: "openai", model: "text-embedding-3-small" }] },
    });
    expect(c.models).toEqual([]);
  });

  it("ordena por provider y modelo", () => {
    const c = buildModelCatalog({ providerConfig: cfg, isAvailable: on, report: { official: [], dbProvisional: [], legacyProvisional: [{ provider: "openai", model: "b" }, { provider: "openai", model: "a" }] } });
    expect(c.models.map((m) => m.model)).toEqual(["a", "b"]);
  });

  it("con la configuración real: openai solo si hay clave; claude y gemini nunca", () => {
    const before = process.env["OPENAI_API_KEY"];
    const report = { official: [{ provider: "openai", model: "gpt-x", source: "s" }], dbProvisional: [], legacyProvisional: [{ provider: "openai", model: "gpt-4o" }] };
    try {
      delete process.env["OPENAI_API_KEY"];
      const off = buildModelCatalog({ providerConfig: PROVIDER_CONFIG, isAvailable: isProviderAvailable, report });
      expect(off.providers).toEqual([{ id: "openai", available: false }]);
      expect(off.models).toEqual([]);
      process.env["OPENAI_API_KEY"] = "x";
      const enabled = buildModelCatalog({ providerConfig: PROVIDER_CONFIG, isAvailable: isProviderAvailable, report });
      expect(enabled.providers).toEqual([{ id: "openai", available: true }]);
      expect(enabled.models.map((m) => m.model)).toEqual(["gpt-4o", "gpt-x"]);
    } finally {
      if (before === undefined) delete process.env["OPENAI_API_KEY"]; else process.env["OPENAI_API_KEY"] = before;
    }
  });

  it("no expone precios, claves, variables de entorno, timeouts ni rutas internas", () => {
    const before = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-super-secreta-123";
    try {
      // Aunque la fuente trajera más campos (precios), el catálogo solo copia los suyos.
      const rowWithPrices = { provider: "openai", model: "gpt-x", source: "https://docs.example/pricing", inputCost: 0.2, outputCost: 1.2 };
      const c = buildModelCatalog({
        providerConfig: PROVIDER_CONFIG, isAvailable: isProviderAvailable,
        report: { official: [rowWithPrices], dbProvisional: [], legacyProvisional: [] },
      });
      const text = JSON.stringify(c);
      expect(text).not.toContain("sk-super-secreta-123");
      expect(text).not.toMatch(/API_KEY|apiKeyEnv|OPENAI_|ANTHROPIC_|GEMINI_|timeoutMs|process\.env|inputCost|outputCost|Per1M|USD/);
      for (const m of c.models) expect(Object.keys(m).sort()).toEqual(["model", "priceKnown", "priceSource", "provider", "provisional", "source"]);
      for (const p of c.providers) expect(Object.keys(p).sort()).toEqual(["available", "id"]);
    } finally {
      if (before === undefined) delete process.env["OPENAI_API_KEY"]; else process.env["OPENAI_API_KEY"] = before;
    }
  });
});

describe("catálogo de knowledge — consulta", () => {
  it("filtra por el workspace pedido y por entradas activas, y NUNCA selecciona el contenido", () => {
    const q = knowledgeCatalogQuery(42).toSQL();
    expect(q.sql).toMatch(/"org_id"\s*=\s*\$1/);
    expect(q.sql).toMatch(/"is_active"\s*=\s*\$2/);
    expect(q.params.slice(0, 2)).toEqual([42, true]);
    expect(q.sql).not.toMatch(/"content"/);
    expect(q.sql).toMatch(/select "id", "title", "category" from "knowledge_base"/i);
  });

  it("la consulta de otro workspace lleva SU id (no hay forma de pedir otro)", () => {
    expect(knowledgeCatalogQuery(7).toSQL().params[0]).toBe(7);
    expect(knowledgeCatalogQuery(8).toSQL().params[0]).toBe(8);
  });
});
