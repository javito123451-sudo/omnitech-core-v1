import { describe, it, expect } from "vitest";
import { buildPayload, isDirty, mapIssues, toBuilderValues, validate } from "@/lib/agents/builder";
import { errorIssues, AgentsApiError } from "@/lib/agents/agentErrors";
import { agent, config } from "./fixtures";

const a = agent(7, "Ventas");
const base = () => toBuilderValues(a, config());

describe("builder — valores iniciales", () => {
  it("salen de la configuración real (listas una por línea, números como texto)", () => {
    const v = base();
    expect(v).toMatchObject({
      name: "Ventas", description: "Descripción de Ventas", avatarUrl: "",
      identityRole: "Asistente comercial", objectiveWhat: "Atender consultas de clientes",
      personalityTone: "cercano", behaviorInstructions: "Responde con amabilidad.",
      behaviorRules: "Saluda siempre", businessContext: "Taller mecánico en Valencia",
      paramTemperature: "0.4", paramMaxOutputTokens: "800", paramMaxToolRounds: "3", paramMaxHistoryMessages: "10",
      channels: ["web", "whatsapp"],
    });
  });

  it("una versión antigua sin algún campo usa los valores por defecto del backend, no undefined", () => {
    const v = toBuilderValues(a, { identity: { role: "x" } });
    expect(v.paramTemperature).toBe("0.3");
    expect(v.personalityLanguage).toBe("es");
    expect(v.behaviorRules).toBe("");
    expect(v.channels).toEqual([]);
  });

  it("sin ninguna versión el formulario es el de la configuración por defecto", () => {
    expect(toBuilderValues(a, null).paramMaxOutputTokens).toBe("1024");
  });
});

describe("builder — payload exacto", () => {
  it("sin cambios no hay nada que enviar", () => {
    expect(buildPayload(base(), base())).toEqual({ meta: null, config: null });
  });

  it("un cambio de rol envía SOLO la sección identity completa (el backend sustituye secciones enteras)", () => {
    const p = buildPayload({ ...base(), identityRole: "Vendedor" }, base());
    expect(p).toEqual({ meta: null, config: { config: { identity: { role: "Vendedor" } } } });
  });

  it("una sección con varios campos se envía completa aunque solo cambie uno", () => {
    const p = buildPayload({ ...base(), objectiveWhat: "Vender" }, base());
    expect(p.config).toEqual({ config: { objective: { what: "Vender", audience: "Clientes nuevos", expectedOutcome: "Cita agendada" } } });
  });

  it("las listas se convierten en arrays sin líneas vacías ni espacios", () => {
    const p = buildPayload({ ...base(), behaviorRules: "  Regla A \n\n Regla B  ", behaviorAvoid: "" }, base());
    expect(p.config?.config.behavior).toEqual({
      instructions: "Responde con amabilidad.", rules: ["Regla A", "Regla B"], restrictions: ["No des precios cerrados"], avoid: [],
    });
  });

  it("los parámetros se envían como números", () => {
    const p = buildPayload({ ...base(), paramTemperature: "1.2", paramMaxToolRounds: "5" }, base());
    expect(p.config?.config.parameters).toEqual({ temperature: 1.2, maxOutputTokens: 800, maxToolRounds: 5, maxHistoryMessages: 10 });
  });

  it("los canales se envían como lista completa", () => {
    const p = buildPayload({ ...base(), channels: ["web", "crm", "email"] }, base());
    expect(p.config).toEqual({ config: { channels: ["web", "crm", "email"] } });
  });

  it("nombre, descripción y avatar van a PATCH (meta), no a la configuración; vacío = null", () => {
    const p = buildPayload({ ...base(), name: "  Nuevo ", description: "  ", avatarUrl: "https://x/y.png" }, base());
    expect(p).toEqual({ meta: { name: "Nuevo", description: null, avatarUrl: "https://x/y.png" }, config: null });
  });

  it("no envía nunca campos desconocidos ni de solo lectura (model, knowledge, tools, permissions, notes, limits)", () => {
    const everything = {
      ...base(), name: "N", description: "D", avatarUrl: "u", identityRole: "r", objectiveWhat: "w", objectiveAudience: "a", objectiveExpectedOutcome: "e",
      personalityTone: "t", personalityStyle: "s", personalityLanguage: "l", personalityFormality: "f", behaviorInstructions: "i",
      behaviorRules: "1", behaviorRestrictions: "2", behaviorAvoid: "3", businessContext: "b",
      paramTemperature: "1", paramMaxOutputTokens: "10", paramMaxToolRounds: "2", paramMaxHistoryMessages: "5", channels: ["crm"] as const,
    };
    const p = buildPayload({ ...everything, channels: [...everything.channels] }, base());
    expect(Object.keys(p.config!.config).sort()).toEqual(
      ["behavior", "businessContext", "channels", "identity", "objective", "parameters", "personality"],
    );
    expect(Object.keys(p.meta!).sort()).toEqual(["avatarUrl", "description", "name"]);
    expect(JSON.stringify(p)).not.toMatch(/"(model|knowledge|tools|permissions|notes|limits|monthlyBudget)"/);
  });
});

