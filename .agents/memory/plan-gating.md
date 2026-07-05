---
name: Plan gating — known plans required in planModules
description: planModules map in auth.ts must include every plan name that exists in the DB or modules get blocked
---

# Plan Gating Bug Pattern

## The rule
`planModules` in `artifacts/api-server/src/routes/auth.ts` must include an entry for **every plan name that exists in `organizations.plan`** column. If a plan is missing, the lookup returns `undefined`, which triggers the fallback — and the fallback was `planModules.starter = ["crm"]`, setting every non-crm module to `false`.

**Why:** The loop `for (const key of Object.keys(modules)) { if (!allowedModules.includes(key)) modules[key] = false; }` actively disables everything not in the allowed list. Missing plan = crm-only.

**How to apply:** Whenever you add a new organization with a new plan name, also add that plan to `planModules`. The fallback is now `ALL_MODULES` (fail-open) as a safety net, but explicit entries are still required for proper tier enforcement.

## Current plan names in DB (as of fix)
- `starter` → crm only
- `free` → crm only  
- `growth` → crm + ai_agents + analytics + integrations + automations + omni_marketing
- `scale` → ALL_MODULES
- `professional` → ALL_MODULES
- `enterprise` → ALL_MODULES
- `business` → ALL_MODULES
- unknown → ALL_MODULES (fail-open fallback)

## DB org plans
- org 10 (Omnitech): was `free` → corrected to `enterprise`
- org 13 (prueba001): `enterprise`
- org 14 (Empresa de Servicios): `professional`

## Cache invalidation
FIX-X in startupMigrations.ts calls `bumpOrgModuleVersion(id)` for all orgs on startup. This forces the orgContext to clear stale localStorage sidebar cache (version check: `if (!cached || cached.version < version) clearSidebarCache()`).
