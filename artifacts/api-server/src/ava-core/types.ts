// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — shared types
//  One engine, two contexts (SUPER_ADMIN / CRM). See ava-core/contextRouter.ts
//  for how a request is assigned a context, and ava-core/engine.ts for the
//  tool-calling loop that uses these types.
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolDefinition } from "../ai/types";

export type AvaContextType = "super_admin" | "crm";

export interface AvaContext {
  type:         AvaContextType;
  orgId:        number;
  userId:       number;
  clerkUserId:  string;
  orgRole:      string;
  platformRole: string | null;
}

export interface AvaTool {
  definition: ToolDefinition;
  // Executes the tool and returns a JSON-serializable result. Every executor
  // receives the resolved AvaContext, never raw request data, so a tool can
  // never read orgId/permissions from anywhere but the backend-verified context.
  execute: (args: Record<string, unknown>, ctx: AvaContext) => Promise<unknown>;
}

// ── Structured response format (READ → ANALYZE → EXPLAIN) ──────────────────
// Ava never replies in free text alone in this phase — the model must call
// present_findings as its final step, forcing the observado/análisis/
// hipótesis/recomendación shape the design doc specified.
export interface AvaStructuredAnswer {
  observed:       string;
  analysis:       string;
  hypothesis?:    string;
  recommendation?: string;
}

// ── Action pilot (READ → PROPOSE → CONFIRM → EXECUTE → AUDIT) ──────────────
// Only "create_task" is wired to real execution in this phase. Everything
// else here is the scaffold future actions will plug into.
export interface ActionProposal {
  actionId:      string; // e.g. "create_task"
  summary:       string; // human-readable proposal shown to the user before confirming
  params:        Record<string, unknown>;
  confirmToken:  string; // opaque, single-use, backend-verified — never a plain boolean
  expiresAt:     string; // ISO timestamp; stale proposals cannot be confirmed
}

export interface AvaAction {
  id: string;
  // Builds the human-readable proposal + validated params (READ + PROPOSE).
  // Throws if required data is missing or the user lacks permission — the
  // proposal step itself is permission-checked, not just execution.
  propose: (rawParams: Record<string, unknown>, ctx: AvaContext) => Promise<{ summary: string; params: Record<string, unknown> }>;
  // Executes only after the confirmation token has been validated by the
  // engine (see ava-core/actions/confirmationStore.ts). Re-checks permission.
  execute: (params: Record<string, unknown>, ctx: AvaContext) => Promise<unknown>;
  requiredPermission?: string;
}

export interface AvaAskRequest {
  message:  string;
  sessionId?: string;
  context?: AvaContextType; // client's requested context — a HINT only, never trusted alone
}

export interface AvaAskResponse {
  sessionId: string;
  answer:    AvaStructuredAnswer;
  proposal?: ActionProposal;
}
