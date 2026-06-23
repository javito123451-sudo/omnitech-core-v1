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
}

export interface SkillResult {
  success:    boolean;
  skillId:    string;
  result:     string; // JSON string
  error?:     string;
  // DB read-back verification flag
  dbVerified?: boolean;
}
