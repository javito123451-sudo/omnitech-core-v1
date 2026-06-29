# Informe BackOffice + UX por Rol — OmniTech Core
> Fecha: 29 Junio 2026
> Fase: BackOffice, Dashboards por Rol, Pipeline, Onboarding, Soporte

---

## Resumen Ejecutivo

Se ha implementado la fase completa de BackOffice con dashboards específicos por rol, pipeline comercial, onboarding automático, gestión de planes y sistema de incidencias. Todo es **backward-compatible** y **no destructivo**.

## Funcionalidades Implementadas

### 1. Dashboard por Rol (/dashboard)
**Archivo:** `artifacts/omniflow/src/pages/role-dashboard.tsx`

- **Superadmin/Owner**: KPIs globales (clientes, pipeline, comisiones, miembros)
- **Administrador**: Vista de gestión con accesos rápidos
- **Vendedor**: Leads propios, clientes asignados, comisiones personales, pipeline personal
- **Cliente/Member**: Vista básica de workspace

**Backend:** `artifacts/api-server/src/routes/dashboard.ts`
- `GET /api/dashboard/role` → devuelve KPIs filtrados por rol efectivo
- Calcula conversiones, comisiones (10%), pipeline value, tickets abiertos

### 2. Dashboard Superadmin (/control-center)
Ya existente — se mantiene sin cambios. Redirección de home a `/control-center` para SUPER_ADMIN.

### 3. Dashboard Administrador (/dashboard)
Redirigido desde home para usuarios con rol `owner` o `admin`. Muestra:
- Clientes totales y activos
- Pipeline value y confirmed value
- Tasa de conversión
- Comisiones totales del equipo
- Miembros del workspace
- Accesos rápidos a gestión

### 4. Dashboard Vendedor (/dashboard)
Para rol `vendedor`. Muestra:
- Leads asignados (assigned_seller_id)
- Clientes activos propios
- Pipeline personal (filtrado por assignedToUserId)
- Comisiones personales (10% sobre quotes aceptados)
- Próximas citas
- Accesos rápidos a Mis Prospectos / Mis Clientes / Mis Comisiones

### 5. Dashboard Cliente (/portal)
Ya existente — portal de cliente con token. Sin cambios.

### 6. Sección Mis Clientes (/my-clients)
Ya implementada en fase anterior. Filtra por `assigned_admin_id`.

### 7. Mis Prospectos (/my-prospects)
Ya implementada en fase anterior. Filtra por `assigned_seller_id` + status=lead.

### 8. Mis Comisiones (/my-commissions)
Ya implementada en fase anterior. Calcula 10% sobre quotes aceptados.

### 9. Pipeline Comercial (/pipeline)
**Archivo:** `artifacts/omniflow/src/pages/pipeline.tsx`
**Backend:** `artifacts/api-server/src/routes/pipeline.ts`

- Tablero Kanban con 6 etapas: Lead → Contactado → Propuesta → Negociación → Cerrado (Ganado/Perdido)
- Drag & drop por botones (flechas izquierda/derecha)
- Filtros por vendedor
- Crear nuevas oportunidades (deals)
- Valor esperado y probabilidad de cierre por etapa

**Endpoints:**
- `GET /api/pipeline/stages` → listar etapas
- `GET /api/pipeline/deals` → listar deals con cliente
- `POST /api/pipeline/deals` → crear deal
- `PATCH /api/pipeline/deals/:id/stage` → mover entre etapas
- `POST /api/pipeline/stages` → crear etapa (admin)

### 10. Onboarding Automático (/onboarding)
**Archivo:** `artifacts/omniflow/src/pages/onboarding.tsx`
**Backend:** `artifacts/api-server/src/routes/onboarding.ts`

- Wizard paso a paso: Bienvenida → Perfil → Integraciones → Primer cliente → Primer presupuesto → Activado
- Barra de progreso visual
- Estados: `pending`, `in_progress`, `active`, `suspended`
- Skip opcional por paso

**Endpoints:**
- `GET /api/onboarding/status` → estado actual
- `POST /api/onboarding/progress` → avanzar paso

### 11. Gestión de Planes (/plans)
**Archivo:** `artifacts/omniflow/src/pages/plans.tsx`

- Comparativa visual Starter/Growth/Scale
- Módulos habilitados por plan
- Precios y límites de usuarios

### 12. Activación Dinámica de Módulos por Plan
Ya implementada en fase anterior (`/api/auth/me`). Planes:
- **Starter/Free**: CRM únicamente
- **Growth**: CRM + AI + Analytics + Integrations + Automations
- **Scale**: Todos los módulos

### 13. Estado del Onboarding
Columnas añadidas a `organizations`:
- `onboarding_status` (TEXT): pending, in_progress, active, suspended
- `onboarding_step` (INTEGER): 0-6
- `onboarding_completed_at` (TIMESTAMP)

### 14. Sistema de Incidencias y Soporte (/support)
**Archivo:** `artifacts/omniflow/src/pages/support.tsx`
**Backend:** `artifacts/api-server/src/routes/support.ts`

- Lista de tickets con filtros por estado
- Crear ticket con categoría y prioridad
- Estados: open, in_progress, resolved, closed
- Comentarios por ticket (con soporte para internos)
- Actualización de estado y asignación

