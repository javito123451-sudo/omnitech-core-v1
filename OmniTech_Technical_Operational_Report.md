# OmniTech Core — Informe Técnico y Operativo Completo
## Preparación para Primer Cliente Real · 17 de junio de 2026

---

## ÍNDICE

1. [Sistema de Autenticación](#1-sistema-de-autenticación)
2. [Sistema de Organizaciones y Workspaces](#2-sistema-de-organizaciones-y-workspaces)
3. [Super Admin y Jerarquía de Roles](#3-super-admin-y-jerarquía-de-roles)
4. [Manual de Módulos](#4-manual-de-módulos)
5. [Arquitectura Multi-Tenant](#5-arquitectura-multi-tenant)
6. [Registro de Riesgos](#6-registro-de-riesgos)
7. [Manual Operativo para Fran](#7-manual-operativo-para-fran)

---

## 1. Sistema de Autenticación

### ¿Qué sistema utiliza?

**Proveedor:** Clerk (identidad y sesiones)  
**Modo actual:** Development — aviso naranja visible en pantalla de login. Requiere cambio a Production keys antes de lanzar con clientes reales.

```
Clerk gestiona:   Identidad (quién eres)
OmniTech gestiona: Autorización (qué puedes hacer y dónde)
```

### Servicios implicados

| Servicio | Paquete | Función |
|----------|---------|---------|
| Clerk Backend | `@clerk/express` | Valida JWTs, extrae `userId` |
| Clerk Frontend | `@clerk/react` | Sesión en UI, hooks `useUser()` / `useAuth()` |
| Express middleware | `requireAuth` | Bloquea rutas sin sesión válida |
| Express middleware | `resolveOrg` | Inyecta `req.orgId` + `req.orgRole` |
| Express middleware | `requireSuperAdmin` | Bloquea rutas de Control Center |

**Archivos clave:**

| Archivo | Rol |
|---------|-----|
| `artifacts/api-server/src/middlewares/auth.ts` | `requireAuth` + `resolveOrg` |
| `artifacts/api-server/src/middlewares/superAdmin.ts` | `requireSuperAdmin` + `hasPlatformRole` |
| `artifacts/api-server/src/routes/auth.ts` | `GET /me` + `POST /setup-org` |
| `artifacts/omniflow/src/lib/orgContext.tsx` | Contexto React de sesión + org |
| `artifacts/omniflow/src/hooks/useSuperAdmin.ts` | Hook para verificar Super Admin en UI |

### Tablas implicadas en autenticación

| Tabla | Contenido |
|-------|-----------|
| `users` | Perfil local: email, nombre, avatar, status |
| `platform_roles` | Roles globales (SUPER_ADMIN, STAFF_OMNITECH) |
| `org_members` | Qué usuario pertenece a qué workspace + su rol |
| `organizations` | Workspaces registrados |
| `org_invitations` | Tokens de invitación para unirse a un workspace |
| `audit_logs` | Registro de todos los inicios de sesión |

### Flujo de autenticación completo

```
Usuario hace click en "Iniciar sesión"
    ↓
Clerk muestra formulario (Google / Email)
    ↓
Clerk valida credenciales → genera JWT
    ↓
Frontend: OrgProvider → GET /api/auth/me
    ↓
Backend requireAuth: extrae clerkUserId del JWT ──→ 401 si inválido
    ↓
Si usuario NO existe en tabla users → INSERT automático
Si usuario YA existe → actualiza perfil desde Clerk
    ↓
Busca membership en org_members
    ↓
Si tiene org  → { organization: { id, name, slug, plan, role } }
Si no tiene   → { organization: null }
    ↓
Frontend orgContext:
  organization != null → needsSetup = false → acceso al dashboard
  organization == null + isSuperAdmin → redirect /setup (crear workspace)
  organization == null + !isSuperAdmin → redirect /no-access ← FIX APLICADO
```

### ¿Qué ocurre cuando un usuario es invitado?

```
Super Admin → Control Center → Workspace → "Invitar usuario"
    ↓
POST /api/organizations/invitations → genera token UUID (24h expiración)
    ↓
Se envía URL: /invite/:token al email del usuario
    ↓
Usuario hace click → pantalla de confirmación (nombre del workspace, invitador)
    ↓
Usuario inicia sesión con Clerk (si no lo está)
    ↓
POST /api/invitations/:token/accept
  → crea usuario en tabla users si no existe
  → INSERT en org_members con el rol del token
  → marca invitación como aceptada
    ↓
Usuario entra directamente al workspace correcto → sin pasar por /setup
```

**Archivo:** `artifacts/api-server/src/routes/invitations.ts`  
**Página frontend:** `artifacts/omniflow/src/pages/invite.tsx`  
**Ruta:** `/invite/:token`

---

## 2. Sistema de Organizaciones y Workspaces

### Vocabulario

En OmniTech, **Organización = Workspace = Tenant**. Son sinónimos que apuntan a la misma tabla `organizations`.

### Cómo se crea un Workspace (estado actual — post-fix)

**Única forma permitida:** Super Admin via Control Center

```
Control Center → Workspaces → "Nuevo Workspace"
    ↓
POST /api/control-center/workspaces  ← requiere SUPER_ADMIN o STAFF
    ↓
INSERT en organizations (name, slug auto-generado)
    ↓
Workspace listo — sin usuarios todavía
```

**¿Puede un usuario normal crear un workspace?**  
**No.** `POST /api/auth/setup-org` ahora devuelve `403 setup_not_allowed` para cualquier usuario que no sea `SUPER_ADMIN`.

### Tablas del sistema de organizaciones

| Tabla | Columnas clave | Descripción |
|-------|---------------|-------------|
| `organizations` | `id, name, slug, plan, status` | Tabla maestra de workspaces |
| `org_members` | `org_id, user_id, role` | Membresías usuario↔workspace |
| `org_invitations` | `token, org_id, email, role, expires_at, accepted_at` | Invitaciones pendientes |
| `module_configs` | `org_id, module_slug, is_enabled` | Módulos activos por workspace |
| `license_plans` | `org_id, plan, seats, billing_cycle, valid_until` | Plan y licencia por workspace |
| `org_integrations` | `org_id, integration_slug, status, credentials_enc` | Telegram/WhatsApp por workspace |

### Estado actual de la BD

```
organizations:  1  →  OmniTech Core (org_id=8, plan=free, active)
org_members:    1  →  javito123451@gmail.com como owner
license_plans:  0  →  sin licencias asignadas (usa plan "free" por defecto)
module_configs: 0  →  sin configuración explícita (todos en estado por defecto)
```

---

## 3. Super Admin y Jerarquía de Roles

### Jerarquía completa

```
SUPER_ADMIN  (scope: platform, prioridad: 100)
    └── Acceso total: todos los workspaces, Control Center completo, suspend/activate

STAFF_OMNITECH  (scope: platform, prioridad: 90)
    └── Personal interno: acceso operativo a Control Center (sin acciones destructivas)

owner  (scope: org, prioridad: 80)
    └── Propietario de un workspace: gestiona usuarios, integra servicios

admin  (scope: org, prioridad: 70)
    └── Administrador del workspace: gestiona clientes y contenido

member  (scope: org, prioridad: 60)
    └── Usuario estándar del workspace

read_only  (scope: org, prioridad: 50)
    └── Solo lectura

CLIENT  (scope: client, prioridad: 10)
    └── Acceso externo del cliente final (sin acceso al CRM)
```

**Tabla de roles:** `role_catalog` (y `platform_roles` para roles globales)

### Super Admin actual

| Campo | Valor |
|-------|-------|
| Email | `javito123451@gmail.com` |
| Clerk ID | en tabla `platform_roles` |
| Rol | `SUPER_ADMIN` |
| is_active | `true` |
| Workspace propio | OmniTech Core (org_id=8) |

### Cómo acceder al modo Super Admin

1. Iniciar sesión como `javito123451@gmail.com`
2. En el sidebar izquierdo, parte inferior → click en **"Control Center"** (icono hexágono morado)
3. URL: `/control-center`

Si el botón no aparece en el sidebar, es porque la sesión de Clerk no corresponde a una cuenta con `SUPER_ADMIN` activo.

### Permisos del Super Admin

| Acción | Disponible |
|--------|:----------:|
| Ver todos los workspaces | ✅ |
| Crear workspaces | ✅ |
| Suspender / activar workspaces | ✅ |
| Suspender / activar usuarios | ✅ |
| Activar / desactivar módulos por workspace | ✅ |
| Asignar licencias | ✅ |
| Ver auditoría de toda la plataforma | ✅ |
| Crear backups | ✅ |
| Gestionar integraciones de plataforma | ✅ |
| Gestionar roles de plataforma | ✅ |
| Acceder al dashboard de IA | ✅ |
| Ver diagnósticos del sistema | ✅ |

### Qué falta por implementar

| Item | Estado | Prioridad |
|------|:------:|:---------:|
| Impersonación de workspace (ver como cliente) | ❌ No implementado | Media |
| Notificaciones de alerta al Super Admin | ❌ No implementado | Media |
| Panel de billing / facturación real | ❌ No implementado | Alta |
| Onboarding guiado para nuevos workspaces | ❌ No implementado | Media |
| Clerk en modo Production | ⚠️ Pendiente | **Crítica** |

---

## 4. Manual de Módulos

### Catálogo de Módulos

| Slug | Nombre visible | Siempre activo | Descripción |
|------|---------------|:--------------:|-------------|
| `crm` | CRM | ✅ Sí | Gestión de clientes y relaciones |
| `whatsapp` | WhatsApp Business | No | Mensajería y automatizaciones |
| `omni_import_ai` | Omni Import AI | No | Importación inteligente de datos |
| `omni_docs` | Omni Docs | No | Gestión documental |
| `omni_security` | Omni Security Core | No | Seguridad y auditoría avanzada |
| `omni_marketing` | Omni Marketing Hub | No | Campañas y automatización |
| `analytics` | Analytics | No | Análisis avanzado de datos |
| `automations` | Automations | No | Flujos de trabajo automatizados |
| `ai_agents` | AI Agents | No | Agentes de IA personalizados |

> **CRM es el único módulo obligatorio** — no puede desactivarse (`alwaysOn: true`).

### Archivos implicados en el sistema de módulos

| Archivo | Función |
|---------|---------|
| `artifacts/api-server/src/routes/control-center.ts` líneas 258-290 | API CRUD de módulos |
| `artifacts/api-server/src/middlewares/requireModule.ts` | Middleware que bloquea rutas si módulo inactivo |
| `artifacts/omniflow/src/pages/control-center/modules.tsx` | UI de gestión de módulos |
| Tabla `module_configs` | Estado activo/inactivo por (org_id, module_slug) |

**Cache:** Los estados de módulos se cachean **2 minutos** en memoria del servidor. Al activar/desactivar, el cambio tarda hasta 2 minutos en propagarse.

### Activar un módulo

**Ruta:** `Control Center → Módulos`  
**Pantalla:** `/control-center/modules`

1. En la vista **"Por Módulo"** — selecciona el módulo del catálogo superior
2. Verás la lista de workspaces con su estado actual (activo/inactivo)
3. Click en el toggle del workspace donde quieres activarlo
4. El cambio se guarda inmediatamente (sin botón de guardar)

**Alternativa — vista "Por Organización":**
1. Haz click en el tab **"Por Organización"**
2. Expande el workspace del cliente
3. Verás todos los módulos con su toggle
4. Activa / desactiva individualmente

**API directa:**
```
PATCH /api/control-center/modules
Body: { "orgId": 8, "moduleSlug": "whatsapp", "isEnabled": true }
Headers: Authorization: Bearer <token>
```

### Desactivar un módulo

Mismo proceso que activar — el toggle alterna el estado.

Al desactivar un módulo:
- El frontend **bloquea el acceso** a las rutas del módulo (devuelve 403)
- Los datos **no se eliminan** (son seguros y recuperables)
- El botón del menú lateral puede seguir visible si no hay verificación de módulo en el componente de navegación

### Asignar módulos por Workspace

Cada módulo se activa/desactiva **individualmente por workspace**. No hay activación global — debes ir módulo a módulo o workspace a workspace.

**Para activar todos los módulos a un nuevo workspace:**

1. `Control Center → Módulos → tab "Por Organización"`
2. Expande el workspace del cliente
3. Activa los módulos contratados uno por uno

**Módulos recomendados para cliente estándar:**

| Módulo | Incluir en plan básico |
|--------|:---------------------:|
| CRM | ✅ Siempre |
| WhatsApp Business | Según contrato |
| Analytics | Según contrato |
| AI Agents | Plan premium |
| Automations | Plan premium |

### Crear un nuevo módulo

Actualmente los módulos están hardcodeados en el catálogo dentro del backend:

```
Archivo: artifacts/api-server/src/routes/control-center.ts
Línea: 260 — array CATALOG
```

Para añadir un módulo nuevo:
1. Añadir entrada al array `CATALOG` con `{ slug, name, description, alwaysOn }`
2. Crear el middleware `requireModule("nuevo_slug")` en las rutas protegidas
3. Añadir la página/componente de UI correspondiente
4. Registrar la ruta en `App.tsx`

> No existe un sistema de creación de módulos desde la UI — requiere código.

### Ocultar módulos de un workspace

No existe una función de "ocultar" como tal. Las opciones son:
- **Desactivar** el módulo (el usuario recibirá 403 si intenta acceder)
- **No activar** el módulo (por defecto, todos están inactivos excepto CRM)

### Gestionar licencias

**Ruta:** `Control Center → Licencias` (`/control-center/licenses`)

Una licencia define:
- **Plan** (`starter`, `free`, `pro`, `enterprise`)
- **Seats** (número máximo de usuarios)
- **Ciclo de facturación** (`monthly`, `annual`)
- **Fecha de validez** (optional — sin fecha = sin expiración)

**Asignar licencia a un workspace:**

1. `Control Center → Licencias`
2. Localiza el workspace (los sin licencia aparecen como "starter/5 seats por defecto")
3. Click en **"Editar"** o **"Asignar"**
4. Selecciona plan, seats, ciclo, notas opcionales
5. Guarda

**API directa:**
```
POST /api/control-center/licenses
Body: {
  "orgId": 10,
  "plan": "pro",
  "seats": 10,
  "billingCycle": "monthly",
  "notes": "Cliente A — Plan Pro Mensual",
  "validUntil": "2027-06-17"
}
```

### Gestionar límites de uso

Los límites actuales están en el plan de licencia (campo `seats`). No existe un sistema de límites granular por módulo todavía — es una mejora futura.

---

## 5. Arquitectura Multi-Tenant

### Estructura actual y objetivo

```
OmniTech HQ
│
├── OmniTech Core (org_id=8)  ← workspace de Fran (Super Admin)
│     Telegram: Ava Omni ✅
│     WhatsApp: activo ✅
│
├── Cliente A (org_id=próximo)
│     Módulos: CRM, WhatsApp
│     Usuarios: 2
│
├── Cliente B (org_id=próximo+1)
│     Módulos: CRM, Analytics
│     Usuarios: 5
│
└── Cliente N ...
```

### Aislamiento de datos (Row-Level Isolation)

Cada tabla operativa incluye `org_id`. Todas las consultas filtran por `org_id` del usuario autenticado (inyectado por `resolveOrg` middleware).

| Tabla | Aislada por |
|-------|------------|
| `clients` | `org_id` |
| `messages` | `org_id` |
| `quotes`, `quote_items` | `org_id` |
| `appointments` | `org_id` |
| `ai_sessions`, `ai_messages` | `org_id` |
| `org_integrations` | `org_id` |
| `knowledge_base` | `org_id` |
| `agent_memory` | `org_id` |

Un usuario del workspace A **nunca ve** datos del workspace B. El `resolveOrg` middleware garantiza esto a nivel de API.

### Cómo crear un Workspace para un cliente

```
1. Control Center → Workspaces → "Nuevo Workspace"
2. Introducir: nombre del cliente (ej: "Empresa García S.L.")
3. OmniTech genera slug automáticamente
4. Workspace creado → aparece en la lista
5. Accede al workspace → "Ver detalle" para gestionar
```

**Endpoint:** `POST /api/control-center/workspaces`  
**Archivo:** `artifacts/api-server/src/routes/control-center.ts` línea 138  
**Página:** `artifacts/omniflow/src/pages/control-center/workspaces.tsx`

### Cómo crear e invitar usuarios al workspace

```
1. Control Center → Workspaces → click en el workspace del cliente
2. Sección "Usuarios" → "Invitar usuario"
3. Introduce: email del usuario, rol (owner/admin/member/read_only)
4. Se genera token de 24h
5. Comparte el link /invite/:token con el usuario
6. El usuario:
   a. Abre el link
   b. Inicia sesión / crea cuenta en Clerk
   c. Acepta la invitación
   d. Entra directamente al workspace del cliente
```

**Notas importantes:**
- Un usuario **solo puede pertenecer a un workspace** a la vez (restricción actual)
- Si el usuario ya tiene otro workspace, la aceptación devuelve `409` con el mensaje de error
- Las invitaciones expiran en **24 horas**
- Si expiran, el Super Admin debe generar una nueva

**Archivos:**  
- Creación: `artifacts/api-server/src/routes/control-center.ts` (endpoint de invitaciones dentro de workspaces)  
- Aceptación: `artifacts/api-server/src/routes/invitations.ts`  
- Página frontend: `artifacts/omniflow/src/pages/invite.tsx`

### Cómo evitar organizaciones duplicadas

**Medidas implementadas (post-fix):**

| Capa | Protección |
|------|-----------|
| Backend API | `POST /setup-org` → 403 para no-SuperAdmins |
| Frontend ProtectedRoute | `needsSetup + !isSuperAdmin` → redirect `/no-access` |
| Frontend Setup page | `!isSuperAdmin` → bloquea formulario visualmente |
| Invitation accept | Verifica que el usuario no tenga ya un workspace |

### Cómo asegurar que los usuarios entren en el workspace correcto

1. **Con invitación:** el token lleva embebido el `org_id` → el usuario entra directamente al workspace correcto
2. **Sin invitación:** imposible entrar al workspace (solo ven `/no-access`)
3. **Sesiones activas:** `resolveOrg` inyecta el `org_id` en cada request → no hay posibilidad de acceder a otro workspace

---

## 6. Registro de Riesgos

> Estado **antes del fix aplicado** — documentado para referencia histórica.  
> Los marcados con ✅ están mitigados con el fix del 17/06/2026.

### Riesgos de arquitectura (ahora mitigados)

| # | Riesgo | Probabilidad | Impacto | Estado |
|---|--------|:------------:|:-------:|:------:|
| R-01 | Cualquier login Clerk → nueva org automática | 🔴 Certeza | Alto | ✅ CERRADO |
| R-02 | Usuarios sin workspace ven formulario setup | 🔴 Certeza | Alto | ✅ CERRADO |
| R-03 | `POST /setup-org` sin control de acceso | 🔴 Certeza | Alto | ✅ CERRADO |
| R-04 | Ghost users auto-creados (user_id=9) | 🔴 Certeza | Medio | ✅ CERRADO |

### Riesgos activos (pendientes)

| # | Riesgo | Probabilidad | Impacto | Acción requerida |
|---|--------|:------------:|:-------:|:-----------------|
| R-05 | Clerk en modo Development → límites en producción | 🔴 Alta | **Crítico** | Cambiar a Production keys antes de lanzar |
| R-06 | `INTEGRATION_ENCRYPTION_KEY` no configurado → tokens en base64 | 🟡 Media | Alto | Configurar variable de 64 hex chars |
| R-07 | `WHATSAPP_BUSINESS_PHONE_ID` no configurado → envío falla | 🔴 Alta | Alto | Configurar en panel de variables |
| R-08 | Sin rate limiting en rutas de Control Center | 🟡 Media | Medio | Añadir middleware de rate limit |
| R-09 | Un usuario = un workspace (no multi-workspace) | 🟡 Media | Medio | Diseñar flujo multi-workspace si se necesita |
| R-10 | Invitaciones expiran en 24h → requiere reenvío manual | 🟢 Baja | Bajo | Aumentar TTL o añadir reenvío automático |
| R-11 | Sin sistema de billing real (licencias manuales) | 🟡 Media | Alto | Integrar Stripe / sistema de facturación |

### Riesgos si se siguen creando usuarios sin el fix

> **Ya no aplicables** — el fix está en producción. Para referencia histórica:

- Cada login nuevo genera 1 registro en `users` → ruido en BD
- Si el usuario llega a `/setup` → nueva org creada → datos fragmentados
- Las integraciones Telegram/WhatsApp NO se copian a la nueva org → bots no funcionan en la nueva org
- Las org duplicadas no se eliminan automáticamente → limpieza manual requerida

---

## 7. Manual Operativo para Fran

### Paso 0 — Antes de todo: acceder a la plataforma

1. Abre el navegador y ve a la URL de OmniTech Core
2. Pantalla: **"Bienvenido a OmniTech Core — Inicia sesión"**
3. Usa: `javito123451@gmail.com` (tu cuenta de Super Admin)
4. Método recomendado: **Continue with Google** (más rápido)
5. Llegarás al **Dashboard principal** del workspace OmniTech Core

---

### Paso 1 — Entrar como Super Admin

Desde el Dashboard:

1. En el sidebar izquierdo, desplázate hasta la parte inferior
2. Busca el botón **"Control Center"** (icono hexágono, color violeta)
3. Click → se abre el **Control Center** con layout diferente (fondo más oscuro)
4. URL: `/control-center`

Verás en la barra lateral izquierda del Control Center:

```
PLATAFORMA
  ├── Dashboard
  ├── Workspaces
  ├── Usuarios
  └── Roles

SISTEMA
  ├── Módulos
  ├── IA
  ├── Integraciones
  └── Licencias

OPS
  ├── Seguridad
  ├── Auditoría
  ├── Backups
  └── Diagnóstico
```

---

### Paso 2 — Crear un Workspace para un cliente

1. `Control Center → Workspaces` (sidebar)
2. Pantalla: lista de todos los workspaces
3. Click en **"Nuevo Workspace"** (botón superior derecho)
4. Introduce el nombre del cliente: ej. `"Empresa García S.L."`
5. Click en **Crear**
6. El workspace aparece en la lista con `status: active`

**Resultado en BD:**
```sql
INSERT INTO organizations (name, slug, plan) 
VALUES ('Empresa García S.L.', 'empresa-garcia-sl-abc12', 'free');
```

---

### Paso 3 — Crear y configurar el cliente dentro del workspace

El workspace recién creado está vacío. Para configurarlo:

1. En la lista de Workspaces, click en **"Ver detalle"** del workspace recién creado
2. URL: `/control-center/workspaces/<id>`
3. Desde esta pantalla puedes:
   - Ver los datos del workspace
   - Invitar usuarios
   - Ver módulos activos
   - Ver licencia asignada

Para añadir el perfil de empresa del cliente, el usuario owner del workspace lo completa desde su propio **Settings** (`/settings`).

---

### Paso 4 — Crear usuarios e invitarlos al workspace

1. En la pantalla de detalle del workspace → sección **"Usuarios"**
2. Click en **"Invitar usuario"**
3. Introduce:
   - **Email** del usuario del cliente
   - **Rol**: `owner` (si es el responsable del cliente) o `member`
4. Se genera un **link de invitación** válido 24 horas
5. Copia el link y envíaselo al usuario por email / WhatsApp

**El usuario recibe el link y:**
1. Abre el link → página `/invite/:token`
2. Ve: nombre del workspace, quién lo invitó, rol asignado
3. Inicia sesión / crea cuenta
4. Click en **"Aceptar invitación"**
5. Entra directamente al workspace del cliente

**Si el usuario ya tiene cuenta de Clerk** — solo acepta, no necesita crear una nueva.

---

### Paso 5 — Activar módulos para el workspace del cliente

1. `Control Center → Módulos` (sidebar)
2. Selecciona el tab **"Por Organización"**
3. Busca el workspace del cliente y expándelo
4. Activa los módulos contratados con el toggle:

**Módulos recomendados por tipo de cliente:**

| Tipo de cliente | Módulos a activar |
|----------------|------------------|
| CRM básico | CRM (siempre activo) |
| CRM + WhatsApp | CRM + WhatsApp Business |
| CRM + IA | CRM + AI Agents + Automations |
| Completo | Todos excepto los que no apliquen |

5. Los cambios se aplican en máximo **2 minutos** (caché del servidor)

---

### Paso 6 — Desactivar módulos

Mismo proceso que activar — el toggle apaga el módulo.

Al desactivar:
- El módulo devuelve `403 Módulo no disponible` si el usuario intenta acceder
- Los datos del módulo se conservan en BD (no se eliminan)
- Puede reactivarse en cualquier momento

---

### Paso 7 — Gestionar permisos de usuarios

**Roles disponibles dentro de un workspace:**

| Rol | Acceso |
|-----|--------|
| `owner` | Acceso completo al workspace, puede invitar usuarios |
| `admin` | Gestión de clientes y contenido, sin acceso a configuración crítica |
| `member` | Uso normal de módulos activos |
| `read_only` | Solo lectura en todos los módulos |

**Para cambiar el rol de un usuario:**

1. `Control Center → Usuarios` (sidebar)
2. Busca el usuario
3. Click en **"Editar"** → cambia el rol
4. Guarda

O desde el detalle del workspace: sección Usuarios → editar rol.

---

### Paso 8 — Asignar licencia al workspace del cliente

1. `Control Center → Licencias` (sidebar)
2. Busca el workspace del cliente (aparece con "starter" por defecto si no tiene licencia)
3. Click en **"Asignar"** o **"Editar"**
4. Selecciona:
   - **Plan:** `starter` / `free` / `pro` / `enterprise`
   - **Seats:** número de usuarios permitidos
   - **Ciclo:** mensual / anual
   - **Notas:** referencia del contrato (opcional)
   - **Válido hasta:** fecha de expiración (opcional)
5. Guarda

**Nota:** El campo `seats` no bloquea usuarios automáticamente todavía — es informativo. En el roadmap está añadir enforcement automático.

---

### Paso 9 — Acceder a cualquier Workspace (supervisión)

Actualmente no existe impersonación directa. Para supervisar un workspace:

1. `Control Center → Workspaces → click en "Ver detalle"`
2. Ves: usuarios, módulos, integraciones, licencia, actividad reciente del workspace
3. URL: `/control-center/workspaces/<id>`

Para ver datos operativos del workspace (clientes, mensajes, etc.) necesitarías estar como miembro de ese workspace. **Esto es una mejora pendiente** (función "ver como cliente").

---

### Paso 10 — Supervisar toda la plataforma

**Dashboard global:** `Control Center → Dashboard`

Muestra:
- Total workspaces activos / suspendidos
- Total usuarios registrados
- Total clientes en toda la plataforma
- Total mensajes procesados
- Agentes IA activos / Automatizaciones activas
- Últimas actividades y alertas de seguridad

**Auditoría completa:** `Control Center → Auditoría`

Logs de todas las acciones: logins, creación de workspaces, cambios de módulos, invitaciones, etc. Filtrable por fecha, tipo de acción, workspace, usuario.

**Diagnóstico del sistema:** `Control Center → Diagnóstico`

Estado de la BD, migraciones, integridad de datos.

**Backups:** `Control Center → Backups`

Backups manuales y programados. Backup más reciente: `OmniTech_Pre_Consolidation_Backup_20260617_133808.dump` (30MB).

**Seguridad:** `Control Center → Seguridad`

Lista de vulnerabilidades conocidas y su estado (open/mitigated).

---

## Resumen: Estado actual de OmniTech Core

| Aspecto | Estado |
|---------|:------:|
| Autenticación (Clerk) | ✅ Funcional — pendiente cambio a Production keys |
| Bug auto-creación de orgs | ✅ Cerrado (fix 17/06/2026) |
| Un único workspace (OmniTech Core) | ✅ Confirmado |
| Un único Super Admin (javito@gmail.com) | ✅ Confirmado |
| Telegram activo | ✅ Bot "Ava Omni" en OmniTech Core |
| WhatsApp activo (webhook) | ✅ Activo — envío pendiente de PHONE_ID |
| Sistema de invitaciones | ✅ Funcional |
| Control Center completo | ✅ Funcional |
| Gestión de módulos | ✅ Funcional |
| Gestión de licencias | ✅ Funcional (manual) |
| Aislamiento de datos multi-tenant | ✅ Implementado vía org_id |
| **Listo para primer workspace cliente** | **✅ SÍ** |

---

## Próximos pasos recomendados antes del primer cliente

| Prioridad | Tarea | Tiempo estimado |
|:---------:|-------|:---------------:|
| 🔴 1 | Configurar Clerk en modo Production (cambiar keys) | 30 min |
| 🔴 2 | Configurar `WHATSAPP_BUSINESS_PHONE_ID` | 10 min |
| 🟡 3 | Configurar `INTEGRATION_ENCRYPTION_KEY` | 10 min |
| 🟡 4 | Crear el workspace del primer cliente | 5 min |
| 🟡 5 | Invitar al usuario del primer cliente | 5 min |
| 🟡 6 | Activar módulos para el cliente | 5 min |
| 🟢 7 | Asignar licencia al workspace del cliente | 5 min |

---

*Informe generado el 17 de junio de 2026 — OmniTech Core v1.0-rc1*  
*Auditor: OmniTech Agent — Revisión técnica completa del sistema*
