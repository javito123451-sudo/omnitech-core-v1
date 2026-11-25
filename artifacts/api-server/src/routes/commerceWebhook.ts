/**
 * POST /api/commerce/webhooks/shopify — receptor público de webhooks de Shopify (OmniCommerce Bridge).
 * Seguridad: falla CERRADO sin SHOPIFY_API_SECRET; HMAC sobre cuerpo crudo (req.rawBody, capturado en app.ts);
 * valida dominio de la tienda si SHOPIFY_SHOP_DOMAIN está definido. Nunca devuelve detalles internos.
 */
import { Router, type IRouter } from "express";
import { verifyShopifyHmac } from "../commerce/hmac";
import { ingestWebhook } from "../commerce/ingest";
import { logger } from "../lib/logger";

export const commerceWebhookRouter: IRouter = Router();

commerceWebhookRouter.post("/webhooks/shopify", async (req, res) => {
  const secret = process.env["SHOPIFY_API_SECRET"];
  if (!secret) { res.status(503).json({ error: "not_configured" }); return; }

  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!verifyShopifyHmac(raw, req.get("x-shopify-hmac-sha256"), secret)) {
    logger.warn({ ip: req.ip }, "[Commerce] webhook rechazado: HMAC inválido");
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const expectedShop = process.env["SHOPIFY_SHOP_DOMAIN"];
  const shop = req.get("x-shopify-shop-domain") ?? null;
  if (expectedShop && shop !== expectedShop) { res.status(401).json({ error: "invalid_shop" }); return; }

  const webhookId = req.get("x-shopify-webhook-id");
  const topic = req.get("x-shopify-topic");
  if (!webhookId || !topic) { res.status(400).json({ error: "missing_headers" }); return; }

  try {
    const r = await ingestWebhook({ webhookId, topic, shopDomain: shop, payload: req.body });
    // 200 incluso si el procesado falló: el evento ya está persistido y se reintenta internamente.
    res.status(200).json({ ok: true, duplicate: r.duplicate });
  } catch (err) {
    logger.error({ err }, "[Commerce] no se pudo persistir el webhook");
    res.status(500).json({ error: "persist_failed" }); // Shopify reintentará
  }
});
