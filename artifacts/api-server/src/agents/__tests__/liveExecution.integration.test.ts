// Ejecución LIVE de Agent Factory de extremo a extremo contra Postgres real (ci-test): permisos, límite de uso, idempotencia,
// confirmaciones persistentes y atómicas, auditoría, créditos y aislamiento entre workspaces.
//
// Camino real: HTTP (agentsRouter con identidad simulada) → executeRun → runAgent → Skill Engine → AI Gateway → OmniCredits.
// Solo el proveedor de IA es falso y guionizado. Requiere DATABASE_URL de una base desechable; se omite limpiamente sin ella.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import {
  db, aiUsageLogsTable, creditLedgerTable, tasksTable, clientsTable, knowledgeBaseTable, auditLogsTable,
  aiAgentProposalsTable, aiAgentRunRequestsTable, type AgentConfig,
} from "@workspace/db";

// Rol sintético «sinCrm»: tiene agents.read pero ningún permiso de CRM (no existe un rol real así). Solo afecta a authorization.ts.
vi.mock("../../middlewares/permissions", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../middlewares/permissions")>();
  return { ...m, getPermissionsForRole: (r: string) => (r === "sinCrm" ? new Set(["agents.read", "ai.read"]) : m.getPermissionsForRole(r)) as ReturnType<typeof m.getPermissionsForRole> };
});

import { agentsRouter } from "../../routes/agents";
import { callAI, type GatewayDeps } from "../../ai-gateway/gateway";
import { ResponseCache } from "../../ai-gateway/responseCache";
import { checkBudgetBlocked, logAiCall } from "../../utils/aiUsageLogger";
import { creditsPort, getAvailable, grantCredits } from "../../credits/creditService";
import { createAgent, publishAgent, saveDraft, transitionAgent } from "../agentService";
import { defaultRunnerDeps, runAgent } from "../agentRunner";
import { resetDeniedAuditThrottle } from "../liveRunService";
import { hashToken } from "../proposalStore";
import { getPermissionsForRole } from "../../middlewares/permissions";
import { resolveToolAccess } from "../authorization";
import { TOOL_REGISTRY } from "../toolRegistry";
import { listSkills } from "../../skills";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import type { GenerateResult, Message } from "../../ai/types";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const FN = `live_it_${Date.now()}`;
const known = () => new Set(listSkills().map((s) => s.id));
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

// ── IA falsa guionizada + Gateway y créditos REALES ──────────────────────────────────────────────────
type Script = GenerateResult | Error | (() => Promise<GenerateResult>);
const script: Script[] = [];
const seen: Message[][] = [];
let providerCalls = 0;
const usage = { promptTokens: 200, completionTokens: 50, totalTokens: 250 };
const say = (text: string): GenerateResult => ({ text, usage });
const callTool = (name: string, args: object, id = "c1"): GenerateResult => ({ text: "", usage, toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

const fakeRoute = {
  provider: {
    id: "fake", name: "fake",
    generate: async (m: Message[]) => {
      providerCalls++; seen.push(m);
      const s = script.shift() ?? say("ok");
      if (s instanceof Error) throw s;
      return typeof s === "function" ? s() : s;
    },
  } as never,
  providerId: "fake", model: "gpt-4o-mini", timeoutMs: 5000,
};
const gatewayDeps: GatewayDeps = {
  resolveRoutes: () => [fakeRoute], checkBudgetBlocked, logAiCall, credits: creditsPort, cache: new ResponseCache(),
  sleep: async () => {}, ensurePricingLoaded: async () => {}, auditBlock: async () => {},
};
const realCallAI = defaultRunnerDeps.callAI;

// ── HTTP con identidad simulada ──────────────────────────────────────────────────────────────────────
interface Identity { orgId: number; userId: number; role: string; platformRole?: string; superAdmin?: boolean }
let id: Identity;
let server: Server;
let base = "";
const as = (orgId: number, userId: number, role: string, extra: Partial<Identity> = {}) => { id = { orgId, userId, role, ...extra }; };

const http = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: Record<string, any> = {};
  try { json = await res.json() as Record<string, any>; } catch { /* sin cuerpo */ }
  return { status: res.status, body: json, headers: res.headers };
};
const live = (agentId: number, message = "hola", key?: string, extra: object = {}) =>
  http("POST", `/${agentId}/run`, { mode: "live", message, ...extra }, key ? { "Idempotency-Key": key } : {});
const confirm = (agentId: number, token: string) => http("POST", `/${agentId}/confirm`, { confirmToken: token, confirm: true });

let A = 0, B = 0, C = 0;
const U = { adminA: 1001, adminA2: 1002, roA: 1003, memberA: 1004, adminB: 2001, adminC: 3001, adminC2: 3002 };
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ready = (over: Partial<AgentConfig> = {}): Partial<AgentConfig> => ({
  identity: { role: "ROL-V1" },
  objective: { what: "Atender", audience: "c", expectedOutcome: "e" }, behavior: { instructions: "Sé amable.", rules: [], restrictions: [], avoid: [] }, ...over,
});
async function publishedAgent(org: number, name: string, over: Partial<AgentConfig> = {}) {
  const { agent } = await createAgent(org, "audit", { name });
  await saveDraft(org, agent.id, "audit", ready(over));
  await publishAgent(org, agent.id, known());
  return agent.id;
}
const proposeAgent = (org: number, tools: Partial<AgentConfig["tools"]> = { read: [], write: ["create_task"] }) =>
  publishedAgent(org, `Agente-${uniq()}`, { tools: { read: [], write: [], ...tools } });

const tasksOf = (org: number, title: string) => db.select().from(tasksTable).where(and(eq(tasksTable.orgId, org), eq(tasksTable.title, title)));
const countRows = async (table: typeof tasksTable | typeof aiUsageLogsTable | typeof creditLedgerTable | typeof aiAgentRunRequestsTable, org: number) =>
  Number((await db.select({ n: sql`count(*)` }).from(table as typeof tasksTable).where(eq((table as typeof tasksTable).orgId, org)))[0]!.n);
const snapshot = async (org: number) => ({ usage: await countRows(aiUsageLogsTable, org), ledger: await countRows(creditLedgerTable, org), balance: (await getAvailable(org)).available });
const auditOf = async (org: number, agentId: number) =>
  (await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, org), eq(auditLogsTable.resourceId, String(agentId))))).map((r) => ({ action: r.action, actor: r.actorClerkId, details: (r.details ?? {}) as Record<string, any> }));
