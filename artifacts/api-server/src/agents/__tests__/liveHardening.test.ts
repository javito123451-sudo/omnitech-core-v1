// Piezas puras del hardening LIVE (sin base de datos): almacén de propuestas, auditoría, límites, huellas y matriz de permisos.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryProposalStore, hashToken, PROPOSAL_TTL_MS } from "../proposalStore";
import { argKeys, fingerprint, makeAudit, scrub } from "../liveAudit";
import { DEFAULT_LIVE_LIMITS, hashIdempotencyKey, hashRequest, IDEMPOTENCY_KEY_PATTERN, liveLimits } from "../liveRunService";
import { getPermissionsForRole } from "../../middlewares/permissions";

const logAuditSystem = vi.hoisted(() => vi.fn());
vi.mock("../../utils/auditLogger", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../utils/auditLogger")>()), logAuditSystem: (...a: unknown[]) => logAuditSystem(...a) }));

const P = { orgId: 1, userId: 10, agentId: 5, agentVersionId: 50, toolId: "create_task", args: { title: "x" }, testOnly: false };
const ctx = { orgId: 1, userId: 10, agentId: 5 };

describe("almacén de propuestas (misma semántica que el de PostgreSQL)", () => {
  it("el token no es el hash y solo el dueño exacto (org + usuario + agente) puede consumirlo, una vez", async () => {
    const s = createMemoryProposalStore();
    const { token } = await s.create(P);
    expect(token.length).toBeGreaterThanOrEqual(43);                 // 256 bits en base64url
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await s.consume(token, { ...ctx, userId: 99 })).toBeNull();
    expect(await s.consume(token, { ...ctx, orgId: 2 })).toBeNull();
    expect(await s.consume(token, { ...ctx, agentId: 6 })).toBeNull();
    expect(await s.consume(token, ctx)).toMatchObject({ toolId: "create_task", args: { title: "x" }, agentVersionId: 50 });
    expect(await s.consume(token, ctx)).toBeNull();                   // un solo uso
  });

  it("caduca a los 5 minutos", async () => {
    let now = 1_000_000;
    const s = createMemoryProposalStore(() => now);
    const { token, expiresAt } = await s.create(P);
    expect(Date.parse(expiresAt) - now).toBe(PROPOSAL_TTL_MS);
    now += PROPOSAL_TTL_MS + 1;
    expect(await s.consume(token, ctx)).toBeNull();
  });

  it("un token inventado no consume nada; dos tokens son independientes", async () => {
    const s = createMemoryProposalStore();
    const a = await s.create(P); const b = await s.create({ ...P, toolId: "create_client" });
    expect(a.token).not.toBe(b.token);
    expect(await s.consume("inventado", ctx)).toBeNull();
    expect((await s.consume(b.token, ctx))!.toolId).toBe("create_client");
    expect((await s.consume(a.token, ctx))!.toolId).toBe("create_task");
  });

  it("consumir concurrentemente: solo una promesa lo recibe", async () => {
    const s = createMemoryProposalStore();
    const { token } = await s.create(P);
    const rs = await Promise.all(Array.from({ length: 8 }, () => s.consume(token, ctx)));
    expect(rs.filter(Boolean)).toHaveLength(1);
  });
});

