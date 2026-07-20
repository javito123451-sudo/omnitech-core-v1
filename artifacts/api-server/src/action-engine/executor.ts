/**
 * Action Engine — Executor
 *
 * The executor is the safe wrapper that:
 *  1. Looks up the action in the registry.
 *  2. Calls the executor function.
 *  3. Catches all errors — never throws to the caller.
 *  4. Measures execution time.
 *  5. Optionally logs the execution to the audit trail.
 *
 * Design: execute() always resolves (never rejects).
 * This guarantees that an AIE handler can call executeAction() without
 * defensive try/catch boilerplate — the Action Engine absorbs all failures.
 */

import type { ActionContext, ActionResult } from "./types";
import { getAction } from "./registry";
import { logAuditSystem } from "../utils/auditLogger";

// ── Core execute ──────────────────────────────────────────────────────────────

export async function execute(
  actionName: string,
  payload:    Record<string, unknown>,
  ctx:        ActionContext,
): Promise<ActionResult> {
  const start = Date.now();

  // ── Guard: action must exist ──────────────────────────────────────────────
  const registration = getAction(actionName);

  if (!registration) {
    const durationMs = Date.now() - start;
    console.warn(
      `[ActionEngine] Unknown action "${actionName}" requested by "${ctx.source}".`,
    );
    return { actionName, status: "not_found", durationMs };
  }

  // ── Guard: orgId is mandatory ─────────────────────────────────────────────
  if (!ctx.orgId || ctx.orgId <= 0) {
    const durationMs = Date.now() - start;
    console.warn(
      `[ActionEngine] Action "${actionName}" blocked — ctx.orgId missing. Source: "${ctx.source}".`,
    );
    return { actionName, status: "skipped", durationMs, error: "orgId missing in ctx" };
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const result = registration.executor(payload, ctx);
    if (result instanceof Promise) {
      await result;
    }

    const durationMs = Date.now() - start;

    // ── Optional audit trail ──────────────────────────────────────────────
    if (registration.audit) {
      logAuditSystem({
        orgId:      ctx.orgId,
        action:     `ACTION_ENGINE:${actionName.toUpperCase().replace(/\./g, "_")}`,
        targetType: "action",
        targetId:   ctx.sourceEventId ?? actionName,
        details:    `source=${ctx.source} duration=${durationMs}ms`,
      });
    }

    return { actionName, status: "ok", durationMs };

  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(
      `[ActionEngine] Error executing action "${actionName}" (source: "${ctx.source}", org: ${ctx.orgId}):`,
      err,
    );

    return { actionName, status: "error", durationMs, error: errorMessage };
  }
}

// ── Parallel execute ──────────────────────────────────────────────────────────

export async function executeAll(
  actions: Array<{ name: string; payload: Record<string, unknown> }>,
  ctx:     ActionContext,
): Promise<ActionResult[]> {
  if (actions.length === 0) return [];

  return Promise.all(
    actions.map(({ name, payload }) => execute(name, payload, ctx)),
  );
}
