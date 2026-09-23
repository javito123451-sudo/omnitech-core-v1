/**
 * Omni Integration Hub — Email Adapter
 * A diferencia de WhatsApp/Telegram, este adapter NO usa credenciales por
 * organización (ctx.credentials) — es una capacidad de plataforma respaldada
 * por un único RESEND_API_KEY compartido (ver lib/email.ts sendEmail()),
 * igual que ya hacían sendPortalEmail/sendInvitationEmail. No hay remitente
 * propio por workspace en esta versión.
 */
import type {
  IntegrationAdapter,
  AdapterContext,
  ValidationResult,
  IntegrationHealth,
  SendMessagePayload,
  SendMessageResult,
  ReceiveMessagePayload,
} from "../types";
import { IntegrationRegistry } from "../integrationRegistry";
import { sendEmail } from "../../lib/email";

const EmailAdapter: IntegrationAdapter = {
  async validate(_ctx: AdapterContext): Promise<ValidationResult> {
    const configured = Boolean(process.env["RESEND_API_KEY"]);
    return { valid: configured, missing: configured ? [] : ["RESEND_API_KEY"] };
  },

  async healthCheck(_ctx: AdapterContext): Promise<IntegrationHealth> {
    const configured = Boolean(process.env["RESEND_API_KEY"]);
    return {
      overall: configured ? "healthy" : "unhealthy",
      checkedAt: new Date().toISOString(),
      results: [{
        name: "api_key",
        status: configured ? "pass" : "fail",
        message: configured ? "RESEND_API_KEY presente" : "RESEND_API_KEY no configurado",
        durationMs: 0,
      }],
    };
  },

  async send(_ctx: AdapterContext, payload: SendMessagePayload): Promise<SendMessageResult> {
    if (!payload.to || !payload.to.includes("@")) {
      return { success: false, error: "Destino inválido: se esperaba un email" };
    }
    const subject = (payload.metadata?.["subject"] as string | undefined) ?? "Mensaje de OmniTech Core";
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:pre-wrap;line-height:1.6;color:#1a1f2e;">${escapeHtml(payload.message)}</div>`;
    try {
      // OmniSeller Fase 5 — PASO 1: sendEmail() ahora devuelve el id real de
      // Resend; se propaga como providerId para que outreachService.ts lo
      // guarde en lead_messages.external_message_id (sin esto, el webhook de
      // Fase 5 no podría correlacionar ningún evento de email).
      const result = await sendEmail(payload.to, subject, html);
      return result.ok
        ? { success: true, providerId: result.id }
        : { success: false, error: result.error ?? "RESEND_API_KEY no configurado" };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  // No procesamos webhooks entrantes de email EN EL HUB en esta versión —
  // el webhook de eventos de Resend (delivered/bounced/...) de OmniSeller
  // Fase 5 vive deliberadamente fuera del Hub, en
  // outreach/webhooks/resendWebhook.ts, con su propia verificación de firma
  // Svix y su propia lógica de correlación con lead_messages — no encaja en
  // la forma ReceiveMessagePayload (pensada para mensajes conversacionales
  // entrantes, no para eventos de estado de entrega). Este método sigue
  // devolviendo null a propósito.
  async receive(_rawPayload: unknown): Promise<ReceiveMessagePayload | null> {
    return null;
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

IntegrationRegistry.register("email", EmailAdapter);
console.log("[IntegrationHub] Email adapter registered");
