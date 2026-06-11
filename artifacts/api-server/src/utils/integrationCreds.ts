import crypto from "node:crypto";
import { db, orgIntegrationsTable, integrationEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Encryption key setup ──────────────────────────────────────────────────────
const RAW_KEY = process.env.INTEGRATION_ENCRYPTION_KEY;
export const ENC_KEY =
  RAW_KEY && RAW_KEY.length === 64 ? Buffer.from(RAW_KEY, "hex") : null;

if (!ENC_KEY) {
  console.warn(
    "[IntegrationCreds] INTEGRATION_ENCRYPTION_KEY not set or invalid — " +
    "credentials stored as base64 only. Set a 64-char hex key for production.",
  );
}

// ── AES-256-GCM encrypt / decrypt ─────────────────────────────────────────────
export function encryptCredentials(obj: Record<string, string>): string {
  const json = JSON.stringify(obj);
  if (!ENC_KEY) return Buffer.from(json).toString("base64");
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptCredentials(stored: string): Record<string, string> {
  try {
    if (!ENC_KEY)
      return JSON.parse(Buffer.from(stored, "base64").toString("utf8")) as Record<string, string>;
    const buf      = Buffer.from(stored, "base64");
    const iv       = buf.subarray(0, 12);
    const tag      = buf.subarray(12, 28);
    const enc      = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(decipher.update(enc) + decipher.final("utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

// ── WhatsApp credential resolution: DB (per-org) → env vars ──────────────────
export interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken:   string;
  verifyToken:   string;
  source:        "db" | "env";
}

export async function getWhatsAppCreds(orgId?: number): Promise<WhatsAppCreds | null> {
  // 1. Try DB per-org record first
  if (orgId) {
    try {
      const [row] = await db
        .select()
        .from(orgIntegrationsTable)
        .where(
          and(
            eq(orgIntegrationsTable.orgId, orgId),
            eq(orgIntegrationsTable.integrationSlug, "whatsapp"),
          ),
        );
      if (row?.credentialsEnc) {
        const creds = decryptCredentials(row.credentialsEnc);
        if (creds["phoneNumberId"] && creds["accessToken"]) {
          return {
            phoneNumberId: creds["phoneNumberId"],
            accessToken:   creds["accessToken"],
            verifyToken:   creds["verifyToken"] ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "omnitech-webhook",
            source:        "db",
          };
        }
      }
    } catch (err) {
      console.error("[IntegrationCreds] WhatsApp DB lookup failed:", err);
    }
  }

  // 2. Fall back to env vars (backward compatibility)
  const phoneNumberId = process.env.WHATSAPP_BUSINESS_PHONE_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
  const verifyToken   = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "omnitech-webhook";

  if (phoneNumberId && accessToken) {
    return { phoneNumberId, accessToken, verifyToken, source: "env" };
  }

  return null;
}

// ── Resolve verify token: env var first, then any DB org ─────────────────────
// Used by the public webhook GET endpoint (no orgId known yet)
export async function resolveWhatsAppVerifyTokens(): Promise<string[]> {
  const tokens = new Set<string>();

  // Env var always included
  const envToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (envToken) tokens.add(envToken);
  tokens.add("omnitech-webhook"); // default fallback

  // All DB-stored tokens across orgs
  try {
    const rows = await db
      .select({ credentialsEnc: orgIntegrationsTable.credentialsEnc })
      .from(orgIntegrationsTable)
      .where(eq(orgIntegrationsTable.integrationSlug, "whatsapp"));

    for (const row of rows) {
      if (!row.credentialsEnc) continue;
      const creds = decryptCredentials(row.credentialsEnc);
      if (creds["verifyToken"]) tokens.add(creds["verifyToken"]);
    }
  } catch {
    // non-critical — fall back to env var only
  }

  return Array.from(tokens);
}

// ── Non-blocking integration event logger ────────────────────────────────────
export function logIntegrationEvent(params: {
  orgId:           number;
  integrationSlug: string;
  direction:       string;
  eventType:       string;
  status?:         string;
  summary?:        string;
  errorMessage?:   string;
}): void {
  db.insert(integrationEventsTable)
    .values({
      orgId:           params.orgId,
      integrationSlug: params.integrationSlug,
      direction:       params.direction,
      eventType:       params.eventType,
      status:          params.status ?? "processed",
      summary:         params.summary ?? null,
      errorMessage:    params.errorMessage ?? null,
    })
    .catch((err) => console.error("[IntegrationEvent] log failed:", err));
}
