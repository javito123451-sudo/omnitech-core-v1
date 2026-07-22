---
name: NotificationService — motor multicanal
description: Arquitectura de NotificationService que reemplaza llamadas directas a WA/Telegram en Autopilot
---

## Regla
Autopilot nunca llama directamente a WhatsApp/Telegram/Email.
Siempre usa `NotificationService.send()` → `IntegrationManager.send()` → Adapter.

## Archivos clave
- `src/services/notificationService.ts` — dispatcher central; exporta `getActiveChannels(orgId)`
- `src/hub/adapters/telegramAdapter.ts` — adaptador Telegram outbound (auto-registrado en hub/index.ts)
- `src/utils/autopilotEngine.ts` — usa NotificationService en send_notification, notify_owner, strategic_brief

## Canales soportados
- `auto` — cascada: Telegram → WhatsApp → Email → Slack → internal
- `all` — broadcast a todos los activos en paralelo
- `telegram`, `whatsapp`, `email`, `slack`, `teams` — específico
- `internal` — log a activity table

## DB
- FIX-AE migra `action_type='send_whatsapp'` → `send_notification` con `channels:["whatsapp"]`
- `getActiveChannels(orgId)` consulta `org_integrations` donde `status IN ('connected','production')`

## API
- `GET /api/autopilot/channels` → `{ channels: [{slug, label, icon}], active: string[] }`
  - Siempre incluye auto, internal, all; filtra por canales activos del workspace

## Por qué
Escalabilidad: añadir un nuevo canal = registrar un nuevo Adapter. Autopilot no necesita modificarse.
