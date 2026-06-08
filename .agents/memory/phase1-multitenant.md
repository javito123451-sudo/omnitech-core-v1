---
name: Phase 1 multi-tenant auth
description: OmniTech Core Phase 1 — Clerk auth, organizations, org_id isolation, JIT user provisioning pattern
---

## Architecture

- **Auth**: Clerk (Replit-managed, provisioned). Session cookies on web — no Bearer tokens.
- **Tables added**: `organizations`, `users`, `org_members`, `ai_sessions`, `ai_messages`, `agent_memory`
- **Tables modified**: `clients`, `appointments`, `messages`, `activity` — all got `org_id INTEGER NOT NULL DEFAULT 1`
- **All existing routes** are now behind `requireAuth` + `resolveOrg` middleware which sets `req.orgId` and `req.userId`
- **`/api/auth/me`** is public (only requireAuth, no resolveOrg) — JIT-provisions the user in `users` table and returns org info
- **`/api/auth/setup-org`** creates a new org and org_member row for a freshly registered user
- **OrgProvider** React context calls `/api/auth/me` on mount; if no org → redirects to `/setup`

## Critical: FK migration ordering

When adding a FK column with `DEFAULT 1` to existing tables (clients, appointments, messages, activity), drizzle-kit push fails if no row with id=1 exists in `organizations` yet. **Fix:** pre-seed `organizations` with id=1 via direct SQL before running `drizzle-kit push --force`.

```js
// run via: node --input-type=module
await client.query(`CREATE TABLE IF NOT EXISTS organizations (...)`);
await client.query(`INSERT INTO organizations (id, ...) VALUES (1, ...) ON CONFLICT (id) DO NOTHING`);
await client.query(`SELECT setval('organizations_id_seq', GREATEST((SELECT MAX(id) FROM organizations), 1))`);
```

## Key files
- `artifacts/api-server/src/middlewares/auth.ts` — requireAuth, resolveOrg
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — Clerk FAPI proxy
- `artifacts/api-server/src/routes/auth.ts` — /me + /setup-org endpoints
- `artifacts/omniflow/src/lib/orgContext.tsx` — OrgProvider + useOrg hook
- `artifacts/omniflow/src/pages/setup.tsx` — org creation onboarding page
- `lib/db/src/schema/organizations.ts` — organizations, users, org_members
- `lib/db/src/schema/ai-memory.ts` — ai_sessions, ai_messages, agent_memory

## Clerk appearance (dark theme)
The app uses HSL vars from index.css. colorPrimary = hsl(217,91%,60%), colorBackground = hsl(222,35%,11%). Tailwind v4 requires `@layer theme, base, clerk, components, utilities` before `@import 'tailwindcss'` and `tailwindcss({ optimize: false })` in vite.config.ts.

**Why:** optimize: false prevents lightningcss from reordering @layer imports from @clerk/themes, which breaks Clerk UI in prod builds.
