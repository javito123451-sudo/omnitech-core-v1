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

import { createTaskSkill, getTasksSkill } from "./taskSkills";

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
  createTaskSkill,
  getTasksSkill,
];

const SKILL_MAP: Map<string, SkillDefinition> = new Map(SKILLS.map(s => [s.id, s]));

// Alias mappings for backward compatibility (Telegram tools used different names)
SKILL_MAP.set("get_client_appointments", getAppointmentsSkill);
SKILL_MAP.set("get_client", getClientDetailSkill);
SKILL_MAP.set("list_clients", getClientsSkill);
SKILL_MAP.set("list_quotes", getQuotesSkill);
SKILL_MAP.set("list_tasks", getTasksSkill);

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

// OpenAI function-calling schema for LLM integration
export function getOpenAIFunctions(): Array<{
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
}> {
  return SKILLS.map(s => {
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
