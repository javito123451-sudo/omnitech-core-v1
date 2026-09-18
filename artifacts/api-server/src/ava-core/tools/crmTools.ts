// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — Ava CRM tool catalog (READ ONLY)
//
//  Every tool receives orgId from the backend-resolved AvaContext ONLY —
//  never from the model's arguments — so a workspace can never read another
//  workspace's data regardless of what the LLM is tricked into asking for.
//
//  Client/appointment/quote/task reads reuse the existing Skill Engine
//  (skills/index.ts) with channel:"internal", exactly like routes/chat.ts
//  does for the dashboard assistant — no new query logic for those entities.
//  Pipeline/leads reuse the functions extracted from routes/pipeline.ts and
//  routes/leads.ts. Conversations reuse routes/messages.ts. Activity has no
//  prior reader anywhere in the app, so it gets one minimal query here.
// ═══════════════════════════════════════════════════════════════════════════

import { db, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { executeSkill } from "../../skills";
import { getDealsData, getPipelineStagesData } from "../../routes/pipeline";
import { getMessagesData } from "../../routes/messages";
import type { AvaContext, AvaTool } from "../types";

// routes/leads.ts constructs an OpenAI client at module load time, so it's
// imported lazily here instead of at the top — importing crmTools.ts (e.g.
// from a test, or from any context that only needs the other tools) should
// never force that module to initialize.
async function getLeadsDashboardData(orgId: number) {
  const { getLeadsDashboardData: impl } = await import("../../routes/leads");
  return impl(orgId);
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  execute: AvaTool["execute"],
  required: string[] = [],
): AvaTool {
  return {
    definition: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties, required } },
    },
    execute,
  };
}

async function runSkill(skillId: string, args: Record<string, unknown>, ctx: AvaContext) {
  const result = await executeSkill(skillId, args, ctx.orgId, {
    channel: "internal",
    user: { id: ctx.clerkUserId, name: ctx.clerkUserId },
    meta: { source: "ava_core_crm" },
  });
  if (!result.success) return { error: result.error ?? "Error al ejecutar la herramienta." };
  try {
    return JSON.parse(result.result);
  } catch {
    return result.result;
  }
}

async function getActivityData(orgId: number, limit = 20) {
  const rows = await db.select().from(activityTable)
    .where(eq(activityTable.orgId, orgId))
    .orderBy(desc(activityTable.createdAt))
    .limit(Math.min(limit, 50));
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export const CRM_TOOLS: AvaTool[] = [
  tool("get_clients", "Lista clientes del workspace, con filtro de búsqueda opcional.", {
    search: { type: "string", description: "Texto de búsqueda por nombre" },
    limit:  { type: "number", description: "Máximo de resultados" },
  }, (args, ctx) => runSkill("list_clients", args, ctx)),

  tool("get_client_detail", "Detalle de un cliente concreto por nombre o ID.", {
    client_name: { type: "string", description: "Nombre del cliente" },
    client_id:   { type: "number", description: "ID del cliente" },
  }, (args, ctx) => runSkill("get_client_detail", args, ctx)),

  tool("get_leads", "Panel de leads captados (OmniLeads): búsquedas, resultados, oportunidad.", {}, (_args, ctx) =>
    getLeadsDashboardData(ctx.orgId)),

  tool("get_pipeline_deals", "Oportunidades del pipeline comercial con su etapa, cliente y valor.", {}, (_args, ctx) =>
    getDealsData(ctx.orgId)),

  tool("get_pipeline_stages", "Etapas configuradas del pipeline comercial.", {}, (_args, ctx) =>
    getPipelineStagesData(ctx.orgId)),

  tool("get_appointments", "Citas del calendario, con filtros de fecha o cliente.", {
    date:        { type: "string", description: "Fecha (YYYY-MM-DD)" },
    client_name: { type: "string", description: "Nombre del cliente" },
  }, (args, ctx) => runSkill("get_appointments", args, ctx)),

  tool("get_quotes", "Presupuestos del workspace, con filtro opcional de estado.", {
    status: { type: "string", description: "pending, accepted, rejected, all" },
  }, (args, ctx) => runSkill("list_quotes", args, ctx)),

  tool("get_tasks", "Tareas del CRM, con filtros de estado y prioridad.", {
    status:   { type: "string", description: "pending, in_progress, completed, all" },
    priority: { type: "string", description: "low, medium, high, all" },
  }, (args, ctx) => runSkill("list_tasks", args, ctx)),

  tool("get_conversations", "Mensajes de la conversación con un cliente concreto.", {
    client_id: { type: "number", description: "ID del cliente" },
  }, (args, ctx) => getMessagesData(ctx.orgId, Number(args["client_id"]))),

  tool("get_activity", "Actividad reciente del workspace (feed de eventos del CRM).", {
    limit: { type: "number", description: "Máximo de resultados (por defecto 20, máx 50)" },
  }, (args, ctx) => getActivityData(ctx.orgId, Number(args["limit"] ?? 20))),
];
