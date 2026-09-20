// ═══════════════════════════════════════════════════════════════════════════
//  Agent runner — TESTING and LIVE modes.
//
//   TESTING  real AI (through the AI Gateway, consumes credits) on any version
//            of the agent, including a draft. Action tools are NEVER executed:
//            they come back as proposals flagged testOnly.
//   LIVE     the published version, real AI, real read tools. Action tools
//            still don't run on the model's say-so: each one becomes a
//            proposal that a human must confirm (confirmAgentAction), which
//            re-checks authorization before executing.
//
//  Authorization is re-derived here on every run (agent tools ∩ user
//  permission ∩ workspace module) — see authorization.ts. SIMULATION lives in
//  simulator.ts and never reaches this file.
// ═══════════════════════════════════════════════════════════════════════════

import { db, organizationsTable, type AgentConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Message, ToolDefinition } from "../ai/types";
import { callAI, type GatewayResult } from "../ai-gateway/gateway";
import { dbProposalStore, type ProposalStore } from "./proposalStore";
import { argKeys, fingerprint, noopAudit, type AuditFn, type LiveAuditActor } from "./liveAudit";
import { executeSkill, getOpenAIFunctions } from "../skills";
import { AgentError, readConfig, resolveRunTarget, type RunTargetMode } from "./agentService";
import { resolveToolAccess } from "./authorization";
import { loadKnowledge } from "./knowledge";
import { buildSystemPrompt } from "./promptBuilder";
import { getAgentTool } from "./toolRegistry";

export interface RunActor {
  orgId:        number;
  userId:       number;
  userClerkId:  string;
  orgRole:      string;
  platformRole: string | null;
}

export interface RunRequest {
  actor:     RunActor;
  agentId:   number;
  mode:      RunTargetMode;
  versionId?: number;
  message:   string;
  history?:  Array<{ role: "user" | "assistant"; content: string }>;
  /** Identidad INTERNA de la ejecución (la genera el servidor). Enlaza auditoría y propuestas. */
  runId?:    string;
}

export interface AgentProposal {
  toolId:       string;
  params:       Record<string, unknown>;
  summary:      string;
  confirmToken: string;
  expiresAt:    string;
  /** true when the run was a TESTING run: this proposal can never be executed. */
  testOnly:     boolean;
}

export interface RunResult {
  mode:      RunTargetMode;
  agent:     { id: number; name: string; versionNumber: number };
  reply:     string;
  toolsUsed: string[];
  proposals: AgentProposal[];
  denied:    { toolId: string; reason: string }[];
  usage:     { provider: string | null; model: string | null; tokensIn: number; tokensOut: number; costUsd: number; credits: number; estimatedCredits: number; cached: boolean; requestIds: string[] };
}

export interface RunnerDeps {
  callAI:         typeof callAI;
  executeSkill:   typeof executeSkill;
  resolveTarget:  typeof resolveRunTarget;
  loadKnowledge:  typeof loadKnowledge;
  getOrgPlan:     (orgId: number) => Promise<string | null>;
  toolSchemas:    () => ToolDefinition[];
  moduleEnabled?: (orgId: number, slug: string) => Promise<boolean>;
  /** Propuestas de acción pendientes de confirmación (persistentes y atómicas). */
  proposals:      ProposalStore;
  /** Auditoría LIVE. Por defecto no hace nada: las rutas inyectan el sumidero real. */
  audit?:         AuditFn;
}

const auditActor = (a: RunActor): LiveAuditActor => ({ clerkId: a.userClerkId, userId: a.userId, orgId: a.orgId, role: a.orgRole });

