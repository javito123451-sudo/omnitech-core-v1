// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Skill Engine
//  Skill definitions: reusable, LLM-agnostic CRM actions
//  Every skill can be called directly (no LLM required) or via the engine.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "@workspace/db";

export interface SkillParam {
  name:        string;
  type:        "string" | "number" | "boolean" | "date" | "time" | "object" | "array";
  description: string;
  required?:   boolean;
  default?:    unknown;
}

export interface SkillDefinition {
  id:          string;
  name:        string;
  description: string;
  params:      SkillParam[];
  execute:     (params: Record<string, unknown>, orgId: number, context: SkillContext) => Promise<string>;
}

export interface SkillContext {
  // The client associated with this interaction (if known)
  client?: { id: number; name: string } | null;
  // The user/agent making the request (if known)
  user?: { id: string; name: string } | null;
  // Channel of origin ("whatsapp", "telegram", "web", "internal")
  channel?: string;
  // Extra metadata (for logging, etc.)
  meta?: Record<string, unknown>;
  // Last appointment referenced in this conversation (for resolving "that appointment", "tomorrow's", etc.)
  lastAppointmentId?: number;
  // Identity of the sender on the external channel — phone number for WhatsApp,
  // chat_id for Telegram. Always populated when the request comes from a
  // channel webhook, regardless of whether a CRM client is linked. Lets guest
  // (no-client) skills like reschedule/cancel resolve "my appointment" from
  // the sender's identity instead of only from conversation-turn memory.
  guestIdentity?: string;
}

export interface SkillResult {
  success:    boolean;
  skillId:    string;
  result:     string; // JSON string
  error?:     string;
  // DB read-back verification flag
  dbVerified?: boolean;
  // Conversational context: last appointment referenced in this result
  lastAppointmentId?: number;
}
