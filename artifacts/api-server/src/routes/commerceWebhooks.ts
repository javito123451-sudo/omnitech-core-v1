// POST /api/commerce/webhooks/shopify — receptor de webhooks de Shopify.
// Público (sin Clerk): la autenticación es la firma HMAC + el dominio de la tienda.
import { Router, type IRouter } from "express";
import { verifyShopifyHmac, isExpectedShop } from "../commerce/shopifyVerify";
import { ingestEvent } from "../commerce/bridge";
import { logger } from "../lib/logger";

export const commerceWebhooksRouter: IRouter = Router();

commerceWebhooksRouter.post("/shopify", async (req, res) => {
  const rawBody   = (req as unknown as { rawBody?: Buffer }).rawBody;
  const hmac      = req.header("x-shopify-hmac-sha256");
  const topic     = req.header("x-shopify-topic");
  const shop      = req.header("x-shopify-shop-domain");
  const webhookId = req.header("x-shopify-webhook-id");

  if (!verifyShopifyHmac(rawBody, hmac, process.env["SHOPIFY_WEBHOOK_SECRET"])) {
    logger.warn({ topic, shop }, "[OmniCommerce] webhook Shopify con firma inválida");
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  if (!isExpectedShop(shop, process.env["SHOPIFY_SHOP_DOMAIN"])) {
    logger.warn({ topic, shop }, "[OmniCommerce] webhook de una tienda no esperada");
    res.status(401).json({ error: "unexpected shop" });
    return;
  }
  if (!topic || !webhookId) {
    res.status(400).json({ error: "missing topic or webhook id" });
    return;
  }

  try {
    const result = await ingestEvent({
      source: "shopify", eventId: webhookId, topic, shopDomain: shop ?? null, rawBody: rawBody!, payload: req.body,
    });
    if (result.outcome === "failed") {
      // 5xx ⇒ Shopify reintenta. Superado el máximo, 200 para cortar el bucle: queda
      // en commerce_webhook_events (failed) para reintento manual desde Control Center.
      res.status(result.retryable ? 500 : 200).json({ ok: false, eventId: result.eventRowId, retry: result.retryable });
      return;
    }
    res.status(200).json({ ok: true, outcome: result.outcome });
  } catch (err) {
    logger.error({ err, topic }, "[OmniCommerce] error inesperado en ingesta");
    res.status(500).json({ ok: false });
  }
});