describe("builder — dirty state", () => {
  it("volver al valor original deja de ser un cambio", () => {
    const edited = { ...base(), identityRole: "otro" };
    expect(isDirty(edited, base())).toBe(true);
    expect(isDirty({ ...edited, identityRole: "Asistente comercial" }, base())).toBe(false);
  });

  it("espacios sobrantes, líneas vacías y el orden de los canales no cuentan como cambio", () => {
    expect(isDirty({ ...base(), name: " Ventas ", behaviorRules: "Saluda siempre\n\n", channels: ["whatsapp", "web"] }, base())).toBe(false);
  });
});

describe("builder — validación (espejo del esquema del backend)", () => {
  it("una configuración correcta no da errores", () => expect(validate(base())).toEqual({}));

  it("nombre obligatorio", () => expect(validate({ ...base(), name: "  " }).name).toBeTruthy());

  it.each([
    ["paramTemperature", "2.1"], ["paramTemperature", "-0.1"], ["paramTemperature", ""], ["paramTemperature", "abc"],
    ["paramMaxOutputTokens", "0"], ["paramMaxOutputTokens", "8001"], ["paramMaxOutputTokens", "10.5"],
    ["paramMaxToolRounds", "0"], ["paramMaxToolRounds", "11"],
    ["paramMaxHistoryMessages", "-1"], ["paramMaxHistoryMessages", "51"],
  ] as const)("%s = «%s» no es válido", (field, value) => {
    expect(validate({ ...base(), [field]: value })[field]).toBeTruthy();
  });

  it.each([
    ["paramTemperature", "0"], ["paramTemperature", "2"], ["paramMaxOutputTokens", "8000"], ["paramMaxToolRounds", "10"],
    ["paramMaxHistoryMessages", "0"], ["paramMaxHistoryMessages", "50"],
  ] as const)("%s = «%s» está en el límite y es válido", (field, value) => {
    expect(validate({ ...base(), [field]: value })[field]).toBeUndefined();
  });
});

describe("builder — errores del backend por campo", () => {
  it("errorIssues lee las incidencias de un 400 de zod y mapIssues las reparte por campo", () => {
    const err = new AgentsApiError({
      status: 400, code: null, message: "Configuración no válida.",
      body: { error: "Configuración no válida.", issues: [
        { path: ["parameters", "temperature"], message: "Too big" },
        { path: ["channels", 1], message: "Invalid option" },
        { path: ["model", "provider"], message: "raro" },
      ] },
    });
    const { fields, other } = mapIssues(errorIssues(err));
    expect(fields.paramTemperature).toBe("Too big");
    expect(fields.channels).toBe("Invalid option");
    expect(other).toEqual(["model.provider: raro"]);
  });

  it("sin incidencias no inventa nada", () => {
    expect(errorIssues(new AgentsApiError({ status: 400, code: null, message: "x", body: { error: "x" } }))).toEqual([]);
    expect(errorIssues(new Error("x"))).toEqual([]);
  });
});
