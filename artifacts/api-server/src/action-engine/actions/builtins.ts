/**
 * Action Engine — Built-in Actions
 *
 * These are the universal actions available in every OmniTech module.
 * Domain-specific actions (e.g. "time.create_incident") are registered
 * by the corresponding handler module in Phase 4+.
 *
 * Built-in catalog:
 *   debug.log            — Development/testing: logs to console.
 *   audit.log_system     — Write a system-generated audit trail entry.
 *   ace.update_context   — Patch the ACE context for a specific user.
 *   notification.create  — Store an in-app notification for a user.
 */

import type {
  AuditLogPayload,
  AceUpdatePayload,
  DebugLogPayload,
  NotificationPayload,
} from "../types";
import { registerAction } from "../registry";
import { logAuditSystem } from "../../utils/auditLogger";
import { updateContext }   from "../../ace";
import { db }             from "@workspace/db";
import { sql }            from "drizzle-orm";

// ── debug.log ─────────────────────────────────────────────────────────────────

registerAction<DebugLogPayload>({
  name:        "debug.log",
  description: "Log a debug message and optional data to the console. Development use only.",
  audit:       false,
  executor(payload, ctx) {
    console.log(
      `[ActionEngine:debug.log] org=${ctx.orgId} src=${ctx.source} msg="${payload.message}"`,
      payload.data ?? "",
    );
  },
});

// ── audit.log_system ──────────────────────────────────────────────────────────

registerAction<AuditLogPayload>({
  name:        "audit.log_system",
  description: "Write a system-generated entry to the audit trail (no user attribution).",
  audit:       false, // avoid infinite loop — this IS the audit write
  executor(payload, ctx) {
    logAuditSystem({
      orgId:      ctx.orgId,
      action:     payload.action,
      targetType: payload.targetType,
      targetId:   payload.targetId !== undefined ? String(payload.targetId) : undefined,
      details:    payload.details,
    });
  },
});

// ── ace.update_context ────────────────────────────────────────────────────────

registerAction<AceUpdatePayload>({
  name:        "ace.update_context",
  description: "Patch the ACE (Ava Context Engine) context for a specific user.",
  audit:       false,
  executor(payload, ctx) {
    updateContext(ctx.orgId, payload.userId, payload.contextPatch);
  },
});

// ── notification.create ───────────────────────────────────────────────────────
// Stores an in-app notification row in the `notifications` table.
// The table is created by the FIX-AD migration (see startupMigrations.ts).

registerAction<NotificationPayload>({
  name:        "notification.create",
  description: "Create an in-app notification visible to a specific user.",
  audit:       false,
  async executor(payload, ctx) {
    await db.execute(sql`
      INSERT INTO notifications
        (org_id, target_user_id, title, body, link, level, is_read, created_at)
      VALUES
        (
          ${ctx.orgId},
          ${payload.targetUserId},
          ${payload.title},
          ${payload.body},
          ${payload.link ?? null},
          ${payload.level ?? "info"},
          false,
          NOW()
        )
      ON CONFLICT DO NOTHING
    `);
  },
});