async function getOrgPlan(orgId: number): Promise<string | null> {
  const [org] = await db.select({ plan: organizationsTable.plan }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return org?.plan ?? null;
}

export const defaultRunnerDeps: RunnerDeps = {
  callAI, executeSkill, resolveTarget: resolveRunTarget, loadKnowledge, getOrgPlan,
  toolSchemas: () => getOpenAIFunctions() as ToolDefinition[],
  proposals: dbProposalStore,
};


function parseArgs(json: string): Record<string, unknown> {
  try { const v = JSON.parse(json); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
}

export async function runAgent(req: RunRequest, deps: RunnerDeps = defaultRunnerDeps): Promise<RunResult> {
  const { actor } = req;
  const { agent, version } = await deps.resolveTarget(actor.orgId, req.agentId, req.mode, req.versionId);
  const config: AgentConfig = readConfig(version);
  const audit = deps.audit ?? noopAudit;
  const who = auditActor(actor);
  await audit({ action: "agent_run_started", actor: who, agentId: agent.id, mode: req.mode, versionNumber: version.versionNumber, runId: req.runId, success: true });

  const access = await resolveToolAccess({ config, orgId: actor.orgId, orgRole: actor.orgRole, platformRole: actor.platformRole, moduleEnabled: deps.moduleEnabled });
  const allowed = new Map([...access.read, ...access.action].map((t) => [t.id, t]));
  const schemas = deps.toolSchemas().filter((s) => allowed.has(s.function.name));

  const knowledge = await deps.loadKnowledge(actor.orgId, config.knowledge);
  const plan = await deps.getOrgPlan(actor.orgId);

  const history = (req.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-config.parameters.maxHistoryMessages);
  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt(agent, config, knowledge, [...allowed.keys()]) },
    ...history,
    { role: "user", content: req.message },
  ];

  const usage = { provider: null as string | null, model: null as string | null, tokensIn: 0, tokensOut: 0, costUsd: 0, credits: 0, estimatedCredits: 0, cached: false, requestIds: [] as string[] };
  const proposals: AgentProposal[] = [];
  const toolsUsed: string[] = [];
  let reply = "";

  for (let round = 0; round < config.parameters.maxToolRounds; round++) {
    const result: GatewayResult = await deps.callAI({
      mode: "live",
      orgId: actor.orgId,
      userClerkId: actor.userClerkId,
      functionName: `agent_${agent.id}`,
      agentId: agent.id,
      agentVersionId: version.id,
      messages,
      options: {
        temperature: config.parameters.temperature,
        maxTokens: config.parameters.maxOutputTokens,
        ...(schemas.length ? { tools: schemas, toolChoice: "auto" as const } : {}),
      },
      routing: { agent: config.model, plan },
      usageKind: "agent_execution",
      // Presupuestos del agente. executionUsed acumula lo gastado en ESTA ejecución (varias llamadas).
      billing: {
        ledger: true,
        agentLimits: {
          monthly: agent.monthlyCreditLimit, daily: agent.dailyCreditLimit,
          perExecution: agent.perExecutionCreditLimit, executionUsed: usage.credits,
        },
      },
    });

    usage.provider = result.provider; usage.model = result.model;
    usage.tokensIn += result.usage?.promptTokens ?? 0; usage.tokensOut += result.usage?.completionTokens ?? 0;
    usage.costUsd += result.costUsd; usage.credits += result.credits; usage.estimatedCredits += result.estimatedCredits ?? 0;
    usage.cached = usage.cached || result.cached; usage.requestIds.push(result.requestId);
    reply = result.text ?? "";

    if (!result.toolCalls || result.toolCalls.length === 0) break;
    messages.push({ role: "assistant", content: result.text ?? "", tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      const toolId = call.function.name;
      const tool = allowed.get(toolId);
      const args = parseArgs(call.function.arguments);
      const respond = (payload: unknown) => messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(payload) });

      if (!tool) { respond({ error: "Herramienta no permitida para este agente o usuario." }); continue; }

      if (tool.kind === "read") {
        const out = await deps.executeSkill(toolId, args, actor.orgId, {
          channel: "internal", user: { id: actor.userClerkId, name: actor.userClerkId },
          meta: { source: "agent_factory", agentId: agent.id },
        });
        toolsUsed.push(toolId);
        await audit({
          action: "tool_read_executed", actor: who, agentId: agent.id, mode: req.mode, versionNumber: version.versionNumber, runId: req.runId,
          toolId, success: out.success, reason: out.success ? undefined : "skill_error", details: { argKeys: argKeys(args), argsHash: fingerprint(args) },
        });
        respond(out.success ? safeJson(out.result) : { error: out.error ?? "Error al ejecutar la herramienta." });
        continue;
      }

      // Action tools never execute on the model's say-so: a human confirms first.
      const testOnly = req.mode === "testing";
      const { token, expiresAt } = await deps.proposals.create({
        orgId: actor.orgId, userId: actor.userId, agentId: agent.id, agentVersionId: version.id, toolId, args, testOnly, runId: req.runId ?? null,
      });
      await audit({
        action: "tool_proposed", actor: who, agentId: agent.id, mode: req.mode, versionNumber: version.versionNumber, runId: req.runId,
        toolId, success: true, details: { argKeys: argKeys(args), argsHash: fingerprint(args), testOnly, expiresAt },
      });
      proposals.push({ toolId, params: args, summary: `${toolId}(${JSON.stringify(args)})`, confirmToken: token, expiresAt, testOnly });
      respond({ proposed: true, requiresConfirmation: true, note: testOnly ? "Prueba: no se ejecutará." : "Pendiente de confirmación del usuario." });
    }
  }

  return {
    mode: req.mode,
    agent: { id: agent.id, name: agent.name, versionNumber: version.versionNumber },
    reply: reply || "No he podido completar la respuesta.",
    toolsUsed, proposals, denied: access.denied, usage,
  };
}

