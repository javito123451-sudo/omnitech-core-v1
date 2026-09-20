// Contrato HTTP de LIVE (sin base de datos): permiso agents.execute, cabecera Idempotency-Key, errores estructurados
// (429 / 409) y auditoría de los rechazos. El agentsRouter es el real; solo se observa la capa de servicio.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const executeRun = vi.hoisted(() => vi.fn());
const confirmAgentAction = vi.hoisted(() => vi.fn());
const logAuditSystem = vi.hoisted(() => vi.fn());

vi.mock("../../agents/liveRunService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/liveRunService")>()),
  executeRun: (...a: unknown[]) => executeRun(...a),
}));
vi.mock("../../agents/agentRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/agentRunner")>()),
  confirmAgentAction: (...a: unknown[]) => confirmAgentAction(...a),
}));
vi.mock("../../utils/auditLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/auditLogger")>()),
  logAuditSystem: (...a: unknown[]) => logAuditSystem(...a),
  logAudit: vi.fn(),
}));

import { agentsRouter } from "../agents";
import { LiveRunRejection } from "../../agents/liveRunService";
import { AgentError } from "../../agents/agentService";

interface Identity { orgId?: number; role?: string; superAdmin?: boolean }
let identity: Identity = {};
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: identity.orgId, userId: 42, orgRole: identity.role, effectiveRole: identity.role, isSuperAdmin: identity.superAdmin === true, clerkUserId: "clerk_42" });
    next();
  });
  app.use("/api/agents", agentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const runResult = { mode: "live", agent: { id: 7, name: "Ana", versionNumber: 1 }, reply: "hola", toolsUsed: [], proposals: [], denied: [],
  usage: { provider: "fake", model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0.5, credits: 2, estimatedCredits: 2, cached: false, requestIds: ["r"] } };

beforeEach(() => {
  identity = { orgId: 1, role: "admin" };
  executeRun.mockReset().mockResolvedValue({ result: runResult, replayed: false, runId: "run-1" });
  confirmAgentAction.mockReset().mockResolvedValue({ agentId: 7, versionNumber: 1, toolId: "create_task", args: {}, result: {} });
  logAuditSystem.mockReset().mockResolvedValue(undefined);
});

const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const audited = () => logAuditSystem.mock.calls.map((c) => c[0] as { action: string; details: Record<string, unknown> });

describe("POST /:id/run — permisos por modo", () => {
  it("LIVE con agents.read pero sin agents.execute (read_only) → 403, nada se ejecuta, y queda agent_run_denied", async () => {
    identity = { orgId: 1, role: "read_only" };
    const res = await send("/7/run", { mode: "live", message: "hola" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "permission_denied", permission: "agents.execute" });
    expect(executeRun).not.toHaveBeenCalled();
    expect(audited()).toEqual([expect.objectContaining({ action: "agent_run_denied", details: expect.objectContaining({ reason: "permission_denied", role: "read_only", mode: "live" }) })]);
  });

  it.each(["owner", "admin", "manager", "member"])("%s puede ejecutar LIVE", async (role) => {
    identity = { orgId: 1, role };
    expect((await send("/7/run", { mode: "live", message: "hola" })).status).toBe(200);
    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(executeRun.mock.calls[0]![0]).toMatchObject({ mode: "live", agentId: 7, actor: { orgId: 1, userId: 42, orgRole: role } });
  });

  it("vendedor (sin agents.read) → 403 antes de nada", async () => {
    identity = { orgId: 1, role: "vendedor" };
    expect((await send("/7/run", { mode: "live", message: "hola" })).status).toBe(403);
    expect(executeRun).not.toHaveBeenCalled();
  });

  it("testing sigue pidiendo agents.write (member, con execute pero sin write, no puede probar); simulate sigue en agents.read", async () => {
    identity = { orgId: 1, role: "member" };
    const res = await send("/7/run", { mode: "testing", message: "hola" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("agents.write") });
    expect(executeRun).not.toHaveBeenCalled();
    identity = { orgId: 1, role: "manager" };
    expect((await send("/7/run", { mode: "testing", message: "hola" })).status).toBe(200);
  });

  it("SUPER_ADMIN conserva su bypass", async () => {
    identity = { orgId: 1, role: "none", superAdmin: true };
    expect((await send("/7/run", { mode: "live", message: "hola" })).status).toBe(200);
  });

  it("CONFIRM exige agents.execute: read_only → 403 y no se toca el almacén", async () => {
    identity = { orgId: 1, role: "read_only" };
    const res = await send("/7/confirm", { confirmToken: "t", confirm: true });
    expect(res.status).toBe(403);
    expect(confirmAgentAction).not.toHaveBeenCalled();
    expect(audited()[0]).toMatchObject({ action: "agent_run_denied" });
    identity = { orgId: 1, role: "member" };
    expect((await send("/7/confirm", { confirmToken: "t", confirm: true })).status).toBe(200);
  });
});

describe("POST /:id/run — Idempotency-Key y errores estructurados", () => {
  it("pasa la clave al servicio (recortada) y, sin cabecera, pasa null; el cuerpo no puede aportar requestId", async () => {
    await send("/7/run", { mode: "live", message: "hola", requestId: "del-cliente-1234" }, { "Idempotency-Key": "  clave-valida-1  " });
    expect(executeRun.mock.calls[0]![0]).toMatchObject({ idempotencyKey: "clave-valida-1" });
    expect(JSON.stringify(executeRun.mock.calls[0]![0])).not.toContain("del-cliente-1234");
    await send("/7/run", { mode: "live", message: "hola" });
    expect(executeRun.mock.calls[1]![0]).toMatchObject({ idempotencyKey: null });
  });

  it("clave con formato inválido → 400 sin ejecutar", async () => {
    for (const bad of ["corta", "tiene espacios dentro", "x".repeat(200)]) {
      const res = await send("/7/run", { mode: "live", message: "hola" }, { "Idempotency-Key": bad });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_idempotency_key" });
    }
    expect(executeRun).not.toHaveBeenCalled();
  });

  it("un resultado repetido lleva la cabecera Idempotent-Replayed", async () => {
    executeRun.mockResolvedValue({ result: runResult, replayed: true, runId: "run-1" });
    const res = await send("/7/run", { mode: "live", message: "hola" }, { "Idempotency-Key": "clave-valida-1" });
    expect(res.headers.get("idempotent-replayed")).toBe("true");
    expect((await send("/7/run", { mode: "live", message: "hola" })).status).toBe(200);
  });

  it("rate limit → 429 estructurado con Retry-After", async () => {
    executeRun.mockRejectedValue(new LiveRunRejection(429, "RATE_LIMITED", "Has alcanzado el límite", { scope: "user", limitPerMinute: 10, retryAfterSeconds: 60 }));
    const res = await send("/7/run", { mode: "live", message: "hola" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ status: "RATE_LIMITED", message: "Has alcanzado el límite", scope: "user", limitPerMinute: 10, retryAfterSeconds: 60 });
  });

  it("clave reutilizada con otro contenido y ejecución aún en curso → 409 estructurados", async () => {
    executeRun.mockRejectedValueOnce(new LiveRunRejection(409, "IDEMPOTENCY_KEY_REUSED", "otra petición"));
    const a = await send("/7/run", { mode: "live", message: "hola" }, { "Idempotency-Key": "clave-valida-1" });
    expect([a.status, ((await a.json()) as { status: string }).status]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    executeRun.mockRejectedValueOnce(new LiveRunRejection(409, "IDEMPOTENCY_IN_PROGRESS", "en curso", { retryAfterSeconds: 5 }));
    const b = await send("/7/run", { mode: "live", message: "hola" }, { "Idempotency-Key": "clave-valida-1" });
    expect([b.status, ((await b.json()) as { status: string }).status, b.headers.get("retry-after")]).toEqual([409, "IDEMPOTENCY_IN_PROGRESS", "5"]);
  });

  it("los errores del agente y del Gateway se traducen como antes (404, 402 estructurado)", async () => {
    executeRun.mockRejectedValueOnce(new AgentError(404, "Agente no encontrado."));
    expect((await send("/7/run", { mode: "live", message: "hola" })).status).toBe(404);
  });

  it("la vista del cliente sigue sin tokens ni costes en dinero; ?technical=1 solo con permiso de edición", async () => {
    const plain = await (await send("/7/run", { mode: "live", message: "hola" })).json() as { usage: Record<string, unknown> };
    expect(plain.usage).not.toHaveProperty("costUsd");
    expect(plain.usage).not.toHaveProperty("tokensIn");
    expect(plain.usage["credits"]).toBe(2);
  });
});
