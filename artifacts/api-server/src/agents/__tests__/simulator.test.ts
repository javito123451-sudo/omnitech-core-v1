// SIMULATION debe ser gratis y sin efectos: ni proveedor de IA, ni créditos, ni
// acciones, ni escrituras. Y debe mostrar lo que el brief pide ver.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultAgentConfig } from "@workspace/db";
import { simulateAgent, SIMULATION_SCENARIOS } from "../simulator";
import { OpenAIProvider } from "../../ai/openaiProvider";
import { getAgentTool } from "../toolRegistry";

const tools = (ids: string[]) => ids.map((id) => getAgentTool(id)!);

function input(message: string, read: string[] = [], action: string[] = []) {
  const config = defaultAgentConfig();
  config.tools.read = read;
  config.tools.write = action;
  return {
    agent: { id: 1, name: "Ana" }, versionNumber: 3, config, message,
    readTools: tools(read), actionTools: tools(action),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("simulateAgent", () => {
  it("no llama a ningún proveedor de IA (ni con clave configurada)", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const generate = vi.spyOn(OpenAIProvider.prototype, "generate");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    simulateAgent(input("Quiero crear una tarea para llamar a Juan", ["list_tasks"], ["create_task"]));
    expect(generate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("es una función pura: su código no importa ni el gateway ni la base de datos", () => {
    const src = readFileSync(fileURLToPath(new URL("../simulator.ts", import.meta.url)), "utf8");
    // Solo cuentan los imports que existen en tiempo de ejecución ("import type" se borra al compilar).
    const runtimeImports = src.split("\n").filter((l) => l.startsWith("import ") && !l.startsWith("import type")).join("\n");
    expect(runtimeImports).not.toMatch(/ai-gateway\/gateway"|@workspace\/db"|creditService|\/skills"|confirmationStore|agentService|agentRunner/);
  });

  it("muestra agente, versión, modelo, herramientas, coste y créditos estimados y la respuesta", () => {
    const r = simulateAgent(input("¿Cuáles son mis tareas pendientes?", ["list_tasks"], ["create_task"]));
    expect(r.simulated).toBe(true);
    expect(r.agent).toEqual({ id: 1, name: "Ana", versionNumber: 3 });
    expect(r.route).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(r.toolsSelected).toContain("list_tasks");
    expect(r.estimate.typicalCostUsd).toBeGreaterThan(0);
    expect(r.estimate.typicalCredits).toBeGreaterThan(0);
    expect(r.estimate.maxCredits).toBeGreaterThanOrEqual(r.estimate.typicalCredits);
    expect(r.reply).toMatch(/SIMULACIÓN/);
    expect(r.notes.join(" ")).toMatch(/no se ha llamado a ningún proveedor/);
  });

  it("propone una acción (que exige confirmación) pero no la ejecuta", () => {
    const r = simulateAgent(input("Necesito crear una tarea para llamar a Juan", [], ["create_task"]));
    expect(r.proposedAction).toMatchObject({ toolId: "create_task", requiresConfirmation: true });
    expect(r.proposedAction!.params).toMatchObject({ title: expect.stringContaining("crear una tarea") });
    expect(r.reply).toMatch(/no se ejecuta nada/);
  });

  it("solo considera las herramientas ya autorizadas que se le pasan", () => {
    const r = simulateAgent(input("crear tarea para llamar a Juan", [], []));
    expect(r.toolsSelected).toEqual([]);
    expect(r.proposedAction).toBeNull();
  });

  it("respeta el modelo elegido por el agente al estimar", () => {
    const i = input("hola");
    i.config.model = { model: "gpt-4o" };
    const r = simulateAgent(i);
    expect(r.route.model).toBe("gpt-4o");
    expect(r.estimate.typicalCostUsd).toBeGreaterThan(simulateAgent(input("hola")).estimate.typicalCostUsd);
  });

  it("avisa cuando no hay precio para el modelo", () => {
    const i = input("hola");
    i.config.model = { provider: "claude", model: "algo" };
    const r = simulateAgent(i);
    expect(r.estimate.priceKnown).toBe(false);
    expect(r.notes.join(" ")).toMatch(/No hay precio/);
  });

  it("marca la estimación como provisional cuando el precio no está configurado (legacy o fallback)", () => {
    const legacy = simulateAgent(input("hola"));
    expect(legacy.estimate).toMatchObject({ priceSource: "legacy", provisional: true });
    expect(legacy.notes.join(" ")).toMatch(/PROVISIONAL/);
    const i = input("hola");
    i.config.model = { provider: "claude", model: "algo" };
    expect(simulateAgent(i).estimate).toMatchObject({ priceSource: "fallback", priceKnown: false, provisional: true });
  });

  it("ofrece los escenarios de prueba del brief", () => {
    expect(SIMULATION_SCENARIOS.map((s) => s.id)).toEqual(
      expect.arrayContaining(["new_client", "angry", "undecided", "asks_price", "wants_appt", "cancels", "returning", "asks_info"]),
    );
    for (const s of SIMULATION_SCENARIOS) expect(simulateAgent(input(s.message)).simulated).toBe(true);
  });
});
