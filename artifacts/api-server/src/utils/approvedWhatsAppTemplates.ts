import { getWhatsAppCreds } from "./integrationCreds";
import { logger } from "../lib/logger";

export type ApprovedWhatsAppTemplateKind = "lead_welcome" | "appointment_confirmation";

/** Send only pre-approved Meta templates: public lead capture is an outbound
 * business-initiated conversation and must not use a free-form text message. */
export async function sendApprovedWhatsAppTemplate(
  orgId: number,
  toRaw: string,
  kind: ApprovedWhatsAppTemplateKind,
  parameters: string[],
): Promise<boolean> {
  const creds = await getWhatsAppCreds(orgId);
  const templateName = kind === "lead_welcome"
    ? process.env.WHATSAPP_TEMPLATE_LEAD_WELCOME
    : process.env.WHATSAPP_TEMPLATE_APPOINTMENT_CONFIRMATION;
  if (!creds || !templateName) {
    logger.warn({ orgId, kind, hasCredentials: !!creds, hasTemplate: !!templateName }, "[WhatsAppAutomation] not configured; message skipped");
    return false;
  }
  const to = toRaw.replace(/\\D/g, "");
  if (to.length < 8) return false;
  const response = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "es_ES" },
        components: parameters.length ? [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] : [],
      },
    }),
  });
  const data = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) {
    logger.warn({ orgId, kind, status: response.status, error: data.error?.message }, "[WhatsAppAutomation] Meta template send failed");
    return false;
  }
  logger.info({ orgId, kind, providerMessageId: data.messages?.[0]?.id }, "[WhatsAppAutomation] approved template accepted by Meta");
  return true;
}
