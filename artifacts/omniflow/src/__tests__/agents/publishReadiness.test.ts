import { describe, it, expect } from "vitest";
import { NOT_AVAILABLE_NOW, deniedByAccess, publishBlockers } from "@/lib/agents/publishReadiness";
import { config, effectiveAccess, knowledgeCatalog, modelCatalog, toolCatalog } from "./fixtures";
import type { EffectiveAccessResponse } from "@/lib/agents/types";

const run = (cfg = config(), access: EffectiveAccessResponse = effectiveAccess(), over: Partial<Parameters<typeof publishBlockers>[0]> = {}) =>
  publishBlockers({ config: cfg, models: modelCatalog(), knowledge: knowledgeCatalog(), tools: toolCatalog(), access, ...over });

describe("publishBlockers (ayuda previa; el backend valida igualmente)", () => {
  it("una configuración cuyo modelo, conocimiento y herramientas están en los catálogos no bloquea", () => {
    expect(run(config({ model: { provider: "openai", model: "gpt-5.6-luna" }, knowledge: { workspace: false, entryIds: [1, 2], categories: [] }, tools: { read: ["list_tasks"], write: ["create_task"] } }))).toEqual([]);
  });

  it("sin modelo fijo (predeterminado) no bloquea", () => {
    expect(run(config({ model: {} }))).toEqual([]);
  });

  it("modelo legacy: bloquea con «Configuración existente no disponible actualmente»", () => {
    const b = run(config({ model: { provider: "openai", model: "gpt-3.5-legacy" } }));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ key: "model", area: "model" });
    expect(b[0]!.detail).toContain(NOT_AVAILABLE_NOW);
  });

  it("provider que no está en el catálogo (claude, inventado) o no disponible bloquea", () => {
    expect(run(config({ model: { provider: "claude", model: "x" } }))[0]!.detail).toMatch(/proveedor no está en el catálogo/);
    const off = modelCatalog(); off.providers = [{ id: "openai", available: false }]; off.models = [];
    expect(run(config({ model: { provider: "openai", model: "gpt-5.6-luna" } }), effectiveAccess(), { models: off })[0]!.detail).toMatch(/no está disponible/);
  });

  it("solo modelo o solo proveedor: se comprueba lo que se puede sin adivinar el valor por defecto", () => {
    expect(run(config({ model: { model: "gpt-5.6-luna" } }))).toEqual([]);
    expect(run(config({ model: { model: "inventado" } }))).toHaveLength(1);
    expect(run(config({ model: { provider: "openai" } }))).toEqual([]);
  });

  it("cada fallback se comprueba por separado", () => {
    const b = run(config({ model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }, { provider: "openai", model: "fantasma" }] } }));
    expect(b.map((x) => x.key)).toEqual(["fallback-1"]);
    expect(b[0]!.label).toContain("Modelo de respaldo 2");
  });

  it("conocimiento legacy: un id que el catálogo no devuelve bloquea", () => {
    const b = run(config({ knowledge: { workspace: false, entryIds: [1, 999], categories: [] } }));
    expect(b.map((x) => x.key)).toEqual(["knowledge-999"]);
    expect(b[0]!.detail).toContain(NOT_AVAILABLE_NOW);
  });

  it("tool legacy o de tipo incorrecto bloquea; una tool duplicada según el backend también", () => {
    expect(run(config({ tools: { read: ["old_tool"], write: [] } })).map((x) => x.key)).toEqual(["tool-old_tool"]);
    expect(run(config({ tools: { read: ["create_task"], write: [] } })).map((x) => x.key)).toEqual(["tool-create_task-kind"]);
    const access = effectiveAccess({ tools: [{ toolId: "list_tasks", declaredAs: "write", kind: "read", permission: "crm.read", module: "crm", allowed: false, reason: "duplicate_declaration", requiresConfirmation: false, message: "Herramienta declarada dos veces." }] });
    expect(run(config({ tools: { read: ["list_tasks"], write: [] } }), access).map((x) => x.key)).toContain("tool-list_tasks-dup");
  });

  it("writesRequireConfirmation:false bloquea", () => {
    expect(run(config({ permissions: { writesRequireConfirmation: false } })).map((x) => x.key)).toEqual(["confirmation"]);
  });

  it("que TU rol no pueda usar una herramienta no bloquea: es solo información", () => {
    const access = effectiveAccess({ tools: [
      { toolId: "create_task", declaredAs: "write", kind: "action", permission: "crm.write", module: "crm", allowed: false, reason: "missing_permission", requiresConfirmation: false, message: "El rol no tiene el permiso" },
      { toolId: "get_invoice", declaredAs: "read", kind: "read", permission: "accounting.read", module: "omni_accounting", allowed: false, reason: "module_disabled", requiresConfirmation: false, message: "módulo" },
    ] });
    expect(run(config({ tools: { read: ["get_invoice"], write: ["create_task"] } }), access)).toEqual([]);
    expect(deniedByAccess(access).map((t) => t.toolId)).toEqual(["create_task", "get_invoice"]);
  });

  it("no toca la configuración que revisa", () => {
    const c = config({ model: { provider: "openai", model: "viejo" } });
    const before = JSON.stringify(c);
    run(c);
    expect(JSON.stringify(c)).toBe(before);
  });
});
