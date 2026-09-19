// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — engine
//
//  Bounded LLM tool-calling loop, same shape as routes/telegram.ts's proven
//  pattern (aiProvider.generate + tools + toolChoice:"auto", MAX_ROUNDS cap).
//  What's different from telegram/whatsapp: the tool catalog is per-context
//  (super_admin vs crm), every answer must end in present_findings, and a
//  write intent goes through propose_action → a confirmation token instead
//  of executing immediately.
// ═══════════════════════════════════════════════════════════════════════════

import { db, aiSessionsTable, aiMessagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { callAI } from "../ai-gateway/gateway";
import type { Message, ToolDefinition } from "../ai/types";
import { buildAceSummary } from "./aceBridge";
import { PRESENT_FINDINGS_TOOL, parsePresentFindingsArgs } from "./responseFormat";
import { SUPER_ADMIN_TOOLS } from "./tools/superAdminTools";
import { CRM_TOOLS } from "./tools/crmTools";
import { AVA_ACTIONS } from "./actions/createTaskAction";
import { createProposal, consumeProposal } from "./actions/confirmationStore";
import type { AvaContext, AvaAskResponse, ActionProposal } from "./types";

const MAX_ROUNDS = 5;

const PROPOSE_ACTION_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "propose_action",
    description:
      "Propón una acción que modifica datos (por ejemplo crear una tarea). " +
      "NUNCA ejecutes la acción directamente — esto solo genera una propuesta " +
      "que el usuario debe confirmar explícitamente antes de que se ejecute nada.",
    parameters: {
      type: "object",
      properties: {
        actionId: { type: "string", description: "ID de la acción, por ejemplo 'create_task'" },
        params:   { type: "object", description: "Parámetros de la acción" },
      },
      required: ["actionId", "params"],
    },
  },
};

function toolsForContext(ctx: AvaContext) {
  const catalog = ctx.type === "super_admin" ? SUPER_ADMIN_TOOLS : CRM_TOOLS;
  const actionsAvailable = ctx.type === "crm" && Object.keys(AVA_ACTIONS).length > 0;
  const definitions: ToolDefinition[] = [
    ...catalog.map(t => t.definition),
    PRESENT_FINDINGS_TOOL,
    ...(actionsAvailable ? [PROPOSE_ACTION_TOOL] : []),
  ];
  const byName = new Map(catalog.map(t => [t.definition.function.name, t]));
  return { definitions, byName };
}

function systemPrompt(ctx: AvaContext, aceSummary: string): string {
  const roleLine = ctx.type === "super_admin"
    ? "Eres AVA CORE en el contexto SUPER ADMIN: ayudas al equipo de OmniTech a supervisar la plataforma (workspaces, usuarios, seguridad, IA, facturación). Solo lectura — no puedes modificar nada."
    : "Eres AVA CORE en el contexto CRM: ayudas al usuario con su propio workspace (clientes, leads, pipeline, citas, presupuestos, tareas, conversaciones).";

  return [
    roleLine,
    "Usa las herramientas disponibles para obtener datos reales antes de responder — nunca inventes datos.",
    "SIEMPRE debes terminar llamando a present_findings, estructurando tu respuesta en observado/análisis (y opcionalmente hipótesis/recomendación).",
    ctx.type === "crm"
      ? "Si el usuario pide crear, modificar o borrar algo, llama a propose_action — nunca lo des por hecho ni digas que ya está hecho hasta que el usuario confirme y el sistema lo ejecute."
      : null,
    "Contexto de sesión (ACE):",
    aceSummary,
  ].filter((l): l is string => l !== null).join("\n");
}

async function getOrCreateSession(ctx: AvaContext, sessionId: string | undefined, firstUserMessage: string): Promise<string> {
  const agentSlug = ctx.type === "super_admin" ? "ava_core_super_admin" : "ava_core_crm";
  if (sessionId) {
    const [existing] = await db.select({ id: aiSessionsTable.id }).from(aiSessionsTable)
      .where(and(eq(aiSessionsTable.id, sessionId), eq(aiSessionsTable.orgId, ctx.orgId), eq(aiSessionsTable.userId, ctx.userId)));
    if (existing) {
      await db.update(aiSessionsTable).set({ updatedAt: new Date() }).where(eq(aiSessionsTable.id, sessionId));
      return sessionId;
    }
  }
  const [created] = await db.insert(aiSessionsTable).values({
    orgId: ctx.orgId,
    userId: ctx.userId,
    agentSlug,
    title: firstUserMessage.slice(0, 60) || "Ava Core",
  }).returning();
  return created!.id;
}

