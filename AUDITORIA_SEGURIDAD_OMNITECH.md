# Auditoría de Seguridad — OmniTech Core
> Fecha: 29 Junio 2026
> Alcance: Middleware, rutas, DB schema, separación BackOffice/Cliente

---

## Resumen Ejecutivo

OmniTech Core tiene una **base de autorización funcional** con Clerk + middleware propio (`requireAuth`, `resolveOrg`, `requireSuperAdmin`, `requireModule`). El aislamiento multi-tenant está implementado vía `orgId` en casi todas las tablas y queries.

Sin embargo, se han identificado **gaps críticos** en granularidad de permisos, separación BackOffice/Portal, soporte multi-workspace por usuario, y potenciales fugas de datos en endpoints que no filtran correctamente.

---

## 1. Roles Actuales vs Roles Objetivo

### Roles Actuales
| Scope | Roles | Enforce |
|-------|-------|---------|
| Workspace (org_members) | `owner`, `admin`, `member`, `read_only` | `resolveOrg` → `req.orgRole` |
| Plataforma (platform_roles) | `SUPER_ADMIN`, `STAFF_OMNITECH` | `requireSuperAdmin` |

### Roles Objetivo (solicitado)
- `SUPERADMIN` — Control total + soporte
- `ADMINISTRADOR` — Gestión del workspace
- `VENDEDOR` — Acceso CRM + cotizaciones + clientes propios
- `CLIENTE` — Acceso solo a portal cliente

### Gaps Identificados
1. **No existe rol CLIENTE** — Los clientes usan token del Portal, no tienen cuenta de usuario real en el sistema.
2. **VENDEDOR no está modelado** — Solo hay `member` genérico. No se distingue vendedor de staff administrativo.
3. **Sin granular permissions** — No hay `crm.read`, `workspace.view`, etc. Solo se chequea `orgRole` y módulo activo.
4. **Super Admin bypassa TODO** — El `x-ws-override` da acceso total sin logging de supervisión ni modo auditado.

---

## 2. Aislamiento Multi-Tenant (orgId)

### Estado: ✅ Cubierto en la mayoría
- `clients`, `appointments`, `messages`, `quotes`, `accounting`, `autopilot`, `telegram`, `whatsapp` — TODOS filtran por `eq(table.orgId, orgId)`
- `stats`, `executive` — Filtran correctamente
- `control-center` — Rutas de SuperAdmin, **intencionalmente** cross-org (esperado)

### ⚠️ Problemas Encontrados
1. **`resolveOrg` solo permite 1 membership** — Si un usuario está en múltiples workspaces, solo ve el primero. No hay soporte para switch de workspace.
2. **`org_members` permite `role = 'owner'` único?** No hay constraint ni lógica que impida múltiples owners por org.
3. **No hay `workspace_id` / `company_id` como columnas independientes** — Solo existe `orgId` que actúa como workspace. No hay separación workspace vs company.

---

## 3. Separación BackOffice vs Cliente

### BackOffice (`/control-center/*`)
- Protegido por `requireSuperAdmin` ✅
- Rutas devuelven datos cross-org (esperado para SuperAdmin) ✅
- **Falta**: endpoint de soporte para que STAFF_OMNITECH entre a workspace de cliente sin ser SuperAdmin

### Portal Cliente (`/portal/*`)
- Token-based, sin Clerk auth ✅ (intencional)
- Filtra por `session.orgId` y `session.clientId` ✅
- **Falta**: rate limiting en endpoints de portal, validación de IP

### Rutas de la App Principal
- `/dashboard`, `/clients`, `/quotes`, etc. usan `requireAuth + resolveOrg` ✅
- **Falta**: No hay guardia de rol en frontend para ocultar funciones según rol de workspace

---

## 4. Middleware Actual

