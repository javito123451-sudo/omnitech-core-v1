# OmniTech Core — Architecture & Auth Analysis Report
## Problema: Auto-creación de organizaciones en nuevos logins
### Informe Técnico Completo · 17 de junio de 2026

---

## Resumen del Problema

Cada vez que **cualquier cuenta Clerk inicia sesión**, el sistema:
1. Crea automáticamente un registro de usuario en la BD
2. Detecta que no tiene organización
3. Redirige al formulario `/setup`
4. Permite crear una organización completamente nueva sin restricciones

Esto viola el modelo deseado: una sola plataforma multi-tenant donde los usuarios entran por invitación a un workspace ya existente.

---

## 1. Sistema de Autenticación

**Proveedor: Clerk**

| Componente | Detalle |
|------------|---------|
| SDK backend | `@clerk/express` — `getAuth(req)` extrae el `userId` del JWT |
| SDK frontend | `@clerk/react` — hooks `useUser()`, `useAuth()`, `getToken()` |
| Tipo de sesión | JWT Bearer token — enviado en `Authorization: Bearer` + cookie `__session` |
| Configuración | `CLERK_SECRET_KEY` (backend) + `VITE_CLERK_PUBLISHABLE_KEY` (frontend) |
| Modo actual | ⚠️ **Development** — aviso visible en la pantalla de login |

**Clerk gestiona SOLO la identidad** (quién es el usuario). La autorización (a qué workspace pertenece, qué rol tiene) la gestiona completamente OmniTech Core en su propia BD.

---

## 2. Cómo se Crea una Organización Actualmente

### Endpoint responsable

```
POST /api/auth/setup-org
Archivo: artifacts/api-server/src/routes/auth.ts  línea 154
```

### Lógica completa

```typescript
// Cualquier usuario autenticado con Clerk puede llamar a este endpoint
authRouter.post("/setup-org", requireAuth, async (req, res) => {
  const { orgName } = req.body;          // Nombre libre, introducido por el usuario
  
  // Solo verifica que el usuario no tenga ya una org — no verifica ningún permiso más
  const existing = await db.select(...).where(eq(orgMembersTable.userId, user.id));
  if (existing.length > 0) {
    res.status(409).json({ error: "User already has an organization." });
    return;
  }
  
  // Crea la org con el nombre que el usuario quiera
  const [org] = await db.insert(organizationsTable).values({ name: orgName, slug, plan: "free" });
  
  // Se convierte automáticamente en "owner" de esa nueva org
  await db.insert(orgMembersTable).values({ orgId: org.id, userId: user.id, role: "owner" });
});
```

**No existe ningún control de acceso**: cualquier cuenta de Clerk puede crear una organización.

---

## 3. Trigger que Crea Automáticamente las Nuevas Organizaciones

El flujo completo paso a paso:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FLUJO ACTUAL — cualquier login dispara este flujo                      │
│                                                                          │
│  1. Usuario hace login con Clerk                                         │
│     ↓                                                                    │
│  2. Frontend: OrgProvider → GET /api/auth/me  (orgContext.tsx:79)       │
│     ↓                                                                    │
│  3. Backend: auth.ts:42 — si el usuario no existe en users → INSERT     │
│     → Nuevo registro creado en tabla users para CUALQUIER cuenta Clerk  │
│     ↓                                                                    │
│  4. Backend: busca membership en org_members → ninguno encontrado       │
│     → Devuelve { organization: null }                                    │
│     ↓                                                                    │
│  5. Frontend: orgContext.tsx:84 → needsSetup = !organization → true     │
│     ↓                                                                    │
│  6. Frontend: App.tsx:165 — ProtectedRoute detecta needsSetup=true      │
│     → navigate("/setup")                                                │
│     ↓                                                                    │
│  7. Frontend: setup.tsx — muestra formulario "Crea tu organización"     │
│     Usuario escribe cualquier nombre                                     │
│     ↓                                                                    │
│  8. Frontend: setup.tsx:36 → POST /api/auth/setup-org                   │
│     ↓                                                                    │
│  9. Backend: auth.ts:195 — INSERT en organizations + org_members        │
│     → NUEVA ORGANIZACIÓN CREADA SIN RESTRICCIONES                       │
│     ↓                                                                    │
│ 10. Frontend: redirect → /dashboard con la nueva org                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Archivos implicados en el flujo actual

