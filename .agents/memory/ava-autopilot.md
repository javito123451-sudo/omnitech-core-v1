---
name: Ava Autopilot scheduler design
description: Key design decisions for the autonomous autopilot scheduler to avoid silent misbehavior.
---

## Condition-based triggers must evaluate CRM data — not just rate-limit

`shouldRunTask()` is async and queries the DB before executing condition-based triggers (`inactive_clients_30d`, `quotes_expiring_7d`). It returns `false` if no matching records exist, even if the 23h cooldown has elapsed.

**Why:** Without the DB condition check, tasks fire daily regardless of whether the triggering state is actually present. Rate-limiting alone is not sufficient.

**How to apply:** Any new condition-based trigger must add a corresponding DB existence/count check inside `shouldRunTask()`, separate from the action dispatch.

## nextRunAt and lastRunAt advance only after successful execution

`runAutopilotTask()` commits both `lastRunAt` and `nextRunAt = calcNextRunAt(...)` inside the success branch ONLY. On failure, neither is updated — only the run record is marked as error.

**Why:** `shouldRunTask()` uses `lastRunAt` for the 23h cooldown on condition-based triggers. Updating `lastRunAt` on failure would suppress retries for up to 23h. Not updating it lets the task retry immediately on the next scheduler tick (next minute).

## In-flight idempotency guard

Before inserting a run record, `runAutopilotTask()` checks for an existing row with `status = "running"` for that task. The inserted "running" row is the distributed lock — prevents duplicate executions when a task takes longer than the 1-minute cron interval.

## Shared primitives (must reuse)

- `executeCrmTool(toolName, args, orgId)` — exported from `routes/chat.ts`; use for `strategic_brief` and any CRM data fetch.
- `sendAutoReply(orgId, phone, message)` — exported from `routes/whatsapp.ts`; use for all WhatsApp sending in the engine.

Do not re-implement these inline in the engine.

## DB migration note

Autopilot tables created via direct SQL — drizzle-kit push requires TTY. Use `executeSql` in code_execution sandbox for all DDL on this project.
