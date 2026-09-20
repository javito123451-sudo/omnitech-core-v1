import { describe, it, expect } from "vitest";
import { buildPayload, isDirty, mapIssues, toBuilderValues } from "@/lib/agents/builder";
import { agent, config } from "./fixtures";

const a = agent(7, "Ventas");
const withCfg = (over: Parameters<typeof config>[0]) => toBuilderValues(a, config(over));

describe("builder — modelo y conocimiento", () => {
  const base = withCfg({
    model: { provider: "openai", model: "gpt-4o-mini", fallbacks: [{ provider: "openai", model: "gpt-4o" }] },
    knowledge: { workspace: false, entryIds: [1, 999], categories: ["ventas"] },
  });

  it("los valores iniciales salen de config.model y config.knowledge", () => {
    expect(base).toMatchObject({
      modelProvider: "openai", modelName: "gpt-4o-mini", modelFallbacks: [{ provider: "openai", model: "gpt-4o" }],
      knowledgeEntryIds: [1, 999], knowledgeWorkspace: false, knowledgeCategories: ["ventas"],
    });
    const empty = toBuilderValues(a, config({ model: {} }));
    expect(empty).toMatchObject({ modelProvider: "", modelName: "", modelFallbacks: [] });
  });

  it("sin cambios en modelo ni conocimiento no se envía ninguna de las dos secciones", () => {
    const p = buildPayload({ ...base, identityRole: "otro" }, base);
    expect(Object.keys(p.config!.config)).toEqual(["identity"]);
  });

  it("elegir un modelo envía la sección model ENTERA: provider+model y conserva los fallbacks", () => {
    const p = buildPayload({ ...base, modelProvider: "openai", modelName: "gpt-5.6-luna" }, base);
    expect(p).toEqual({ meta: null, config: { config: { model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o" }] } } } });
  });

  it("volver a «sin modelo fijo» envía model sin provider ni model (los fallbacks siguen)", () => {
    const p = buildPayload({ ...base, modelProvider: "", modelName: "" }, base);
    expect(p.config!.config.model).toEqual({ fallbacks: [{ provider: "openai", model: "gpt-4o" }] });
    const noFallbacks = withCfg({ model: { provider: "openai", model: "x" } });
    expect(buildPayload({ ...noFallbacks, modelProvider: "", modelName: "" }, noFallbacks).config!.config.model).toEqual({});
  });

  it("cambiar la selección de conocimiento envía la sección knowledge ENTERA: workspace y categories intactos", () => {
    const p = buildPayload({ ...base, knowledgeEntryIds: [1, 2, 999] }, base);
    expect(p.config).toEqual({ config: { knowledge: { workspace: false, entryIds: [1, 2, 999], categories: ["ventas"] } } });
  });

  it("un id de conocimiento que ya no está en el catálogo se conserva si el usuario no lo quita", () => {
    const p = buildPayload({ ...base, knowledgeEntryIds: [999, 2] }, base);
    expect(p.config!.config.knowledge!.entryIds).toContain(999);
  });

  it("el orden de los ids no cuenta como cambio", () => {
    expect(isDirty({ ...base, knowledgeEntryIds: [999, 1] }, base)).toBe(false);
    expect(isDirty({ ...base, knowledgeEntryIds: [1] }, base)).toBe(true);
    expect(isDirty({ ...base, modelName: "otro" }, base)).toBe(true);
  });

  it("nunca se envían tools ni permissions, aunque haya cambios en modelo y conocimiento", () => {
    const p = buildPayload({ ...base, modelName: "x", modelProvider: "openai", knowledgeEntryIds: [] }, base);
    expect(Object.keys(p.config!.config).sort()).toEqual(["knowledge", "model"]);
    expect(JSON.stringify(p)).not.toMatch(/"(tools|permissions|notes)"/);
  });

  it("los errores 400 de model/knowledge caen en su campo", () => {
    const { fields, other } = mapIssues([
      { path: ["model", "model"], message: "Modelo no válido" },
      { path: ["knowledge", "entryIds", 0], message: "Id no válido" },
      { path: ["tools", "read"], message: "raro" },
    ]);
    expect(fields.modelName).toBe("Modelo no válido");
    expect(fields.knowledgeEntryIds).toBe("Id no válido");
    expect(other).toEqual(["tools.read: raro"]);
  });
});