| Archivo | Rol | Líneas clave |
|---------|-----|:------------:|
| `artifacts/api-server/src/routes/auth.ts` | Provisiona usuario + crea org | 42–52, 154–218 |
| `artifacts/api-server/src/middlewares/auth.ts` | Verifica sesión Clerk, no bloquea setup | 17–35 |
| `artifacts/omniflow/src/lib/orgContext.tsx` | `needsSetup = !organization` | 84 |
| `artifacts/omniflow/src/App.tsx` | `ProtectedRoute` → redirect `/setup` | 160–168 |
| `artifacts/omniflow/src/pages/setup.tsx` | Formulario libre de creación de org | 34–51 |

### Tablas implicadas

| Tabla | Qué ocurre |
|-------|-----------|
| `users` | INSERT automático en cada primer login de cualquier cuenta Clerk |
| `organizations` | INSERT cuando el usuario completa el formulario de setup |
| `org_members` | INSERT con `role: "owner"` al crear la org |
| `org_invitations` | ✅ Existe pero NO se usa en el flujo de setup — está desconectado |

---

## 4. Modelo Super Admin → Workspace → Usuarios

### Modelo actual (implementado pero roto)

```
platform_roles (SUPER_ADMIN)   →  acceso a Control Center
                                   pero NO bloquea crear nuevas orgs
        ↕
organizations                  →  creadas libremente por cualquier usuario
        ↕
org_members (owner/member)     →  asignados automáticamente al crear org
```

### El modelo existe en BD pero no se hace cumplir en el flujo de login:

- ✅ `platform_roles` tabla con `SUPER_ADMIN` existe
- ✅ `SuperAdminRoute` en frontend bloquea el Control Center a no-admins
- ✅ `org_invitations` tabla con tokens de invitación existe
- ❌ **El flujo de login no consulta si el usuario tiene invitación pendiente**
- ❌ **`/setup` no está protegida** — accesible por cualquier usuario autenticado
- ❌ **`POST /setup-org` no verifica** si el usuario está autorizado a crear orgs

---

## 5. Comportamiento Correcto de Usuarios Invitados

**Flujo de invitación existente** (tabla `org_invitations`, ruta `/invite/:token`):

```
Super Admin → POST /api/organizations/invitations → genera token
                ↓
           URL: /invite/:token
                ↓
           GET /api/invitations/:token → valida token, devuelve org
                ↓
           POST /api/invitations/:token/accept → INSERT en org_members
                ↓
           Usuario entra directamente en el workspace existente
```

Este flujo **YA ESTÁ IMPLEMENTADO** y funciona correctamente.  
El problema es que el usuario invitado **TAMBIÉN puede ir a `/setup` y crear otra org** si accede directamente sin usar el token.

---

## 6. Cambios Recomendados

### Objetivo final del modelo

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MODELO DESEADO                                                          │
│                                                                          │
│  OmniTech HQ (org principal)                                            │
│    ↑                                                                     │
│  Fran (javito123451@gmail.com)  ←  SUPER_ADMIN global                   │
│    │                                                                     │
│    ├── Puede crear Workspaces para clientes                              │
│    ├── Puede invitar usuarios a cualquier Workspace                      │
│    └── Los usuarios invitados entran SOLO al Workspace asignado         │
│                                                                          │
│  Usuario nuevo                                                           │
│    → Login con Clerk                                                     │
│    → Si tiene invitación pendiente → va a /invite/:token → join org     │
│    → Si NO tiene invitación → "Sin acceso" (NO /setup)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Cambio A — Backend: bloquear `POST /setup-org` a usuarios no autorizados

**Archivo:** `artifacts/api-server/src/routes/auth.ts`

```typescript
// CAMBIO: verificar que el usuario tiene una invitación válida aceptada
// O que es SUPER_ADMIN antes de crear una org nueva.

authRouter.post("/setup-org", requireAuth, async (req, res) => {
  // AÑADIR: verificar platform_role SUPER_ADMIN
  const [platformRole] = await db
    .select()
    .from(platformRolesTable)
    .where(and(
      eq(platformRolesTable.clerkUserId, clerkUserId),
      eq(platformRolesTable.isActive, true)
    ));

  const isSuperAdmin = platformRole?.role === "SUPER_ADMIN";

  // AÑADIR: verificar que viene de una invitación aceptada recientemente
  // (o simplemente bloquear a no-SuperAdmins por completo)
  if (!isSuperAdmin) {
    res.status(403).json({
      error: "setup_not_allowed",
      message: "Solo un Super Admin puede crear organizaciones. Usa un enlace de invitación para unirte a un workspace existente."
    });
    return;
  }
  
  // ... resto del handler sin cambios
});
```

