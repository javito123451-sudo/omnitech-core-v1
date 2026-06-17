# OmniTech Core — Telegram Ownership Investigation Report
## Sólo lectura · Sin modificaciones de datos

**Fecha:** 17 de junio de 2026  
**Método:** Consultas directas a PostgreSQL (SELECT solamente)  
**Alcance:** Toda la base de datos de producción — 3 organizaciones, 5 usuarios, 1 configuración Telegram  

---

## Resumen Ejecutivo

| Item | Resultado |
|------|-----------|
| Configuraciones Telegram en BD | **1** |
| Organizaciones con Telegram activo | **1 de 3** |
| Configuraciones conectadas (status = active) | **1** |
| Configuraciones huérfanas | **0** |
| Tokens únicos en uso | **1** (env var = DB token — idénticos) |
| Token almacenado cifrado | **NO** — base64 sin cifrar (riesgo de seguridad) |

---

## 1. Configuraciones Telegram en la Base de Datos

**Total encontradas: 1 fila en `org_integrations`**

| Campo | Valor |
|-------|-------|
| `config_id` | 7 |
| `org_id` | 8 |
| `integration_slug` | `telegram` |
| `status` | `active` ✅ |
| `display_name` | `Ava Omni` |
| `config` | NULL |
| `external_id` | NULL |
| `last_synced_at` | NULL |
| `error_message` | NULL |
| `has_token` | SÍ (`credentials_enc` presente) |
| Creada el | 2026-06-16 21:50:46 |
| Última actualización | 2026-06-16 23:19:13 |

---

## 2. Usuario Propietario de la Configuración

La tabla `org_integrations` **no tiene columna de usuario propietario directo** — la propiedad se determina cruzando el log de auditoría con los miembros del workspace.

### Quién conectó la integración (audit_logs)

| Evento | Actor (clerk_id) | Email | Acción | Display Name usado | Credenciales | Fecha |
|--------|-----------------|-------|--------|-------------------|:------------:|-------|
| 1ª conexión | `user_3F0QXYl1n6KKCsKs7wxRYdgZKJe` | *(no registrado en audit)* | `integration_connected` | `Omnitech_bot` | ✅ SÍ | 2026-06-16 21:50:46 |
| 2ª reconexión | `user_3F0QXYl1n6KKCsKs7wxRYdgZKJe` | *(no registrado en audit)* | `integration_connected` | `Ava Omni` | ❌ NO | 2026-06-16 23:19:13 |

**Resolución del clerk_id → usuario:**

Cruzando `user_3F0QXYl1n6KKCsKs7wxRYdgZKJe` con la tabla `users` y `org_members`:

| Campo | Valor |
|-------|-------|
| `user_id` (interno) | 7 |
| `clerk_id` | `user_3F0QXYl1n6KKCsKs7wxRYdgZKJe` |
| `email` | **javito123451@gmail.com** |
| `name` | Javilisto123 123 |
| `status` | `active` |
| Rol en el workspace | `owner` |
| Miembro desde | 2026-06-15 14:41:25 |

**→ El usuario propietario es `javito123451@gmail.com` (Javilisto123 123), único owner del workspace "Demos".**

> **Nota sobre la 2ª conexión:** La reconexión del 23:19 no incluyó nuevas credenciales (`hasCredentials: false`). El token original se conservó porque la lógica del backend usa `credentialsEnc ?? existing[0]?.credentialsEnc`. Solo se actualizó el `display_name` de `Omnitech_bot` a `Ava Omni`.

---

## 3. Workspace Propietario de la Configuración

| Campo | Valor |
|-------|-------|
| `org_id` | **8** |
| `name` | **Demos** |
| `slug` | `demos-0v5w7` |
| `plan` | `free` |
| `status` | `active` |
| Miembros | 1 |

### Miembros del workspace "Demos"

| user_id | email | nombre | rol | estado | desde |
|---------|-------|--------|-----|--------|-------|
| 7 | javito123451@gmail.com | Javilisto123 123 | `owner` | active | 2026-06-15 14:41:25 |

**Este workspace tiene un único miembro, que es también quien configuró el bot.**

---

## 4. Tokens de Bot Telegram Configurados

### Token en Base de Datos (`org_integrations.credentials_enc`)