const actionsOf = async (org: number, agentId: number) => (await auditOf(org, agentId)).map((a) => a.action);

/** Cambia los límites LIVE por entorno durante un test. Por defecto son altos para que no interfieran entre tests. */
const setLimits = (user: number, org: number) => { process.env["AGENT_LIVE_USER_LIMIT_PER_MIN"] = String(user); process.env["AGENT_LIVE_ORG_LIMIT_PER_MIN"] = String(org); };

describe.skipIf(!hasRealDb)("Agent Factory LIVE — ejecución de extremo a extremo (Postgres)", () => {
  beforeAll(async () => {
    defaultRunnerDeps.callAI = ((req: Parameters<typeof callAI>[0]) => callAI({ ...req, functionName: `${FN}_${req.functionName}` }, gatewayDeps)) as typeof defaultRunnerDeps.callAI;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: id.orgId, userId: id.userId, orgRole: id.role, effectiveRole: id.role, clerkUserId: `clerk_${id.userId}`, isSuperAdmin: id.superAdmin === true, platformRole: id.platformRole });
      next();
    });
    app.use("/api/agents", agentsRouter);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents`;

    [A, B] = (await createTempOrgs(2, "live-it")) as [number, number];
    await grantCredits(A, 5000, { reference: `live-it-grant-A-${uniq()}` });
    await grantCredits(B, 5000, { reference: `live-it-grant-B-${uniq()}` });
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    defaultRunnerDeps.callAI = realCallAI;
    await db.delete(aiUsageLogsTable).where(sql`${aiUsageLogsTable.functionName} like ${FN + "%"}`);
    await deleteTempOrgs([A, B]);
    for (const k of ["AGENT_LIVE_USER_LIMIT_PER_MIN", "AGENT_LIVE_ORG_LIMIT_PER_MIN"]) delete process.env[k];
  });
  // C = workspace propio de CADA test (con créditos): las ejecuciones de la ventana de límite de otros tests no interfieren.
  beforeEach(async () => {
    script.length = 0; seen.length = 0; providerCalls = 0; setLimits(1000, 1000); resetDeniedAuditThrottle();
    [C] = (await createTempOrgs(1, "live-it-c")) as [number];
    await grantCredits(C, 500, { reference: `live-it-grant-C-${uniq()}` });
  });
  afterEach(async () => { vi.useRealTimers(); await deleteTempOrgs([C]); });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("permisos: agents.execute controla LIVE", () => {
    it("matriz de roles: agents.execute solo para owner/admin/manager/member; read_only y vendedor no", () => {
      const has = (role: string) => getPermissionsForRole(role).has("agents.execute");
      expect(["owner", "admin", "manager", "member"].map(has)).toEqual([true, true, true, true]);
      expect(["read_only", "vendedor", "cliente", "client", "asistente", "sinCrm"].map(has)).toEqual([false, false, false, false, false, false]);
      expect(getPermissionsForRole("read_only").has("agents.read")).toBe(true);
    });

    it("agents.read sin agents.execute (read_only): LIVE → 403 permission_denied, sin proveedor, sin créditos, sin fila de ejecución, con auditoría", async () => {
      const aid = await proposeAgent(A);
      as(A, U.roA, "read_only");
      const b = { snap: await snapshot(A), runs: await countRows(aiAgentRunRequestsTable, A) };
      const r = await live(aid);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: "permission_denied", permission: "agents.execute" });
      expect(providerCalls).toBe(0);
      expect(await snapshot(A)).toEqual(b.snap);
      expect(await countRows(aiAgentRunRequestsTable, A)).toBe(b.runs);
      const denied = (await auditOf(A, aid)).find((e) => e.action === "agent_run_denied")!;
      expect(denied.details).toMatchObject({ reason: "permission_denied", role: "read_only", mode: "live", result: "failure" });
    });

    it("read_only sí puede simular (agents.read) y ver el agente; no puede probar con IA real (agents.write)", async () => {
      const aid = await proposeAgent(A);
      as(A, U.roA, "read_only");
      expect((await http("POST", `/${aid}/simulate`, { message: "hola" })).status).toBe(200);
      expect((await fetch(`${base}/${aid}`)).status).toBe(200);
      expect((await http("POST", `/${aid}/run`, { mode: "testing", message: "hola" })).status).toBe(403);
      expect(providerCalls).toBe(0);
    });

    it.each(["owner", "admin", "manager", "member"])("%s (agents.execute) puede ejecutar LIVE", async (role) => {
      const aid = await proposeAgent(A);
      as(A, U.memberA, role);
      const r = await live(aid);
      expect(r.status).toBe(200);
    });

    it("agents.write NO sustituye a agents.execute: testing va con write, LIVE con execute (manager tiene ambos; se comprueba cada uno por separado)", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "manager");
      script.push(say("t"), say("l"));
      expect((await http("POST", `/${aid}/run`, { mode: "testing", message: "hola" })).status).toBe(200);
      expect((await live(aid)).status).toBe(200);
    });

    it("vendedor (sin agents.read) → 403 en la ruta; SUPER_ADMIN conserva su bypass", async () => {
      const aid = await proposeAgent(A);
      as(A, 5555, "vendedor");
      expect((await live(aid)).status).toBe(403);
      as(A, 6666, "none", { superAdmin: true, platformRole: "SUPER_ADMIN" });
      expect((await live(aid)).status).toBe(200);
    });

    it("CONFIRM también exige agents.execute", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      script.push(callTool("create_task", { title: `t-${uniq()}` }), say("¿la creo?"));
      const run = await live(aid);
      as(A, U.roA, "read_only");
      const r = await confirm(aid, run.body.proposals[0].confirmToken);
      expect(r.status).toBe(403);
      expect(r.body.permission).toBe("agents.execute");
      // el intento no gastó la propuesta: su dueño sigue pudiendo confirmarla
      as(A, U.adminA, "admin");
      expect((await confirm(aid, run.body.proposals[0].confirmToken)).status).toBe(200);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("límite de uso LIVE (por usuario y por workspace)", () => {
    it("valores por defecto documentados y sobrescribibles por entorno", async () => {
      const { liveLimits, DEFAULT_LIVE_LIMITS } = await import("../liveRunService");
      expect(DEFAULT_LIVE_LIMITS).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
      expect(liveLimits({})).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
      expect(liveLimits({ AGENT_LIVE_USER_LIMIT_PER_MIN: "3", AGENT_LIVE_ORG_LIMIT_PER_MIN: "7" })).toEqual({ userPerWindow: 3, orgPerWindow: 7 });
      expect(liveLimits({ AGENT_LIVE_USER_LIMIT_PER_MIN: "abc", AGENT_LIVE_ORG_LIMIT_PER_MIN: "-1" })).toEqual({ userPerWindow: 10, orgPerWindow: 60 });
    });

    it("el usuario que excede su límite recibe 429 estructurado: sin proveedor, sin créditos, con auditoría", async () => {
      setLimits(2, 1000);
      const aid = await publishedAgent(C, `Limite-${uniq()}`);
      as(C, U.adminC, "admin");
      script.push(say("1"), say("2"), say("3"));
      expect((await live(aid, "uno")).status).toBe(200);
      expect((await live(aid, "dos")).status).toBe(200);
      const before = await snapshot(C); const calls = providerCalls;
      const third = await live(aid, "tres");
      expect(third.status).toBe(429);
      expect(third.body).toMatchObject({ status: "RATE_LIMITED", scope: "user", limitPerMinute: 2 });
      expect(third.headers.get("retry-after")).toBe("60");
      expect(providerCalls).toBe(calls);
      expect(await snapshot(C)).toEqual(before);
      const events = await auditOf(C, aid);
      expect(events.find((e) => e.action === "agent_run_denied" && e.details["reason"] === "rate_limited")).toBeTruthy();
    });

    it("el límite es POR USUARIO: otro usuario del mismo workspace no se ve afectado", async () => {
      setLimits(1, 1000);
      const aid = await publishedAgent(C, `Usuarios-${uniq()}`);
      as(C, U.adminC, "admin"); expect((await live(aid, "a")).status).toBe(200);
      expect((await live(aid, "b")).status).toBe(429);
      as(C, U.adminC2, "admin"); expect((await live(aid, "c")).status).toBe(200);
    });

    it("el workspace que excede su límite recibe 429 con scope org", async () => {
      setLimits(1000, 3);
      const orgs = (await createTempOrgs(1, "live-it-orgcap")) as [number];
      const O = orgs[0]!;
      try {
        await grantCredits(O, 500, { reference: `live-it-grant-O-${uniq()}` });
        const aid = await publishedAgent(O, `Org-${uniq()}`);
        for (const [i, u] of [4001, 4002, 4003].entries()) { as(O, u, "admin"); expect((await live(aid, `m${i}`)).status).toBe(200); }
        as(O, 4004, "admin");
        const r = await live(aid, "excede");
        expect(r.status).toBe(429);
        expect(r.body).toMatchObject({ status: "RATE_LIMITED", scope: "org", limitPerMinute: 3 });
        const calls = providerCalls;
        await live(aid, "otra");
        expect(providerCalls).toBe(calls);
      } finally { await deleteTempOrgs([O]); }
    });

    it("un rechazo no ocupa hueco de la ventana y un reintento idempotente de una ejecución ya hecha no cuenta ni se bloquea", async () => {
      setLimits(1, 1000);
      const aid = await publishedAgent(C, `Reintento-${uniq()}`);
      as(C, U.adminC, "admin");
      const key = `k-${uniq()}`;
      expect((await live(aid, "primera", key)).status).toBe(200);
      expect((await live(aid, "segunda")).status).toBe(429);                 // sin clave: ejecución nueva → límite
      const replay = await live(aid, "primera", key);                          // con la clave: repetición → no cuenta
      expect(replay.status).toBe(200);
      expect(replay.headers.get("idempotent-replayed")).toBe("true");
    });

    it("el límite solo afecta a LIVE: testing y simulate no lo consumen", async () => {
      setLimits(1, 1000);
      const aid = await publishedAgent(C, `Solo-live-${uniq()}`);
      as(C, U.adminC, "admin");
      script.push(say("t1"), say("t2"));
      expect((await http("POST", `/${aid}/run`, { mode: "testing", message: "a" })).status).toBe(200);
      expect((await http("POST", `/${aid}/run`, { mode: "testing", message: "b" })).status).toBe(200);
      expect((await http("POST", `/${aid}/simulate`, { message: "s" })).status).toBe(200);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("idempotencia de /run (Idempotency-Key)", () => {
    it("misma clave y mismo contenido: el reintento devuelve el resultado anterior sin proveedor, sin usage log, sin ledger, sin nueva auditoría", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      const key = `retry-${uniq()}`;
      script.push(say("respuesta única"));
      const first = await live(aid, "hola", key);
      const mid = await snapshot(A); const calls = providerCalls; const runs = await countRows(aiAgentRunRequestsTable, A);
      const second = await live(aid, "hola", key);
      expect(second.status).toBe(200);
      expect(second.headers.get("idempotent-replayed")).toBe("true");
      expect(first.headers.get("idempotent-replayed")).toBeNull();
      expect(second.body.reply).toBe(first.body.reply);
      expect(second.body.usage.requestIds).toEqual(first.body.usage.requestIds);
      expect(providerCalls).toBe(calls);
      expect(await snapshot(A)).toEqual(mid);
      expect(await countRows(aiAgentRunRequestsTable, A)).toBe(runs);
      const actions = await actionsOf(A, aid);
      expect(actions.filter((a) => a === "agent_run_started")).toHaveLength(1);
      expect(actions.filter((a) => a === "agent_run_completed")).toHaveLength(1);
    });

    it("10 POST /run simultáneos con la misma clave: UNA sola ejecución real", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      const key = `burst-${uniq()}`;
      const before = await snapshot(A);
      script.push(async () => { await new Promise((r) => setTimeout(r, 400)); return say("una sola vez"); });
      const results = await Promise.all(Array.from({ length: 10 }, () => live(aid, "hola", key)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(new Set(results.map((r) => r.body.reply)).size).toBe(1);
      expect(new Set(results.map((r) => JSON.stringify(r.body.usage.requestIds))).size).toBe(1);
      expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(9);
      expect(providerCalls).toBe(1);
      const after = await snapshot(A);
      expect(after.usage - before.usage).toBe(1);
      expect(after.ledger - before.ledger).toBe(1);
      const actions = await actionsOf(A, aid);
      expect(actions.filter((a) => a === "agent_run_started")).toHaveLength(1);
      expect(actions.filter((a) => a === "agent_run_completed")).toHaveLength(1);
    });

    it("misma clave con contenido distinto → 409 IDEMPOTENCY_KEY_REUSED, sin ejecutar nada", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      const key = `reuse-${uniq()}`;
      script.push(say("ok"));
      await live(aid, "mensaje original", key);
      const before = await snapshot(A); const calls = providerCalls;
      const r = await live(aid, "OTRO mensaje", key);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ status: "IDEMPOTENCY_KEY_REUSED" });
      expect(providerCalls).toBe(calls);
      expect(await snapshot(A)).toEqual(before);
    });

    it("la clave está ligada a usuario, agente y modo: en otro contexto es una ejecución independiente", async () => {
      const a1 = await proposeAgent(A, { read: [], write: [] });
      const a2 = await proposeAgent(A, { read: [], write: [] });
      const key = `scope-${uniq()}`;
      script.push(say("1"), say("2"), say("3"), say("4"));
      as(A, U.adminA, "admin");
      expect((await live(a1, "x", key)).status).toBe(200);
      expect((await live(a2, "x", key)).status).toBe(200);                                        // otro agente
      as(A, U.adminA2, "admin");
      expect((await live(a1, "x", key)).body.reply).toBe("3");                                     // otro usuario: nueva ejecución
      as(A, U.adminA, "admin");
      const testing = await http("POST", `/${a1}/run`, { mode: "testing", message: "x" }, { "Idempotency-Key": key });
      expect(testing.body.reply).toBe("4");                                                        // otro modo
      expect(providerCalls).toBe(4);
    });

    it("la clave nunca cruza workspaces: la misma en A y en B da dos ejecuciones", async () => {
      const aA = await proposeAgent(A, { read: [], write: [] });
      const aB = await proposeAgent(B, { read: [], write: [] });
      const key = `cross-${uniq()}`;
      script.push(say("A"), say("B"));
      as(A, U.adminA, "admin"); const ra = await live(aA, "x", key);
      as(B, U.adminB, "admin"); const rb = await live(aB, "x", key);
      expect([ra.body.reply, rb.body.reply]).toEqual(["A", "B"]);
      expect(providerCalls).toBe(2);
    });

    it("un requestId del cliente en el cuerpo no cuenta: sin cabecera cada petición es una ejecución nueva", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      script.push(say("1"), say("2"));
      await live(aid, "x", undefined, { requestId: "fijo-123456" });
      await live(aid, "x", undefined, { requestId: "fijo-123456" });
      expect(providerCalls).toBe(2);
    });

    it("una ejecución que FALLÓ libera la clave: el reintento con la misma clave se ejecuta y se cobra una sola vez", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      const key = `fail-${uniq()}`;
      const before = await snapshot(A);
      script.push(Object.assign(new Error("boom"), { status: 400 }));
      const bad = await live(aid, "hola", key);
      expect(bad.status).toBe(503);
      const mid = await snapshot(A);
      expect(mid.ledger).toBe(before.ledger);                                                    // el fallo no cobró (reserva liberada)
      expect(mid.balance).toBeCloseTo(before.balance, 6);
      script.push(say("ahora sí"));
      const good = await live(aid, "hola", key);
      expect(good.status).toBe(200);
      expect((await snapshot(A)).ledger - before.ledger).toBe(1);
    });

    it("formato de clave: demasiado corta o con caracteres no permitidos → 400", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      expect((await live(aid, "x", "corta")).status).toBe(400);
      expect((await live(aid, "x", "con espacios no vale")).status).toBe(400);
      expect(providerCalls).toBe(0);
    });

    it("el Idempotency-Key no se guarda en claro: solo su hash", async () => {
      const aid = await proposeAgent(A, { read: [], write: [] });
      as(A, U.adminA, "admin");
      const key = `secreto-${uniq()}`;
      await live(aid, "hola", key);
      const rows = await db.select().from(aiAgentRunRequestsTable).where(and(eq(aiAgentRunRequestsTable.orgId, A), eq(aiAgentRunRequestsTable.agentId, aid)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.idempotencyKeyHash).toBe(sha(key));
      expect(JSON.stringify(rows[0])).not.toContain(key);
      expect(JSON.stringify(await auditOf(A, aid))).not.toContain(key);
    });

    it("la repetición de un resultado con propuesta devuelve el MISMO token, que sigue valiendo una sola vez", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      const key = `prop-${uniq()}`; const title = `t-${uniq()}`;
      script.push(callTool("create_task", { title }), say("¿la creo?"));
      const first = await live(aid, "crea", key);
      const second = await live(aid, "crea", key);
      expect(second.body.proposals[0].confirmToken).toBe(first.body.proposals[0].confirmToken);
      expect(await db.select().from(aiAgentProposalsTable).where(and(eq(aiAgentProposalsTable.orgId, A), eq(aiAgentProposalsTable.agentId, aid)))).toHaveLength(1);   // no se crea otra propuesta
      expect((await confirm(aid, first.body.proposals[0].confirmToken)).status).toBe(200);
      expect((await confirm(aid, second.body.proposals[0].confirmToken)).status).toBe(409);
      expect(await tasksOf(A, title)).toHaveLength(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("confirmaciones: persistentes, atómicas y de un solo uso", () => {
    async function propose(role = "admin", user = U.adminA, org = A, agentId?: number) {
      const aid = agentId ?? await proposeAgent(org);
      const title = `zz-conf-${uniq()}`;
      as(org, user, role);
      script.push(callTool("create_task", { title, priority: "high" }), say("¿la creo?"));
      const run = await live(aid, `crea ${title}`);
      expect(run.status).toBe(200);
      return { aid, title, token: run.body.proposals[0].confirmToken as string, proposal: run.body.proposals[0] };
    }
    const rowOf = async (token: string) => (await db.select().from(aiAgentProposalsTable).where(eq(aiAgentProposalsTable.tokenHash, hashToken(token))))[0];

    it("la propuesta se guarda en la base de datos con el hash del token (nunca el token), workspace, usuario, agente, versión, tool y argumentos", async () => {
      const p = await propose();
      const row = (await rowOf(p.token))!;
      expect(row).toMatchObject({ orgId: A, userId: U.adminA, agentId: p.aid, toolId: "create_task", status: "pending", testOnly: false, consumedAt: null });
      expect(row.tokenHash).toBe(sha(p.token));
      expect(row.agentVersionId).toBeGreaterThan(0);
      expect(row.args).toMatchObject({ title: p.title, priority: "high" });
      // 5 minutos (con holgura por la diferencia de reloj entre la aplicación y la base de datos)
      expect(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 5 * 60 * 1000)).toBeLessThan(5000);
      expect(JSON.stringify(row)).not.toContain(p.token);                                       // ninguna columna guarda el token en claro
      expect(await tasksOf(A, p.title)).toEqual([]);                                             // propuesta ≠ ejecución
    });

    it("confirmación correcta por el mismo usuario: una tarea, con los parámetros propuestos; la fila queda consumed", async () => {
      const p = await propose();
      as(A, U.adminA, "admin");
      expect((await confirm(p.aid, p.token)).status).toBe(200);
      const tasks = await tasksOf(A, p.title);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.priority).toBe("high");
      const row = (await rowOf(p.token))!;
      expect(row.status).toBe("consumed");
      expect(row.consumedAt).not.toBeNull();
    });

    it("replay: la segunda confirmación es 409 y no crea otra tarea", async () => {
      const p = await propose();
      as(A, U.adminA, "admin");
      expect([(await confirm(p.aid, p.token)).status, (await confirm(p.aid, p.token)).status]).toEqual([200, 409]);
      expect(await tasksOf(A, p.title)).toHaveLength(1);
    });

    it("dos confirmaciones SIMULTÁNEAS: solo una ejecuta (UPDATE condicional atómico)", async () => {
      const p = await propose();
      as(A, U.adminA, "admin");
      const rs = await Promise.all(Array.from({ length: 6 }, () => confirm(p.aid, p.token)));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await tasksOf(A, p.title)).toHaveLength(1);
    });

    it("otro usuario, otro workspace u otro agente → 409, y NO gastan la propuesta: su dueño sigue pudiendo confirmar", async () => {
      const p = await propose();
      const other = await proposeAgent(A);
      as(A, U.adminA2, "admin"); expect((await confirm(p.aid, p.token)).status).toBe(409);
      as(B, U.adminB, "admin"); expect((await confirm(p.aid, p.token)).status).toBe(409);
      as(A, U.adminA, "admin"); expect((await confirm(other, p.token)).status).toBe(409);
      expect((await rowOf(p.token))!.status).toBe("pending");
      expect(await tasksOf(A, p.title)).toEqual([]);
      expect(await tasksOf(B, p.title)).toEqual([]);
      expect((await confirm(p.aid, p.token)).status).toBe(200);
      expect(await tasksOf(A, p.title)).toHaveLength(1);
    });

    it("caducada (5 min) → 409 y la fila pasa a expired", async () => {
      const p = await propose();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
      as(A, U.adminA, "admin");
      expect((await confirm(p.aid, p.token)).status).toBe(409);
      vi.useRealTimers();
      expect((await rowOf(p.token))!.status).toBe("expired");
      expect(await tasksOf(A, p.title)).toEqual([]);
    });

    it("la confirmación sobrevive a un «reinicio»: no depende de memoria del proceso (otra instancia del store la ve)", async () => {
      const p = await propose();
      const { dbProposalStore } = await import("../proposalStore");
      // un almacén nuevo (como una instancia recién arrancada) consume la propuesta creada por el anterior
      const consumed = await dbProposalStore.consume(p.token, { orgId: A, userId: U.adminA, agentId: p.aid });
      expect(consumed).toMatchObject({ toolId: "create_task", args: { title: p.title } });
      expect(await dbProposalStore.consume(p.token, { orgId: A, userId: U.adminA, agentId: p.aid })).toBeNull();
    });

    it("el cliente no puede cambiar parámetros, usuario ni workspace: solo cuenta el token", async () => {
      const p = await propose();
      as(A, U.adminA, "admin");
      const res = await http("POST", `/${p.aid}/confirm?orgId=${B}&userId=9`, { confirmToken: p.token, confirm: true, args: { title: "HACKEADO" }, params: { title: "HACKEADO" }, orgId: B, toolId: "cancel_appointment" });
      expect(res.status).toBe(200);
      expect(await tasksOf(A, p.title)).toHaveLength(1);
      expect(await tasksOf(A, "HACKEADO")).toEqual([]);
      expect(await tasksOf(B, "HACKEADO")).toEqual([]);
    });

    it("exige confirm:true y un token; un 400 no gasta la propuesta", async () => {
      const p = await propose();
      as(A, U.adminA, "admin");
      expect((await http("POST", `/${p.aid}/confirm`, { confirmToken: p.token })).status).toBe(400);
      expect((await http("POST", `/${p.aid}/confirm`, { confirm: true })).status).toBe(400);
      expect((await confirm(p.aid, p.token)).status).toBe(200);
    });

    it("se reevalúa en el momento de confirmar: agente pausado, tool retirada o rol degradado → 409 sin tarea", async () => {
      const paused = await propose(); await transitionAgent(A, paused.aid, "pause");
      as(A, U.adminA, "admin"); expect((await confirm(paused.aid, paused.token)).status).toBe(409);
      const retired = await propose();
      await saveDraft(A, retired.aid, "audit", { tools: { read: [], write: [] } }); await publishAgent(A, retired.aid, known());
      as(A, U.adminA, "admin"); expect((await confirm(retired.aid, retired.token)).status).toBe(409);
      const demoted = await propose();
      as(A, U.adminA, "read_only"); expect((await confirm(demoted.aid, demoted.token)).status).toBe(403);   // ya ni siquiera tiene agents.execute
      for (const p of [paused, retired, demoted]) expect(await tasksOf(A, p.title)).toEqual([]);
    });

    it("una propuesta de PRUEBA (testing) nunca se ejecuta", async () => {
      const aid = await proposeAgent(A);
      const title = `zz-testonly-${uniq()}`;
      as(A, U.adminA, "admin");
      script.push(callTool("create_task", { title }), say("ok"));
      const run = await http("POST", `/${aid}/run`, { mode: "testing", message: "crea" });
      expect(run.body.proposals[0].testOnly).toBe(true);
      expect((await confirm(aid, run.body.proposals[0].confirmToken)).status).toBe(409);
      expect(await tasksOf(A, title)).toEqual([]);
    });

    it("un token inventado no ejecuta nada", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      expect((await confirm(aid, "00000000-0000-4000-8000-000000000000")).status).toBe(409);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("herramientas: sin permiso RBAC no hay READ ni ACTION", () => {
    it("matriz: cada tool se concede a un rol solo si tiene el permiso RBAC de esa tool", async () => {
      for (const role of ["owner", "admin", "manager", "member", "read_only", "vendedor", "sinCrm"]) {
        const perms = getPermissionsForRole(role);
        const read = TOOL_REGISTRY.filter((t) => t.kind === "read").map((t) => t.id);
        const write = TOOL_REGISTRY.filter((t) => t.kind === "action").map((t) => t.id);
        const a = await resolveToolAccess({ config: { tools: { read, write } }, orgId: A, orgRole: role, platformRole: null, moduleEnabled: async () => true });
        const allowed = new Set([...a.read, ...a.action].map((t) => t.id));
        for (const t of TOOL_REGISTRY) expect(allowed.has(t.id), `${role}/${t.id}`).toBe(perms.has(t.permission));
      }
    });

    it("READ: rol con agents.read pero sin crm.read → la tool pedida por el modelo se deniega, sin datos y sin ejecutar la skill", async () => {
      const aid = await publishedAgent(A, `Lectura-${uniq()}`, { tools: { read: ["list_tasks"], write: [] } });
      await db.insert(tasksTable).values({ orgId: A, title: "SECRETO-TAREA", status: "pending", priority: "medium" } as never);
      script.push(callTool("list_tasks", {}), say("hecho"));
      const run = await runAgent({ actor: { orgId: A, userId: 1, userClerkId: "c", orgRole: "sinCrm", platformRole: null }, agentId: aid, mode: "live", message: "lista mis tareas" });
      expect(run.toolsUsed).toEqual([]);
      expect(run.denied.map((d) => d.toolId)).toEqual(["list_tasks"]);
      const toolMsgs = (seen[1] ?? []).filter((m) => m.role === "tool").map((m) => String(m.content)).join(" ");
      expect(toolMsgs).toContain("no permitida");
      expect(toolMsgs).not.toContain("SECRETO-TAREA");
    });

    it("ACTION: read_only pidiendo create_task → ni propuesta ni tarea; y sin agents.execute ni siquiera llega a ejecutar", async () => {
      const aid = await proposeAgent(A);
      const title = `zz-deny-${uniq()}`;
      as(A, U.roA, "read_only");
      script.push(callTool("create_task", { title }), say("listo"));
      expect((await live(aid, "crea")).status).toBe(403);
      expect(await tasksOf(A, title)).toEqual([]);
      // aunque llegara al runner con ese rol, la tool se deniega
      const run = await runAgent({ actor: { orgId: A, userId: U.roA, userClerkId: "c", orgRole: "read_only", platformRole: null }, agentId: aid, mode: "live", message: "crea" });
      expect(run.proposals).toEqual([]);
      expect(run.denied[0]).toMatchObject({ toolId: "create_task" });
      expect(await tasksOf(A, title)).toEqual([]);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("auditoría LIVE", () => {
    it("flujo completo: started → tool_read_executed → tool_proposed → completed → tool_action_executed, con actor, rol, workspace, agente, versión y runId", async () => {
      const aid = await publishedAgent(A, `Auditoria-${uniq()}`, { tools: { read: ["list_tasks"], write: ["create_task"] } });
      as(A, U.adminA, "admin");
      const title = `zz-audit-${uniq()}`;
      const key = `aud-${uniq()}`;
      script.push(callTool("list_tasks", {}), callTool("create_task", { title, priority: "high" }, "c2"), say("¿la creo?"));
      const run = await live(aid, "haz", key);
      const token = run.body.proposals[0].confirmToken;
      await confirm(aid, token);
      const events = await auditOf(A, aid);
      const by = (a: string) => events.filter((e) => e.action === a);
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["agent_run_started", "tool_read_executed", "tool_proposed", "agent_run_completed", "tool_action_executed"]));
      const started = by("agent_run_started")[0]!;
      expect(started).toMatchObject({ actor: `clerk_${U.adminA}`, details: { role: "admin", mode: "live", versionNumber: 1, result: "success", agentId: aid } });
      const runId = started.details["runId"];
      expect(runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(by("tool_read_executed")[0]!.details).toMatchObject({ toolId: "list_tasks", runId, result: "success" });
      expect(by("tool_proposed")[0]!.details).toMatchObject({ toolId: "create_task", runId, testOnly: false, argKeys: ["priority", "title"] });
      const done = by("agent_run_completed")[0]!.details;
      expect(done).toMatchObject({ runId, provider: "fake", model: "gpt-4o-mini", toolsUsed: ["list_tasks"], proposals: ["create_task"], idempotencyKeyHash: sha(key) });
      expect(typeof done["credits"]).toBe("number");
      expect(done["requestIds"]).toHaveLength(3);
      expect(by("tool_action_executed")[0]!.details).toMatchObject({ toolId: "create_task", versionNumber: 1, runId });
    });

    it("privacidad: ningún evento lleva tokens de confirmación, el Idempotency-Key en claro ni los valores de los argumentos", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      const title = `DATO-PERSONAL-${uniq()}`; const key = `clave-${uniq()}`;
      script.push(callTool("create_task", { title }), say("¿la creo?"));
      const run = await live(aid, "crea", key);
      const token = run.body.proposals[0].confirmToken;
      await confirm(aid, token);
      await confirm(aid, token);                                                   // replay → fallo
      const text = JSON.stringify(await auditOf(A, aid));
      expect(text).not.toContain(token);
      expect(text).not.toContain(key);
      expect(text).not.toContain(title);
      expect(text).not.toMatch(/api[_-]?key|sk-|authorization|bearer/i);
    });

    it("tool_action_failed incluye el toolId y el motivo (skill, tool retirada) y también el fallo previo (token no válido)", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      script.push(callTool("create_task", { title: `t-${uniq()}` }), say("ok"));
      const run = await live(aid, "crea");
      const token = run.body.proposals[0].confirmToken;
      await confirm(aid, token);
      await confirm(aid, token);
      await confirm(aid, "00000000-0000-4000-8000-000000000000");
      const failed = (await auditOf(A, aid)).filter((e) => e.action === "tool_action_failed");
      expect(failed).toHaveLength(2);
      expect(failed.every((f) => f.details["reason"] === "confirmation_invalid" && f.details["result"] === "failure")).toBe(true);

      const retired = await proposeAgent(A);
      script.push(callTool("create_task", { title: `t-${uniq()}` }), say("ok"));
      const r2 = await live(retired, "crea");
      await saveDraft(A, retired, "audit", { tools: { read: [], write: [] } }); await publishAgent(A, retired, known());
      await confirm(retired, r2.body.proposals[0].confirmToken);
      const f2 = (await auditOf(A, retired)).find((e) => e.action === "tool_action_failed")!;
      expect(f2.details).toMatchObject({ toolId: "create_task", reason: "not_authorized", versionNumber: 2 });
    });

    it("agent_run_denied: permiso (403), límite (429) y créditos (402); agent_run_failed: proveedor caído", async () => {
      const aid = await publishedAgent(C, `Denegados-${uniq()}`);
      // 403
      as(C, U.roA, "read_only"); await live(aid);
      // 429
      setLimits(1, 1000); as(C, U.adminC, "admin");
      script.push(say("1"));
      await live(aid, "a"); await live(aid, "b");
      setLimits(1000, 1000);
      // proveedor caído
      script.push(Object.assign(new Error("boom"), { status: 400 }));
      await live(aid, "c");
      const ev = await auditOf(C, aid);
      const reasons = ev.filter((e) => e.action === "agent_run_denied").map((e) => e.details["reason"]).sort();
      expect(reasons).toEqual(["permission_denied", "rate_limited"]);
      const failed = ev.filter((e) => e.action === "agent_run_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]!.details).toMatchObject({ reason: "provider_unavailable", httpStatus: 503, result: "failure" });

      // 402: workspace sin créditos
      const callsBefore402 = providerCalls;
      const [O] = (await createTempOrgs(1, "live-it-nocredit")) as [number];
      try {
        const nc = await publishedAgent(O!, "NC");
        as(O!, 7001, "admin");
        const r = await live(nc);
        expect(r.status).toBe(402);
        const denied = (await auditOf(O!, nc)).find((e) => e.action === "agent_run_denied")!;
        expect(denied.details).toMatchObject({ reason: "insufficient_credits", httpStatus: 402 });
        expect(providerCalls).toBe(callsBefore402);                                // el 402 no llega al proveedor
      } finally { await deleteTempOrgs([O!]); }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("créditos", () => {
    it("simulate = 0 créditos, 0 proveedor, 0 filas de uso", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      const before = await snapshot(A);
      expect((await http("POST", `/${aid}/simulate`, { message: "hola" })).status).toBe(200);
      expect(await snapshot(A)).toEqual(before);
      expect(providerCalls).toBe(0);
    });

    it("LIVE consume créditos por cada llamada al modelo; los rechazos por permiso no consumen; una tool denegada no cobra extra", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      const before = await snapshot(A);
      script.push(say("hola"));
      const ok = await live(aid, "hola");
      const after = await snapshot(A);
      expect(ok.status).toBe(200);
      expect(after.ledger).toBe(before.ledger + 1);
      expect(after.balance).toBeLessThan(before.balance);
      as(A, 5555, "vendedor"); expect((await live(aid, "x")).status).toBe(403);
      as(A, U.roA, "read_only"); expect((await live(aid, "x")).status).toBe(403);
      expect(await snapshot(A)).toEqual(after);
    });

    it("proveedor que falla: reserva liberada, saldo intacto y cero movimientos", async () => {
      const aid = await proposeAgent(A);
      as(A, U.adminA, "admin");
      const before = await snapshot(A);
      script.push(Object.assign(new Error("boom"), { status: 400 }));
      const r = await live(aid, "hola");
      expect(r.status).toBe(503);
      expect(r.body.status).toBe("PROVIDER_UNAVAILABLE");
      const after = await snapshot(A);
      expect(after.ledger).toBe(before.ledger);
      expect(after.balance).toBeCloseTo(before.balance, 6);
    });

    it("sin créditos: 402 estructurado y cero llamadas al proveedor", async () => {
      const [O] = (await createTempOrgs(1, "live-it-402")) as [number];
      try {
        const aid = await publishedAgent(O!, "NC");
        as(O!, 7002, "admin");
        const r = await live(aid);
        expect(r.status).toBe(402);
        expect(r.body.status).toBe("INSUFFICIENT_CREDITS");
        expect(providerCalls).toBe(0);
      } finally { await deleteTempOrgs([O!]); }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("estados y versiones", () => {
    it("matriz de estados: simulate / run testing / run live / confirm en draft, published, paused, archived", async () => {
      const mk = async (status: "draft" | "published" | "paused" | "archived") => {
        const { agent } = await createAgent(A, "audit", { name: `st-${status}-${uniq()}` });
        await saveDraft(A, agent.id, "audit", ready());
        if (status !== "draft") await publishAgent(A, agent.id, known());
        if (status === "paused") await transitionAgent(A, agent.id, "pause");
        if (status === "archived") await transitionAgent(A, agent.id, "archive");
        return agent.id;
      };
      const table: Record<string, Record<string, number>> = {};
      for (const st of ["draft", "published", "paused", "archived"] as const) {
        const aid = await mk(st);
        as(A, U.adminA, "admin");
        script.push(say("a"), say("b"));
        table[st] = {
          simulate: (await http("POST", `/${aid}/simulate`, { message: "hola" })).status,
          runTesting: (await http("POST", `/${aid}/run`, { mode: "testing", message: "hola" })).status,
          runLive: (await live(aid)).status,
          confirm: (await confirm(aid, "00000000-0000-4000-8000-000000000000")).status,
        };
      }
      expect(table).toEqual({
        draft:     { simulate: 200, runTesting: 200, runLive: 409, confirm: 409 },
        published: { simulate: 200, runTesting: 200, runLive: 200, confirm: 409 },
        paused:    { simulate: 200, runTesting: 200, runLive: 409, confirm: 409 },
        archived:  { simulate: 409, runTesting: 409, runLive: 409, confirm: 409 },
      });
    });

    it("LIVE ejecuta SIEMPRE la versión publicada aunque exista un borrador distinto o se pida versionId; TESTING y simulate usan el borrador", async () => {
      const { agent } = await createAgent(A, "audit", { name: `ver-${uniq()}` });
      await saveDraft(A, agent.id, "audit", ready({ identity: { role: "ROL-V1" } }));
      await publishAgent(A, agent.id, known());
      const v = await saveDraft(A, agent.id, "audit", { identity: { role: "ROL-V2-BORRADOR" } });
      as(A, U.adminA, "admin");
      script.push(say("a"));
      const liveRun = await live(agent.id, "hola", undefined, { versionId: v.id });
      const livePrompt = String(seen.at(-1)!.find((m) => m.role === "system")!.content);
      script.push(say("b"));
      const test = await http("POST", `/${agent.id}/run`, { mode: "testing", message: "hola" });
      const testPrompt = String(seen.at(-1)!.find((m) => m.role === "system")!.content);
      const sim = await http("POST", `/${agent.id}/simulate`, { message: "hola" });
      expect(liveRun.body.agent.versionNumber).toBe(1);
      expect(livePrompt).toContain("ROL-V1"); expect(livePrompt).not.toContain("ROL-V2");
      expect(test.body.agent.versionNumber).toBe(2); expect(testPrompt).toContain("ROL-V2");
      expect(sim.body.agent.versionNumber).toBe(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe("aislamiento entre workspaces (A→A, A→B, B→B, B→A)", () => {
    it("run / simulate / get / effective-access / confirm", async () => {
      const aA = await proposeAgent(A, { read: [], write: [] });
      const aB = await proposeAgent(B, { read: [], write: [] });
      const out: Record<string, number> = {};
      const call = async (label: string, org: number, agentId: number) => {
        as(org, org === A ? U.adminA : U.adminB, "admin");
        script.push(say("ok"));
        out[`${label}:run`] = (await live(agentId)).status;
        out[`${label}:simulate`] = (await http("POST", `/${agentId}/simulate`, { message: "hola" })).status;
        out[`${label}:get`] = (await fetch(`${base}/${agentId}`)).status;
        out[`${label}:effective`] = (await fetch(`${base}/${agentId}/effective-access`)).status;
        out[`${label}:confirm`] = (await confirm(agentId, "00000000-0000-4000-8000-000000000000")).status;
      };
      await call("A→A", A, aA); await call("A→B", A, aB); await call("B→B", B, aB); await call("B→A", B, aA);
      for (const k of ["A→A", "B→B"]) expect([out[`${k}:run`], out[`${k}:simulate`], out[`${k}:get`], out[`${k}:effective`]]).toEqual([200, 200, 200, 200]);
      for (const k of ["A→B", "B→A"]) for (const op of ["run", "simulate", "get", "effective"]) expect(out[`${k}:${op}`], `${k}:${op}`).toBe(404);
      for (const k of ["A→A", "A→B", "B→B", "B→A"]) expect(out[`${k}:confirm`]).toBe(409);
    });

    it("una ejecución cruzada no deja fila de ejecución, ni consumo, ni propuesta en ninguno de los dos workspaces", async () => {
      const aB = await proposeAgent(B);
      as(A, U.adminA, "admin");
      const beforeA = await countRows(aiAgentRunRequestsTable, A); const beforeB = await countRows(aiAgentRunRequestsTable, B);
      const sB = await snapshot(B);
      script.push(callTool("create_task", { title: "x" }));
      expect((await live(aB, "hola", `x-${uniq()}`)).status).toBe(404);
      expect(await snapshot(B)).toEqual(sB);
      expect(await countRows(aiAgentRunRequestsTable, B)).toBe(beforeB);
      expect(await countRows(aiAgentRunRequestsTable, A)).toBe(beforeA);      // el rechazo libera la reserva de ejecución
    });

    it("TOOLS: get_client/list_clients con datos de OTRO workspace no devuelven nada", async () => {
      const [cb] = await db.insert(clientsTable).values({ orgId: B, name: "CLIENTE-SECRETO-B", email: "b@x.test" } as never).returning();
      const aid = await publishedAgent(A, `Lector-${uniq()}`, { tools: { read: ["get_client", "list_clients"], write: [] } });
      as(A, U.adminA, "admin");
      script.push(callTool("get_client", { client_id: cb!.id, id: cb!.id, name: "CLIENTE-SECRETO-B" }), callTool("list_clients", { search: "SECRETO" }, "c2"), say("fin"));
      const run = await live(aid, "dame el cliente");
      const toolOutputs = seen.flat().filter((m) => m.role === "tool").map((m) => String(m.content)).join(" ");
      expect(toolOutputs).not.toContain("CLIENTE-SECRETO-B");
      expect(JSON.stringify(run.body)).not.toContain("CLIENTE-SECRETO-B");
    });

    it("KNOWLEDGE: un id de conocimiento de B metido en la config de A nunca llega al prompt, ni al publicar ni al probar", async () => {
      const [kb] = await db.insert(knowledgeBaseTable).values({ orgId: B, title: "DOC-B", content: "CONTENIDO-SECRETO-DE-B" }).returning();
      const { agent } = await createAgent(A, "audit", { name: `kb-${uniq()}` });
      await saveDraft(A, agent.id, "audit", ready({ knowledge: { workspace: false, entryIds: [kb!.id], categories: [] } }), undefined, { validateKnowledge: false });
      await expect(publishAgent(A, agent.id, known())).rejects.toMatchObject({ status: 422 });
      as(A, U.adminA, "admin");
      script.push(say("ok"));
      await http("POST", `/${agent.id}/run`, { mode: "testing", message: "hola" });
      expect(seen.flat().map((m) => String(m.content)).join(" ")).not.toContain("CONTENIDO-SECRETO-DE-B");
    });
  });
});