function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

// ── Confirmation → execution ─────────────────────────────────────────────────

export interface ConfirmDeps {
  executeSkill:  typeof executeSkill;
  resolveTarget: typeof resolveRunTarget;
  moduleEnabled?: (orgId: number, slug: string) => Promise<boolean>;
  proposals:     ProposalStore;
  audit?:        AuditFn;
}

export const defaultConfirmDeps: ConfirmDeps = { executeSkill, resolveTarget: resolveRunTarget, proposals: dbProposalStore };

/**
 * Ejecuta una propuesta del modelo — solo si el token es válido: de un solo uso (consumo atómico en la base de datos),
 * del mismo workspace + usuario + agente, y sin caducar (5 min) — y solo si el agente SIGUE publicado y la autorización
 * (herramienta declarada ∩ rol actual del usuario ∩ módulo) se cumple AHORA. Un token ajeno, manipulado, de una prueba o de
 * un agente pausado nunca ejecuta. El cliente no envía parámetros: se usan los que guardó el servidor al proponer.
 */
export async function confirmAgentAction(
  actor: RunActor, agentId: number, confirmToken: string, deps: ConfirmDeps = defaultConfirmDeps,
) {
  const audit = deps.audit ?? noopAudit;
  const who = auditActor(actor);

  const entry = await deps.proposals.consume(confirmToken, { orgId: actor.orgId, userId: actor.userId, agentId });
  if (!entry) {
    await audit({ action: "tool_action_failed", actor: who, agentId, mode: "live", success: false, reason: "confirmation_invalid" });
    throw new AgentError(409, "La confirmación no es válida, ya se usó o ha caducado.");
  }
  const { toolId, args, testOnly } = entry;
  const fail = async (reason: string, err: AgentError, versionNumber?: number): Promise<never> => {
    await audit({ action: "tool_action_failed", actor: who, agentId, mode: "live", versionNumber, runId: entry.runId, toolId, success: false, reason, details: { argKeys: argKeys(args), argsHash: fingerprint(args) } });
    throw err;
  };
  if (testOnly) return fail("test_only", new AgentError(409, "Las propuestas de una prueba no se ejecutan."));

  let target: Awaited<ReturnType<typeof resolveRunTarget>>;
  try { target = await deps.resolveTarget(actor.orgId, agentId, "live"); }   // 409 if paused/archived/unpublished
  catch (err) { return fail("agent_state", err instanceof AgentError ? err : new AgentError(409, String(err))); }
  const { agent, version } = target;

  const config = readConfig(version);
  const access = await resolveToolAccess({ config, orgId: actor.orgId, orgRole: actor.orgRole, platformRole: actor.platformRole, moduleEnabled: deps.moduleEnabled });
  const tool = access.action.find((t) => t.id === toolId);
  if (!tool || getAgentTool(toolId)?.kind !== "action") {
    return fail("not_authorized", new AgentError(409, `La acción '${toolId}' ya no está autorizada para este agente o usuario.`), version.versionNumber);
  }

  const out = await deps.executeSkill(toolId, args, actor.orgId, {
    channel: "internal", user: { id: actor.userClerkId, name: actor.userClerkId },
    meta: { source: "agent_factory_confirmed", agentId: agent.id },
  });
  if (!out.success) return fail("skill_error", new AgentError(422, out.error ?? "No se pudo ejecutar la acción."), version.versionNumber);

  await audit({
    action: "tool_action_executed", actor: who, agentId: agent.id, mode: "live", versionNumber: version.versionNumber, runId: entry.runId,
    toolId, success: true, details: { argKeys: argKeys(args), argsHash: fingerprint(args) },
  });
  return { agentId: agent.id, versionNumber: version.versionNumber, toolId, args, result: safeJson(out.result) };
}
