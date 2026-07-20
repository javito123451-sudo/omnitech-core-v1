/**
 * Action Engine — Public API
 *
 * This is the ONLY file that external code should import from the Action Engine.
 *
 * Consumers (AIE handlers, Phase 4+):
 *   import { executeAction, executeAllActions, ACTION_NAMES } from "../action-engine";
 *
 * Module developers (registering domain-specific actions):
 *   import { registerAction } from "../action-engine";
 *
 * Diagnostics:
 *   import { getActionEngineSummary, initActionEngine } from "../action-engine";
 */

// ── Public API re-exports ─────────────────────────────────────────────────────

export { registerAction }               from "./registry";
export { execute as executeAction, executeAll as executeAllActions } from "./executor";
export type {
  ActionContext,
  ActionResult,
  ActionResultStatus,
  ActionRegistration,
  ActionExecutorFn,
  NotificationPayload,
  AuditLogPayload,
  AceUpdatePayload,
  DebugLogPayload,
} from "./types";

// ── Named constants for built-in action names ─────────────────────────────────
// Use these instead of magic strings when calling executeAction().

export const ACTION_NAMES = {
  DEBUG_LOG:         "debug.log",
  AUDIT_LOG_SYSTEM:  "audit.log_system",
  ACE_UPDATE:        "ace.update_context",
  NOTIFICATION:      "notification.create",
} as const;

// ── Initialisation ────────────────────────────────────────────────────────────

import "./actions";                       // registers all built-in actions
import { getActionCount, getRegistrySummary } from "./registry";

/**
 * Initialise the Action Engine.
 * Called once at server startup by initAIE() (the AIE is the entry point
 * for the entire intelligence pipeline, so it owns the init sequence).
 */
export function initActionEngine(): void {
  // Actions are registered as a side-effect of importing ./actions above.
  console.log(
    `[ActionEngine] Initialised — ${getActionCount()} built-in action(s) registered.`,
  );
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export function getActionEngineSummary() {
  return {
    version:        "1.0.0-phase2",
    status:         "operational",
    totalActions:   getActionCount(),
    actions:        getRegistrySummary(),
  };
}
