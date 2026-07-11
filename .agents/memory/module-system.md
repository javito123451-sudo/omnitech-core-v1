---
name: Module System Architecture
description: How module gating works end-to-end — auth.ts, orgContext.tsx, requireModule.ts, startup migration FIX-AB
---

## The Rule

`auth.ts` (GET /api/auth/me) **always** returns every known module slug as either `true` or `false`.
`orgContext.tsx` `canAccessModule` uses `=== true` (fail-closed). Absence → blocked.

**Why:** The old code only included modules with DB rows in the response. `modules[key] !== false` defaulted absent keys to `true`, making every unset module accessible regardless of plan or admin toggles.

## How to apply

### Backend — `auth.ts`
1. Build `allowedSet` from `PLAN_MODULES[plan]` (or ALL_MODULES if unknown plan).
2. Initialize `modules[slug] = allowedSet.has(slug)` for **every** slug in `ALL_MODULE_SLUGS`.
3. Set `modules.crm = true` unconditionally.
4. Apply DB configs: only for slugs in `allowedSet` — DB can only restrict, never grant beyond plan.
5. Send full object: every slug is present as `true` or `false`.

### Frontend — `orgContext.tsx`
```ts
return modules[key] === true;  // fail-closed — never fail-open
```

### Startup — FIX-AB
Seeds `module_configs` for every org × every slug on each server start.
`ON CONFLICT DO NOTHING` — admin-set values are preserved.
Ensures `requireModule` middleware always has a DB row to check (no implicit defaults).

## Plan → modules mapping (current)

| Plan | Modules |
|------|---------|
| starter (€99) | crm, whatsapp, omni_marketing, knowledge_base, omni_accounting, ai_agents, quotes, portal_cliente |
| professional (€149) | starter + automations, integrations, analytics, omni_docs |
| business (€299) | professional + omni_import_ai, omni_ads, omni_leads, omni_tax, omni_diagnostics, omni_security |
| enterprise (€1000+) | ALL_MODULE_SLUGS |
| enterprise_plus | ALL_MODULE_SLUGS |
| growth (legacy) | crm, ai_agents, analytics, integrations, automations, omni_marketing |
| scale (legacy) | ALL_MODULE_SLUGS |
| free (legacy) | crm |

Unknown plan → ALL_MODULE_SLUGS (fail-open at plan level, admin still controls DB configs).

## ALL_MODULE_SLUGS (canonical list in auth.ts and FIX-AB)
crm, ai_agents, analytics, integrations, automations, omni_accounting, omni_import_ai, whatsapp, omni_tax, omni_marketing, omni_ads, omni_leads, omni_diagnostics, omni_security, omni_docs, quotes, portal_cliente, knowledge_base
