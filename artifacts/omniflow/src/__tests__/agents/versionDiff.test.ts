import { describe, it, expect } from "vitest";
import { countChanges, diffVersions } from "@/lib/agents/versionDiff";
import { findActive, findDraft, findReviewBase, findSimulationTarget, simulationKey, sortVersions } from "@/lib/agents/versioning";
import { agent, config, version } from "./fixtures";

const section = (diff: ReturnType<typeof diffVersions>, id: string) => diff.find((s) => s.id === id)!;

describe("diffVersions", () => {
  it("dos configuraciones iguales: todas las secciones salen y todas dicen «sin cambios»", () => {
    const d = diffVersions(config(), config());
    expect(d.map((s) => s.id)).toEqual(["identity", "objective", "personality", "behavior", "context", "parameters", "channels", "other"]);
    expect(d.every((s) => s.changes.length === 0)).toBe(true);
    expect(countChanges(d)).toBe(0);
  });

  it("campo modificado: guarda el antes y el después", () => {
    const c = section(diffVersions(config(), config({ identity: { role: "Vendedor" } })), "identity").changes;
    expect(c).toEqual([{ label: "Rol", kind: "modified", before: "Asistente comercial", after: "Vendedor", addedItems: [], removedItems: [] }]);
  });

  it("campo añadido (antes vacío) y eliminado (ahora vacío)", () => {
    const empty = config({ businessContext: "" });
    const withCtx = config({ businessContext: "Taller" });
    expect(section(diffVersions(empty, withCtx), "context").changes[0]).toMatchObject({ kind: "added", before: null, after: "Taller" });
    expect(section(diffVersions(withCtx, empty), "context").changes[0]).toMatchObject({ kind: "removed", before: "Taller", after: null });
  });

  it("un campo que falta en una versión antigua cuenta como vacío (no como cambio inventado)", () => {
    const old: Partial<ReturnType<typeof config>> = { identity: { role: "x" } };
    const d = diffVersions(old, { identity: { role: "x" } });
    expect(countChanges(d)).toBe(0);
    expect(section(diffVersions(old, config()), "objective").changes.every((c) => c.kind === "added")).toBe(true);
  });

  it("listas: elementos añadidos y eliminados", () => {
    const from = config({ behavior: { instructions: "i", rules: ["A", "B"], restrictions: [], avoid: [] } });
    const to = config({ behavior: { instructions: "i", rules: ["B", "C"], restrictions: ["No X"], avoid: [] } });
    const b = section(diffVersions(from, to), "behavior").changes;
    expect(b.find((c) => c.label === "Reglas")).toMatchObject({ kind: "modified", addedItems: ["C"], removedItems: ["A"] });
    expect(b.find((c) => c.label === "Restricciones")).toMatchObject({ kind: "added", addedItems: ["No X"], removedItems: [] });
    expect(b.find((c) => c.label === "Instrucciones")).toBeUndefined();
  });

  it("lista vaciada = eliminada; lista con otro orden = «reordenada», no un cambio de contenido", () => {
    const rules = (r: string[]) => config({ behavior: { instructions: "i", rules: r, restrictions: [], avoid: [] } });
    expect(section(diffVersions(rules(["A"]), rules([])), "behavior").changes[0]).toMatchObject({ kind: "removed", removedItems: ["A"] });
    expect(section(diffVersions(rules(["A", "B"]), rules(["B", "A"])), "behavior").changes[0]).toMatchObject({ kind: "reordered", addedItems: [], removedItems: [] });
  });

  it("canales: se comparan con su etiqueta y por elementos", () => {
    const c = section(diffVersions(config({ channels: ["web"] }), config({ channels: ["web", "whatsapp"] })), "channels").changes;
    expect(c).toEqual([expect.objectContaining({ kind: "modified", addedItems: ["WhatsApp"], removedItems: [] })]);
  });

  it("los cambios se agrupan en su sección y las demás quedan sin cambios", () => {
    const d = diffVersions(config(), config({
      personality: { tone: "formal", style: "breve", language: "es", formality: "informal" },
      parameters: { temperature: 1, maxOutputTokens: 800, maxToolRounds: 3, maxHistoryMessages: 10 },
    }));
    expect(section(d, "personality").changes.map((c) => c.label)).toEqual(["Tono"]);
    expect(section(d, "parameters").changes).toEqual([expect.objectContaining({ label: "Temperatura", before: "0.4", after: "1" })]);
    expect(section(d, "identity").changes).toEqual([]);
    expect(countChanges(d)).toBe(2);
  });

  it("no oculta diferencias en modelo, conocimiento, herramientas y permisos (se copian entre versiones)", () => {
    const d = diffVersions(config(), config({
      model: { provider: "openai", model: "gpt-x" },
      tools: { read: ["search_clients"], write: [] },
      knowledge: { workspace: true, entryIds: [3], categories: [] },
      permissions: { writesRequireConfirmation: false },
    }));
    const labels = section(d, "other").changes.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Proveedor", "Modelo", "Herramientas de lectura", "Entradas de conocimiento", "Las acciones piden confirmación"]));
    expect(section(d, "other").changes.find((c) => c.label === "Las acciones piden confirmación")).toMatchObject({ before: "Sí", after: "No" });
  });

  it("una diferencia solo de espacios en blanco en un campo vacío no cuenta", () => {
    expect(countChanges(diffVersions(config({ businessContext: "" }), config({ businessContext: "   " })))).toBe(0);
  });
});

