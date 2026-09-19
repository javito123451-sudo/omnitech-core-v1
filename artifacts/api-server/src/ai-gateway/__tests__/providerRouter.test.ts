// El router decide proveedor y modelo sin acoplar a los agentes a uno concreto.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveRoutes, previewRoute, isProviderAvailable, NoProviderAvailableError, PLAN_DEFAULTS } from "../providerRouter";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("AI_PROVIDER", "openai");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Provider Router", () => {
  it("por defecto usa el proveedor global y el modelo por defecto", () => {
    const [route] = resolveRoutes();
    expect(route!.providerId).toBe("openai");
    expect(route!.model).toBe("gpt-4o-mini");
  });

  it("la preferencia del agente gana a la del workspace y a la del plan", () => {
    const routes = resolveRoutes({
      agent: { model: "gpt-4o" }, workspace: { model: "gpt-4o-mini" }, plan: "enterprise",
    });
    expect(routes[0]!.model).toBe("gpt-4o");
  });

  it("sin agente, gana el workspace; sin workspace, gana el plan", () => {
    expect(resolveRoutes({ workspace: { model: "gpt-4o" }, plan: "starter" })[0]!.model).toBe("gpt-4o");
    expect(resolveRoutes({ plan: "starter" })[0]!.model).toBe(PLAN_DEFAULTS["starter"]!.model);
  });

  it("un proveedor desconocido es un error de configuración", () => {
    expect(() => resolveRoutes({ agent: { provider: "nope" } })).toThrow(/desconocido/);
  });

  it("un proveedor conocido pero no implementado se salta y sirve el fallback", () => {
    // claude es un stub aunque haya clave: no está disponible.
    expect(isProviderAvailable("claude")).toBe(false);
    const routes = resolveRoutes({ agent: { provider: "claude", model: "x", fallbacks: [{ provider: "openai", model: "gpt-4o" }] } });
    expect(routes.map((r) => `${r.providerId}/${r.model}`)).toEqual(["openai/gpt-4o"]);
  });

  it("un proveedor sin API key no está disponible", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isProviderAvailable("openai")).toBe(false);
    expect(() => resolveRoutes()).toThrow(NoProviderAvailableError);
  });

  it("ordena principal y fallbacks sin duplicados", () => {
    const routes = resolveRoutes({
      agent: { model: "gpt-4o", fallbacks: [{ provider: "openai", model: "gpt-4o" }, { provider: "openai", model: "gpt-4o-mini" }] },
    });
    expect(routes.map((r) => r.model)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("previewRoute (simulación) no exige que el proveedor esté disponible", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(previewRoute({ agent: { provider: "claude", model: "algo" } })).toEqual({ provider: "claude", model: "algo" });
  });
});