**Endpoints:**
- `GET /api/support/tickets` → listar
- `GET /api/support/tickets/:id` → detalle con comentarios
- `POST /api/support/tickets` → crear
- `PATCH /api/support/tickets/:id` → actualizar estado/asignación
- `POST /api/support/tickets/:id/comments` → añadir comentario

---

## Migraciones de Base de Datos

**Archivo:** `lib/db/src/schema/migrations_backoffice.sql`

### Tablas creadas:
| Tabla | Propósito |
|-------|----------|
| `support_tickets` | Tickets de incidencias |
| `ticket_comments` | Comentarios por ticket |
| `pipeline_stages` | Etapas del Kanban comercial |
| `deals` | Oportunidades en pipeline |

### Columnas añadidas a `organizations`:
| Columna | Tipo | Default |
|---------|------|---------|
| `onboarding_status` | TEXT | 'pending' |
| `onboarding_step` | INTEGER | 0 |
| `onboarding_completed_at` | TIMESTAMP | NULL |

### Índices creados:
- `idx_support_tickets_org`, `idx_support_tickets_status`, `idx_support_tickets_assigned`
- `idx_ticket_comments_ticket`
- `idx_pipeline_stages_org`, `idx_pipeline_stages_order`
- `idx_deals_org`, `idx_deals_stage`, `idx_deals_assigned`

### Seed de etapas pipeline:
6 etapas por defecto creadas para todas las organizaciones existentes:
Lead(10%), Contactado(25%), Propuesta(50%), Negociación(75%), Cerrado Ganado(100%), Cerrado Perdido(0%)

---

## Archivos Modificados/Creados

### Backend (API Server)
| Archivo | Tipo | Líneas |
|---------|------|--------|
| `artifacts/api-server/src/routes/dashboard.ts` | Nuevo | ~180 |
| `artifacts/api-server/src/routes/pipeline.ts` | Nuevo | ~150 |
| `artifacts/api-server/src/routes/onboarding.ts` | Nuevo | ~100 |
| `artifacts/api-server/src/routes/support.ts` | Nuevo | ~200 |
| `artifacts/api-server/src/routes/index.ts` | Modificado | +4 rutas |
| `lib/db/src/schema/organizations.ts` | Modificado | +3 columnas |
| `lib/db/src/schema/support-tickets.ts` | Nuevo | ~50 |
| `lib/db/src/schema/pipeline.ts` | Nuevo | ~60 |
| `lib/db/src/schema/index.ts` | Modificado | +2 exports |

### Frontend (OmniFlow)
| Archivo | Tipo | Líneas |
|---------|------|--------|
| `artifacts/omniflow/src/pages/role-dashboard.tsx` | Nuevo | ~315 |
| `artifacts/omniflow/src/pages/pipeline.tsx` | Nuevo | ~260 |
| `artifacts/omniflow/src/pages/onboarding.tsx` | Nuevo | ~180 |
| `artifacts/omniflow/src/pages/support.tsx` | Nuevo | ~330 |
| `artifacts/omniflow/src/pages/plans.tsx` | Nuevo | ~170 |
| `artifacts/omniflow/src/App.tsx` | Modificado | +6 rutas, redirección |
| `artifacts/omniflow/src/components/layout/MainLayout.tsx` | Modificado | +4 nav items |

---

## Pruebas de Regresión

### Build
- ✅ Backend: Compila sin errores (esbuild)
- ✅ Frontend: Compila sin errores (Vite + TypeScript)
- ✅ TypeScript: `tsc --noEmit` sin errores

### Endpoints
- ✅ `GET /api/dashboard/role` → 401 (requiere auth, no 404)
- ✅ `GET /api/pipeline/stages` → 401
- ✅ `GET /api/pipeline/deals` → 401
- ✅ `GET /api/onboarding/status` → 401
- ✅ `GET /api/support/tickets` → 401

### Base de Datos
- ✅ Tablas creadas: support_tickets, ticket_comments, pipeline_stages, deals
- ✅ Columnas añadidas a organizations
- ✅ Índices creados
- ✅ Pipeline stages seedeados para org existente

### Funcionalidades existentes
- ✅ Login/Auth sin cambios
- ✅ Control Center sin cambios
- ✅ CRM, Presupuestos, Calendario sin cambios
- ✅ Integraciones (WhatsApp, Telegram) sin cambios
- ✅ Portal de cliente sin cambios

---

## Compatibilidad

- ✅ Todos los endpoints existentes funcionan igual
- ✅ Nuevas tablas no afectan queries existentes
- ✅ Nuevas columnas en organizations son nullable/con default
- ✅ Frontend legacy no se rompe (nuevas rutas son aditivas)
- ✅ Redirección home cambiada de `/executive-dashboard` a `/dashboard`

---

## Conclusión

La fase BackOffice añade:
- **4 dashboards por rol** (superadmin, admin, vendedor, cliente)
- **Pipeline comercial** con Kanban y 6 etapas
- **Onboarding automático** con 6 pasos y estados
- **Sistema de incidencias** con tickets y comentarios
- **Gestión de planes** con comparativa visual
- **Módulos dinámicos** por plan (ya implementado en fase anterior)

Todo respeta el aislamiento por workspace y la arquitectura de permisos granular existente.
