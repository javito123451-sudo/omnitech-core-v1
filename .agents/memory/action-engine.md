---
name: Action Engine
description: Execution layer of the intelligence pipeline. Handlers DECIDE; Action Engine EXECUTES. Phase 2 of ACE+AIE+ActionEngine architecture.
---

# Action Engine — Phase 2

## What it is
The execution arm of the intelligence pipeline. AIE handlers analyse events and call `executeAction()` to produce real effects (DB writes, notifications, ACE updates, audit logs).

## Backend location
`artifacts/api-server/src/action-engine/`
- `types.ts`          — ActionContext, ActionResult, ActionExecutorFn, ActionRegistration, IActionEngine, payload types
- `registry.ts`       — Map<name, ActionRegistration>, registerAction(), getAction(), listActions()
- `executor.ts`       — execute() safe wrapper (orgId guard + try/catch + timing + optional audit); executeAll() parallel
- `actions/builtins.ts` — 4 built-in actions registered at import time
- `actions/index.ts`  — action loader (import builtins + future domain actions)
- `index.ts`          — public API surface, ACTION_NAMES constants, initActionEngine()

## Built-in actions (ACTION_NAMES constants)
| Constant | Name string | Does |
|---|---|---|
| `DEBUG_LOG` | `debug.log` | console.log — dev only |
| `AUDIT_LOG_SYSTEM` | `audit.log_system` | logAuditSystem() — no user |
| `ACE_UPDATE` | `ace.update_context` | updateContext() from ACE |
| `NOTIFICATION` | `notification.create` | INSERT INTO notifications |

## notifications table (FIX-AC)
Columns: id, org_id, target_user_id, title, body, link, level, is_read, created_at
Index: idx_notifications_user (org_id, target_user_id, is_read)

## How to call from a handler (Phase 4+)
```typescript
import { executeAction, executeAllActions, ACTION_NAMES } from "../action-engine";
import type { ActionContext } from "../action-engine";

const ctx: ActionContext = {
  orgId:          event.orgId,
  userId:         event.userId,
  clerkUserId:    event.clerkUserId,
  sourceEventId:  event.id,
  source:         "OmniTime:clock-in-handler",
};

// Single action (always resolves):
const result = await executeAction(ACTION_NAMES.NOTIFICATION, {
  targetUserId: 42,
  title: "Fichaje registrado",
  body: "Has fichado a las 09:00",
  level: "success",
}, ctx);

// result.status: "ok" | "error" | "skipped" | "not_found"
// result.durationMs: number
// result.error?: string  (if status === "error")

// Multiple parallel actions:
const results = await executeAllActions([
  { name: ACTION_NAMES.AUDIT_LOG_SYSTEM, payload: { action: "TIME_CLOCK_IN", targetType: "time_entry", targetId: 77 } },
  { name: ACTION_NAMES.NOTIFICATION,    payload: { targetUserId: 42, title: "...", body: "..." } },
], ctx);
```

## How to add a domain action (Phase 4+)
```typescript
// src/action-engine/actions/timeActions.ts
import { registerAction } from "../registry";
registerAction({
  name: "time.create_incident",
  description: "Create a time incident (auto-detected).",
  audit: true,
  async executor(payload, ctx) {
    await db.execute(sql`INSERT INTO time_incidents ...`);
  },
});

// src/action-engine/actions/index.ts — add:
import "./timeActions";
```

## Startup wiring
`initAIE()` in `src/aie/index.ts` calls `initActionEngine()` FIRST
(before initDispatcher and registerAllHandlers), so actions are ready
when handlers try to use them.

## Architecture constraint
Handlers → executeAction() → Action Engine → modules
Actions must NEVER emit AIE events (infinite loop risk).
Actions must ALWAYS filter by ctx.orgId before any DB query.

## Next FIX letter: FIX-AD (OmniTime tables)
