# Omni Review Bot — motor de campañas: decisiones y estado

Estado: implementado y probado con Postgres real. **Ningún envío real** (WhatsApp/Resend) se ha hecho: faltan credenciales.

## Piezas
- `review/templates.ts` plantillas (validación anti-incentivo / anti-filtro por satisfacción) y render.
- `review/channels/{types,whatsapp,email,registry}.ts` interfaz `ChannelProvider`. SMS = un fichero + registro + ampliar el CHECK de canales.
- `review/engine/audience.ts` audiencia elegible en SQL (mismas reglas que `guard.ts`, con test de paridad).
- `review/engine/campaigns.ts` alta/edición/duplicado/lanzamiento/pausa/reanudación/cancelación/resultados.
- `review/engine/worker.ts` cola: reclamación `FOR UPDATE SKIP LOCKED`, límites, ventana horaria, reintentos, recuperación.
- `review/engine/status.ts` estados de entrega del proveedor (monótono, idempotente).
- `review/publicRoutes.ts` `/api/review-public/r/:token` (clic → 302) y `/u/:token` (baja; el GET no da de baja).

## Decisiones que conviene revisar
1. **WhatsApp solo con credenciales PROPIAS de la empresa** (`org_integrations`). `getWhatsAppCreds` cae a variables de entorno de la plataforma; aquí se ignora ese respaldo para no enviar desde un número ajeno.
2. **«Como máximo una vez»**: un envío `sending` con bloqueo caducado (5 min) NO se reenvía solo (podría duplicarse); pasa a `failed/lease_expired` y se reintenta a mano (`/retry-failed`).
3. **Frecuencia**: no se vuelve a pedir a un contacto en 90 días (`REVIEW_REQUEST_COOLDOWN_DAYS`) desde otra campaña. Un recordatorio como máximo, solo a quien no hizo clic.
4. **Audiencia por establecimiento**: solo contactos con `location_id` = el de la campaña.
5. **Ventana de envío por defecto 09–20** (hora de la empresa) + horas de silencio opcionales.
6. **Destino inválido** → supresión solo de ese canal (`outreach_suppressions`, `bounced`); error de configuración → campaña pausada.
7. **Clics**: se ignoran UAs de bots/vistas previas (WhatsApp, Slack, Googlebot…). Un clic NO es una reseña.
8. Cambio aditivo en código compartido: `lib/email.ts#sendEmail` acepta un 4.º parámetro opcional (cabeceras `List-Unsubscribe`, texto). Los llamadores existentes no cambian.

## Pendiente (no implementado todavía)
- Webhooks: estados de entrega de WhatsApp/Resend hacia `applyProviderStatus`, y «BAJA»/«STOP» entrantes por WhatsApp (cambios 7 y 8 aprobados).
- Si el webhook llega antes de que se guarde el id del proveedor, debe responder no-2xx para que reintente.
- Frontend; lectura de reseñas de Google; herramientas de Ava; tarea de retención (24 meses).
- Antes de desplegar: aplicar la migración Drizzle 0018 en producción y definir `PUBLIC_URL` (sin ella no se pueden lanzar campañas fuera de producción).