El token está almacenado en **base64 sin cifrar** porque `INTEGRATION_ENCRYPTION_KEY` no está configurada en el entorno.

| Campo | Valor |
|-------|-------|
| Bot ID (parte numérica) | `8954008690` |
| Token completo (enmascarado) | `8954008690:AAGF••••••••••••••••••••••••••••••Bx0` |
| Longitud del token | 46 caracteres |
| Almacenamiento | ⚠️ Base64 sin cifrar |

### Token en Variable de Entorno (`Telegram_bot_token`)

| Campo | Valor |
|-------|-------|
| Nombre de la variable | `Telegram_bot_token` |
| Longitud | 46 caracteres |
| **Comparación con token de BD** | ✅ **IDÉNTICO** — mismo token en ambos lugares |

### Estado del cifrado

```
INTEGRATION_ENCRYPTION_KEY: NO CONFIGURADA

Consecuencia: las credenciales se almacenan como JSON en base64 puro.
Cualquier usuario con acceso a la BD puede leer el bot token con:
  SELECT credentials_enc FROM org_integrations WHERE integration_slug = 'telegram';
  | base64 -d
```

---

## 5. Configuración Marcada como Conectada

**Hay exactamente 1 configuración con `status = 'active'`:**

| config_id | org_id | org_name | status | display_name | Bot ID |
|:---------:|:------:|----------|:------:|:------------:|:------:|
| 7 | 8 | Demos | `active` ✅ | Ava Omni | 8954008690 |

### Actividad de la integración activa

Desde su conexión el 2026-06-16, el bot ha procesado:

| Tipo de evento | Cantidad | Primer evento | Último evento |
|----------------|:--------:|---------------|---------------|
| `message_received` | 37 | 2026-06-16 21:53:51 | 2026-06-17 12:52:33 |
| `ai_reply_sent` | 37 | 2026-06-16 21:53:53 | 2026-06-17 12:52:37 |
| `connected` | 3 | 2026-06-16 21:50:46 | 2026-06-16 23:19:13 |
| `contact_created` | 2 | 2026-06-17 07:55:33 | 2026-06-17 11:01:00 |
| `lead_detected` | 1 | 2026-06-17 07:59:47 | 2026-06-17 07:59:47 |
| `test_ok` | 1 | 2026-06-16 21:53:11 | 2026-06-16 21:53:11 |
| **TOTAL** | **81** | — | — |

**El bot está activo y procesando mensajes en tiempo real.**  
Últimos contactos detectados: Andres Felipe Arango, F.J. Rodriguez Tapi.

---

## 6. Acceso del Usuario Actualmente Autenticado

No es posible determinar qué usuario tiene sesión activa en este momento desde la base de datos sola (Clerk gestiona las sesiones en memoria, sin estado en la BD de la aplicación).

### Quién tiene acceso a esta configuración Telegram

| Usuario | Email | Rol | Acceso a config Telegram | Vía |
|---------|-------|-----|:------------------------:|-----|
| Javilisto123 123 | javito123451@gmail.com | `owner` de org 8 | ✅ **SÍ** | Miembro directo del workspace "Demos" |
| a3servicios servicios | a3servicio@gmail.com | `SUPER_ADMIN` | ✅ **SÍ** | Control Center (acceso a todos los workspaces) |
| OmniTech Core | omnitechcore01@gmail.com | `SUPER_ADMIN` | ✅ **SÍ** | Control Center (acceso a todos los workspaces) |

### Usuarios SIN acceso a esta configuración

| Usuario | Email | Orgs | Motivo |
|---------|-------|------|--------|
| *(user 4 / user 6 como miembro de org)* | — | OmniTech Demo (org 10), Piloto Clientes (org 20) | No son miembros de org 8 y no tienen rol SUPER_ADMIN |

> **Nota sobre los Super Admins:** `a3servicio@gmail.com` y `omnitechcore01@gmail.com` son SUPER_ADMIN del sistema pero **no están registrados como miembros** del workspace "Demos" (org 8). Pueden acceder a la configuración de Telegram solo a través del Control Center (`/control-center/integrations`), no desde el panel de integraciones del CRM.

---

## 7. Configuraciones Huérfanas

### Definición 1: Config Telegram con workspace sin miembros

