import { Router } from "express";
import { randomBytes } from "crypto";
import {
  db, orgIntegrationsTable, integrationEventsTable,
  clientsTable, quotesTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { decryptCredentials, logIntegrationEvent } from "../utils/integrationCreds";

// ── Two routers: one public (webhook), one authenticated ─────────────────────
export const telegramWebhookRouter = Router(); // mounted before requireAuth
export const telegramRouter        = Router(); // mounted after requireAuth

const TG = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

// ── Acceptance / rejection (same as WhatsApp) ─────────────────────────────────
const ACCEPTANCE_RE =
  /\b(acepto|aprobado?|apruebo|lo apruebo|aceptamos|lo acepto|s[ií] acepto|s[ií] confirmo|s[ií] quiero|de acuerdo|confirmado?|confirmamos|adelante|perfecto|estupendo|fenomenal|trato hecho|dale|ok|vale|por supuesto|claro que s[ií]|me parece bien|me va bien|lo quiero|lo tomamos|quiero seguir|acepto el presupuesto|apruebo el presupuesto|confirmo el presupuesto)\b/i;

const REJECTION_RE =
  /\b(rechazo|rechazado?|no acepto|no (lo )?quiero|cancelar?|cancelo|no me interesa|no por ahora|declin[oa]r?|denegado?|no procede|no gracias|lo descarto|no vamos a seguir|no seguimos)\b/i;

// ── Telegram Update types ──────────────────────────────────────────────────────
interface TgUser { id: number; first_name: string; last_name?: string; username?: string; }
interface TgMessage { message_id: number; from?: TgUser; chat: { id: number }; text?: string; }
interface TgUpdate { update_id: number; message?: TgMessage; }

// ── Helper: send a Telegram message (fire-and-forget safe) ───────────────────
async function tgSend(token: string, chatId: number, text: string): Promise<boolean> {
  try {
    const r = await fetch(TG(token, "sendMessage"), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Helper: get token for an org ─────────────────────────────────────────────
async function getTelegramToken(orgId: number): Promise<string | null> {
  const [conn] = await db
    .select()
    .from(orgIntegrationsTable)
    .where(and(
      eq(orgIntegrationsTable.orgId, orgId),
      eq(orgIntegrationsTable.integrationSlug, "telegram"),
    ));
  if (!conn?.credentialsEnc) return null;
  const creds = decryptCredentials(conn.credentialsEnc);
  return (creds.botToken as string | undefined) ?? null;
}

// ── Core: process one incoming Telegram message ───────────────────────────────
async function processIncomingTelegramMessage(orgId: number, msg: TgMessage): Promise<void> {
  const chatId    = msg.chat.id;
  const text      = (msg.text ?? "").trim();
  const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
  const username   = msg.from?.username ? `@${msg.from.username}` : null;
  const trimmed    = text.toLowerCase();

  const isAccepted = ACCEPTANCE_RE.test(trimmed);
  const isRejected = !isAccepted && REJECTION_RE.test(trimmed);

  // 1. Try to find a matching client by Telegram chat_id stored in notes/phone
  //    Fall back to name-based fuzzy match
  const allClients = await db.select().from(clientsTable)
    .where(eq(clientsTable.orgId, orgId));

  const chatIdStr  = String(chatId);
  let client = allClients.find((c) =>
    (c.phone && c.phone.includes(chatIdStr)) ||
    (c.notes && c.notes.includes(chatIdStr)),
  );

  // Fallback: name match (first name of Telegram sender vs client name)
  if (!client && senderName) {
    const nameLower = senderName.toLowerCase();
    client = allClients.find((c) => {
      const parts = c.name.toLowerCase().split(/\s+/);
      return parts.some((p) => nameLower.includes(p) || p.includes(nameLower.split(/\s+/)[0] ?? ""));
    });
  }

  const basePayload: Record<string, unknown> = {
    chatId,
    senderName,
    username,
    messageText:  text.slice(0, 200),
    clientFound:  !!client,
    clientId:     client?.id ?? null,
    clientName:   client?.name ?? null,
    isAccepted,
    isRejected,
  };

  // 2. Log message_received
  await logIntegrationEvent({
    orgId,
    integrationSlug: "telegram",
    direction:   "inbound",
    eventType:   "message_received",
    status:      "processed",
    summary:     `Telegram de ${senderName || chatIdStr}${client ? ` (${client.name})` : ""}: "${text.slice(0, 80)}"`,
    payloadJson: JSON.stringify({ ...basePayload, quoteFound: false }),
  });

  // 3. If no acceptance/rejection keyword — just log (no auto-reply for plain messages)
  if (!isAccepted && !isRejected) return;

  // 4. Find pending quote for this client
  const token = await getTelegramToken(orgId);

  if (!client) {
    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: isAccepted ? "quote_accepted" : "quote_rejected",
      status:    "error",
      summary:   `Keyword detectada pero cliente no encontrado — chat_id ${chatId}`,
      payloadJson: JSON.stringify({ ...basePayload, quoteFound: false, result: "no_client" }),
    });
    if (token) {
      await tgSend(token, chatId,
        "🤖 Recibido tu mensaje. No encontramos tu registro en el sistema. Contacta con nosotros directamente.",
      );
    }
    return;
  }

  const [quote] = await db.select().from(quotesTable)
    .where(and(
      eq(quotesTable.orgId, orgId),
      eq(quotesTable.clientId, client.id),
      eq(quotesTable.status, "sent"),
    ))
    .orderBy(desc(quotesTable.updatedAt))
    .limit(1);

  const newStatus = isAccepted ? "accepted" : "rejected";

  if (!quote) {
    if (token) {
      await tgSend(token, chatId,
        isAccepted
          ? `✅ ¡Gracias, ${client.name}! Hemos recibido tu confirmación. Nos ponemos en contacto contigo pronto.`
          : `👍 Entendido, ${client.name}. Hemos registrado tu respuesta.`,
      );
    }
    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: isAccepted ? "quote_accepted" : "quote_rejected",
      status:    "processed",
      summary:   `Keyword de ${newStatus} de ${client.name} — sin presupuesto enviado pendiente`,
      payloadJson: JSON.stringify({ ...basePayload, quoteFound: false, result: "no_pending_quote" }),
    });
    return;
  }

  // 5. Update quote + client
  await db.update(quotesTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(quotesTable.id, quote.id));

  if (isAccepted) {
    await db.update(clientsTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(clientsTable.id, client.id));
  }

  // 6. Auto-reply
  let autoReplySent = false;
  if (token) {
    const reply = isAccepted
      ? `✅ *¡Presupuesto aceptado!*\n\nGracias, ${client.name}. Hemos registrado tu confirmación del presupuesto *"${quote.title}"*.\n\nNos ponemos en contacto contigo para comenzar. 🚀`
      : `📋 *Presupuesto declinado*\n\nHemos registrado que no deseas continuar con *"${quote.title}"*, ${client.name}. Si cambias de opinión, estamos aquí.`;
    autoReplySent = await tgSend(token, chatId, reply);
  }

  // 7. Log the result
  await logIntegrationEvent({
    orgId, integrationSlug: "telegram", direction: "inbound",
    eventType: isAccepted ? "quote_accepted" : "quote_rejected",
    status:    "processed",
    summary:   `Presupuesto "${quote.title}" ${newStatus} por ${client.name} vía Telegram`,
    payloadJson: JSON.stringify({
      ...basePayload,
      quoteFound:    true,
      quoteId:       quote.id,
      quoteTitle:    quote.title,
      result:        newStatus,
      autoReplySent,
    }),
  });

  console.log(`[Telegram Webhook] ✅ Quote #${quote.id} "${quote.title}" ${newStatus} by ${client.name} | autoReply=${autoReplySent}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC WEBHOOK — Telegram calls this (no auth required)
// URL: POST /api/telegram/webhook/:secret
// ─────────────────────────────────────────────────────────────────────────────
telegramWebhookRouter.post("/webhook/:secret", (req, res) => {
  res.sendStatus(200); // Telegram needs an immediate 200

  const { secret } = req.params;
  const update = req.body as TgUpdate;

  void (async () => {
    try {
      // Lookup org by webhook secret stored in config
      const all = await db.select().from(orgIntegrationsTable)
        .where(eq(orgIntegrationsTable.integrationSlug, "telegram"));

      const conn = all.find((c) => {
        try {
          const cfg = JSON.parse(c.config ?? "{}") as { webhookSecret?: string };
          return cfg.webhookSecret === secret;
        } catch {
          return false;
        }
      });

      if (!conn) {
        console.warn(`[Telegram Webhook] Unknown secret: ${secret.slice(0, 8)}…`);
        return;
      }

      const msg = update.message;
      if (!msg?.text) return; // ignore non-text updates (stickers, photos, etc.)

      await processIncomingTelegramMessage(conn.orgId, msg);
    } catch (err) {
      console.error("[Telegram Webhook] Error:", err);
    }
  })();
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /verify — comprueba que el Bot Token es válido ──────────────────────
telegramRouter.post("/verify", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const token = await getTelegramToken(orgId);

    if (!token) {
      res.json({ success: false, message: "No hay credenciales guardadas. Guarda el Bot Token primero." });
      return;
    }

    const tgRes  = await fetch(TG(token, "getMe"));
    const tgData = await tgRes.json() as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };

    if (!tgData.ok) {
      await logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: "test_failed", status: "error",
        summary: "Verificación fallida — Token inválido",
        errorMessage: tgData.description ?? "Telegram rechazó el token",
        payloadJson: JSON.stringify(tgData),
      });
      res.json({ success: false, message: `Token inválido: ${tgData.description ?? "Error desconocido"}` });
      return;
    }

    const botName = tgData.result?.first_name ?? "Bot";
    const botUser = tgData.result?.username ? `@${tgData.result.username}` : "";

    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "outbound",
      eventType: "test_ok", status: "processed",
      summary: `Bot verificado — ${botName} ${botUser}`,
      payloadJson: JSON.stringify({ botName, botUser }),
    });

    res.json({ success: true, message: `Bot verificado: ${botName} ${botUser}`, botName, botUser });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── POST /set-webhook — registra el webhook URL en Telegram ──────────────────
telegramRouter.post("/set-webhook", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const token = await getTelegramToken(orgId);

    if (!token) {
      res.status(400).json({ success: false, message: "Guarda el Bot Token primero." });
      return;
    }

    // Generate or reuse a per-org webhook secret
    const [conn] = await db.select().from(orgIntegrationsTable)
      .where(and(
        eq(orgIntegrationsTable.orgId, orgId),
        eq(orgIntegrationsTable.integrationSlug, "telegram"),
      ));

    let webhookSecret: string;
    const existingConfig = JSON.parse(conn?.config ?? "{}") as { webhookSecret?: string };
    if (existingConfig.webhookSecret) {
      webhookSecret = existingConfig.webhookSecret;
    } else {
      webhookSecret = randomBytes(16).toString("hex");
    }

    // Determine the public base URL
    const host    = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : (req.headers["x-forwarded-host"]
        ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["x-forwarded-host"]}`
        : `${req.protocol}://${req.get("host")}`);
    const webhookUrl = `${host}/api/telegram/webhook/${webhookSecret}`;

    const tgRes  = await fetch(TG(token, "setWebhook"), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        url:             webhookUrl,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });
    const tgData = await tgRes.json() as { ok: boolean; description?: string };

    if (!tgData.ok) {
      res.json({ success: false, message: `Telegram rechazó el webhook: ${tgData.description ?? "Error desconocido"}` });
      return;
    }

    // Persist the secret in config
    const newConfig = JSON.stringify({ ...existingConfig, webhookSecret });
    await db.update(orgIntegrationsTable)
      .set({ config: newConfig, updatedAt: new Date() })
      .where(and(
        eq(orgIntegrationsTable.orgId, orgId),
        eq(orgIntegrationsTable.integrationSlug, "telegram"),
      ));

    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "outbound",
      eventType: "connected", status: "processed",
      summary: `Webhook registrado en Telegram → ${webhookUrl}`,
      payloadJson: JSON.stringify({ webhookUrl }),
    });

    res.json({ success: true, message: "Webhook registrado correctamente.", webhookUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── GET /webhook-info — estado actual del webhook según Telegram ─────────────
telegramRouter.get("/webhook-info", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const token = await getTelegramToken(orgId);
    if (!token) {
      res.json({ registered: false, url: null });
      return;
    }
    const r    = await fetch(TG(token, "getWebhookInfo"));
    const data = await r.json() as { ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } };
    const info = data.result;
    res.json({
      registered:           !!(info?.url),
      url:                  info?.url ?? null,
      pendingUpdates:       info?.pending_update_count ?? 0,
      lastError:            info?.last_error_message ?? null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── POST /test-send — envía mensaje de prueba a un chat_id ───────────────────
telegramRouter.post("/test-send", async (req, res) => {
  try {
    const orgId  = req.orgId!;
    const { chatId } = req.body as { chatId?: string };

    if (!chatId?.trim()) {
      res.status(400).json({ success: false, message: "Se requiere el Chat ID del destinatario." });
      return;
    }

    const token = await getTelegramToken(orgId);
    if (!token) {
      res.status(400).json({ success: false, message: "Bot Token no encontrado." });
      return;
    }

    const ok = await tgSend(token, Number(chatId.trim()), "✅ *OmniTech Core* — Integración Telegram activa. Este es un mensaje de prueba.");

    if (!ok) {
      await logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: "message_send_failed", status: "error",
        summary: `Prueba fallida → chat_id ${chatId}`,
        payloadJson: JSON.stringify({ chatId }),
      });
      res.json({ success: false, message: "No se pudo enviar el mensaje. Verifica el Chat ID." });
      return;
    }

    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "outbound",
      eventType: "test_sent", status: "processed",
      summary: `Mensaje de prueba enviado → chat_id ${chatId}`,
      payloadJson: JSON.stringify({ chatId }),
    });

    res.json({ success: true, message: "Mensaje enviado correctamente." });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});
