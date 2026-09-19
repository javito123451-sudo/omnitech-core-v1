// La Fábrica de punta a punta contra Postgres real, con proveedor de IA falso:
//   Gateway → Cost Engine → ai_usage_logs → OmniCredits ledger,
// agente por defecto, conocimiento aislado por workspace, y una acción real
// confirmada (crea una tarea de verdad, pero solo tras la confirmación).
//
// Requiere ci-test con las migraciones 0004 y 0005. Se omite limpiamente si no hay.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import {
  db, aiAgentsTable, aiUsageLogsTable, creditAccountsTable, creditLedgerTable, knowledgeBaseTable,
  tasksTable, organizationsTable, aiAgentDefaultsTable, defaultAgentConfig, type AgentConfig,
} from "@workspace/db";
import { callAI, InsufficientCreditsError, type GatewayDeps } from "../../ai-gateway/gateway";
import { ResponseCache } from "../../ai-gateway/responseCache";
import { checkBudgetBlocked, logAiCall } from "../../utils/aiUsageLogger";
import { creditsPort, getBalance, grantCredits } from "../../credits/creditService";
import { createAgent, publishAgent, saveDraft, transitionAgent, getAgentDetail } from "../agentService";
import { clearDefaultAgent, listDefaults, resolveDefaultAgent, setDefaultAgent } from "../defaultAgents";
import { loadKnowledge } from "../knowledge";
import { confirmAgentAction, defaultConfirmDeps, defaultRunnerDeps, runAgent, type RunActor } from "../agentRunner";
import { listSkills } from "../../skills";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import type { AIProvider, GenerateResult } from "../../ai/types";
import type { GatewayResult } from "../../ai-gateway/gateway";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const known = () => new Set(listSkills().map((s) => s.id));
let orgA = 0, orgB = 0;
const FN = `smoke_flow_${Date.now()}`;

const ready = (over: Partial<AgentConfig> = {}): Partial<AgentConfig> => ({
  objective: { what: "Atender consultas", audience: "clientes", expectedOutcome: "cita agendada" },
  behavior: { instructions: "Sé amable.", rules: [], restrictions: [], avoid: [] },
  ...over,
});

async function published(org: number, name: string, config: Partial<AgentConfig> = {}) {
  const { agent } = await createAgent(org, "smoke", { name });
  await saveDraft(org, agent.id, "smoke", ready(config));
  await publishAgent(org, agent.id, known());
  return agent.id;
}

const fakeRoute = (generate: () => Promise<GenerateResult>) => ({
  provider: { id: "fake", name: "fake", generate } as unknown as AIProvider, providerId: "fake", model: "gpt-4o-mini", timeoutMs: 1000,
});

const actor = (org: number, over: Partial<RunActor> = {}): RunActor =>
  ({ orgId: org, userId: 4242, userClerkId: "smoke-user", orgRole: "admin", platformRole: null, ...over });

