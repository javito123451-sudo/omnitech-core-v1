/**
 * Omni Integration Hub — WhatsApp Business Adapter
 * Implements IntegrationAdapter for WhatsApp Cloud API.
 */
import type {
  IntegrationAdapter,
  AdapterContext,
  ValidationResult,
  IntegrationHealth,
  HealthCheckResult,
  SendMessagePayload,
  SendMessageResult,
  ReceiveMessagePayload,
} from "../types";
import { IntegrationRegistry } from "../integrationRegistry";

// ── Meta API helpers ──────────────────────────────────────────────────────────

const META_API_BASE = "https://graph.facebook.com/v19.0";

function getCreds(ctx: AdapterContext): { phoneNumberId: string; accessToken: string } | null {
  const p = ctx.credentials["phoneNumberId"];
  const t = ctx.credentials["accessToken"];
  if (!p || !t) return null;
  return { phoneNumberId: p, accessToken: t };
}

async function metaApiGET(
  ctx: AdapterContext,
  endpoint: string,
): Promise<{ ok: boolean; data: unknown; status: number; error?: string }> {
  const creds = getCreds(ctx);
  if (!creds) return { ok: false, data: null, status: 0, error: "Missing credentials" };
  try {
    const r = await fetch(`${META_API_BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data, status: r.status, error: r.ok ? undefined : (data as Record<string, unknown>)?.error?.message as string };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
}

async function metaApiPOST(
  ctx: AdapterContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown; status: number; error?: string }> {
  const creds = getCreds(ctx);
  if (!creds) return { ok: false, data: null, status: 0, error: "Missing credentials" };
  try {
    const r = await fetch(`${META_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, data, status: r.status, error: r.ok ? undefined : (data as Record<string, unknown>)?.error?.message as string };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
}

// ── Adapter implementation ───────────────────────────────────────────────────────

const WhatsAppAdapter: IntegrationAdapter = {
  // ── validate ───────────────────────────────────────────────────────
  async validate(ctx): Promise<ValidationResult> {
    const missing: string[] = [];
    if (!ctx.credentials["phoneNumberId"]) missing.push("phoneNumberId");
    if (!ctx.credentials["accessToken"])   missing.push("accessToken");
    return { valid: missing.length === 0, missing };
  },

  // ── healthCheck ────────────────────────────────────────────────────
  async healthCheck(ctx): Promise<IntegrationHealth> {
    const results: HealthCheckResult[] = [];
    const creds = getCreds(ctx);

    // 1. Token check
    const t0 = Date.now();
    if (!creds) {
      results.push({ name: "token", status: "fail", message: "Missing credentials", durationMs: 0 });
      return { overall: "unhealthy", checkedAt: new Date().toISOString(), results };
    }
    results.push({ name: "token", status: "pass", message: "Token present", durationMs: 0 });

    // 2. Phone ID check
    results.push({ name: "phone_id", status: "pass", message: `Phone ID: ${creds.phoneNumberId}`, durationMs: 0 });

    // 3. API status check
    const t1 = Date.now();
    const me = await metaApiGET(ctx, "/me");
    results.push({
      name: "api_status",
      status: me.ok ? "pass" : "fail",
      message: me.ok ? "Meta API reachable" : `Meta API error: ${me.error}`,
      durationMs: Date.now() - t1,
    });

    // 4. Permissions check
    const t2 = Date.now();
    if (me.ok) {
      const bizAcct = (me.data as Record<string, unknown>)?.id as string | undefined;
      if (bizAcct) {
        const perms = await metaApiGET(ctx, `/${bizAcct}?fields=whatsapp_business_account`);
        results.push({
          name: "permissions",
          status: perms.ok ? "pass" : "fail",
          message: perms.ok ? "WhatsApp Business permission granted" : `Permission error: ${perms.error}`,
          durationMs: Date.now() - t2,
        });
      } else {
        results.push({ name: "permissions", status: "skip", message: "No business account ID found", durationMs: 0 });
      }
    } else {
      results.push({ name: "permissions", status: "skip", message: "Skipped (API unreachable)", durationMs: 0 });
    }

    // 5. Outbound message check
    const t3 = Date.now();
    const phoneInfo = await metaApiGET(ctx, `/${creds.phoneNumberId}?fields=id`);
    results.push({
      name: "outbound",
      status: phoneInfo.ok ? "pass" : "fail",
      message: phoneInfo.ok ? "Phone number ID valid" : `Phone ID invalid: ${phoneInfo.error}`,
      durationMs: Date.now() - t3,
    });

    // 6. Webhook check — we can't directly verify from here, but we check if verifyToken is present
    const t4 = Date.now();
    const verifyToken = ctx.credentials["verifyToken"] || ctx.config["verifyToken"] as string | undefined;
    results.push({
      name: "webhook",
      status: verifyToken ? "pass" : "fail",
      message: verifyToken ? "Webhook verify token configured" : "Webhook verify token missing",
      durationMs: Date.now() - t4,
    });

    // 7. Inbound messages — we can't directly test, but we report based on recent events
    // (IntegrationManager will check integration_events table for this)
    results.push({
      name: "inbound",
      status: "skip",
      message: "Inbound message check requires historical webhook events",
      durationMs: 0,
    });

    const failCount = results.filter((r) => r.status === "fail").length;
    const overall: HealthCheckResult["status"] = failCount === 0 ? "pass" : failCount >= 2 ? "fail" : "fail";
    const overallStatus: IntegrationHealth["overall"] =
      failCount === 0 ? "healthy" : failCount >= 2 ? "unhealthy" : "degraded";

    return { overall: overallStatus, checkedAt: new Date().toISOString(), results };
  },

  // ── send ────────────────────────────────────────────────────────
  async send(ctx, payload): Promise<SendMessageResult> {
    const creds = getCreds(ctx);
    if (!creds) {
      return { success: false, error: "Missing WhatsApp credentials" };
    }

    const toClean = payload.to.replace(/\D/g, "");
    const result = await metaApiPOST(ctx, `/${creds.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to:   toClean,
      type: "text",
      text: { body: payload.message },
    });

    if (result.ok) {
      const data = result.data as { messages?: { id: string }[] };
      return { success: true, providerId: data?.messages?.[0]?.id };
    }
    return { success: false, error: result.error ?? `HTTP ${result.status}` };
  },

  // ── receive ──────────────────────────────────────────────────────
  async receive(rawPayload): Promise<ReceiveMessagePayload | null> {
    const payload = rawPayload as MetaWebhookPayload;
    if (payload.object !== "whatsapp_business_account") return null;

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value) return null;

    const msg = value.messages?.[0];
    const contact = value.contacts?.[0];
    if (!msg || msg.type !== "text") return null;

    return {
      from:      msg.from,
      message:   msg.text?.body ?? "",
      providerId: msg.id,
      metadata: {
        timestamp: msg.timestamp,
        profileName: contact?.profile?.name,
        waId: contact?.wa_id,
      },
      raw: payload,
    };
  },
};

// ── Meta webhook payload types (local mirror) ─────────────────────────────
interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product?: string;
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}

// ── Register adapter ─────────────────────────────────────────────────────
IntegrationRegistry.register("whatsapp", WhatsAppAdapter);
console.log("[IntegrationHub] WhatsApp adapter registered");
