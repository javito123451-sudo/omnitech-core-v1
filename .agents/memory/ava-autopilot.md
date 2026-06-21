---
name: Ava Autopilot module
description: Capa 3 autonomous execution layer — scheduled/condition-based CRM tasks running in the background.
---

## Architecture

- **DB**: `autopilot_tasks` (id, org_id, name, enabled, trigger_type, trigger_config jsonb, action_type, action_config jsonb, last_run_at, next_run_at) + `autopilot_runs` (id, task_id, org_id, status, started_at, completed_at, result_summary, error_message). Created via direct SQL (drizzle-kit push requires TTY).
- **Engine**: `artifacts/api-server/src/utils/autopilotEngine.ts` — `shouldRunTask`, `calcNextRunAt`, `executeAction` (switch on actionType), `runAutopilotTask` (wraps in run record).
- **Scheduler**: `artifacts/api-server/src/utils/autopilotScheduler.ts` — node-cron `* * * * *`, fire-and-forget, started in `index.ts` if `NODE_ENV !== "test"`.
- **API**: `routes/autopilot.ts` — GET/POST /tasks, PATCH/DELETE /tasks/:id, GET /tasks/:id/runs. Registered in routes/index.ts: `router.use("/autopilot", requireModule("automations"), autopilotRouter)`.
- **Frontend**: `pages/automations.tsx` at route `/automations`, sidebar entry in "Sistema" group gated by `moduleKey: "automations"`.

## Trigger types
- `daily`, `weekly`, `monthly` — time-based (uses nextRunAt)
- `inactive_clients_30d`, `quotes_expiring_7d` — condition-based (runs once per 23h max)

## Action types
- `strategic_brief` — DB query summary → activity log + optional WhatsApp to owner_phone
- `notify_owner` — custom message → activity log + optional WhatsApp
- `send_whatsapp` — sends WhatsApp to cfg.phone with cfg.message
- `log_activity` — writes to activity table
- `update_client_status` — (default branch, condition-triggered)

**Why:** Reuses `getWhatsAppCreds` from integrationCreds util directly in the engine (avoids circular imports with whatsapp.ts). Does NOT import executeCrmTool from chat.ts — engine has its own lightweight DB queries.

**How to apply:** When adding new trigger or action types, add to both `TRIGGER_LABELS`/`ACTION_LABELS` in the engine AND in the frontend `automations.tsx`. DB migration must be done via direct SQL (`executeSql` in code_execution sandbox), not drizzle-kit push (requires TTY).
