import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifica la firma de un webhook de Shopify.
 * Shopify firma el cuerpo CRUDO con HMAC-SHA256 usando el secreto de la app
 * y lo envía en base64 en X-Shopify-Hmac-Sha256. Hay que comparar contra el
 * buffer original (no contra JSON.stringify del body parseado).
 */
export function verifyShopifyHmac(
  rawBody: Buffer | undefined,
  hmacHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!rawBody || !hmacHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Normaliza y valida el dominio de la tienda (evita webhooks de otra tienda con el mismo secreto). */
export function isExpectedShop(headerDomain: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!headerDomain) return false;
  return headerDomain.trim().toLowerCase() === expected.trim().toLowerCase();
}
