# Manual de Usuario — Control Center SUPER_ADMIN
## OmniTech Core Platform · v2.0

---

## 1. Acceso al Control Center

### URL de acceso
```
https://[tu-dominio]/control-center
```
O desde el menú lateral del CRM → botón **"Control Center"** (visible solo para SUPER_ADMIN).

### Requisito de acceso
- Cuenta con rol `SUPER_ADMIN` asignado en la plataforma.
- El rol es gestionado en: **Control Center → Roles**.

---

## 2. Menú lateral del Control Center

El sidebar divide las secciones en tres grupos:

### CORE
| Sección | URL | Función |
|---------|-----|---------|
| Dashboard | `/control-center` | Vista general de la plataforma: KPIs, salud del sistema, logs recientes |
| Workspaces | `/control-center/workspaces` | Listar, crear, editar, suspender y eliminar workspaces |
| Usuarios | `/control-center/users` | Ver todos los usuarios de la plataforma, suspender, activar |
| Roles | `/control-center/roles` | Asignar/revocar roles `SUPER_ADMIN` y `STAFF_OMNITECH` |

### PLATAFORMA
| Sección | URL | Función |
|---------|-----|---------|
| Módulos | `/control-center/modules` | Activar/desactivar módulos por workspace |
| IA | `/control-center/ai-center` | Ver consumo de tokens, costes, presupuestos y alertas |
| Integraciones | `/control-center/integrations` | Estado de integraciones disponibles (WhatsApp, Telegram...) |
| Licencias | `/control-center/licenses` | Asignar planes (Starter/Professional/Enterprise) a cada workspace |

### SEGURIDAD
| Sección | URL | Función |
|---------|-----|---------|
| Seguridad | `/control-center/security` | Checklist de seguridad, configuración 2FA, política de contraseñas |
| Auditoría | `/control-center/audit` | Log completo de acciones administrativas con filtros |
| Backups | `/control-center/backups` | Estado y gestión de copias de seguridad |
| Diagnóstico | `/control-center/diagnostics` | Salud del sistema, roles activos, rutas habilitadas |

---

## 3. Permisos

| Acción | SUPER_ADMIN | STAFF_OMNITECH |
|--------|-------------|----------------|
| Ver Dashboard | ✅ | ✅ |
| Crear workspace | ✅ | ❌ |
| Suspender workspace | ✅ | ❌ |
| Eliminar workspace | ✅ | ❌ |
| Ver usuarios | ✅ | ✅ |
| Suspender usuario | ✅ | ❌ |
| Asignar roles de plataforma | ✅ | ❌ |
| Activar/desactivar módulos | ✅ | ✅ |
| Asignar licencias | ✅ | ❌ |
| Ver auditoría | ✅ | ✅ |
| Supervisar cualquier workspace | ✅ | ❌ |

---

## 4. Flujo: Crear el primer Workspace cliente

1. Ir a **Control Center → Workspaces**.
2. Pulsar el botón **"Nuevo Workspace"** (esquina superior derecha).
3. Introducir el **nombre** del cliente (ej: "Clínica García").
4. Pulsar **Crear** — el sistema genera automáticamente el slug.
5. El workspace aparece en la lista con estado **Activo** y plan **Free**.
6. Ir a **Licencias** → buscar el workspace → pulsar **"Asignar Licencia"**.
7. Seleccionar el plan (Starter / Professional / Enterprise), el número de seats y el ciclo de facturación.
8. Guardar — el workspace queda listo para recibir usuarios.

---

## 5. Flujo: Invitar usuarios a un Workspace

Una vez creado el workspace:

1. Ir a **Control Center → Workspaces** → clic en el workspace.
2. Pestaña **"Miembros"** → ver los usuarios actuales.
3. Para invitar un nuevo usuario:
   - El usuario debe registrarse en `/sign-up` o recibir un enlace de invitación.
   - El propietario del workspace puede invitar desde **Configuración → Equipo** dentro del CRM.
   - Como SUPER_ADMIN, puedes ver y gestionar membresías desde la pestaña Miembros del workspace.
4. Los roles dentro del workspace son: `owner`, `admin`, `member`, `read_only`.

---

## 6. Flujo: Activar módulos para un Workspace

Dos formas de activar módulos:

### Desde Módulos (vista global)
1. Ir a **Control Center → Módulos**.
2. Seleccionar vista **"Por Workspace"** o **"Por Módulo"**.
3. Localizar el workspace y el módulo deseado.
4. Pulsar el toggle para activar/desactivar.

### Desde detalle del Workspace
1. Ir a **Workspaces** → clic en el workspace.
2. Pestaña **"Módulos"**.
3. Activar o desactivar cada módulo individualmente.

**Módulos disponibles:**
- `CRM` — siempre activo, no se puede desactivar.
- `WhatsApp Business` — mensajería automática.
- `Omni Import AI` — importación inteligente de datos.
- `Omni Docs` — gestión documental.
- `Analytics` — estadísticas avanzadas.
- `Automations` — flujos automáticos.
- `AI Agents` — agentes de IA especializados.

---

## 7. Supervisar un Workspace (acceso directo al CRM)

Como SUPER_ADMIN puedes entrar en el CRM de cualquier workspace para supervisar su actividad:

1. Ir a **Workspaces** → clic en el workspace que quieras supervisar.
2. Pulsar el botón **"Supervisar CRM"** (icono ojo, color violeta).
3. Serás redirigido al **Dashboard del CRM** de ese workspace.
4. Un banner violeta en la parte superior indica: **"Modo supervisión: [Nombre del Workspace]"**.
5. Para salir: pulsar **"Salir"** en el banner → vuelves a la lista de workspaces.

> ⚠️ En modo supervisión, todas las acciones (crear clientes, enviar mensajes, etc.) se ejecutan en el workspace supervisado, NO en el tuyo propio.

---

## 8. Dashboard SaaS — Métricas principales

El Dashboard (`/control-center`) muestra en tiempo real:

- **Workspaces activos / suspendidos**
- **Usuarios totales en la plataforma**
- **Clientes registrados**
- **Mensajes procesados**
- **Presupuestos generados**
- **Estado de servicios**: Base de datos, OpenAI, WhatsApp, Clerk
- **Administradores de plataforma** activos
- **Últimas acciones** en el log de auditoría

---

## 9. Gestión de Licencias

Los planes disponibles:

| Plan | Precio | Seats | Módulos incluidos |
|------|--------|-------|------------------|
| Starter | Gratis | 3 | CRM básico, WhatsApp (100 msg/mes) |
| Professional | €49/mes | 10 | CRM completo, WhatsApp ilimitado, IA avanzada, Analytics |
| Enterprise | Personalizado | Sin límite | Todo en Professional + módulos personalizados, SLA, onboarding |

Para asignar: **Licencias** → botón **"Asignar"** junto al workspace → seleccionar plan → guardar.

---

## 10. Auditoría

El log de auditoría (`/control-center/audit`) registra automáticamente:

- Creación, modificación y eliminación de workspaces.
- Suspensión y activación de usuarios y workspaces.
- Asignación y revocación de licencias.
- Activación y desactivación de módulos.
- Cambios de roles de plataforma.

Filtros disponibles: por severidad (info / warning / critical), por workspace, por actor, por rango de fechas.

---

*Manual generado el 19 de junio de 2026 — OmniTech Core Platform*