async function saveMessage(sessionId: string, role: "user" | "assistant", content: string) {
  await db.insert(aiMessagesTable).values({ sessionId, role, content }).catch(() => {});
}

export async function runAvaCoreAsk(
  ctx: AvaContext,
  userMessage: string,
  sessionId: string | undefined,
): Promise<AvaAskResponse> {
  const resolvedSessionId = await getOrCreateSession(ctx, sessionId, userMessage);
  await saveMessage(resolvedSessionId, "user", userMessage);

  const aceSummary = buildAceSummary(ctx);
  const { definitions, byName } = toolsForContext(ctx);

  const messages: Message[] = [
    { role: "system", content: systemPrompt(ctx, aceSummary) },
    { role: "user", content: userMessage },
  ];

  let proposal: ActionProposal | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Ava Super Admin is platform-level supervision: logged with no org so a
    // workspace's own AI budget can never block it. CRM usage is attributed
    // to (and budgeted against) the workspace.
    const result = await callAI({
      mode: "live",
      orgId: ctx.type === "super_admin" ? null : ctx.orgId,
      userClerkId: ctx.clerkUserId,
      functionName: `ava_core_${ctx.type}`,
      messages,
      options: { temperature: 0.3, tools: definitions, toolChoice: "auto" },
    });

    if (!result.toolCalls || result.toolCalls.length === 0) {
      // Model answered without going through present_findings — wrap it so
      // the response shape stays consistent for the frontend.
      const answer = { observed: result.text, analysis: "" };
      await saveMessage(resolvedSessionId, "assistant", result.text);
      return { sessionId: resolvedSessionId, answer };
    }

    messages.push({ role: "assistant", content: result.text ?? "", tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      if (call.function.name === "present_findings") {
        const answer = parsePresentFindingsArgs(call.function.arguments);
        await saveMessage(resolvedSessionId, "assistant", JSON.stringify(answer));
        return { sessionId: resolvedSessionId, answer, proposal };
      }

      if (call.function.name === "propose_action") {
        let args: { actionId?: string; params?: Record<string, unknown> } = {};
        try { args = JSON.parse(call.function.arguments); } catch { /* leave empty */ }
        const action = args.actionId ? AVA_ACTIONS[args.actionId] : undefined;
        if (!action) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Acción no reconocida." }) });
          continue;
        }
        try {
          const { summary, params } = await action.propose(args.params ?? {}, ctx);
          const { token, expiresAt } = createProposal(action.id, params, ctx.orgId, ctx.userId);
          proposal = { actionId: action.id, summary, params, confirmToken: token, expiresAt };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ proposed: true, summary }) });
        } catch (err) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: String(err instanceof Error ? err.message : err) }) });
        }
        continue;
      }

      const tool = byName.get(call.function.name);
      if (!tool) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: `Herramienta desconocida: ${call.function.name}` }) });
        continue;
      }
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments); } catch { /* empty args */ }
      try {
        const toolResult = await tool.execute(args, ctx);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
      } catch (err) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: String(err instanceof Error ? err.message : err) }) });
      }
    }

    // If a proposal was just created this round, stop the loop and hand it
    // back — the model shouldn't keep "chatting" past a pending confirmation.
    if (proposal) {
      const answer = { observed: proposal.summary, analysis: "Propuesta pendiente de confirmación del usuario." };
      await saveMessage(resolvedSessionId, "assistant", JSON.stringify(answer));
      return { sessionId: resolvedSessionId, answer, proposal };
    }
  }

  const fallback = { observed: "No se pudo completar el análisis en el número máximo de pasos.", analysis: "" };
  await saveMessage(resolvedSessionId, "assistant", JSON.stringify(fallback));
  return { sessionId: resolvedSessionId, answer: fallback };
}

// ── Confirmation → execution ────────────────────────────────────────────────
// Backend re-validates the token (single-use, scoped to this exact user+org,
// not expired) before touching AVA_ACTIONS — a manipulated/replayed/borrowed
// token from another session or org can never trigger execution here.
export async function confirmAvaAction(ctx: AvaContext, confirmToken: string) {
  const entry = consumeProposal(confirmToken, ctx.orgId, ctx.userId);
  if (!entry) {
    throw new Error("La confirmación no es válida, ya se usó o ha caducado. Pide la acción de nuevo.");
  }
  const action = AVA_ACTIONS[entry.actionId];
  if (!action) {
    throw new Error(`Acción '${entry.actionId}' no reconocida.`);
  }
  const result = await action.execute(entry.params, ctx);
  return { actionId: entry.actionId, params: entry.params, result };
}
