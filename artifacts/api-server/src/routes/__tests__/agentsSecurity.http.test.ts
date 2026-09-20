// Contrato HTTP de la publicación segura: 422 con problemas estructurados, effective-access de solo lectura y aislamiento por
// workspace (el orgId sale SIEMPRE del contexto autenticado, nunca de la URL, la query ni el cuerpo).
// El agentsRouter es el real; solo se sustituye la capa de servicio para observar con qué argumentos se le llama.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const publishAgent = vi.hoisted(() => vi.fn());
const saveDraft = vi.hoisted(() => vi.fn());
const getAgentDetail = vi.hoisted(() => vi.fn());
const previewEffectiveAccess = vi.hoisted(() => vi.fn());
const logAudit = vi.hoisted(() => vi.fn());

vi.mock("../../agents/agentService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/agentService")>()),
  publishAgent: (...a: unknown[]) => publishAgent(...a),
  saveDraft: (...a: unknown[]) => saveDraft(...a),
  getAgentDetail: (...a: unknown[]) => getAgentDetail(...a),
}));
vi.mock("../../agents/effectiveAccess", () => ({ previewEffectiveAccess: (...a: unknown[]) => previewEffectiveAccess(...a) }));
vi.mock("../../utils/auditLogger", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));

import { agentsRouter } from "../agents";
import { AgentError } from "../../agents/agentService";
import type { PublishProblem } from "../../agents/publishValidation";

interface Identity { orgId?: number; role?: string; superAdmin?: boolean; platformRole?: string }
let identity: Identity = {};
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: identity.orgId, orgRole: identity.role, effectiveRole: identity.role, isSuperAdmin: identity.superAdmin === true,
      platformRole: identity.platformRole, clerkUserId: "user_test", userId: 1,
    });
    next();
  });
  app.use("/api/agents", agentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const OWNER_ORG = 1;
beforeEach(() => {
  identity = { orgId: OWNER_ORG, role: "admin" };
  for (const f of [publishAgent, saveDraft, getAgentDetail, previewEffectiveAccess, logAudit]) f.mockReset();
  // El agente 7 pertenece al workspace 1: cualquier otro workspace no lo encuentra.
  const ownership = async (orgId: number) => { if (orgId !== OWNER_ORG) throw new AgentError(404, "Agente no encontrado."); };
  publishAgent.mockImplementation(async (orgId: number) => { await ownership(orgId); return { agent: { id: 7 }, publishedVersionNumber: 2 }; });
  saveDraft.mockImplementation(async (orgId: number) => { await ownership(orgId); return { id: 30, versionNumber: 2 }; });
  getAgentDetail.mockImplementation(async (orgId: number) => { await ownership(orgId); return { agent: { id: 7 }, versions: [] }; });
  previewEffectiveAccess.mockImplementation(async (actor: { orgId: number }) => { await ownership(actor.orgId); return { agentId: 7, tools: [], summary: {} }; });
});

const send = (path: string, method: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("POST /:id/publish — problemas estructurados", () => {
  const details: PublishProblem[] = [
    { field: "config.model.model", code: "UNKNOWN_MODEL", message: "El modelo «x» no está disponible para el proveedor «openai»." },
    { field: "config.model.fallbacks[1].provider", code: "UNKNOWN_PROVIDER", message: "Proveedor de IA desconocido: acme" },
  ];

  it("422 con problems (texto, contrato histórico) y problemDetails (campo + código)", async () => {
    publishAgent.mockRejectedValue(new AgentError(422, "El agente no está listo para publicarse.", details.map((d) => d.message), details));
    const res = await send("/7/publish", "POST");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "El agente no está listo para publicarse.", problems: details.map((d) => d.message), problemDetails: details });
  });

  it("un 422 sin detalles no añade problemDetails (contrato anterior intacto)", async () => {
    publishAgent.mockRejectedValue(new AgentError(422, "x", ["a"]));
    expect(await (await send("/7/publish", "POST")).json()).toEqual({ error: "x", problems: ["a"] });
  });

  it("no filtra secretos ni rutas internas", async () => {
    process.env["OPENAI_API_KEY"] = "sk-no-debe-salir";
    publishAgent.mockRejectedValue(new AgentError(422, "no listo", ["p"], details));
    const text = await (await send("/7/publish", "POST")).text();
    delete process.env["OPENAI_API_KEY"];
    expect(text).not.toMatch(/sk-no-debe-salir|API_KEY|node_modules|\/src\/|stack/i);
  });

  it("exige agents.publish (agents.write y agents.read no bastan)", async () => {
    for (const role of ["member", "read_only", "manager"]) {
      identity = { orgId: OWNER_ORG, role };
      expect((await send("/7/publish", "POST")).status, role).toBe(403);
    }
    expect(publishAgent).not.toHaveBeenCalled();
    identity = { orgId: OWNER_ORG, role: "admin" };
    expect((await send("/7/publish", "POST")).status).toBe(200);
  });

  it("publica con el workspace de la sesión: un id o un orgId en la URL/cuerpo no lo cambian", async () => {
    identity = { orgId: 5, role: "admin" };
    const res = await send("/7/publish?orgId=1", "POST", { orgId: 1, org_id: 1 });
    expect(res.status).toBe(404);                                       // el agente 7 es del workspace 1, no del 5
    expect(publishAgent.mock.calls.map((c) => c[0])).toEqual([5]);
  });
});