describe.skipIf(!hasRealDb)("Fábrica — flujo completo", () => {
  beforeAll(async () => {
    [orgA, orgB] = await createTempOrgs(2, "factory");
  });
  afterAll(async () => {
    await db.delete(aiUsageLogsTable).where(like(aiUsageLogsTable.functionName, "smoke_flow_%"));
    await deleteTempOrgs([orgA, orgB]); // cascada: agentes, cuentas y ledger, conocimiento, tareas
  });

  it("Gateway → Cost Engine → ai_usage_logs → ledger: cada pieza queda enlazada", async () => {
    await grantCredits(orgA, 100, { reference: "smoke-flow-grant" });
    const agentId = await published(orgA, "Flujo");
    const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "hola", usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500, cachedTokens: 400 } }));
    const deps: GatewayDeps = {
      resolveRoutes: () => [fakeRoute(generate)], checkBudgetBlocked, logAiCall, credits: creditsPort,
      cache: new ResponseCache(), sleep: async () => {},
    };

    const r = await callAI({
      mode: "live", orgId: orgA, userClerkId: "smoke-user", functionName: FN, agentId, requestId: `${FN}-ok`,
      messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
    }, deps);

    const [log] = await db.select().from(aiUsageLogsTable).where(and(eq(aiUsageLogsTable.functionName, FN), eq(aiUsageLogsTable.status, "ok")));
    expect(log).toMatchObject({ orgId: orgA, model: "gpt-4o-mini", tokensInput: 1200, tokensOutput: 300 });
    expect(Number(log!.costUsd)).toBeCloseTo(r.costUsd, 6);
    expect(log!.metadata).toMatchObject({ provider: "fake", requestId: `${FN}-ok`, agentId, cachedTokens: 400, credits: r.credits });

    const [entry] = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.reference, `${FN}-ok`));
    expect(entry).toMatchObject({ orgId: orgA, entryType: "usage", agentId, provider: "fake", model: "gpt-4o-mini", usageLogId: log!.id });
    expect(Number(entry!.credits)).toBeCloseTo(-r.credits, 4);
    expect(Number(entry!.technicalCostUsd)).toBeCloseTo(r.costUsd, 6);
    expect(Number(entry!.estimatedCredits)).toBeCloseTo(r.estimatedCredits!, 4);
    expect(await getBalance(orgA)).toBeCloseTo(100 - r.credits, 4);
  });

  it("sin créditos: error controlado, cero llamadas al proveedor, cero movimientos, intento registrado", async () => {
    const generate = vi.fn(async (): Promise<GenerateResult> => ({ text: "no debería llegar" }));
    const deps: GatewayDeps = {
      resolveRoutes: () => [fakeRoute(generate)], checkBudgetBlocked, logAiCall, credits: creditsPort,
      cache: new ResponseCache(), sleep: async () => {},
    };
    await expect(callAI({
      mode: "live", orgId: orgB, functionName: FN, requestId: `${FN}-none`,
      messages: [{ role: "user", content: "hola" }], billing: { ledger: true },
    }, deps)).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(generate).not.toHaveBeenCalled();
    expect(await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.orgId, orgB))).toEqual([]);
    const [blocked] = await db.select().from(aiUsageLogsTable)
      .where(and(eq(aiUsageLogsTable.functionName, FN), eq(aiUsageLogsTable.orgId, orgB), eq(aiUsageLogsTable.status, "blocked")))
      .orderBy(desc(aiUsageLogsTable.id));
    expect(blocked!.errorMsg).toMatch(/Créditos insuficientes/);
  });

  it("agente por defecto: solo publicado, canal declarado, resolución canal → all, y aislado por org", async () => {
    const agentId = await published(orgA, "Por defecto", { channels: ["telegram"] });
    const noChannel = await published(orgA, "Sin canal", { channels: [] });
    const { agent: draft } = await createAgent(orgA, "smoke", { name: "Borrador" });

    await expect(setDefaultAgent(orgA, "all", draft.id, "u")).rejects.toMatchObject({ status: 409 });        // no publicado
    await expect(setDefaultAgent(orgA, "telegram", noChannel, "u")).rejects.toMatchObject({ status: 422 }); // no declara el canal
    await expect(setDefaultAgent(orgB, "all", agentId, "u")).rejects.toMatchObject({ status: 404 });          // otra org

    await setDefaultAgent(orgA, "all", noChannel, "u");
    await setDefaultAgent(orgA, "telegram", agentId, "u");
    expect(await resolveDefaultAgent(orgA, "telegram")).toEqual({ agentId, resolvedFrom: "telegram" });
    expect(await resolveDefaultAgent(orgA, "whatsapp")).toEqual({ agentId: noChannel, resolvedFrom: "all" });
    expect(await resolveDefaultAgent(orgB, "telegram")).toBeNull();
    expect((await listDefaults(orgB))).toEqual([]);

    await transitionAgent(orgA, agentId, "pause"); // un agente pausado deja de ser el vigente
    expect(await resolveDefaultAgent(orgA, "telegram")).toEqual({ agentId: noChannel, resolvedFrom: "all" });

    expect(await clearDefaultAgent(orgA, "all")).toBe(true);
    expect(await resolveDefaultAgent(orgA, "whatsapp")).toBeNull();
    await db.delete(aiAgentDefaultsTable).where(eq(aiAgentDefaultsTable.orgId, orgA));
  });

  it("conocimiento: un agente nunca usa ni publica con conocimiento de otra org", async () => {
    const [foreign] = await db.insert(knowledgeBaseTable).values({ orgId: orgB, title: "SECRETO-B", content: "dato privado de B" }).returning();
    const [own] = await db.insert(knowledgeBaseTable).values({ orgId: orgA, title: "Horario A", content: "abrimos a las 9" }).returning();

    const { agent } = await createAgent(orgA, "smoke", { name: "Con conocimiento" });
    await saveDraft(orgA, agent.id, "smoke", ready({ knowledge: { workspace: false, entryIds: [foreign!.id], categories: [] } }));
    await expect(publishAgent(orgA, agent.id, known())).rejects.toMatchObject({ status: 422 });

    // aunque la configuración lo listara, la lectura filtra por org
    expect(await loadKnowledge(orgA, { workspace: false, entryIds: [foreign!.id], categories: [] })).toBe("");
    const all = await loadKnowledge(orgA, { workspace: true, entryIds: [], categories: [] });
    expect(all).toContain("abrimos a las 9");
    expect(all).not.toContain("SECRETO-B");

    await saveDraft(orgA, agent.id, "smoke", { knowledge: { workspace: false, entryIds: [own!.id], categories: [] } });
    await expect(publishAgent(orgA, agent.id, known())).resolves.toBeTruthy();
  });

  it("acción real: se propone, NO se crea la tarea hasta confirmar, y la org B no puede usarla", async () => {
    const agentId = await published(orgA, "Tareas", { tools: { read: [], write: ["create_task"] } });
    const title = `smoke-task-${Date.now()}`;

    // El "modelo" pide crear la tarea y luego responde: dos respuestas guionizadas por ejecución.
    const result = (over: Partial<GatewayResult>): GatewayResult => ({
      text: "", requestId: "r", provider: "fake", model: "gpt-4o-mini", costUsd: 0, credits: 0, estimatedCredits: 0,
      cached: false, attempts: 1, fallbackUsed: false, durationMs: 1, ...over,
    });
    const scriptedRunner = () => {
      const queue = [
        result({ toolCalls: [{ id: "c1", type: "function", function: { name: "create_task", arguments: JSON.stringify({ title }) } }] }),
        result({ text: "¿La creo?" }),
      ];
      return { ...defaultRunnerDeps, callAI: (async () => queue.shift()!) as unknown as typeof defaultRunnerDeps.callAI };
    };

    const run = await runAgent({ actor: actor(orgA), agentId, mode: "live", message: `Crea la tarea ${title}` }, scriptedRunner());
    expect(run.proposals).toHaveLength(1);
    const p = run.proposals[0]!;
    const tasksNow = () => db.select().from(tasksTable).where(and(eq(tasksTable.orgId, orgA), eq(tasksTable.title, title)));
    expect(await tasksNow()).toEqual([]); // propuesto, no ejecutado

    // otra organización no puede confirmar ni ejecutar el agente de A
    await expect(confirmAgentAction(actor(orgB), agentId, p.confirmToken, defaultConfirmDeps)).rejects.toBeTruthy();
    await expect(runAgent({ actor: actor(orgB), agentId, mode: "live", message: "hola" }, scriptedRunner())).rejects.toMatchObject({ status: 404 });
    expect(await tasksNow()).toEqual([]);

    // el intento ajeno quemó el token; se propone de nuevo y ahora sí se confirma
    const run2 = await runAgent({ actor: actor(orgA), agentId, mode: "live", message: `Crea la tarea ${title}` }, scriptedRunner());
    const done = await confirmAgentAction(actor(orgA), agentId, run2.proposals[0]!.confirmToken, defaultConfirmDeps);
    expect(done.toolId).toBe("create_task");
    const rows = await tasksNow();
    expect(rows).toHaveLength(1);
  });

  it("un agente pausado no se ejecuta en LIVE", async () => {
    const agentId = await published(orgA, "Pausable");
    await transitionAgent(orgA, agentId, "pause");
    await expect(runAgent({ actor: actor(orgA), agentId, mode: "live", message: "hola" }, defaultRunnerDeps)).rejects.toMatchObject({ status: 409 });
    const { agent } = await getAgentDetail(orgA, agentId);
    expect(agent.status).toBe("paused");
  });
});

// La config por defecto es válida y estable: si cambia el esquema, este test lo delata.
describe("configuración por defecto", () => {
  it("incluye identidad, parámetros y conocimiento con valores seguros", () => {
    const c = defaultAgentConfig();
    expect(c.permissions.writesRequireConfirmation).toBe(true);
    expect(c.knowledge).toEqual({ workspace: false, entryIds: [], categories: [] });
    expect(c.parameters.maxToolRounds).toBeGreaterThan(0);
  });
});
