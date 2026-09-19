// Reglas puras de la Fábrica de Agentes: qué es lectura y qué es escritura,
// cuándo un agente está listo para publicarse, y quién puede publicar.
import { describe, it, expect } from "vitest";
import { defaultAgentConfig } from "@workspace/db";
import { isReadTool } from "../toolClassification";
import { validateForPublish } from "../agentService";
import { getPermissionsForRole } from "../../middlewares/permissions";
import { listSkills } from "../../skills";

const known = new Set(["list_clients", "list_tasks", "create_task", "escalate_to_human"]);

function readyConfig() {
  const c = defaultAgentConfig();
  c.objective.what = "Atender consultas";
  c.behavior.instructions = "Responde con amabilidad.";
  return c;
}

describe("tool classification", () => {
  it("classifies every real skill: get_/list_/accounting_summary read, everything else write", () => {
    const reads = listSkills().filter((s) => isReadTool(s.id)).map((s) => s.id);
    const writes = listSkills().filter((s) => !isReadTool(s.id)).map((s) => s.id);
    expect(reads).toEqual(expect.arrayContaining(["list_clients", "list_tasks", "get_appointments", "accounting_summary"]));
    expect(writes).toEqual(expect.arrayContaining(["create_task", "create_invoice", "register_payment", "cancel_appointment", "update_repair_stage", "escalate_to_human"]));
  });
});

describe("validateForPublish", () => {
  it("accepts a complete agent", () => {
    expect(validateForPublish({ name: "Ana" }, readyConfig(), known)).toEqual([]);
  });

  it("requires a name, an objective and instructions", () => {
    const problems = validateForPublish({ name: " " }, defaultAgentConfig(), known);
    expect(problems.length).toBe(3);
  });

  it("does not let a write tool hide in the read list (no write access by the back door)", () => {
    const c = readyConfig();
    c.tools.read = ["create_task"];
    expect(validateForPublish({ name: "Ana" }, c, known).join(" ")).toMatch(/create_task.*modifica datos/);
  });

  it("does not let a read tool sit in the write list, nor a tool in both", () => {
    const c = readyConfig();
    c.tools.write = ["list_clients", "create_task"];
    c.tools.read = ["create_task"];
    const text = validateForPublish({ name: "Ana" }, c, known).join(" | ");
    expect(text).toMatch(/list_clients.*solo lectura/);
    expect(text).toMatch(/create_task.*a la vez/);
  });

  it("rejects unknown tools", () => {
    const c = readyConfig();
    c.tools.read = ["hack_the_planet"];
    expect(validateForPublish({ name: "Ana" }, c, known).join(" ")).toMatch(/desconocida/);
  });
});

describe("agents permissions by role", () => {
  it.each([
    ["owner",     true,  true,  true],
    ["admin",     true,  true,  true],
    ["manager",   true,  true,  false],
    ["member",    true,  false, false],
    ["read_only", true,  false, false],
    ["vendedor",  false, false, false],
    ["cliente",   false, false, false],
  ])("%s -> read:%s write:%s publish:%s", (role, read, write, publish) => {
    const p = getPermissionsForRole(role);
    expect(p.has("agents.read")).toBe(read);
    expect(p.has("agents.write")).toBe(write);
    expect(p.has("agents.publish")).toBe(publish);
  });
});
