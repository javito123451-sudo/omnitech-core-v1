// Enlaces públicos de seguimiento y baja. Cada mensaje lleva un token aleatorio propio
// (review_messages.tracking_token): sirve para registrar el clic y para la baja de un clic.
import { randomBytes } from "node:crypto";

/** Base pública del backend. En producción cae al dominio de la plataforma (igual que el resto del repo); fuera de producción hay que configurarla. */
export function publicBaseUrl(): string | null {
  const v = process.env["PUBLIC_URL"]?.trim();
  if (v) return v.replace(/\/+$/, "");
  return process.env["NODE_ENV"] === "production" ? "https://www.omnitech-core.com" : null;
}

export const reviewLink = (base: string, token: string) => `${base}/api/review-public/r/${token}`;
export const unsubscribeLink = (base: string, token: string) => `${base}/api/review-public/u/${token}`;
export const newToken = () => randomBytes(24).toString("base64url");
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
