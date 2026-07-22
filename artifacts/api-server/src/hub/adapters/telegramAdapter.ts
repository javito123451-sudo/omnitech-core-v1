/**
 * Omni Integration Hub — Telegram Bot Adapter
 * Implements IntegrationAdapter for outbound Telegram messages.
 * Inbound webhook parsing remains in routes/telegram.ts.
 */
import type {
  IntegrationAdapter,
  AdapterContext,
  ValidationResult,
  IntegrationHealth,
  SendMessagePayload,
  SendMessageResult,
  ReceiveMessagePayload,
} from "../types";
import { IntegrationRegistry } from "../integrationRegistry";

const TG_API = (token: string, method: string): string =>
  `https://api.telegram.org/bot${token}/${method}`;

function getToken(ctx: AdapterContext): string | null {
  return (
    ctx.credentials["token"]    ??
    ctx.credentials["botToken"] ??
    ctx.credentials["bot_token"] ??
    null
  );
}

const telegramAdapter: IntegrationAdapter = {

  async validate(ctx: AdapterContext): Promise<ValidationResult> {
    const token = getToken(ctx);
    if (!token) return { valid: false, missing: ["token"], errors: ["Bot token missing"] };
    return { valid: true, missing: [] };
  },

  async healthCheck(ctx: AdapterContext): Promise<IntegrationHealth> {
    const token = getToken(ctx);
    if (!token) {
      return {
        overall:   "unhealthy",
        checkedAt: new Date().toISOString(),
        results:   [{ name: "token", status: "fail", message: "Bot token not configured", durationMs: 0 }],
      };
    }
    const t0 = Date.now();
    try {
      const res  = await fetch(TG_API(token, "getMe"));
      const data = await res.json() as { ok: boolean; result?: { username?: string } };
      const dur  = Date.now() - t0;
      return {
        overall:   data.ok ? "healthy" : "unhealthy",
        checkedAt: new Date().toISOString(),
        results:   [{
          name:       "getMe",
          status:     data.ok ? "pass" : "fail",
          message:    data.ok ? `Bot @${data.result?.username ?? "?"} is alive` : "Bot API unreachable",
          durationMs: dur,
        }],
      };
    } catch (err) {
      return {
        overall:   "unhealthy",
        checkedAt: new Date().toISOString(),
        results:   [{ name: "getMe", status: "fail", message: String(err), durationMs: Date.now() - t0 }],
      };
    }
  },

  async send(ctx: AdapterContext, payload: SendMessagePayload): Promise<SendMessageResult> {
    const token = getToken(ctx);
    if (!token) return { success: false, error: "No bot token configured" };

    const chatId = payload.to?.trim();
    if (!chatId) return { success: false, error: "No chat_id provided (set recipient to the Telegram chat ID)" };

    try {
      const res  = await fetch(TG_API(token, "sendMessage"), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:    chatId,
          text:       payload.message,
          parse_mode: "Markdown",
        }),
      });
      const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!data.ok) return { success: false, error: data.description ?? "Telegram API error" };
      return { success: true, providerId: String(data.result?.message_id ?? "") };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async receive(_rawPayload: unknown): Promise<ReceiveMessagePayload | null> {
    // Inbound webhook processing is handled in routes/telegram.ts
    return null;
  },
};

// Self-register
IntegrationRegistry.register("telegram", telegramAdapter);
console.log("[IntegrationHub] Telegram adapter registered");

export { telegramAdapter };
