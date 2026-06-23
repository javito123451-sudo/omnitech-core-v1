import { Router, type RequestHandler } from "express";
import { db, messagesTable, clientsTable, activityTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { getProviderSingleton } from "../ai/types";
import {
  ListMessagesQueryParams,
  SendMessageBody,
  GenerateAiReplyBody,
} from "@workspace/api-zod";

export const messagesRouter = Router();

messagesRouter.get("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const query = ListMessagesQueryParams.parse(req.query);
    const rows = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.clientId, query.clientId), eq(messagesTable.orgId, orgId)))
      .orderBy(messagesTable.createdAt);

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

messagesRouter.post("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const body = SendMessageBody.parse(req.body);
    const [msg] = await db
      .insert(messagesTable)
      .values({
        orgId,
        clientId: body.clientId,
        content: body.content,
        direction: "outbound",
        isAi: body.isAi ?? false,
        status: "sent",
      })
      .returning();

    const [client] = await db
      .select({ name: clientsTable.name })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.orgId, orgId)));

    await db.insert(activityTable).values({
      orgId,
      type: "message_sent",
      description: `Message sent to ${client?.name ?? "client"}`,
      clientName: client?.name ?? null,
      userId: req.userId,
    });

    res.status(201).json({ ...msg, createdAt: msg.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

messagesRouter.post("/ai-reply", async (req, res) => {
  try {
    const body = GenerateAiReplyBody.parse(req.body);
    const orgId = req.orgId!;

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(503).json({ error: "AI deshabilitado — falta API key" });
      return;
    }

    const aiProvider = getProviderSingleton();

    const [org] = await db
      .select({ name: clientsTable.name })
      .from(clientsTable)
      .where(eq(clientsTable.id, body.clientId))
      .limit(1);

    const systemPrompt = `Eres el asistente AI de OmniTech Core. Ayudas a equipos de ventas a responder a clientes de forma profesional y concisa. Responde SIEMPRE en español. Máximo 3-4 frases. Tono profesional pero cálido.`;

    const result = await aiProvider.generate([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Contexto del cliente: ${body.context || "Ninguno"}. \n\nMensaje del cliente: "${body.message}". \n\nGenera una respuesta profesional apropiada.` },
    ], {
      model:       "gpt-4o-mini",
      temperature: 0.7,
      maxTokens:   250,
    });

    const reply = result.text.trim();
    res.json({ reply: reply || "Gracias por tu mensaje. Te responderemos en breve." });
  } catch (err) {
    console.error("[AI Reply] Error:", err);
    res.status(500).json({ error: "Error generando respuesta AI" });
  }
});

export const conversationsHandler: RequestHandler = async (req, res) => {
  try {
    const orgId = req.orgId!;

    // 2 queries total (not N+1) — fetch all clients and messages in batch
    const clients = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId));

    const allMessages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.orgId, orgId))
      .orderBy(desc(messagesTable.createdAt));

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const msgsByClient = new Map<number, typeof allMessages>();
    for (const msg of allMessages) {
      const list = msgsByClient.get(msg.clientId) ?? [];
      list.push(msg);
      msgsByClient.set(msg.clientId, list);
    }

    const conversations = [];
    for (const [clientId, msgs] of msgsByClient.entries()) {
      const client = clientMap.get(clientId);
      if (!client || msgs.length === 0) continue;
      const last = msgs[0];
      const unread = msgs.filter((m) => m.direction === "inbound").length;
      conversations.push({
        clientId,
        clientName: client.name,
        clientPhone: client.phone ?? null,
        lastMessage: last.content,
        lastMessageAt: last.createdAt.toISOString(),
        unreadCount: unread,
      });
    }

    // Sort by most recent message
    conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    res.json(conversations);
  } catch (err) {
    console.error("[conversationsHandler] error:", err);
    res.status(500).json({ error: String(err) });
  }
};