---

### Cambio B — Frontend: `ProtectedRoute` no redirige a `/setup` indiscriminadamente

**Archivo:** `artifacts/omniflow/src/App.tsx`

```tsx
// CAMBIO: en lugar de redirect ciego a /setup,
// mostrar pantalla "Sin acceso — contacta con tu administrador"

function ProtectedRoute({ children }) {
  const { needsSetup, loading } = useOrg();
  const { isSuperAdmin, loading: adminLoading } = useSuperAdmin();

  useEffect(() => {
    if (!loading && !adminLoading && needsSetup) {
      if (isSuperAdmin) {
        setLocation("/setup");        // Solo SuperAdmin puede crear org
      } else {
        setLocation("/no-access");    // Resto: pantalla sin acceso
      }
    }
  }, [loading, adminLoading, needsSetup, isSuperAdmin]);
  // ...
}
```

---

### Cambio C — Nueva página `/no-access`

Una pantalla simple que muestra:
> *"No tienes acceso a ningún workspace. Solicita una invitación a tu administrador."*

Sin botón de crear organización.

---

### Cambio D — Clientes como Workspaces independientes

El modelo actual ya soporta esto: cada cliente puede tener su propio `org_id`.  
El Super Admin (Fran) usa el Control Center → Workspaces para crear la org del cliente y luego invita a los usuarios del cliente.

No requiere cambios de esquema — solo de flujo de onboarding.

---

## Riesgos si se Siguen Creando Usuarios Ahora

| Riesgo | Probabilidad | Impacto |
|--------|:------------:|:-------:|
| Cada login de una cuenta Clerk no invitada crea un `user` en BD | 🔴 **Certeza** | Bajo — solo ruido en la tabla |
| Si el usuario llega a `/setup`, crea una segunda organización | 🟡 Probable | **Alto** — duplica el workspace, datos fragmentados |
| Integraciones Telegram/WhatsApp **no** se copian a la nueva org | 🔴 Certeza | **Alto** — el nuevo workspace queda sin bots |
| El usuario sin org ve el formulario de setup sin ningún aviso | 🔴 Certeza | Medio — confusión de UX |
| Contaminación de `organizations`, `org_members`, datos demo | 🟡 Probable | Medio — hay que limpiar manualmente |

### Acción inmediata recomendada (antes de implementar la solución completa)

Como medida de emergencia, se puede desactivar el formulario de setup para que no se pueda crear nuevas organizaciones hasta que el fix esté implementado.

**Opción rápida (~10 minutos):** modificar `setup.tsx` para mostrar un mensaje de "Sistema en mantenimiento — contacta con el administrador" en lugar del formulario, bloqueando la creación de nuevas orgs mientras se implementa el fix completo.

---

## Resumen de Archivos a Modificar

| Archivo | Cambio | Prioridad |
|---------|--------|:---------:|
| `artifacts/api-server/src/routes/auth.ts` | Bloquear `POST /setup-org` a no-SuperAdmins | 🔴 Crítica |
| `artifacts/omniflow/src/App.tsx` | `ProtectedRoute` → `/no-access` si no es SuperAdmin | 🔴 Crítica |
| `artifacts/omniflow/src/pages/setup.tsx` | Bloquear UI para no-SuperAdmins (quick fix) | 🟡 Urgente |
| `artifacts/omniflow/src/pages/` | Crear página `no-access.tsx` | 🟡 Urgente |

## Resumen de Tablas Implicadas

| Tabla | Qué cambiar |
|-------|------------|
| `users` | Sin cambios — auto-provisioning está bien |
| `organizations` | Sin cambios de esquema — control vía API |
| `org_members` | Sin cambios de esquema |
| `org_invitations` | Sin cambios — el flujo de invitación ya funciona |
| `platform_roles` | Sin cambios — ya tiene la info necesaria |

---

*Informe generado el 17 de junio de 2026 — OmniTech Core v1.0-rc1*
