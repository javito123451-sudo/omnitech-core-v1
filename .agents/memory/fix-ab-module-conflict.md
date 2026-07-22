---
name: FIX-AB ON CONFLICT flaw — module_configs stale on plan change
description: FIX-AB seeded module_configs with DO NOTHING; plan upgrades never propagated. Fixed with conditional DO UPDATE + FIX-AF repair migration.
---

## The bug

`FIX-AB` (startupMigrations.ts) seeds `module_configs` rows per-org based on plan.
It used `ON CONFLICT (org_id, module_slug) DO NOTHING`.

**Consequence:** if an org's plan changed after the first seed, the old value (e.g.
`knowledge_base = false` for a `free` plan) was **never corrected**, even after the
org moved to `starter` or `professional` (which both include `knowledge_base`).

**Confirmed in production:**
- Org "Familia Rodríguez Saavedra" (id=30): plan=starter, knowledge_base=false (system-seeded)
- Org "A3servicio_prueba" (id=29): plan=professional, 8 modules incorrectly false

Result: 403 `module_disabled` on all affected module routes despite plan allowing them.

## The fix

### FIX-AB — conditional DO UPDATE
```sql
ON CONFLICT (org_id, module_slug) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  WHERE module_configs.updated_by = 'system-fix-ab'
```

- System-seeded rows (`updated_by = 'system-fix-ab'`) → always updated to reflect current plan
- Admin-explicit rows (`updated_by = clerk_user_id`) → never touched

### FIX-AF — one-shot repair migration
Bulk UPDATE to re-enable all modules for orgs where:
1. `updated_by = 'system-fix-ab'` (system seed, not admin override)
2. `is_enabled = false`
3. The org's current plan includes the module

Runs on every startup but only acts when stale rows exist.

## Key rule going forward

**Why:** `updated_by = 'system-fix-ab'` is the ownership marker for system-managed rows.
Any row with a different `updated_by` is an admin override — never overwrite it.

**How to apply:**
- All system seeds in startup migrations must set `updated_by = 'system-fix-ab'`
- Use `ON CONFLICT DO UPDATE WHERE updated_by = 'system-fix-ab'` pattern for idempotent seeds
- New module slugs added to `ALL_SLUGS` automatically get seeded on next restart

## Production impact (next deploy)
FIX-AF repairs:
- 3 rows for org 30 (knowledge_base, portal_cliente, quotes)
- 8 rows for org 29 (ai_agents, automations, knowledge_base, omni_accounting, omni_docs, portal_cliente, quotes, whatsapp)