describe("reglas de versionado", () => {
  const v1 = version(10, 1, { publishedAt: "2026-05-01T09:00:00Z" });
  const v2 = version(20, 2, { publishedAt: "2026-05-02T09:00:00Z" });
  const v3 = version(30, 3);
  const a = agent(7, "Ventas", { activeVersionId: 20 });

  it("ordena de más reciente a más antigua sin mutar la entrada", () => {
    const input = [v1, v3, v2];
    expect(sortVersions(input).map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(input.map((v) => v.versionNumber)).toEqual([1, 3, 2]);
  });

  it("borrador = la versión sin fecha de publicación; activa = agent.activeVersionId", () => {
    expect(findDraft([v1, v2, v3])?.versionNumber).toBe(3);
    expect(findDraft([v1, v2])).toBeNull();
    expect(findActive(a, [v1, v2, v3])?.versionNumber).toBe(2);
  });

  it("base de revisión: la activa; si no hay, la publicada más reciente; si no, ninguna", () => {
    expect(findReviewBase(a, [v1, v2, v3])?.versionNumber).toBe(2);
    expect(findReviewBase({ activeVersionId: null }, [v1, v2, v3])?.versionNumber).toBe(2);
    expect(findReviewBase({ activeVersionId: null }, [v3])).toBeNull();
  });

  it("la simulación apunta al borrador, luego a la activa, luego a la última (como el backend)", () => {
    expect(findSimulationTarget(a, [v1, v2, v3])?.versionNumber).toBe(3);
    expect(findSimulationTarget(a, [v1, v2])?.versionNumber).toBe(2);
    expect(findSimulationTarget({ activeVersionId: null }, [v1, v2])?.versionNumber).toBe(2);
  });

  it("simulationKey cambia con la versión, con su contenido y con el nombre del agente; es estable si nada cambia", () => {
    const base = simulationKey(a, v3);
    expect(simulationKey(a, { ...v3 })).toBe(base);
    expect(simulationKey(a, { ...v3, config: config({ identity: { role: "otro" } }) })).not.toBe(base);
    expect(simulationKey(a, { ...v3, versionNumber: 4 })).not.toBe(base);
    expect(simulationKey({ ...a, name: "Otro" }, v3)).not.toBe(base);
    expect(simulationKey(a, null)).toBe("7|none");
  });
});
