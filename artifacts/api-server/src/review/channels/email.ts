// Correo electrónico vía el envío compartido de la plataforma (Resend, lib/email.ts).
// Cada mensaje lleva SIEMPRE: identificación del remitente (LSSI), enlace de baja visible y
// cabeceras List-Unsubscribe / List-Unsubscribe-Post (baja de un clic, RFC 8058).
import { sendEmail, type SendEmailResult } from "../../lib/email";
import { escapeHtml, renderText } from "../templates";
import type { ChannelProvider, SendOutcome, SendRequest } from "./types";

export function classifyEmailError(message: string): Extract<SendOutcome, { ok: false }> {
  const m = message.slice(0, 300);
  if (/api key|apikey|unauthori[sz]ed|forbidden|domain.*(not verified|verify)|no configurado/i.test(m)) return { ok: false, retryable: false, fatal: true, code: "email_config", message: m };
  if (/rate.?limit|too many|429|timeout|timed out|temporar|unavailable|5\d\d|ECONN|fetch failed|network/i.test(m)) return { ok: false, retryable: true, code: "email_transient", message: m };
  if (/invalid.*(email|recipient|address)|not a valid|mailbox|does not exist/i.test(m)) return { ok: false, retryable: false, invalidDestination: true, code: "email_invalid_address", message: m };
  return { ok: false, retryable: false, code: "email_rejected", message: m };
}

export function buildEmail(req: SendRequest): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const vars = { nombre: req.contactName ?? "", servicio: req.service ?? "", establecimiento: req.location.name, enlace: req.links.review };
  const subject = renderText(req.template.subject ?? "", vars).replace(/[\r\n]+/g, " ").slice(0, 200);
  const bodyHtml = renderText(req.template.body, vars, escapeHtml)
    .split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")
    // El enlace de reseña (ya sin escapar, es una URL propia) se hace pulsable.
    .replace(escapeHtml(req.links.review), `<a href="${escapeHtml(req.links.review)}">${escapeHtml(req.links.review)}</a>`)
    .replace(req.links.review, `<a href="${escapeHtml(req.links.review)}">${escapeHtml(req.links.review)}</a>`);
  const identity = [req.sender.legalName ?? req.sender.name, req.sender.taxId, req.sender.address].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const footer = `<hr><p style="font-size:12px;color:#666">Mensaje enviado por ${identity}. Si no deseas recibir más mensajes de este tipo, <a href="${escapeHtml(req.links.unsubscribe)}">date de baja aquí</a>.</p>`;
  const text = `${renderText(req.template.body, vars)}\n\n--\nEnviado por ${[req.sender.legalName ?? req.sender.name, req.sender.taxId, req.sender.address].filter(Boolean).join(" · ")}.\nBaja: ${req.links.unsubscribe}`;
  return {
    subject, html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">${bodyHtml}${footer}</div>`, text,
    headers: { "List-Unsubscribe": `<${req.links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export function emailProvider(send: typeof sendEmail = sendEmail): ChannelProvider {
  const perMin = Number(process.env["REVIEW_EMAIL_MAX_PER_MINUTE"] ?? 120);
  const perDay = process.env["REVIEW_EMAIL_DAILY_LIMIT"] ? Number(process.env["REVIEW_EMAIL_DAILY_LIMIT"]) : null;
  return {
    channel: "email", providerId: "resend",
    limits: { maxPerMinute: Number.isFinite(perMin) && perMin > 0 ? perMin : 120, maxPerDay: perDay && perDay > 0 ? perDay : null },
    async readiness() {
      return process.env["RESEND_API_KEY"] ? { ready: true } : { ready: false, reason: "El envío de correo no está configurado en la plataforma (RESEND_API_KEY)." };
    },
    async send(req): Promise<SendOutcome> {
      const e = buildEmail(req);
      let r: SendEmailResult;
      try { r = await send(req.to, e.subject, e.html, { headers: e.headers, text: e.text }); }
      catch (err) { return { ok: false, retryable: true, code: "network_error", message: String((err as Error).message ?? err).slice(0, 300) }; }
      return r.ok ? { ok: true, providerMessageId: r.id ?? null } : classifyEmailError(r.error ?? "error desconocido");
    },
  };
}
