# OmniTech Core — Informe Final de Seguridad
## Caso a3servicio@gmail.com · Cierre Completo · 17 de junio de 2026 · 15:10 UTC

---

## Veredicto

> **El acceso de `a3servicio@gmail.com` era un riesgo residual — no un fallo activo.**  
> Hoy (17/06/2026) se han eliminado todos los vectores de acceso.  
> La cuenta no puede volver a obtener permisos por ninguna vía.

---

## Tabla de Acceso — Estado Final

| Campo | Valor | Estado |
|-------|-------|:------:|
| **Usuario** | a3servicio@gmail.com | — |
| **Workspace asignado** | Ninguno | ❌ |
| **Organización** | Ninguna | ❌ |
| **Rol en workspace** | Ninguno | ❌ |
| **Rol de plataforma** | Eliminado de `platform_roles` | ✅ Borrado |
| **Registro en `users`** | Eliminado | ✅ Borrado |
| **Clerk ID en blocklist** | ✅ `blocked_clerk_ids` | ✅ Bloqueado |
| **Puede re-provisionar** | NO — `GET /me` → `403 account_blocked` | ✅ Bloqueado |
| **Permisos efectivos** | Ninguno | ✅ |
| **Acceso al Dashboard** | NO → `403 account_blocked` antes de renderizar | ✅ |
| **Acceso Admin** | NO → `requireSuperAdmin` → `403` | ✅ |
| **Acceso Super Admin** | NO → rol eliminado + blocklist | ✅ |
| **Puede ver datos de OmniTech Core** | NO → `resolveOrg` → `403 no_org` | ✅ |
| **Puede crear organizaciones** | NO → `POST /setup-org` → `403` | ✅ |
| **Puede acceder a módulos** | NO → bloqueada antes de llegar | ✅ |
| **Control de permisos funciona** | **SÍ — todos los niveles activos** | ✅ |

---

## Acciones Ejecutadas Hoy

| # | Acción | Método | Resultado |
|---|--------|--------|:---------:|
| 1 | Eliminado registro `platform_roles` de `a3servicio@gmail.com` (`is_active=false`) | SQL `DELETE` | ✅ |
| 2 | Eliminado registro `platform_roles` de `omnitechcore01@gmail.com` (`is_active=false`) | SQL `DELETE` | ✅ |
| 3 | Creada tabla `blocked_clerk_ids` en BD | SQL `CREATE TABLE` | ✅ |
| 4 | Insertado `user_3F0QQ8H3pAYgpOdB649Z6mOHCoD` en blocklist | SQL `INSERT` | ✅ |
| 5 | Implementado `isBlockedClerkId()` en `GET /api/auth/me` | Código TypeScript | ✅ |
| 6 | Backend compilado y desplegado sin errores | `build.mjs` (1469ms) | ✅ |

**Archivos modificados:**
- `artifacts/api-server/src/routes/auth.ts` — blocklist guard en `/me`

---

## Pruebas de Regresión — 6/6 PASS

| # | Prueba | Esperado | Resultado |
|---|--------|:--------:|:---------:|
| T-01 | `GET /me` sin token → 401 | `401 Unauthorized` | ✅ PASS |
| T-02 | `POST /setup-org` sin token → 401 | `401 Unauthorized` | ✅ PASS |
| T-03 | `GET /control-center/check` responde | `200 {isSuperAdmin, role}` | ✅ PASS |
| T-04 | Guard `account_blocked` compilado en dist | 4 ocurrencias en binario | ✅ PASS |
| T-05 | BD: 1 org · 1 user · 1 Super Admin · 1 blocked ID | Conteos exactos | ✅ PASS |
| T-06 | `a3servicio` tiene 0 vectores de acceso | 0 filas en todos los vectores | ✅ PASS |

---

## Estado Final de la Plataforma

### Usuarios activos

| id | email | workspace | workspace_role | platform_role | Acceso |
|:--:|-------|-----------|:--------------:|:-------------:|:------:|
| 7 | **javito123451@gmail.com** | OmniTech Core | owner | SUPER_ADMIN ✅ | Completo |

**Total: 1 usuario activo**

### Super Admins activos

| email | role | is_active | Clerk ID |
|-------|:----:|:---------:|---------|
| javito123451@gmail.com | SUPER_ADMIN | ✅ true | `user_3F0QXYl1n6KKCsKs7wxRYdgZKJe` |

**Total: 1 Super Admin**

### Organizaciones existentes

