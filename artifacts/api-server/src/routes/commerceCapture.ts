/**
 * POST /api/commerce-public/requests — captación pública (formulario de la tienda Shopify).
 * Sin auth (la llama el navegador del visitante). Antispam: honeypot + 5 envíos/hora/IP + validación.
 * Responde igual exista o no la solicitud (no enumera emails). No crea cuenta, pedido ni licencia.
 */
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { createCaptureRequest, CaptureError } from "../commerce/capture";
import { logger } from "../lib/logger";

export const commerceCaptureRouter: IRouter = Router();

const limiter = rateLimit({ windowMs: 60 * 60_000, max: Number(process.env["COMMERCE_CAPTURE_MAX_PER_HOUR"] ?? 5), standardHeaders: true, legacyHeaders: false,
  message: { error: "too_many_requests" } });

commerceCaptureRouter.post("/requests", limiter, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b["website"] === "string" && b["website"] !== "") { res.status(200).json({ ok: true }); return; } // honeypot
  try {
    await createCaptureRequest({
      email: String(b["email"] ?? ""), name: String(b["name"] ?? ""), company: b["company"] as string, phone: b["phone"] as string,
      planInterest: b["planInterest"] as string, modulesInterest: Array.isArray(b["modulesInterest"]) ? (b["modulesInterest"] as string[]) : [],
      message: b["message"] as string, consentPrivacy: b["consentPrivacy"] === true || b["consentPrivacy"] === "true" || b["consentPrivacy"] === "on",
      consentMarketing: b["consentMarketing"] === true || b["consentMarketing"] === "true", source: b["source"] as string });
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof CaptureError) { res.status(400).json({ error: err.code, message: err.message }); return; }
    logger.error({ err }, "[Commerce] captación falló");
    res.status(500).json({ error: "internal_error" });
  }
});
