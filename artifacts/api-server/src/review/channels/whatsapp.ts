// WhatsApp Business Platform (Cloud API oficial). Mensajes iniciados por la empresa = SOLO plantillas
// aprobadas por Meta, con los parámetros en el orden en que aparecen en el texto.
// Las credenciales son las de la propia empresa (org_integrations, cifradas). NO se usan las variables
// de entorno de la plataforma como respaldo: una empresa sin su cuenta no debe enviar desde un número ajeno.
import { getWhatsAppCreds } from "../../utils/integrationCreds";
import { placeholdersOf, renderText } from "../templates";
import type { ChannelProvider, SendOutcome, SendRequest } from "./types";

const GRAPH = "https://graph.facebook.com/v19.0";

// Códigos de error de la Cloud API (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes).
const RETRYABLE = new Set([4, 17, 32, 613, 80007, 130429, 131056, 131000, 2, 1]);       // límites de ritmo / error interno
const INVALID_DESTINATION = new Set([131026, 131030, 131021]);                           // no entregable / no registrado / mismo número
const FATAL_CONFIG = new Set([190, 10, 200, 131031, 131042, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 100, 131009, 131008]); // token, permisos, pago, plantilla

export function sanitizeParam(s: string): string {
  return s.replace(/[\n\r\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1000) || "-";
}

export function classifyMetaError(status: number, body: unknown): Extract<SendOutcome, { ok: false }> {
  const err = (body as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)?.error;
  const code = err?.code;
  const message = [err?.message, err?.error_data?.details].filter(Boolean).join(" — ").slice(0, 500) || `HTTP ${status}`;
  const codeStr = code !== undefined ? String(code) : `http_${status}`;
  if (code !== undefined && INVALID_DESTINATION.has(code)) return { ok: false, retryable: false, code: codeStr, message, invalidDestination: true };
  if (code !== undefined && FATAL_CONFIG.has(code)) return { ok: false, retryable: false, code: codeStr, message, fatal: true };
  if ((code !== undefined && RETRYABLE.has(code)) || status === 429 || status >= 500 || status === 408) return { ok: false, retryable: true, code: codeStr, message };
  if (status === 401 || status === 403) return { ok: false, retryable: false, code: codeStr, message, fatal: true };
  return { ok: false, retryable: false, code: codeStr, message };
}

export function whatsappProvider(fetchImpl: typeof fetch = fetch): ChannelProvider {
  const perMin = Number(process.env["REVIEW_WHATSAPP_MAX_PER_MINUTE"] ?? 120);
  const perDay = process.env["REVIEW_WHATSAPP_DAILY_LIMIT"] ? Number(process.env["REVIEW_WHATSAPP_DAILY_LIMIT"]) : null; // nivel de mensajería de Meta de la cuenta
  return {
    channel: "whatsapp", providerId: "whatsapp_cloud",
    limits: { maxPerMinute: Number.isFinite(perMin) && perMin > 0 ? perMin : 120, maxPerDay: perDay && perDay > 0 ? perDay : null },

    async readiness(orgId, template) {
      const creds = await getWhatsAppCreds(orgId);
      if (!creds || creds.source !== "db") return { ready: false, reason: "La empresa no tiene su propia cuenta de WhatsApp Business conectada (Integraciones → WhatsApp)." };
      if (!template.waTemplateName || !template.waLanguage) return { ready: false, reason: "La plantilla no tiene nombre e idioma de plantilla de Meta." };
      if (template.waStatus !== "approved") return { ready: false, reason: `La plantilla de Meta no está aprobada (estado: ${template.waStatus ?? "desconocido"}).` };
      return { ready: true };
    },

    async send(req: SendRequest): Promise<SendOutcome> {
      const creds = await getWhatsAppCreds(req.orgId);
      if (!creds || creds.source !== "db") return { ok: false, retryable: false, fatal: true, code: "no_credentials", message: "Sin credenciales propias de WhatsApp." };
      if (req.template.waStatus !== "approved" || !req.template.waTemplateName || !req.template.waLanguage)
        return { ok: false, retryable: false, fatal: true, code: "template_not_approved", message: "Plantilla de Meta no aprobada." };

      const vars = { nombre: req.contactName ?? "", servicio: req.service ?? "", establecimiento: req.location.name, enlace: req.links.review };
      const params = placeholdersOf(req.template.body).map((p) => {
        const v = renderText(`{{${p}}}`, { ...vars, nombre: vars.nombre || "cliente", servicio: vars.servicio || "su servicio" });
        return { type: "text", text: sanitizeParam(v) };
      });
      const payload = {
        messaging_product: "whatsapp", to: req.to.replace(/^\+/, ""), type: "template",
        template: { name: req.template.waTemplateName, language: { code: req.template.waLanguage }, components: params.length ? [{ type: "body", parameters: params }] : [] },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${GRAPH}/${creds.phoneNumberId}/messages`, {
          method: "POST", headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        return { ok: false, retryable: true, code: "network_error", message: String((e as Error).message ?? e).slice(0, 300) };
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) return classifyMetaError(res.status, data);
      const id = (data as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? null;
      return { ok: true, providerMessageId: id };
    },
  };
}
