import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentConfigSchema, defaultAgentConfig } from "@workspace/db";
import { buildModelCatalog, type ModelCatalog } from "../catalogService";
import { modelNeedsValidation, validateModelForPublish } from "../publishValidation";
import { validateForPublishDetailed, validateForPublish } from "../agentService";
import { PROVIDER_CONFIG, isProviderAvailable } from "../../ai-gateway/providerRouter";
import { listSkills } from "../../skills";
import { TOOL_REGISTRY } from "../toolRegistry";

const catalog = (over: Partial<ModelCatalog> = {}): ModelCatalog => ({
  providers: [{ id: "openai", available: true }],
  models: [
    { provider: "openai", model: "gpt-5.6-luna", provisional: false, priceKnown: true, priceSource: "db", source: "s" },
    { provider: "openai", model: "gpt-4o-mini", provisional: true, priceKnown: true, priceSource: "legacy", source: null },
  ],
  ...over,
});
const m = (model: object) => model as ReturnType<typeof defaultAgentConfig>["model"];

const savedProvider = process.env["AI_PROVIDER"];
afterEach(() => { if (savedProvider === undefined) delete process.env["AI_PROVIDER"]; else process.env["AI_PROVIDER"] = savedProvider; });

describe("validación del modelo y proveedor al publicar (contra el catálogo real)", () => {
  it("sin modelo fijo ni fallbacks: comportamiento actual, sin consultar el catálogo", () => {
    expect(modelNeedsValidation(m({}))).toBe(false);
    expect(validateModelForPublish(m({}), catalog())).toEqual([]);
  });

  it("provider y modelo válidos", () => {
    expect(validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna" }), catalog())).toEqual([]);
  });

  it("provider inexistente → UNKNOWN_PROVIDER en config.model.provider", () => {
    const p = validateModelForPublish(m({ provider: "acme", model: "x" }), catalog());
    expect(p).toEqual([{ field: "config.model.provider", code: "UNKNOWN_PROVIDER", message: "Proveedor de IA desconocido: acme" }]);
  });

  it("un provider que existe pero no está implementado (claude, gemini) tampoco es válido: no está en el catálogo", () => {
    for (const provider of ["claude", "gemini"]) {
      expect(validateModelForPublish(m({ provider, model: "cualquiera" }), catalog())).toMatchObject([{ code: "UNKNOWN_PROVIDER", field: "config.model.provider" }]);
    }
  });

  it("provider implementado pero no disponible (sin clave) → PROVIDER_UNAVAILABLE", () => {
    const off = catalog({ providers: [{ id: "openai", available: false }], models: [] });
    const p = validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna" }), off);
    expect(p).toMatchObject([{ code: "PROVIDER_UNAVAILABLE", field: "config.model.provider" }]);
    expect(p[0]!.message).toMatch(/no está disponible/);
  });

  it("modelo inexistente → UNKNOWN_MODEL en config.model.model", () => {
    const p = validateModelForPublish(m({ provider: "openai", model: "gpt-9-inventado" }), catalog());
    expect(p).toEqual([{ field: "config.model.model", code: "UNKNOWN_MODEL", message: "El modelo «gpt-9-inventado» no está disponible para el proveedor «openai»." }]);
  });

  it("un modelo real de otro proveedor no vale para este (se valida el PAR)", () => {
    const two = catalog({ providers: [{ id: "openai", available: true }, { id: "otro", available: true }] });
    expect(validateModelForPublish(m({ provider: "otro", model: "gpt-5.6-luna" }), two)).toMatchObject([{ code: "UNKNOWN_MODEL" }]);
  });

  it("solo modelo (sin provider): se resuelve con el proveedor por defecto del router", () => {
    delete process.env["AI_PROVIDER"];
    expect(validateModelForPublish(m({ model: "gpt-5.6-luna" }), catalog())).toEqual([]);
    expect(validateModelForPublish(m({ model: "inventado" }), catalog())).toMatchObject([{ code: "UNKNOWN_MODEL" }]);
  });

  it("solo provider (sin modelo): se resuelve con el modelo por defecto del router, que también debe estar en el catálogo", () => {
    expect(validateModelForPublish(m({ provider: "openai" }), catalog())).toEqual([]);            // gpt-4o-mini está en el catálogo
    const without = catalog({ models: [catalog().models[0]!] });
    expect(validateModelForPublish(m({ provider: "openai" }), without)).toMatchObject([{ code: "UNKNOWN_MODEL" }]);
  });

  it("fallback válido", () => {
    expect(validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }] }), catalog())).toEqual([]);
  });

  it("fallback inexistente impide publicar aunque el modelo principal sea válido", () => {
    const p = validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "fantasma" }] }), catalog());
    expect(p).toEqual([{ field: "config.model.fallbacks[0].model", code: "UNKNOWN_MODEL", message: "El modelo «fantasma» no está disponible para el proveedor «openai»." }]);
  });

  it("varios fallbacks con uno inválido: solo se señala ese", () => {
    const p = validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna", fallbacks: [
      { provider: "openai", model: "gpt-4o-mini" }, { provider: "acme", model: "x" }, { provider: "openai", model: "gpt-5.6-luna" },
    ] }), catalog());
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ field: "config.model.fallbacks[1].provider", code: "UNKNOWN_PROVIDER" });
  });

  it("solo fallbacks (sin modelo principal): se validan igualmente", () => {
    expect(modelNeedsValidation(m({ fallbacks: [{ provider: "openai", model: "x" }] }))).toBe(true);
    expect(validateModelForPublish(m({ fallbacks: [{ provider: "openai", model: "x" }] }), catalog())).toMatchObject([{ field: "config.model.fallbacks[0].model" }]);
  });

  it("los mensajes no llevan secretos, variables de entorno ni rutas internas", () => {
    process.env["OPENAI_API_KEY"] = "sk-no-debe-salir";
    try {
      const p = validateModelForPublish(m({ provider: "openai", model: "fantasma", fallbacks: [{ provider: "claude" }] }), catalog());
      const text = JSON.stringify(p);
      expect(text).not.toMatch(/sk-no-debe-salir|API_KEY|process\.env|apiKeyEnv|timeout|node_modules|\/src\//);
    } finally { delete process.env["OPENAI_API_KEY"]; }
  });

  it("con las fuentes reales (buildModelCatalog + PROVIDER_CONFIG + informe de precios) el catálogo y la validación coinciden", () => {
    process.env["OPENAI_API_KEY"] = "x";
    try {
      const real = buildModelCatalog({
        providerConfig: PROVIDER_CONFIG, isAvailable: isProviderAvailable,
        report: { official: [{ provider: "openai", model: "gpt-5.6-luna", source: "s" }], dbProvisional: [], legacyProvisional: [{ provider: "openai", model: "gpt-4o" }] },
      });
      expect(validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-luna" }), real)).toEqual([]);
      expect(validateModelForPublish(m({ provider: "openai", model: "gpt-4o" }), real)).toEqual([]);
      expect(validateModelForPublish(m({ provider: "openai", model: "gpt-5.6-sol" }), real)).toMatchObject([{ code: "UNKNOWN_MODEL" }]);
      expect(validateModelForPublish(m({ provider: "claude" }), real)).toMatchObject([{ code: "UNKNOWN_PROVIDER" }]);
    } finally { delete process.env["OPENAI_API_KEY"]; }
  });

  it("no hay ninguna lista de modelos ni de providers escrita en la validación", () => {
    const src = readFileSync(fileURLToPath(new URL("../publishValidation.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/gpt-|claude|gemini|"openai"/i);
  });
});

// ── Herramientas y resto de reglas ───────────────────────────────────────────────────────────────────
const known = new Set(listSkills().map((s) => s.id));
const ready = () => {
  const c = defaultAgentConfig();
  c.objective.what = "Atender consultas";
  c.behavior.instructions = "Responde con amabilidad.";
  return c;
};
const detail = (c = ready()) => validateForPublishDetailed({ name: "Ana" }, c, known);

describe("validación de herramientas al publicar", () => {
  it("una configuración completa no tiene problemas", () => expect(detail()).toEqual([]));

  it("herramienta válida (lectura en read, acción en write)", () => {
    const c = ready(); c.tools.read = ["list_tasks"]; c.tools.write = ["create_task"];
    expect(detail(c)).toEqual([]);
  });

  it("herramienta desconocida → UNKNOWN_TOOL con su campo", () => {
    const c = ready(); c.tools.read = ["hackear_planeta"];
    expect(detail(c)).toEqual([{ field: "config.tools.read", code: "UNKNOWN_TOOL", message: "Herramienta desconocida: hackear_planeta" }]);
  });

  it("una herramienta que el Skill Engine no conoce no se publica aunque esté en el registro (y al revés)", () => {
    const c = ready(); c.tools.read = ["list_tasks"];
    const withoutSkill = new Set([...known].filter((id) => id !== "list_tasks"));
    expect(validateForPublishDetailed({ name: "Ana" }, c, withoutSkill)).toMatchObject([{ code: "UNKNOWN_TOOL" }]);
    expect(validateForPublishDetailed({ name: "Ana" }, c, new Set([...known, "solo_skill"]))).toEqual([]);
    const d = ready(); d.tools.read = ["solo_skill"];
    expect(validateForPublishDetailed({ name: "Ana" }, d, new Set([...known, "solo_skill"]))).toMatchObject([{ code: "UNKNOWN_TOOL" }]);
  });

  it("kind incorrecto: acción en «puede leer» y lectura en «puede hacer» → TOOL_KIND_MISMATCH", () => {
    const a = ready(); a.tools.read = ["create_task"];
    expect(detail(a)).toMatchObject([{ code: "TOOL_KIND_MISMATCH", field: "config.tools.read" }]);
    const b = ready(); b.tools.write = ["list_tasks"];
    expect(detail(b)).toMatchObject([{ code: "TOOL_KIND_MISMATCH", field: "config.tools.write" }]);
  });

  it("declarada en las dos listas → DUPLICATE_TOOL", () => {
    const c = ready(); c.tools.read = ["create_task"]; c.tools.write = ["create_task"];
    expect(detail(c).map((p) => p.code)).toContain("DUPLICATE_TOOL");
  });

  it("writesRequireConfirmation:false no se puede publicar → CONFIRMATION_REQUIRED", () => {
    const c = ready(); c.permissions.writesRequireConfirmation = false;
    expect(detail(c)).toEqual([{ field: "config.permissions.writesRequireConfirmation", code: "CONFIRMATION_REQUIRED", message: "Ejecutar acciones sin confirmación humana todavía no está soportado." }]);
  });

  it("permission, module y kind NO son configurables: la configuración solo guarda ids y el resto lo pone el registro", () => {
    const parsed = agentConfigSchema.parse({ ...defaultAgentConfig(), tools: { read: ["list_tasks"], write: [], permission: "crm.delete", module: "x", kind: "read" } });
    expect(Object.keys(parsed.tools).sort()).toEqual(["read", "write"]);
    expect(() => agentConfigSchema.parse({ ...defaultAgentConfig(), tools: { read: [{ id: "list_tasks", permission: "crm.delete" }], write: [] } })).toThrow();
    // los datos de permiso y módulo salen del registro
    expect(TOOL_REGISTRY.find((t) => t.id === "create_task")).toMatchObject({ permission: "crm.write", module: "crm", kind: "action" });
  });

  it("los textos históricos se mantienen (validateForPublish devuelve los mismos mensajes)", () => {
    const c = ready(); c.tools.read = ["create_task"];
    expect(validateForPublish({ name: "Ana" }, c, known)).toEqual(detail(c).map((p) => p.message));
    expect(validateForPublish({ name: "Ana" }, c, known).join(" ")).toMatch(/create_task.*modifica datos/);
  });

  it("nombre, objetivo e instrucciones siguen siendo obligatorios, con su campo", () => {
    expect(validateForPublishDetailed({ name: " " }, defaultAgentConfig(), known).map((p) => p.code).sort())
      .toEqual(["MISSING_INSTRUCTIONS", "MISSING_NAME", "MISSING_OBJECTIVE"]);
  });
});
