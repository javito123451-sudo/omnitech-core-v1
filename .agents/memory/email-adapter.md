---
name: Email hub adapter (production)
description: How the real "email" adapter in the integration hub works — platform-level, no per-org connection needed
---

# Email adapter — `hub/adapters/emailAdapter.ts`

Shipped in commit `5abc9db` ("CRM comercial + Client Autopilot") as part of wiring
Autopilot to send follow-ups by email in addition to WhatsApp/Telegram. Registered
in `hub/index.ts` alongside `whatsappAdapter`/`telegramAdapter`.

## Why it's architecturally different from WhatsApp/Telegram

WhatsApp/Telegram are per-org connections — each workspace brings its own bot
token / WhatsApp Business number, stored encrypted in
`org_integrations.credentials_enc`, and normally `IntegrationManager.send()`
refuses to send if that row doesn't exist for the org. Email is not like that:
OmniTech sends all transactional email through **one shared platform Resend
account** (`RESEND_API_KEY`/`EMAIL_FROM` env vars, `lib/email.ts`). No org
"connects" anything.

Two places special-case `slug === "email"` to make this work without requiring an
`org_integrations` row per workspace:

1. **`services/notificationService.ts` `getActiveChannels(orgId)`** — after
   fetching the org's real integration rows, appends `"email"` to the list
   whenever `process.env.RESEND_API_KEY` is set, regardless of org. This is what
   makes `"auto"` cascade and channel pickers treat email as always-available.
2. **`hub/integrationManager.ts` `send()`** — `if (!row && slug !== "email")` skips
   the "not configured" early-return for email; builds a minimal
   `{orgId, credentials:{}, config:{}}` context when no row exists.

`lib/email.ts` exports a generic `sendEmail(to, subject, html): Promise<boolean>`
(separate from the two fixed-template functions `sendPortalEmail`/
`sendInvitationEmail`) — this is what the adapter's `send()` calls.

## If you add another platform-level integration later

Follow this same pattern: special-case the slug in `getActiveChannels()` and
`IntegrationManager.send()` (check env var instead of a DB row), write an adapter
whose `validate()`/`healthCheck()`/`send()` read the global env var directly
instead of `ctx.credentials`. Don't invent a third mechanism.

## Cautionary tale (2026-08-21) — two sessions built this independently

A separate Claude Code session working on OmniTax/Accounting also identified this
exact gap ("email" listed in `NotificationService` but no adapter behind it) and
built its own `emailAdapter.ts` + `lib/email.ts sendEmail()` + org-seeding
migration, using a different design (per-org `org_integrations` row seeded at org
creation, instead of the env-var bypass above). By the time that work was ready to
push, this commit (`5abc9db`) had already landed on `main` with an incompatible
`sendEmail()` signature and a real, working `emailAdapter.ts`. The duplicate
attempt was discarded entirely (never merged) once `git fetch origin main` showed
the collision — see `backup-local-fase0-attempt` branch in that session's local
clone if the discarded version is ever needed for reference (per-org seeding
approach, not present on `main`).

**Lesson for future sessions**: `git fetch origin main` and diff before assuming
your local base is current, especially before starting multi-file work in an area
(hub/adapters, notificationService) another concurrent session might also be
touching — and re-check right before generating a patch to hand off, not just at
session start, since another session can land changes mid-task.

## Correction (2026-08-21) — typecheck baseline is 185, not 249

The commit message and the MEMORY.md entry pointing here both claim
`tsc --noEmit` regressed to 249 errors after `5abc9db`. Re-ran the full
monorepo typecheck (`pnpm run typecheck`, real Node/pnpm install, not a
guess) against the current tip of `main` (through `b47e017`): **185
errors**, byte-for-byte identical to the pre-`5abc9db` baseline — diffed
the two error lists directly, zero new entries. The 249 figure doesn't
match the actual repo state; likely came from an incomplete dependency
install or a stale checkout in that session's environment rather than a
real regression. Treat 185 as the current baseline, not 249.
