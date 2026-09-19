// Autorización efectiva = herramienta del agente ∩ permiso del usuario ∩ módulo
// del workspace. El agente solo puede ESTRECHAR lo que el usuario ya puede;
// nunca ampliarlo.
import { describe, it, expect } from "vitest";
import { defaultAgentConfig } from "@workspace/db";
import { TOOL_REGISTRY, getAgentTool } from "../toolRegistry";
import { resolveToolAccess } from "../authorization";
import { listSkills } from "../../skills";

const allModules = async () => true;

function cfg(read: string[], write: string[]) {
  const c = defaultAgentConfig();
  c.tools.read = read;
  c.tools.write = write;
  return c;
}

describe("Tool Registry", () => {
  it("registra TODAS las skills del Skill Engine (una skill nueva sin clasificar rompe este test)", () => {
    const missing = listSkills().map((s) => s.id).filter((id) => !getAgentTool(id));
    expect(missing).toEqual([]);
  });

  it("no registra herramientas que no existan", () => {
    const skillIds = new Set(listSkills().map((s) => s.id));
    expect(TOOL_REGISTRY.map((t) => t.id).filter((id) => !skillIds.has(id))).toEqual([]);
  });

  it("separa lectura de acción", () => {
    expect(getAgentTool("list_tasks")!.kind).toBe("read");
    expect(getAgentTool("create_task")!.kind).toBe("action");
    expect(getAgentTool("register_payment")!.kind).toBe("action");
    expect(getAgentTool("escalate_to_human")!.kind).toBe("action");
  });
});

describe("resolveToolAccess", () => {
  const base = { orgId: 1, moduleEnabled: allModules, platformRole: null };

  it("un admin recibe las herramientas que el agente declara", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "admin", config: cfg(["list_tasks"], ["create_task"]) });
    expect(a.read.map((t) => t.id)).toEqual(["list_tasks"]);
    expect(a.action.map((t) => t.id)).toEqual(["create_task"]);
    expect(a.denied).toEqual([]);
  });

  it("read_only no obtiene la acción aunque el agente la declare (el agente no eleva privilegios)", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "read_only", config: cfg(["list_tasks"], ["create_task"]) });
    expect(a.read.map((t) => t.id)).toEqual(["list_tasks"]);
    expect(a.action).toEqual([]);
    expect(a.denied[0]).toMatchObject({ toolId: "create_task" });
    expect(a.denied[0]!.reason).toMatch(/crm\.write/);
  });

  it("el agente solo estrecha: una herramienta que no declara no aparece aunque el usuario pueda", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "owner", config: cfg([], []) });
    expect([...a.read, ...a.action]).toEqual([]);
  });

  it("un módulo deshabilitado en el workspace excluye la herramienta", async () => {
    const a = await resolveToolAccess({
      ...base, orgRole: "owner", config: cfg(["get_repair_status"], []),
      moduleEnabled: async (_o, slug) => slug !== "omni_taller",
    });
    expect(a.read).toEqual([]);
    expect(a.denied[0]!.reason).toMatch(/omni_taller/);
  });

  it("una herramienta de escritura colada en la lista de lectura se deniega también en ejecución", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "owner", config: cfg(["create_task"], []) });
    expect(a.read).toEqual([]);
    expect(a.denied[0]!.reason).toMatch(/tipo 'action'/);
  });

  it("deniega herramientas desconocidas o repetidas", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "owner", config: cfg(["hack"], []) });
    expect(a.denied[0]!.reason).toMatch(/desconocida/);
    const b = await resolveToolAccess({ ...base, orgRole: "owner", config: cfg(["list_tasks", "list_tasks"], []) });
    expect(b.denied[0]!.reason).toMatch(/dos veces/);
  });

  it("un rol sin permisos de cliente (cliente) no obtiene nada", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "cliente", config: cfg(["list_tasks", "list_clients"], ["create_task"]) });
    expect([...a.read, ...a.action]).toEqual([]);
    expect(a.denied).toHaveLength(3);
  });

  it("SUPER_ADMIN de plataforma sigue la misma regla de bypass que el resto de la app", async () => {
    const a = await resolveToolAccess({ ...base, orgRole: "read_only", platformRole: "SUPER_ADMIN", config: cfg([], ["create_task"]) });
    expect(a.action.map((t) => t.id)).toEqual(["create_task"]);
    const staff = await resolveToolAccess({ ...base, orgRole: "read_only", platformRole: "STAFF_OMNITECH", config: cfg([], ["create_task"]) });
    expect(staff.action).toEqual([]); // STAFF_OMNITECH no obtiene bypass
  });
});
