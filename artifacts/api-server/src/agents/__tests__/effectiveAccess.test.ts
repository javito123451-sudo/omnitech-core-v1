import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultAgentConfig } from "@workspace/db";
import { resolveEffectiveToolAccess, resolveToolAccess } from "../authorization";
import { TOOL_REGISTRY } from "../toolRegistry";

const executeSkill = vi.hoisted(() => vi.fn());
vi.mock("../../skills", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../skills")>()), executeSkill: (...a: unknown[]) => executeSkill(...a) }));

const getAgentDetail = vi.hoisted(() => vi.fn());
vi.mock("../agentService", async (importOriginal) => ({ ...(await importOriginal<typeof import("../agentService")>()), getAgentDetail: (...a: unknown[]) => getAgentDetail(...a) }));

import { previewEffectiveAccess } from "../effectiveAccess";
import { AgentError } from "../agentService";

const allModules = async () => true;
const cfg = (read: string[], write: string[]) => { const c = defaultAgentConfig(); c.tools.read = read; c.tools.write = write; return c; };
const base = { orgId: 1, moduleEnabled: allModules, platformRole: null };
const one = async (role: string, read: string[], write: string[], over: Partial<Parameters<typeof resolveEffectiveToolAccess>[0]> = {}) =>
  resolveEffectiveToolAccess({ ...base, orgRole: role, config: cfg(read, write), ...over });

beforeEach(() => { executeSkill.mockReset(); getAgentDetail.mockReset(); });

describe("resolveEffectiveToolAccess", () => {
  it("permiso presente: lectura → allowed; acción → allowed con confirmación humana", async () => {
    const r = await one("admin", ["list_tasks"], ["create_task"]);
    expect(r[0]).toMatchObject({ toolId: "list_tasks", declaredAs: "read", kind: "read", permission: "crm.read", module: "crm", allowed: true, reason: "allowed", requiresConfirmation: false });
    expect(r[1]).toMatchObject({ toolId: "create_task", declaredAs: "write", kind: "action", permission: "crm.write", module: "crm", allowed: true, reason: "confirmation_required", requiresConfirmation: true });
  });

  it("permiso ausente → missing_permission, con el permiso que falta", async () => {
    const r = await one("read_only", ["list_tasks"], ["create_task"]);
    expect(r[0]).toMatchObject({ allowed: true });
    expect(r[1]).toMatchObject({ toolId: "create_task", allowed: false, reason: "missing_permission", permission: "crm.write", requiresConfirmation: false });
    expect(r[1]!.message).toMatch(/crm\.write/);
  });

  it("módulo activo vs desactivado → module_disabled", async () => {
    const on = await one("owner", ["get_invoice"], []);
    expect(on[0]).toMatchObject({ allowed: true, module: "omni_accounting" });
    const off = await one("owner", ["get_invoice"], [], { moduleEnabled: async (_o, slug) => slug !== "omni_accounting" });
    expect(off[0]).toMatchObject({ allowed: false, reason: "module_disabled", module: "omni_accounting" });
  });

  it("el módulo se consulta para el workspace del actor", async () => {
    const seen: Array<[number, string]> = [];
    await one("owner", ["list_tasks"], [], { orgId: 42, moduleEnabled: async (o, s) => { seen.push([o, s]); return true; } });
    expect(seen).toEqual([[42, "crm"]]);
  });

  it("herramienta desconocida → unknown_tool, sin tipo, permiso ni módulo", async () => {
    const r = await one("owner", ["hackear_planeta"], []);
    expect(r[0]).toEqual({ toolId: "hackear_planeta", declaredAs: "read", kind: null, permission: null, module: null, allowed: false, reason: "unknown_tool", requiresConfirmation: false, message: "Herramienta desconocida." });
  });

  it("herramienta no declarada: no aparece por defecto y con includeUndeclared sale como not_declared", async () => {
    expect((await one("owner", ["list_tasks"], [])).map((t) => t.toolId)).toEqual(["list_tasks"]);
    const all = await one("owner", ["list_tasks"], [], { includeUndeclared: true });
    expect(all).toHaveLength(TOOL_REGISTRY.length);
    expect(all.find((t) => t.toolId === "create_task")).toMatchObject({ declaredAs: null, allowed: false, reason: "not_declared" });
    expect(all.find((t) => t.toolId === "list_tasks")).toMatchObject({ allowed: true });
  });

  it("declarada en el grupo equivocado o duplicada → kind_mismatch / duplicate_declaration", async () => {
    const r = await one("owner", ["create_task", "list_tasks"], ["list_tasks"]);
    expect(r.find((t) => t.toolId === "create_task")).toMatchObject({ allowed: false, reason: "kind_mismatch", kind: "action" });
    expect(r.filter((t) => t.toolId === "list_tasks").map((t) => t.reason)).toEqual(["allowed", "duplicate_declaration"]);
  });

  it("el tipo, el permiso y el módulo salen SIEMPRE del registro, no de lo declarado", async () => {
    const r = await one("owner", ["list_tasks"], ["create_task"]);
    for (const t of r) {
      const reg = TOOL_REGISTRY.find((x) => x.id === t.toolId)!;
      expect([t.kind, t.permission, t.module]).toEqual([reg.kind, reg.permission, reg.module]);
    }
  });

  it("es una proyección de la MISMA decisión que el runtime: lo permitido coincide con resolveToolAccess para todos los roles", async () => {
    const declared = TOOL_REGISTRY.map((t) => t.id);
    const read = declared.filter((id) => TOOL_REGISTRY.find((t) => t.id === id)!.kind === "read");
    const write = declared.filter((id) => TOOL_REGISTRY.find((t) => t.id === id)!.kind === "action");
    for (const role of ["owner", "admin", "manager", "member", "read_only", "vendedor", "cliente", "asistente"]) {
      const moduleEnabled = async (_o: number, slug: string) => slug !== "omni_taller";
      const input = { orgId: 1, orgRole: role, platformRole: null, moduleEnabled, config: cfg(read, write) };
      const runtime = await resolveToolAccess(input);
      const preview = await resolveEffectiveToolAccess(input);
      expect(preview.filter((t) => t.allowed).map((t) => t.toolId).sort()).toEqual([...runtime.read, ...runtime.action].map((t) => t.id).sort());
      expect(preview.filter((t) => !t.allowed).map((t) => t.toolId).sort()).toEqual(runtime.denied.map((d) => d.toolId).sort());
    }
  });

  it("SUPER_ADMIN conserva el bypass de permisos de la plataforma (igual que el runtime), pero no el de módulos", async () => {
    const r = await one("cliente", ["list_tasks"], ["create_task"], { platformRole: "SUPER_ADMIN" });
    expect(r.every((t) => t.allowed)).toBe(true);
    const off = await one("cliente", ["list_tasks"], [], { platformRole: "SUPER_ADMIN", moduleEnabled: async () => false });
    expect(off[0]).toMatchObject({ allowed: false, reason: "module_disabled" });
  });

  it("no ejecuta ninguna herramienta ni cambia la configuración", async () => {
    const c = cfg(["list_tasks"], ["create_task"]);
    const before = JSON.stringify(c);
    await resolveEffectiveToolAccess({ ...base, orgRole: "owner", config: c });
    expect(executeSkill).not.toHaveBeenCalled();
    expect(JSON.stringify(c)).toBe(before);
  });

  it("no devuelve nada sensible: solo campos descriptivos", async () => {
    const r = await one("owner", ["list_tasks"], ["create_task"]);
    for (const t of r) expect(Object.keys(t).sort()).toEqual(["allowed", "declaredAs", "kind", "message", "module", "permission", "reason", "requiresConfirmation", "toolId"]);
  });
});

describe("previewEffectiveAccess (sobre el agente del workspace de la sesión)", () => {
  const agent = { id: 7, orgId: 1, name: "Ana", status: "draft", activeVersionId: 20 };
  const ver = (id: number, n: number, publishedAt: Date | null, tools: { read: string[]; write: string[] }) =>
    ({ id, agentId: 7, orgId: 1, versionNumber: n, publishedAt, config: { ...defaultAgentConfig(), tools }, notes: null, createdBy: null, createdAt: new Date() });

  it("evalúa el BORRADOR si existe (lo que se publicaría) para el rol del usuario autenticado y resume", async () => {
    getAgentDetail.mockResolvedValue({ agent, versions: [ver(30, 3, null, { read: ["list_tasks"], write: ["create_task"] }), ver(20, 2, new Date(), { read: [], write: [] })] });
    const r = await previewEffectiveAccess({ orgId: 1, orgRole: "read_only", platformRole: null }, 7, { moduleEnabled: allModules });
    expect(getAgentDetail).toHaveBeenCalledWith(1, 7);
    expect(r).toMatchObject({ agentId: 7, role: "read_only", version: { id: 30, versionNumber: 3, isDraft: true, isActive: false }, summary: { declared: 2, allowed: 1, denied: 1, requireConfirmation: 0 } });
    expect(r.tools.map((t) => [t.toolId, t.reason])).toEqual([["list_tasks", "allowed"], ["create_task", "missing_permission"]]);
  });

  it("sin borrador evalúa la versión activa", async () => {
    getAgentDetail.mockResolvedValue({ agent, versions: [ver(20, 2, new Date(), { read: ["list_tasks"], write: [] })] });
    const r = await previewEffectiveAccess({ orgId: 1, orgRole: "admin", platformRole: null }, 7, { moduleEnabled: allModules });
    expect(r.version).toMatchObject({ id: 20, isDraft: false, isActive: true });
  });

  it("un agente de otro workspace da 404 y NUNCA se consulta con otro orgId", async () => {
    getAgentDetail.mockImplementation(async (orgId: number) => { if (orgId !== 1) throw new AgentError(404, "Agente no encontrado."); return { agent, versions: [] }; });
    await expect(previewEffectiveAccess({ orgId: 2, orgRole: "owner", platformRole: null }, 7)).rejects.toMatchObject({ status: 404 });
    expect(getAgentDetail.mock.calls.every((c) => c[0] === 2)).toBe(true);
  });

  it("un agente sin versiones da 404", async () => {
    getAgentDetail.mockResolvedValue({ agent, versions: [] });
    await expect(previewEffectiveAccess({ orgId: 1, orgRole: "owner", platformRole: null }, 7)).rejects.toMatchObject({ status: 404 });
  });

  it("no ejecuta herramientas", async () => {
    getAgentDetail.mockResolvedValue({ agent, versions: [ver(30, 3, null, { read: ["list_tasks"], write: ["create_task"] })] });
    await previewEffectiveAccess({ orgId: 1, orgRole: "owner", platformRole: null }, 7, { moduleEnabled: allModules });
    expect(executeSkill).not.toHaveBeenCalled();
  });
});
