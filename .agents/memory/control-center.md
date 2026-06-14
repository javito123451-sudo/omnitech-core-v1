---
name: Control Center Architecture
description: Super Admin Control Center — tables, routes, roles, and frontend layout
---

## Tables Created (direct SQL, no drizzle-kit push)
- `platform_roles` — maps clerk_user_id → SUPER_ADMIN / STAFF_OMNITECH
- `module_configs` — module on/off per org (org_id + module_slug unique key)
- `license_plans` — one license row per org (org_id unique)
- `audit_logs` — action log for all Control Center actions

## Drizzle Schema
- `lib/db/src/schema/platform-admin.ts` — platformRolesTable, moduleConfigsTable, licensePlansTable, auditLogsTable
- Exported from `lib/db/src/schema/index.ts`

## Backend
- `artifacts/api-server/src/middlewares/superAdmin.ts` — `requireSuperAdmin` middleware + `hasPlatformRole` helper + 5-min in-memory cache
- `artifacts/api-server/src/routes/control-center.ts` — all CC routes
- Registered in `routes/index.ts` BEFORE requireAuth/resolveOrg (uses its own auth)
- `/api/control-center/check` — public, returns `{ isSuperAdmin, role }`
- All other endpoints protected by `requireSuperAdmin`

## Frontend
- `artifacts/omniflow/src/hooks/useSuperAdmin.ts` — calls /check, caches result
- `artifacts/omniflow/src/components/layout/ControlCenterLayout.tsx` — dark violet independent sidebar
- Pages under `artifacts/omniflow/src/pages/control-center/`: index, workspaces, users, modules, security, licenses
- Routes in App.tsx wrapped in `<SuperAdminRoute>` guard — redirects to /executive-dashboard if not SUPER_ADMIN
- Link in MainLayout sidebar only visible when `isSuperAdmin === true`

## Seeded Super Admins
- a3servicio@gmail.com → user_3F0QQ8H3pAYgpOdB649Z6mOHCoD → SUPER_ADMIN
- omnitechcore01@gmail.com → user_3F2in1cpKPN0a8yR8iRfeK9YZOd → SUPER_ADMIN

**Why:** Role stored in DB not Clerk metadata so it's platform-managed independent of workspace org membership.

**How to apply:** Add new SUPER_ADMINs via `INSERT INTO platform_roles ...` or via POST /api/control-center/platform-roles (requires existing SUPER_ADMIN token).
