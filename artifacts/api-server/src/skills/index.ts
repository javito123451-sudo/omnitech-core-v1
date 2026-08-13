// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Skill Engine (orquestador)
//  Centralized skill registry and execution
//  NO LLM dependency — skills are pure code
// ═══════════════════════════════════════════════════════════════════════════

import type { SkillDefinition, SkillContext, SkillResult } from "./types";
import { trackSkillEngineCall } from "../utils/avaMetrics";

import {
  createAppointmentSkill, rescheduleAppointmentSkill,
  cancelAppointmentSkill, getAppointmentsSkill,
} from "./appointmentSkills";

import {
  createClientSkill, getClientsSkill, getClientDetailSkill,
} from "./clientSkills";

import {
  createQuoteSkill, getQuotesSkill,
} from "./quoteSkills";

import {
  createInvoiceSkill,
  getInvoiceSkill,
  listPendingInvoicesSkill,
  registerPaymentSkill,
  getClientDebtSkill,
  getMonthlyIncomeSkill,
  accountingSummarySkill,
} from "./accountingSkills";

import { createTaskSkill, getTasksSkill } from "./taskSkills";

import { escalateToHumanSkill } from "./escalationSkills";

// ═══════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════

const SKILLS: SkillDefinition[] = [
  createAppointmentSkill,
  rescheduleAppointmentSkill,
  cancelAppointmentSkill,
  getAppointmentsSkill,
  createClientSkill,
  getClientsSkill,
  getClientDetailSkill,
  createQuoteSkill,
  getQuotesSkill,
  createInvoiceSkill,
  getInvoiceSkill,
  listPendingInvoicesSkill,
  registerPaymentSkill,
  getClientDebtSkill,
  getMonthlyIncomeSkill,
  accountingSummarySkill,
  createTaskSkill,
  getTasksSkill,
  escalateToHumanSkill,
];

const SKILL_MAP: Map<string, SkillDefinition> = new Map(SKILLS.map(s => [s.id, s]));

// Alias mappings for backward compatibility (Telegram tools used different names)
SKILL_MAP.set("get_client_appointments", getAppointmentsSkill);
SKILL_MAP.set("get_client", getClientDetailSkill);
SKILL_MAP.set("list_clients", getClientsSkill);
SKILL_MAP.set("list_quotes", getQuotesSkill);
SKILL_MAP.set("list_tasks", getTasksSkill);
// Accounting aliases
SKILL_MAP.set("list_invoices", listPendingInvoicesSkill);
SKILL_MAP.set("get_pending_invoices", listPendingInvoicesSkill);

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export function listSkills(): SkillDefinition[] {
  return SKILLS.map(s => ({
    id:          s.id,
    name:        s.name,
    description: s.description,
    params:      s.params,
  }));
}

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILL_MAP.get(id);
}

export async function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext = {},
): Promise<SkillResult> {
  const skill = SKILL_MAP.get(skillId);
  if (!skill) {
    return {
      success: false,
      skillId,
      result:  JSON.stringify({ error: `Skill '${skillId}' no encontrado.` }),
      error:   `Skill '${skillId}' no encontrado.`,
    };
  }

  // Validate required params
  const missing = skill.params.filter(p => p.required && !(p.name in params));
  if (missing.length > 0) {
    return {
      success: false,
      skillId,
      result: JSON.stringify({
        error: `Parámetros faltantes: ${missing.map(p => p.name).join(", ")}`,
      }),
      error: `Parámetros faltantes: ${missing.map(p => p.name).join(", ")}`,
    };
  }

  // Apply defaults
  const merged = { ...params };
  for (const p of skill.params) {
    if (!(p.name in merged) && p.default !== undefined) {
      merged[p.name] = p.default;
    }
  }

  try {
    const result = await skill.execute(merged, orgId, context);
    trackSkillEngineCall();

    // Extract conversational context from skill result
    let lastAppointmentId: number | undefined;
    try {
      const parsed = JSON.parse(result);
      if (typeof parsed.lastAppointmentId === "number") {
        lastAppointmentId = parsed.lastAppointmentId;
      }
      // Also capture from create/reschedule/cancel operations
      if (typeof parsed.appointmentId === "number") {
        lastAppointmentId = parsed.appointmentId;
      }
      if (typeof parsed.newAppointmentId === "number") {
        lastAppointmentId = parsed.newAppointmentId;
      }
    } catch { /* not JSON or no ID */ }

    return {
      success: true,
      skillId,
      result,
      dbVerified: true,
      lastAppointmentId,
    };
  } catch (err) {
    const errorMsg = String(err);
    console.error(`[SkillEngine] ${skillId} error:`, errorMsg);
    return {
      success: false,
      skillId,
      result: JSON.stringify({ error: `Error ejecutando ${skillId}: ${errorMsg}` }),
      error: errorMsg,
    };
  }
}

// ── Restricted catalog for external customer-facing channels ─────────────────
// WhatsApp/Telegram talk to unauthenticated strangers off the internet — they
// must NEVER get the full skill catalog (accounting, full CRM listing/detail,
// client creation, quotes, tasks, etc.). Only appointment self-service +
// escalation. The internal dashboard chat (routes/chat.ts) is protected by
// requirePermission("ai.write") and keeps the full catalog via
// getOpenAIFunctions() — do not restrict that one.
const CUSTOMER_CHANNEL_SKILL_IDS = new Set([
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "get_appointments",
  "escalate_to_human",
]);

type OpenAIFunctionSchema = Array<{
  type: "function";
  function: {
    name:        string;
    description: string;
    parameters:  {
      type:       "object";
      properties: Record<string, unknown>;
      required?:  string[];
    };
  };
}>;

function buildOpenAIFunctions(skills: SkillDefinition[]): OpenAIFunctionSchema {
  return skills.map(s => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of s.params) {
      properties[p.name] = {
        type: p.type === "array" ? "array" : p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : "string",
        description: p.description,
      };
      if (p.required) required.push(p.name);
    }
    return {
      type: "function",
      function: {
        name: s.id,
        description: s.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    };
  });
}

// OpenAI function-calling schema for LLM integration — full catalog.
// Used by the internal dashboard chat (routes/chat.ts) only.
export function getOpenAIFunctions(): OpenAIFunctionSchema {
  return buildOpenAIFunctions(SKILLS);
}

// OpenAI function-calling schema scoped by channel:
//  - "customer": WhatsApp/Telegram — restricted to appointment self-service +
//    escalate_to_human, nothing else.
//  - "internal": same full catalog as getOpenAIFunctions().
export function getOpenAIFunctionsForChannel(channel: "customer" | "internal"): OpenAIFunctionSchema {
  if (channel === "internal") return buildOpenAIFunctions(SKILLS);
  return buildOpenAIFunctions(SKILLS.filter(s => CUSTOMER_CHANNEL_SKILL_IDS.has(s.id)));
}

// Hard, code-level gate — NOT just "the tool list we handed the model doesn't
// include it". Callers (routes/whatsapp.ts, routes/telegram.ts) MUST check
// this before calling executeSkill() for a tool call that came back from the
// model, so a jailbroken/confused model emitting a disallowed function name
// can't reach accounting/CRM/quote/task skills through a customer channel.
export function isSkillAllowedForChannel(skillId: string, channel: "customer" | "internal"): boolean {
  if (channel === "internal") return true;
  return CUSTOMER_CHANNEL_SKILL_IDS.has(skillId);
}
