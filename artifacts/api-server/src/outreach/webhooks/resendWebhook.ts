// OmniSeller Fase 5 — PASO 6-9: webhook dedicado de Resend.
//
// Ruta pública nueva (Resend solo permite UNA URL de webhook por cuenta —
// no hay ningún endpoint existente que reutilizar ni con el que colisionar,
// a diferencia de WhatsApp/Telegram). Verificación de firma vía
// `resend.webhooks.verify()`, ya incluido en el SDK `resend` (v6.12.4, ya
// dependencia del repo) — NO se implementa HMAC manual ni se añade la
// dependencia `svix`: el propio SDK expone el método oficial, confirmado
// leyendo directamente sus tipos instalados (node_modules/.pnpm/resend@…).
//
// Contrato verificado ANTES de programar (Paso 0 de la auditoría, con
// fuentes primarias — SDK instalado + docs oficiales de Resend/Svix):
//  - Headers: svix-id, svix-timestamp, svix-signature.
//  - svix-id es ESTABLE entre reintentos del mismo evento lógico → se usa
//    tal cual como external_event_id para la idempotencia (Paso 5: "usa
//    únicamente una estrategia determinista y documentada").
//  - Payload: { type: WebhookEvent, created_at: string, data: {...} }.
//  - data.email_id es el mismo id que ya devuelve resend.emails.send() —
//    correlación con lead_messages.external_message_id (Paso 7).
//  - Eventos implementados en esta fase (Paso 8, los únicos pedidos como
//    mínimo): email.delivered, email.bounced, email.complained,
//    email.opened, email.clicked. email.bounced está documentado por
//    Resend como "the recipient's mail server permanently rejected the
//    email" — por eso CUALQUIER email.bounced se trata como bounce
//    definitivo (no hay necesidad de inspeccionar data.bounce.subType para
//    decidir si supresionar). Otros tipos confirmados por el SDK
//    (email.sent, email.failed, email.delivery_delayed, email.scheduled,
//    email.received, email.suppressed, contact.*, domain.*) se auditan como
//    "ignored" — detectados pero fuera del alcance mínimo de esta fase, sin
//    inventar su tratamiento.
import type { Request, Response } from "express";
import { Resend, type WebhookEventPayload } from "resend";
import { logAuditSystem } from "../../utils/auditLogger";
import { processOutreachEvent } from "./eventProcessor";

const IMPLEMENTED_EVENT_TYPES = new Set(["email.delivered", "email.bounced", "email.complained", "email.opened", "email.clicked"]);

function mapResendEventType(type: string): string {
  switch (type) {
    case "email.delivered":  return "delivered";
    case "email.bounced":    return "bounced";
    case "email.complained": return "complained";
    case "email.opened":     return "opened";
    case "email.clicked":    return "clicked";
    default:                 return type;
  }
}

let _client: Resend | null = null;
function getResendClient(): Resend | null {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return null;
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env["RESEND_WEBHOOK_SECRET"];
  // Paso 6/13 — nunca procesar un payload no autenticado. A diferencia del
  // webhook legacy de WhatsApp (que degrada con un console.warn si falta el
  // secreto — un problema preexistente, documentado en la auditoría, no
  // heredado aquí a propósito), esta ruta es NUEVA: rechaza directamente si
  // no hay secreto configurado, sin ningún fallback inseguro.
  if (!secret) {
    console.error("[Resend Webhook] RESEND_WEBHOOK_SECRET no configurado — rechazando (nunca se procesa sin verificar firma)");
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }

  const client = getResendClient();
  if (!client) {
    res.status(503).json({ error: "resend_not_configured" });
    return;
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const svixId        = req.headers["svix-id"] as string | undefined;
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
  const svixSignature  = req.headers["svix-signature"] as string | undefined;

  if (!rawBody || !svixId || !svixTimestamp || !svixSignature) {
    console.warn("[Resend Webhook] Faltan headers de firma o raw body — rechazado");
    await logAuditSystem({
      actorClerkId: "system:outreach-webhook:email", action: "outreach.webhook_rejected",
      resource: "outreach_event", details: { provider: "email", reason: "missing_signature_headers" }, severity: "warning",
    }).catch(() => {});
    res.status(400).json({ error: "invalid_webhook" });
    return;
  }

  let event: WebhookEventPayload;
  try {
    event = client.webhooks.verify({
      payload: rawBody.toString("utf8"),
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: secret,
    });
  } catch (err) {
    console.warn("[Resend Webhook] Firma inválida — rechazado:", err instanceof Error ? err.message : String(err));
    await logAuditSystem({
      actorClerkId: "system:outreach-webhook:email", action: "outreach.webhook_rejected",
      resource: "outreach_event", details: { provider: "email", reason: "invalid_signature" }, severity: "warning",
    }).catch(() => {});
    res.status(400).json({ error: "invalid_webhook" });
    return;
  }

  await logAuditSystem({
    actorClerkId: "system:outreach-webhook:email", action: "outreach.webhook_received",
    resource: "outreach_event", details: { provider: "email", type: event.type }, severity: "info",
  }).catch(() => {});

  const emailId = (event.data as { email_id?: string }).email_id;

  if (!IMPLEMENTED_EVENT_TYPES.has(event.type)) {
    // Evento real de Resend, pero fuera del alcance mínimo de esta fase
    // (Paso 8) — se responde 200 (no es un error, no queremos que Resend
    // reintente algo que no vamos a tratar distinto la próxima vez) y se
    // audita como recibido-pero-no-tratado, sin inventar su procesamiento.
    await logAuditSystem({
      actorClerkId: "system:outreach-webhook:email", action: "outreach.webhook_received",
      resource: "outreach_event", details: { provider: "email", type: event.type, note: "evento fuera del alcance mínimo de Fase 5" }, severity: "info",
    }).catch(() => {});
    res.status(200).json({ received: true, processed: false });
    return;
  }

  if (!emailId) {
    res.status(200).json({ received: true, processed: false, reason: "missing_email_id" });
    return;
  }

  const result = await processOutreachEvent({
    provider: "email",
    externalEventId: svixId,
    eventType: mapResendEventType(event.type),
    rawPayload: event,
    correlate: { by: "external_message_id", externalMessageId: emailId },
  });

  if (result.outcome === "duplicate") {
    await logAuditSystem({
      actorClerkId: "system:outreach-webhook:email", action: "outreach.webhook_duplicate",
      resource: "outreach_event", details: { provider: "email", externalEventId: svixId }, severity: "info",
    }).catch(() => {});
  }

  // La firma ya se verificó y el evento ya quedó registrado de forma
  // idempotente. "processed"/"duplicate"/"ignored" son desenlaces
  // TERMINALES (nada cambiaría si Resend reintentara) → 200, para que no
  // reintente en bucle. "error" (p. ej. un fallo de DB a mitad de proceso,
  // Paso 13/19) deja la fila en estado "error", NO "processed" — se
  // responde con un error 5xx a propósito, para que el mecanismo de
  // reintentos del propio Resend/Svix vuelva a entregar este mismo evento
  // más tarde, con el mismo svix-id, y el código de arriba reintente el
  // procesamiento sobre la MISMA fila en vez de perderlo silenciosamente.
  if (result.outcome === "error") {
    res.status(500).json({ received: true, processed: false, outcome: result.outcome });
    return;
  }
  res.status(200).json({ received: true, processed: result.outcome === "processed", outcome: result.outcome });
}