describe("PUT /:id/draft — validación y aislamiento", () => {
  it("422 con el detalle de los ids de conocimiento no válidos", async () => {
    const d: PublishProblem[] = [{ field: "config.knowledge.entryIds", code: "UNKNOWN_KNOWLEDGE_ENTRY", message: "El conocimiento #9 no existe en este workspace o no está activo." }];
    saveDraft.mockRejectedValue(new AgentError(422, "El conocimiento seleccionado no es válido.", [d[0]!.message], d));
    const res = await send("/7/draft", "PUT", { config: { knowledge: { workspace: false, entryIds: [9], categories: [] } } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ problems: [d[0]!.message], problemDetails: d });
  });

  it("el workspace sale de la sesión aunque el cliente mande otro en el cuerpo o en la query", async () => {
    await send("/7/draft?orgId=99", "PUT", { orgId: 99, org_id: 99, config: { identity: { role: "x" } } });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0]![0]).toBe(OWNER_ORG);
  });

  it("el workspace A no puede modificar el borrador de B: 404 y solo se intenta con su propio orgId", async () => {
    identity = { orgId: 2, role: "owner" };
    const res = await send("/7/draft", "PUT", { config: { identity: { role: "x" } } });
    expect(res.status).toBe(404);
    expect(saveDraft.mock.calls.map((c) => c[0])).toEqual([2]);
  });

  it("exige agents.write", async () => {
    identity = { orgId: OWNER_ORG, role: "read_only" };
    expect((await send("/7/draft", "PUT", { config: {} })).status).toBe(403);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("el workspace A no puede leer el agente de B", async () => {
    identity = { orgId: 2, role: "owner" };
    expect((await fetch(`${base}/7`)).status).toBe(404);
    expect(getAgentDetail.mock.calls.map((c) => c[0])).toEqual([2]);
  });
});

describe("GET /:id/effective-access — solo lectura", () => {
  it("con agents.read devuelve el resultado del servicio, calculado para el usuario autenticado", async () => {
    previewEffectiveAccess.mockResolvedValue({ agentId: 7, tools: [{ toolId: "list_tasks", allowed: true }], summary: { declared: 1 } });
    identity = { orgId: 1, role: "member", platformRole: "NONE" };
    const res = await fetch(`${base}/7/effective-access`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agentId: 7, tools: [{ toolId: "list_tasks" }] });
    expect(previewEffectiveAccess).toHaveBeenCalledWith({ orgId: 1, orgRole: "member", platformRole: "NONE" }, 7);
  });

  it.each(["owner", "admin", "manager", "member", "read_only"])("el rol %s (agents.read) puede consultarlo", async (role) => {
    identity = { orgId: 1, role };
    expect((await fetch(`${base}/7/effective-access`)).status).toBe(200);
  });

  it.each(["vendedor", "cliente", "client", undefined])("el rol %s no tiene agents.read → 403 y no se calcula nada", async (role) => {
    identity = { orgId: 1, role };
    expect((await fetch(`${base}/7/effective-access`)).status).toBe(403);
    expect(previewEffectiveAccess).not.toHaveBeenCalled();
  });

  it("no se puede evaluar a otro usuario: role, userId, orgId y platformRole de la query o del cuerpo se ignoran", async () => {
    identity = { orgId: 1, role: "read_only", platformRole: "NONE" };
    await fetch(`${base}/7/effective-access?role=owner&userId=999&orgId=2&platformRole=SUPER_ADMIN&as=admin`, { headers: { "x-ws-override": "2", "x-active-workspace": "2" } });
    expect(previewEffectiveAccess).toHaveBeenCalledWith({ orgId: 1, orgRole: "read_only", platformRole: "NONE" }, 7);
  });

  it("solo existe GET: no hay POST/PUT/PATCH/DELETE", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect((await send("/7/effective-access", method, {})).status, method).toBe(404);
  });

  it("no crea auditoría, no publica y no escribe nada", async () => {
    await fetch(`${base}/7/effective-access`);
    expect(logAudit).not.toHaveBeenCalled();
    expect(publishAgent).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("el workspace A no ve el acceso efectivo del agente de B", async () => {
    identity = { orgId: 2, role: "owner" };
    const res = await fetch(`${base}/7/effective-access`);
    expect(res.status).toBe(404);
    expect(previewEffectiveAccess.mock.calls.map((c) => (c[0] as { orgId: number }).orgId)).toEqual([2]);
  });

  it("SUPER_ADMIN sin workspace activo no obtiene datos de ninguno (400, sin consultar)", async () => {
    identity = { orgId: undefined, superAdmin: true };
    const res = await fetch(`${base}/7/effective-access`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("no_org_context");
    expect(previewEffectiveAccess).not.toHaveBeenCalled();
  });

  it("un id no válido → 400", async () => {
    expect((await fetch(`${base}/abc/effective-access`)).status).toBe(400);
  });
});
