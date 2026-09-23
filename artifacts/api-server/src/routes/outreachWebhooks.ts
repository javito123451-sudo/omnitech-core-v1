// OmniSeller Fase 5 — router público para webhooks de Outreach.
//
// PÚBLICO (sin auth de sesión) — mismo criterio que whatsappWebhookRouter/
// telegramWebhookRouter/fleetWebhookRouter (routes/index.ts): estos
// proveedores no pueden autenticarse con Clerk, se autentican con su propio
// mecanismo de firma. Montado ANTES de requireAuth/resolveOrg en
// routes/index.ts.
import { Router } from "express";
import { handleResendWebhook } from "../outreach/webhooks/resendWebhook";

export const outreachWebhooksRouter = Router();

// POST /api/outreach/webhooks/resend
outreachWebhooksRouter.post("/resend", (req, res) => {
  handleResendWebhook(req, res).catch((err) => {
    console.error("[Outreach Webhooks] Error inesperado en /resend:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });
});