describe("auditoría LIVE: privacidad", () => {
  beforeEach(() => logAuditSystem.mockReset());

  it("scrub elimina secretos, tokens y claves, y conserva los hashes", () => {
    expect(scrub({ token: "t", confirmToken: "c", apiKey: "k", api_key: "k", secret: "s", password: "p", authorization: "a", cookie: "c", idempotencyKey: "i", idempotencyKeyHash: "h", toolId: "create_task", nested: { bearer: "b", ok: 1 } }))
      .toEqual({ idempotencyKeyHash: "h", toolId: "create_task", nested: { ok: 1 } });
  });

  it("fingerprint es estable, corto y no revela el valor; argKeys solo devuelve nombres ordenados", () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint("DATO-PERSONAL")).toMatch(/^[0-9a-f]{16}$/);
    expect(argKeys({ title: "x", priority: "y" })).toEqual(["priority", "title"]);
  });

  it("makeAudit escribe el evento con actor, rol, workspace, agente y resultado; y descarta secretos que se le pasen", async () => {
    await makeAudit({ ip: "1.2.3.4", userAgent: "ua" })({
      action: "tool_action_failed", actor: { clerkId: "clerk_1", userId: 1, orgId: 7, role: "admin" }, agentId: 5, mode: "live", versionNumber: 2,
      runId: "run-1", toolId: "create_task", success: false, reason: "not_authorized", details: { confirmToken: "SECRETO", apiKey: "SECRETO", argsHash: "abc" },
    });
    const call = logAuditSystem.mock.calls[0]![0] as Record<string, any>;
    expect(call).toMatchObject({ actorClerkId: "clerk_1", action: "tool_action_failed", resource: "ai_agent", resourceId: 5, orgId: 7, severity: "warning", result: "failure", ip: "1.2.3.4" });
    expect(call.details).toMatchObject({ role: "admin", mode: "live", versionNumber: 2, runId: "run-1", toolId: "create_task", reason: "not_authorized", argsHash: "abc" });
    expect(JSON.stringify(call)).not.toContain("SECRETO");
  });

  it("los eventos correctos son info y los fallidos warning", async () => {
    const a = makeAudit();
    const actor = { clerkId: "c", userId: 1, orgId: 1, role: "admin" };
    await a({ action: "agent_run_completed", actor, agentId: 1, success: true });
    await a({ action: "agent_run_denied", actor, agentId: 1, success: false, reason: "rate_limited" });
    expect(logAuditSystem.mock.calls.map((c) => (c[0] as { severity: string }).severity)).toEqual(["info", "warning"]);
  });
});

describe("idempotencia y límites: piezas puras", () => {
  it("formato de Idempotency-Key: 8–128 caracteres, letras, números y . _ : -", () => {
    for (const ok of ["abcdefgh", "a1b2c3d4-e5f6-7890", "req:2026.09.20_abc", "x".repeat(128)]) expect(IDEMPOTENCY_KEY_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["corta", "x".repeat(129), "con espacios aquí", "raro/±chars", "", "a b c d e f g h"]) expect(IDEMPOTENCY_KEY_PATTERN.test(bad), bad).toBe(false);
  });

  it("la clave se guarda como hash SHA-256 y la huella de la petición depende del contenido", () => {
    expect(hashIdempotencyKey("mi-clave-secreta")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotencyKey("mi-clave-secreta")).not.toContain("secreta");
    const base = { mode: "live", message: "hola", history: [] as unknown[] };
    expect(hashRequest(base)).toBe(hashRequest({ ...base }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, message: "adiós" }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, mode: "testing" }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, history: [{ role: "user", content: "x" }] }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, versionId: 3 }));
  });

  it("límites por defecto (10 por usuario y 60 por workspace, por minuto), configurables por entorno; valores inválidos → por defecto", () => {
    expect(DEFAULT_LIVE_LIMITS).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
    expect(liveLimits({})).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
    expect(liveLimits({ AGENT_LIVE_USER_LIMIT_PER_MIN: "5", AGENT_LIVE_ORG_LIMIT_PER_MIN: "30" })).toEqual({ userPerWindow: 5, orgPerWindow: 30 });
    expect(liveLimits({ AGENT_LIVE_USER_LIMIT_PER_MIN: "0", AGENT_LIVE_ORG_LIMIT_PER_MIN: "1.5" })).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
  });
});

describe("permisos: agents.execute", () => {
  const has = (role: string, p: "agents.read" | "agents.write" | "agents.publish" | "agents.execute") => getPermissionsForRole(role).has(p);

  it("owner, admin, manager y member ejecutan LIVE; read_only, vendedor, cliente y otros roles, no", () => {
    for (const r of ["owner", "admin", "manager", "member"]) expect(has(r, "agents.execute"), r).toBe(true);
    for (const r of ["read_only", "vendedor", "cliente", "client", "asistente", "inexistente"]) expect(has(r, "agents.execute"), r).toBe(false);
  });

  it("agents.read NO implica agents.execute, y agents.write/publish tampoco lo sustituyen: los cuatro son independientes", () => {
    expect(has("read_only", "agents.read")).toBe(true);
    expect(has("read_only", "agents.execute")).toBe(false);
    const table = Object.fromEntries(["owner", "admin", "manager", "member", "read_only"].map((r) => [r, ["agents.read", "agents.write", "agents.publish", "agents.execute"].filter((p) => has(r, p as never))]));
    expect(table).toEqual({
      owner: ["agents.read", "agents.write", "agents.publish", "agents.execute"],
      admin: ["agents.read", "agents.write", "agents.publish", "agents.execute"],
      manager: ["agents.read", "agents.write", "agents.execute"],
      member: ["agents.read", "agents.execute"],
      read_only: ["agents.read"],
    });
  });
});
