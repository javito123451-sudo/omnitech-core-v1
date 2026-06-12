import { Router } from "express";
import { db, orgIntegrationsTable, integrationEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptCredentials, logIntegrationEvent } from "../utils/integrationCreds";

export const telegramRouter = Router();

const TG = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

// ── POST /verify — comprueba que el Bot Token es válido ──────────────────────
telegramRouter.post("/verify", async (req, res) => {
  try {
    const orgId = req.orgId!;

    const [conn] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, "telegram"),
        ),
      );

    if (!conn?.credentialsEnc) {
      res.json({ success: false, message: "No hay credenciales guardadas. Guarda el Bot Token primero." });
      return;
    }

    const creds = decryptCredentials(conn.credentialsEnc);
    const token = creds.botToken as string | undefined;

    if (!token) {
      res.json({ success: false, message: "Bot Token no encontrado en las credenciales." });
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

// ── POST /test-send — envía mensaje de prueba a un chat_id ───────────────────
telegramRouter.post("/test-send", async (req, res) => {
  try {
    const orgId  = req.orgId!;
    const { chatId } = req.body as { chatId?: string };

    if (!chatId?.trim()) {
      res.status(400).json({ success: false, message: "Se requiere el Chat ID del destinatario." });
      return;
    }

    const [conn] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, "telegram"),
        ),
      );

    if (!conn?.credentialsEnc) {
      res.status(400).json({ success: false, message: "Integración Telegram no configurada." });
      return;
    }

    const creds = decryptCredentials(conn.credentialsEnc);
    const token = creds.botToken as string | undefined;

    if (!token) {
      res.status(400).json({ success: false, message: "Bot Token no encontrado." });
      return;
    }

    const text = "✅ *OmniTech Core* — Integración Telegram activa. Este es un mensaje de prueba.";

    const tgRes  = await fetch(TG(token, "sendMessage"), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId.trim(), text, parse_mode: "Markdown" }),
    });
    const tgData = await tgRes.json() as { ok: boolean; description?: string };

    if (!tgData.ok) {
      await logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: "message_send_failed", status: "error",
        summary: `Prueba fallida → chat_id ${chatId}`,
        errorMessage: tgData.description ?? "Error enviando mensaje",
        payloadJson: JSON.stringify({ chatId, error: tgData.description }),
      });
      res.json({ success: false, message: `Error: ${tgData.description ?? "No se pudo enviar el mensaje"}` });
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
