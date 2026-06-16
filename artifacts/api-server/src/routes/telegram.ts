import { Router } from "express";
import { randomBytes } from "crypto";
import OpenAI from "openai";
import {
  db, orgIntegrationsTable, integrationEventsTable,
  clientsTable, quotesTable, agentMemoryTable, organizationsTable, messagesTable,
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

// ── Helper: send a Telegram message ──────────────────────────────────────────
// Returns true on success. Logs every failure with full Telegram error detail.
async function tgSend(token: string, chatId: number, text: string): Promise<boolean> {
  const url = TG(token, "sendMessage");
  console.log(`[tgSend] → chat_id=${chatId} | text="${text.slice(0, 60)}..."`);

  // 1st attempt: plain text (no parse_mode) — safest, never fails on special chars
  try {
    const r = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await r.json() as { ok: boolean; description?: string; error_code?: number };
    if (body.ok) {
      console.log(`[tgSend] ✅ sent to chat_id=${chatId}`);
      return true;
    }
    console.error(`[tgSend] ❌ Telegram error ${body.error_code}: ${body.description} | chat_id=${chatId}`);
    return false;
  } catch (err) {
    console.error(`[tgSend] ❌ fetch exception for chat_id=${chatId}:`, err);
    return false;
  }
}

// ── Helper: get token for an org (DB first, then env var fallback) ───────────
async function getTelegramToken(orgId: number): Promise<string | null> {
  const [conn] = await db
    .select()
    .from(orgIntegrationsTable)
    .where(and(
      eq(orgIntegrationsTable.orgId, orgId),
      eq(orgIntegrationsTable.integrationSlug, "telegram"),
    ));
  if (conn?.credentialsEnc) {
    const creds = decryptCredentials(conn.credentialsEnc);
    if (creds.botToken) return creds.botToken as string;
  }
  // Fallback to environment variable
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

// ── AI reply for general Telegram messages ────────────────────────────────────
// This is the "Telegram → IA → Respuesta" flow.
// Called for every message that is NOT a quote acceptance/rejection keyword.
async function generateTelegramAIReply(params: {
  orgId:      number;
  orgName:    string;
  text:       string;
  senderName: string;
  client:     { name: string; status: string; company?: string | null; tags?: string | null; notes?: string | null } | null;
}): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  const { orgName, text, senderName, client } = params;

  // Load org agent memory (last 10 entries) for business context
  const memories = await db
    .select()
    .from(agentMemoryTable)
    .where(and(
      eq(agentMemoryTable.orgId, params.orgId),
      eq(agentMemoryTable.agentSlug, "operator"),
    ))
    .orderBy(desc(agentMemoryTable.updatedAt))
    .limit(10);

  const memoryBlock = memories.length > 0
    ? "\n\nCONOCIMIENTO DEL NEGOCIO:\n" +
      memories.map((m) => `- ${m.memoryKey}: ${String(m.content ?? "").slice(0, 120)}`).join("\n")
    : "";

  const clientBlock = client
    ? `\n\nCLIENTE IDENTIFICADO:\n- Nombre: ${client.name}\n- Estado: ${client.status}${client.company ? `\n- Empresa: ${client.company}` : ""}${client.tags ? `\n- Etiquetas: ${client.tags}` : ""}${client.notes ? `\n- Notas: ${String(client.notes).slice(0, 200)}` : ""}`
    : "";

  const systemPrompt =
    `Eres el asistente virtual de *${orgName}* en Telegram. Respondes en nombre del negocio de forma profesional, cálida y concisa.

REGLAS OBLIGATORIAS:
- Responde SIEMPRE en español
- Máximo 3-4 frases por respuesta (Telegram = mensajes cortos)
- Tono cercano pero profesional. Tutea al cliente (tú/te)
- Usa emojis con moderación (1-2 máximo)
- Si preguntan por servicios/precios que no conoces → ofrece ponerte en contacto
- Termina siempre con una pregunta o invitación a continuar
- NO menciones que eres IA ni GPT — eres el asistente del negocio
- NO inventes precios ni datos concretos que no te han dado${memoryBlock}${clientBlock}`;

  const userMessage = client
    ? `El cliente ${client.name} dice: "${text}"`
    : `Una persona llamada ${senderName || "un usuario"} escribe: "${text}"`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.7,
      max_tokens:  200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
    });
    return (completion.choices[0]?.message?.content ?? "").trim() || null;
  } catch (err) {
    console.error("[Telegram AI] OpenAI error:", err);
    return null;
  }
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

  // Auto-create contact if not found (task 4)
  if (!client && (senderName || username)) {
    try {
      const newName = senderName || username || `Telegram ${chatIdStr}`;
      const [created] = await db.insert(clientsTable).values({
        orgId,
        name:           newName,
        phone:          null,
        email:          null,
        status:         "prospect",
        telegramChatId: chatIdStr,
        notes:          `Contacto creado automáticamente desde Telegram\nChat ID: ${chatIdStr}${username ? `\nUsername: ${username}` : ""}\nUser ID: ${msg.from?.id ?? "?"}`,
      }).returning();
      client = created;
      console.log(`[Telegram] ✅ Auto-created contact: ${newName} (id=${created?.id})`);
      logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "inbound",
        eventType: "contact_created", status: "processed",
        summary: `Contacto creado automáticamente: ${newName} (chat_id: ${chatIdStr})`,
        payloadJson: JSON.stringify({ chatId, senderName, username, userId: msg.from?.id }),
      });
    } catch (err) {
      console.error("[Telegram] Auto-create contact failed:", err);
    }
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

  // 2. If client found, link telegram_chat_id and save inbound message to messages table
  if (client) {
    // Persist chat_id on client if not already set
    if (!client.telegramChatId || client.telegramChatId !== chatIdStr) {
      await db.update(clientsTable)
        .set({ telegramChatId: chatIdStr })
        .where(eq(clientsTable.id, client.id));
    }
    // Save inbound message
    await db.insert(messagesTable).values({
      orgId,
      clientId: client.id,
      content:  text.slice(0, 2000),
      direction: "inbound",
      isAi:     false,
      status:   "received",
    });
  }

  // 3. Log message_received
  await logIntegrationEvent({
    orgId,
    integrationSlug: "telegram",
    direction:   "inbound",
    eventType:   "message_received",
    status:      "processed",
    summary:     `Telegram de ${senderName || chatIdStr}${client ? ` (${client.name})` : ""}: "${text.slice(0, 80)}"`,
    payloadJson: JSON.stringify({ ...basePayload, quoteFound: false }),
  });

  // 4. Get token once — needed for both AI reply and quote flows
  const token = await getTelegramToken(orgId);
  console.log(`[Telegram] token available=${!!token} | orgId=${orgId} | chatId=${chatId}`);

  // 5. Plain message (no keyword) → Telegram → IA → Respuesta
  //    This is the main conversational flow for general questions.
  if (!isAccepted && !isRejected) {
    if (!token) {
      console.warn(`[Telegram AI] No token for orgId=${orgId} — cannot reply`);
      return;
    }

    // Get org name for bot persona
    const [org] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId));

    const orgName = org?.name ?? "nuestro negocio";

    const aiReply = await generateTelegramAIReply({
      orgId,
      orgName,
      text,
      senderName,
      client: client ?? null,
    });

    console.log(`[Telegram AI] reply generated=${!!aiReply} | len=${aiReply?.length ?? 0}`);

    const replyText = aiReply
      ?? `👋 ¡Hola${senderName ? `, ${senderName}` : ""}! Gracias por escribirnos. En breve un miembro de nuestro equipo te atenderá. ¿Podemos ayudarte en algo más?`;

    const sent = await tgSend(token, chatId, replyText);

    if (aiReply) {
      // Save AI reply to messages table (only when client is known)
      if (client) {
        await db.insert(messagesTable).values({
          orgId,
          clientId:  client.id,
          content:   aiReply.slice(0, 2000),
          direction: "outbound",
          isAi:      true,
          status:    sent ? "sent" : "failed",
        });
      }
      logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: sent ? "ai_reply_sent" : "ai_reply_failed",
        status:    sent ? "processed" : "error",
        summary:   `IA ${sent ? "respondió" : "NO enviada"} a ${senderName || chatIdStr}: "${aiReply.slice(0, 80)}"`,
        payloadJson: JSON.stringify({ ...basePayload, aiReply: aiReply.slice(0, 300), sent }),
      });
    }
    return;
  }

  // 5. Acceptance/rejection keyword flow

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