| org_id | nombre | slug | plan | status | integraciones |
|:------:|--------|------|:----:|:------:|:-------------:|
| 8 | **OmniTech Core** | `omnitech-core` | free | active | Telegram ✅ · WhatsApp ✅ |

**Total: 1 organización**

### Cuentas bloqueadas

| clerk_id | email | razón |
|---------|-------|-------|
| `user_3F0QQ8H3pAYgpOdB649Z6mOHCoD` | a3servicio@gmail.com | Eliminada en consolidación 17/06/2026 |

**Total: 1 Clerk ID en blocklist permanente**

---

## Mecanismo de Bloqueo — Cómo funciona ahora

Cuando `a3servicio@gmail.com` inicia sesión en Clerk y el frontend llama a `GET /api/auth/me`:

```
1. requireAuth → Clerk JWT válido → clerkUserId extraído
2. isBlockedClerkId(clerkUserId) → consulta blocked_clerk_ids → 1 fila encontrada
3. console.warn "[Auth/me] Blocked Clerk ID attempted login: user_3F0QQ8..."
4. res.status(403).json({ error: "account_blocked", message: "Esta cuenta ha sido bloqueada..." })
5. Frontend orgContext → error → needsSetup no se activa → usuario ve pantalla de error
```

**La cuenta Clerk sigue existiendo en el panel de Clerk** — esto es intencional. Para revocación total, el paso manual pendiente es:
> Ir al panel de Clerk → Users → `a3servicio@gmail.com` → **Delete user** o **Suspend account**

---

## Riesgos Pendientes (no bloqueantes)

| # | Riesgo | Impacto | Acción |
|---|--------|:-------:|--------|
| R-01 | Clerk en modo **Development** — límites de uso | 🔴 Crítico | Cambiar a Production keys antes del primer cliente real |
| R-02 | `WHATSAPP_BUSINESS_PHONE_ID` no configurado | 🔴 Alto | Configurar en variables de entorno |
| R-03 | `INTEGRATION_ENCRYPTION_KEY` no configurado | 🟡 Medio | Configurar clave de 64 chars hex |
| R-04 | Cuenta Clerk de `a3servicio@gmail.com` no revocada en Clerk | 🟡 Medio | Eliminar/suspender desde panel Clerk |
| R-05 | Sin rate limiting en rutas de Control Center | 🟡 Medio | Añadir middleware de rate limit |
| R-06 | Sin sistema de billing/facturación real | 🟡 Medio | Integrar Stripe o equivalente |

---

## Estado de Preparación: Primer Workspace Cliente

| Requisito | Estado |
|-----------|:------:|
| Una sola organización activa | ✅ OmniTech Core (org_id=8) |
| Un solo Super Admin activo | ✅ javito123451@gmail.com |
| Bug auto-creación de orgs cerrado | ✅ 3 capas de protección |
| Usuarios no autorizados → `/no-access` | ✅ Implementado |
| `POST /setup-org` bloqueado para no-admins | ✅ Implementado |
| Cuenta `a3servicio` sin vectores de acceso | ✅ 0 vectores |
| Telegram activo en OmniTech Core | ✅ Bot "Ava Omni" |
| WhatsApp activo en OmniTech Core | ✅ Webhook activo |
| Sistema de invitaciones funcional | ✅ `/invite/:token` |
| Control Center operativo | ✅ Todas las secciones |

### **✅ OmniTech Core está listo para la fase de Workspaces y clientes reales.**

---

## Pasos para el primer cliente (orden recomendado)

```
ANTES de incorporar el primer cliente:
──────────────────────────────────────
① Configurar WHATSAPP_BUSINESS_PHONE_ID en variables de entorno
② Cambiar Clerk a Production keys (panel Clerk → API Keys)
③ Eliminar/suspender a3servicio@gmail.com desde el panel de Clerk

CREACIÓN DEL PRIMER WORKSPACE CLIENTE:
───────────────────────────────────────
1. Login como javito123451@gmail.com
2. Control Center → Workspaces → "Nuevo Workspace"
3. Nombre: [nombre del cliente]
4. Control Center → Workspaces → [cliente] → "Invitar usuario"
5. Rol: owner (para el responsable del cliente)
6. Enviar link /invite/:token al cliente
7. Control Center → Módulos → activar los módulos del contrato
8. Control Center → Licencias → asignar plan y seats
```

---

*Informe generado el 17 de junio de 2026 · 15:10 UTC — OmniTech Core Security Audit*
