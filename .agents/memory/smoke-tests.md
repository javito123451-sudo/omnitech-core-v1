# Post-deploy smoke tests (Fase 0.5)

Three things verified, plus how to check/run each one.

## 1. Do WhatsApp/Telegram webhooks reset on every deploy?

**No, not anymore, and it wasn't happening the way it used to.** `autoSetupTelegramWebhooks()`
(`routes/telegram.ts`, called from `index.ts` on boot) is idempotent: it calls Telegram's
`getWebhookInfo` first and only calls `setWebhook` again if the URL actually changed
(`if (currentUrl === webhookUrl) { ...continue; }`). So a normal deploy that doesn't change
the public URL does nothing to the webhook.

The *real* historical bug (comment still in `index.ts:44-48`) was different: on the old Replit
Autoscale instance, the base URL fell back to `REPLIT_DEV_DOMAIN` (or worse, localhost) when
`PUBLIC_URL` wasn't set — and Telegram rejects non-public webhook URLs, so auto-registration
silently broke on every cold boot. Since the move to Render, that fallback chain was removed;
now it's `PUBLIC_URL` (env var) → hardcoded `https://www.omnitech-core.com` (the real custom
domain, proxied by Vercel's `vercel.json` rewrite of `/api/*` to the Render backend — this is
intentional, not a mistake). No dependency on any Replit-only env var remains.

WhatsApp has **no equivalent auto-setup at all** — its webhook subscription lives in the Meta
for Developers dashboard, outside this repo, so there's nothing here that could "reset" it on
deploy. (This is itself a gap: see `smoke-test-deploy.mjs` note below — the code can't detect
if Meta's subscription breaks.)

**Manual per-org check** (not automated — needs a real SUPER_ADMIN session + a real org with
Telegram connected): `GET /api/telegram/webhook-info` returns `{ registered, url, pendingUpdates,
lastError }` straight from Telegram's own `getWebhookInfo`. If `registered: false` or the `url`
doesn't match the current public domain, run `POST /api/telegram/set-webhook` for that org (also
SUPER_ADMIN-gated) to re-register. This endpoint existed before this task; it's the "honest"
diagnostic that the integrations list page's "connected" badge does *not* consult (see
`OmniTech_Core_Telegram_Ownership_Report.md` for the badge-reliability caveat — unrelated to
this reset question specifically).

## 2. Automated tests — `pnpm --filter @workspace/api-server test`

New in this task: `artifacts/api-server` had **zero** tests/test runner before. Added Vitest
(`vitest.config.ts`, `environment: "node"`).

- `src/skills/__tests__/channelFilter.test.ts` — no DB needed. Locks in the customer-channel
  restriction from commit `08838d1`: WhatsApp/Telegram only ever get
  `create_appointment/reschedule_appointment/cancel_appointment/get_appointments/escalate_to_human`
  out of the full skill registry (19 skills as of this commit); everything accounting/CRM/quotes/
  tasks must be rejected by `isSkillAllowedForChannel`, not just left out of the prompt.
- `src/skills/__tests__/guestAppointments.integration.test.ts` — real Postgres, real skill code
  (`executeSkill`, no mocks), guarded by `describe.skipIf(!hasRealDb)` so it skips cleanly
  without a real `DATABASE_URL`. Verifies: guest booking gets `clientId: null` anchored to
  `context.guestIdentity` (not to whatever `guest_phone` text the model extracted — that's the
  point of `effectiveGuestPhone` in `appointmentSkills.ts`), a guest can list *only* their own
  appointment, a *different* guest sees nothing (isolation), and a customer-channel request with
  no identity at all gets `[]` — not the whole org's appointments (the `8e66809` leak this
  guards against).

**To run against a real DB**: point `DATABASE_URL` at a disposable Neon branch (never production
— the test only cleans up the rows it creates via `afterAll`, it doesn't reset anything else,
and it needs at least one row in `organizations`). A Neon branch named `ci-test`
(`br-muddy-frost-b2jrkzgp` in the `Omnitech-core` project as of 2026-09-18) was created for
exactly this. Get its connection string from the Neon console (Branches → ci-test → Connect) and
either export it or put it in a local, gitignored `.env.test`:
```
DATABASE_URL="<ci-test branch connection string>" pnpm --filter @workspace/api-server test
```
Without it, `pnpm --filter @workspace/api-server test` still runs the channel-filter tests and
skips the DB ones (reported as `skipped`, not failed).

**Local Windows note**: this repo's `pnpm-lock.yaml` was generated on Linux, so it only pins
Linux native binaries for rollup/esbuild (used internally by Vite/Vitest) — on Windows you'll
hit `Cannot find module '@rollup/rollup-win32-x64-msvc'` / a matching esbuild error the first
time. Fixed once, locally, by adding `@rollup/rollup-win32-x64-msvc` and
`@esbuild/win32-x64@0.28.1` (pin the exact version — must match the host `esbuild` package's
own pinned `0.28.1`, or you get a "Host version does not match binary version" error) as
devDependencies of `@workspace/api-server`. These are `os`-gated by their own package.json, so
they're inert (skipped) on Linux — safe to keep committed, not just a local workaround.

## 3. Live post-deploy check — `pnpm --filter @workspace/api-server smoke:deploy`

`scripts/smoke-test-deploy.mjs` — zero dependencies, hits the real deployed URL
(`BASE_URL`, defaults to `https://omnitech-core-api.onrender.com`) with three safe, side-effect-free
requests:
1. `GET /api/healthz` → 200 (app is up)
2. `POST /api/telegram/webhook/<bogus secret>` → 200 (route mounted; Telegram's own contract
   requires an immediate 200 regardless of secret validity, so this never touches a real org)
3. `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<bogus>` → 403 (route mounted
   and the verify-token check is live; 403 for a wrong token is the *correct* response, not a
   failure)

Timeout is 60s per check — Render's free plan spins the instance down after inactivity, and a
cold start can take 50s+ (the dashboard says so; see also commit "fix: reintento automático ante
arranque en frío del backend (Render free)"). Run it right after every deploy:
```
BASE_URL=https://omnitech-core-api.onrender.com pnpm --filter @workspace/api-server smoke:deploy
```
Verified working against real production on 2026-09-18 (all 3 checks passed, ~100-220ms each —
instance was already warm).

**What this does *not* prove**: that any specific org's Telegram/WhatsApp webhook is actually
registered with the provider — only that the routes exist and the app booted. For that, use the
manual per-org check in §1 (`GET /api/telegram/webhook-info`). There's no equivalent live
endpoint for WhatsApp's subscription status short of Meta's own dashboard — `healthCheck()` in
`hub/adapters/whatsappAdapter.ts` explicitly marks its own "inbound" check as `status: "skip"`
("requires historical webhook events"), so don't expect this to ever be fully automatable for
WhatsApp specifically.
