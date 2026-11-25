import { createHmac, timingSafeEqual } from "node:crypto";

/** Valida X-Shopify-Hmac-Sha256 (base64 de HMAC-SHA256 del cuerpo CRUDO) en tiempo constante. */
export function verifyShopifyHmac(rawBody: Buffer | undefined, headerValue: string | undefined, secret: string | undefined): boolean {
  if (!rawBody || !headerValue || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try { received = Buffer.from(headerValue, "base64"); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signShopifyBody(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}