```sql
-- org_integrations WHERE integration_slug = 'telegram'
-- AND NOT EXISTS (SELECT 1 FROM org_members WHERE org_id = oi.org_id)
```

| Resultado | Filas devueltas |
|-----------|:---------------:|
| Orgs con Telegram y **cero miembros** | **0** — ninguna huérfana |

### Definición 2: Eventos Telegram sin config row correspondiente

```sql
-- integration_events WHERE integration_slug = 'telegram'
-- AND org_id NOT IN (SELECT org_id FROM org_integrations WHERE integration_slug = 'telegram')
```

| Resultado | Filas devueltas |
|-----------|:---------------:|
| Eventos sin config row | **0** — ningún evento huérfano |

### Definición 3: Organizaciones sin Telegram que generan eventos

| org_id | org_name | has_telegram | telegram_events |
|:------:|----------|:------------:|:---------------:|
| 8 | Demos | ✅ SÍ (active) | 81 |
| 10 | OmniTech Demo | ❌ NO | 0 |
| 20 | Piloto Clientes | ❌ NO | 0 |

**→ No existe ninguna configuración huérfana en ninguna definición.**

---

## 8. Mapa Completo de la Plataforma

### Organizaciones y acceso Telegram

```
┌─────────────────────────────────────────────────────────────────┐
│  org_id=8  ·  "Demos"  ·  plan:free  ·  status:active          │
│                                                                  │
│  Telegram: ✅ ACTIVE  ·  Bot ID: 8954008690  ·  "Ava Omni"     │
│  Token: BD ≡ ENV (idénticos)  ·  Almacenamiento: base64 ⚠️      │
│                                                                  │
│  Members:                                                        │
│    👤 javito123451@gmail.com (owner) ← CONFIGURÓ EL BOT         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  org_id=10  ·  "OmniTech Demo"  ·  plan:free  ·  status:active │
│                                                                  │
│  Telegram: ❌ NO CONFIGURADO                                     │
│                                                                  │
│  Members:                                                        │
│    👤 a3servicio@gmail.com (owner, SUPER_ADMIN)                 │
│    👤 omnitechcore01@gmail.com (owner, SUPER_ADMIN)             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  org_id=20  ·  "Piloto Clientes"  ·  plan:free  ·  status:active│
│                                                                  │
│  Telegram: ❌ NO CONFIGURADO                                     │
│                                                                  │
│  Members:                                                        │
│    👤 a3servicio@gmail.com (owner, SUPER_ADMIN)                 │
│    👤 omnitechcore01@gmail.com (owner, SUPER_ADMIN)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Hallazgos de Seguridad

| # | Hallazgo | Severidad | Impacto |
|---|----------|:---------:|---------|
| 1 | **Token almacenado en base64 sin cifrar** — `INTEGRATION_ENCRYPTION_KEY` no configurada. El bot token es recuperable trivialmente haciendo SELECT sobre `credentials_enc` y decodificando base64. | 🔴 Alto | Exposición del token de bot ante cualquier acceso a la BD |
| 2 | **Token duplicado** — el mismo token existe en la variable de entorno (`Telegram_bot_token`) y en la BD. Si se rota el token, hay que actualizarlo en **ambos** lugares o el sistema puede quedar en estado inconsistente. | 🟡 Medio | Confusión en rotación de credenciales |
| 3 | **El email del actor no se registra en audit_logs** — el campo `actor_email` está NULL en ambas entradas de conexión de Telegram. Solo se registra el `actor_clerk_id`. | 🟢 Bajo | Dificulta la atribución rápida en el log de auditoría sin cruzar con la tabla `users` |

---

## Conclusión

- **1 configuración Telegram activa**, perteneciente al workspace **"Demos"** (org_id=8).
- **Propietario único:** `javito123451@gmail.com` — único miembro y owner del workspace.
- **Bot ID:** `8954008690` — mismo token en entorno y BD.
- **Bot operativo:** 74 mensajes procesados en las últimas 15 horas (37 recibidos + 37 respuestas IA).
- **0 configuraciones huérfanas** en ninguna definición.
- **Riesgo de seguridad activo:** token expuesto en base64 — requiere configurar `INTEGRATION_ENCRYPTION_KEY` antes de producción.

---

*Informe generado el 17 de junio de 2026 — Sólo lectura — Ningún dato modificado*
