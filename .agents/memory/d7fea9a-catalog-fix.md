---
name: OmniLeads admin catalog fix (d7fea9a)
description: Why omni_leads had no toggle in Control Center → Módulos even though it worked everywhere else
---

# OmniLeads admin catalog fix

**Commit**: `d7fea9a`

## The bug

`GET /control-center/modules` in `artifacts/api-server/src/routes/control-center.ts`
(~line 635) returns a hardcoded `CATALOG` array that drives the admin "Módulos por
Workspace" toggle screen. This array is **separate** from the canonical
`ALL_MODULE_SLUGS` list in `auth.ts` (see `module-system.md`) and must be kept in
sync by hand — nothing enforces that automatically.

`omni_leads` was already wired everywhere else (sidebar nav, `auth.ts` plan gating,
`requireModule("omni_leads")` on its routes) but was simply missing from `CATALOG`,
so admins had no UI to enable/disable it per workspace.

## The fix

Added to `CATALOG`:

```ts
{ slug: "omni_leads", name: "OmniLeads AI", description: "Captación y gestión de leads con IA", alwaysOn: false }
```

Also added matching entries to the frontend so the toggle renders correctly:
- `artifacts/omniflow/src/pages/control-center/modules.tsx` — `MODULE_ICONS["omni_leads"] = "🎯"` + a gradient entry in `MODULE_COLORS`.

## Gotcha for next time

Any new module slug needs to be added in **four** places, not one:
1. `ALL_MODULE_SLUGS` in `auth.ts` (canonical list, drives `GET /api/auth/me`)
2. `PLAN_MODULES` in `auth.ts` (which plans include it by default)
3. `CATALOG` in `control-center.ts` (admin toggle screen — easy to forget, this bug)
4. `MODULE_ICONS`/`MODULE_COLORS` in `control-center/modules.tsx` (frontend admin UI)
5. `MODULE_LABELS` in `ModuleGuard.tsx` (fallback label shown when the module is off)

See `omnileads-module.md` for the module's own architecture and its still-pending
data-collection blockers (Google Places / OpenAI keys, module activation).