// ── GET /api/telegram/audit — event log for Telegram Inbox ───────────────────
telegramRouter.get("/audit", async (req, res) => {
  const orgId = (req as any).orgId as number;
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  try {
    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(and(
        eq(integrationEventsTable.orgId, orgId),
        eq(integrationEventsTable.integrationSlug, "telegram"),
      ))
      .orderBy(desc(integrationEventsTable.createdAt))
      .limit(limit);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/telegram/status — bot + webhook info + stats ────────────────────
telegramRouter.get("/status", async (req, res) => {
  const orgId = (req as any).orgId as number;
  try {
    const token = await getTelegramToken(orgId);

    // Bot info
    let botInfo: Record<string, unknown> | null = null;
    if (token) {
      try {
        const r = await fetch(TG(token, "getMe"));
        const j = await r.json() as { ok: boolean; result?: Record<string, unknown> };
        if (j.ok) botInfo = j.result ?? null;
      } catch { /* ignore */ }
    }

    // Webhook info
    let webhookInfo: Record<string, unknown> | null = null;
    if (token) {
      try {
        const r = await fetch(TG(token, "getWebhookInfo"));
        const j = await r.json() as { ok: boolean; result?: Record<string, unknown> };
        if (j.ok) webhookInfo = j.result ?? null;
      } catch { /* ignore */ }
    }

    // Conversation stats from integration_events
    const [row] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(and(
        eq(orgIntegrationsTable.orgId, orgId),
        eq(orgIntegrationsTable.integrationSlug, "telegram"),
      ));

    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(and(
        eq(integrationEventsTable.orgId, orgId),
        eq(integrationEventsTable.integrationSlug, "telegram"),
      ));

    const totalMessages  = events.filter((e) => e.eventType === "message_received").length;
    const totalReplied   = events.filter((e) => e.eventType === "message_sent").length;
    const totalAccepted  = events.filter((e) => e.eventType === "quote_accepted").length;
    const contactsCreated = events.filter((e) => e.eventType === "contact_created").length;

    // Unique conversations (by chatId in payloadJson)
    const chatIds = new Set<string>();
    for (const e of events) {
      if (e.payloadJson) {
        try {
          const p = JSON.parse(e.payloadJson as string);
          if (p.chatId) chatIds.add(String(p.chatId));
        } catch { /* ignore */ }
      }
    }

    res.json({
      connected:       !!token,
      hasCredentials:  !!token,
      envTokenPresent: !!process.env.TELEGRAM_BOT_TOKEN,
      botInfo,
      webhookInfo,
      config:          row?.config ?? null,
      connectedSince:  row?.createdAt ?? null,
      stats: {
        totalMessages,
        totalReplied,
        totalAccepted,
        contactsCreated,
        uniqueConversations: chatIds.size,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/telegram/send — send from CRM to a chat_id ─────────────────────
telegramRouter.post("/send", async (req, res) => {
  const orgId  = (req as any).orgId as number;
  const { chatId, message } = req.body as { chatId: number | string; message: string };

  if (!chatId || !message?.trim()) {
    res.status(400).json({ success: false, message: "Se requiere chatId y message." });
    return;
  }

  try {
    const token = await getTelegramToken(orgId);
    if (!token) {
      res.status(404).json({ success: false, message: "Bot token no configurado." });
      return;
    }

    const sent = await tgSend(token, Number(chatId), message.trim());
    if (!sent) {
      await logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: "message_send_failed", status: "error",
        summary: `Envío fallido → chat_id ${chatId}`,
        payloadJson: JSON.stringify({ chatId }),
      });
      res.json({ success: false, message: "No se pudo enviar el mensaje." });
      return;
    }

    // Save to messages table
    try {
      const client = await db.select().from(clientsTable).where(and(
        eq(clientsTable.orgId, orgId),
        eq(clientsTable.telegramChatId, String(chatId)),
      )).then((r) => r[0] ?? null);

      if (client) {
        await db.insert(messagesTable).values({
          clientId: client.id,
          channel:  "telegram",
          direction: "outbound",
          body:      message.trim(),
          status:    "sent",
          isAi:      false,
        });
      }
    } catch { /* non-critical */ }

    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "outbound",
      eventType: "message_sent", status: "processed",
      summary: `Mensaje enviado desde CRM → chat_id ${chatId}`,
      payloadJson: JSON.stringify({ chatId, preview: message.slice(0, 80) }),
    });

    res.json({ success: true, message: "Mensaje enviado correctamente." });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Auto-webhook setup (called on server startup) ─────────────────────────────
export async function autoSetupTelegramWebhooks(baseUrl: string): Promise<void> {
  try {
    // Find all orgs with telegram integration
    const integrations = await db
      .select()
      .from(orgIntegrationsTable)
      .where(eq(orgIntegrationsTable.integrationSlug, "telegram"));

    for (const integration of integrations) {
      const orgId = integration.orgId;
      const token = await getTelegramToken(orgId);
      if (!token) continue;

      // Get or create webhook secret
      let config = (integration.config ?? {}) as Record<string, unknown>;
      let secret = config.webhookSecret as string | undefined;
      if (!secret) {
        secret = randomBytes(24).toString("hex");
        config = { ...config, webhookSecret: secret };
        await db.update(orgIntegrationsTable).set({ config }).where(eq(orgIntegrationsTable.id, integration.id));
      }

      const webhookUrl = `${baseUrl}/api/telegram/webhook/${secret}`;

      // Check current webhook
      try {
        const infoRes  = await fetch(TG(token, "getWebhookInfo"));
        const infoJson = await infoRes.json() as { ok: boolean; result?: { url?: string } };
        const currentUrl = infoJson.result?.url ?? "";

        if (currentUrl === webhookUrl) {
          console.log(`[Telegram] Org ${orgId}: webhook already set → ${webhookUrl}`);
          continue;
        }

        const setRes  = await fetch(TG(token, "setWebhook"), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ url: webhookUrl }),
        });
        const setJson = await setRes.json() as { ok: boolean; description?: string };
        if (setJson.ok) {
          console.log(`[Telegram] ✅ Org ${orgId}: webhook set → ${webhookUrl}`);
        } else {
          console.error(`[Telegram] ❌ Org ${orgId}: setWebhook failed — ${setJson.description}`);
        }
      } catch (err) {
        console.error(`[Telegram] ❌ Org ${orgId}: auto-webhook error:`, err);
      }
    }
  } catch (err) {
    console.error("[Telegram] autoSetupTelegramWebhooks error:", err);
  }
}
