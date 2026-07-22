---
name: Auditoría global de permisos — bugs estructurales corregidos
description: Dos bugs sistémicos que causaban 403 para todos. Documentados para no repetirlos.
---

## Bug 1 — Permisos fantasma (permisos usados en rutas pero no definidos en el tipo ni en roles)

**Regla:** Cualquier string usado en `requirePermission("x.y")` DEBE estar en:
1. El tipo `Permission` en `middlewares/permissions.ts`
2. Al menos un rol en `PERMISSIONS_BY_ROLE`

Si falta en cualquiera de los dos → 403 para TODOS, sin excepción.

**Permisos añadidos en la auditoría:**
- `automations.read` / `automations.write` — Autopilot (todas las operaciones CRUD)
- `workspace.manage` — Invitaciones (POST /invitations) + Diagnósticos fix (POST /:id/fix)

**Cómo detectarlo:** `grep -rn "requirePermission(" src/routes/ | grep -o '"[^"]*"' | sort -u`
y comparar contra el tipo `Permission`.

## Bug 2 — isSuperAdmin nunca se fijaba fuera de requireSuperAdmin

**Regla:** `req.isSuperAdmin` debe fijarse en `resolveOrg` (auth.ts), NO solo en `requireSuperAdmin`.

**Por qué:** `requirePermission` hace `if (req.isSuperAdmin) return true` como bypass.
Si la ruta no usa `requireSuperAdmin` en su cadena, el flag nunca se fija → el SUPER_ADMIN
pasa por la comprobación de roles normal y falla igual que cualquier otro usuario.

**Fix aplicado:** `resolveOrg` llama a `hasPlatformRole(clerkUserId)` (cacheado 5 min)
y fija `req.isSuperAdmin = true` si es SUPER_ADMIN o STAFF_OMNITECH. Aplica a TODAS las rutas.

## Regla de logging 403

Cada rechazo en `requirePermission` ahora loguea y responde con:
- `user` (clerkUserId)
- `role` (orgRole/effectiveRole)
- `orgId`
- `endpoint` (METHOD + URL)
- `permission` (la clave que faltaba)
- `reason` (texto legible)

**Why:** Un 403 sin contexto es indebuggable. Con contexto se resuelve en segundos.