| Middleware | Función | Estado |
|-----------|---------|--------|
| `clerkMiddleware` | JWT validation | ✅ OK |
| `requireAuth` | Existe `clerkUserId` | ✅ OK |
| `resolveOrg` | Attaches `orgId`, `orgRole`, `userId` | ⚠️ Solo 1 org, sin multi-org |
| `requireSuperAdmin` | SUPER_ADMIN o STAFF_OMNITECH | ✅ OK |
| `requireModule(slug)` | Módulo activo por org | ✅ OK (fail-open, puede ser riesgo) |
| `requirePermission` | **NO EXISTE** | ❌ GAP CRÍTICO |

---

## 5. Schema de DB — Columnas Relevantes

| Tabla | Campos de Isolation | Estado |
|-------|---------------------|--------|
| `users` | `clerk_id`, `status` (active/suspended) | ✅ OK. Falta `workspace_id`, `company_id` |
| `organizations` | `id`, `slug`, `plan`, `status` | ✅ OK. Falta `company_id` |
| `org_members` | `org_id`, `user_id`, `role`, `is_suspended` | ⚠️ Sin granular permissions |
| `clients` | `org_id` | ✅ OK. Falta `assigned_seller`, `assigned_admin` |
| `platform_roles` | `clerk_user_id`, `role`, `is_active` | ✅ OK |

### Campos Faltantes (requeridos)
- `users.assigned_workspace_id` — workspace por defecto
- `users.assigned_company_id` — empresa matriz
- `users.seller_id` — si es vendedor, su ID propio
- `clients.assigned_admin` — admin asignado
- `clients.assigned_seller` — vendedor asignado
- `organizations.company_id` — para agrupar workspaces por empresa

---

## 6. Endpoints con Riesgo Potencial

| Endpoint | Riesgo | Detalle |
|----------|--------|---------|
| `GET /api/portal/invoices` | Bajo | Token-based, pero sin rate limit |
| `GET /api/portal/profile` | Bajo | Token-based, sin rate limit |
| `POST /api/portal/token` | Medio | Cualquier autenticado puede generar token para cualquier cliente de su org |
| `POST /api/whatsapp/webhook` | Medio | Public endpoint, potencial DoS sin rate limit |
| `POST /api/telegram/webhook` | Medio | Public endpoint, potencial DoS sin rate limit |
| `GET /api/control-center/metrics` | Bajo | Cross-org, pero protegido por SuperAdmin |
| `GET /api/health` | Ninguno | Público, solo status |

---

## 7. Frontend — Guards y Contexto

| Componente | Función | Estado |
|-----------|---------|--------|
| `useSuperAdmin()` | Fetch role plataforma | ✅ OK |
| `SuperAdminRoute` | Bloquea `/control-center/*` | ✅ OK |
| `ModuleGuard` | Oculta según módulo activo | ✅ OK |
| `useOrg()` | Provee org, user, modules | ⚠️ No provee `permissions` ni `role` granular |

---

## 8. Priorización de Acciones

### 🔴 CRÍTICO — Implementar en esta fase
1. **Crear middleware `requirePermission`** con permission registry
2. **Añadir campos faltantes a DB** (sin eliminar columnas existentes)
3. **Mejorar `resolveOrg`** para múltiples memberships
4. **Implementar Support Mode** para SuperAdmin en workspace cliente (auditado)

### 🟡 MEDIO — Próxima fase
5. Añadir granular permissions a rutas críticas (accounting, control-center)
6. Añadir `assigned_seller` a clients y filtrar vistas de vendedor
7. Rate limiting en portal público
8. Frontend guards según rol de workspace

### 🟢 BAJO — Futuro
9. Separar `company_id` de `workspace_id` en schema
10. Implementar RBAC completo con permisos por rol predefinidos

---

## Conclusión

La arquitectura actual **no está rota** — tiene aislamiento multi-tenant, roles plataforma, módulos y audit logs. Los gaps son de **granularidad y extensibilidad**, no de fallos de seguridad graves. El approach de "mejoras progresivas sin romper nada" es viable y seguro.

La siguiente fase debe centrarse en:
1. Permission registry + middleware
2. Campos de asignación en DB
3. Support mode auditado
4. Documentación de rutas con nuevos permisos
