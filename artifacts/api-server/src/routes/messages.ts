import { Router, type RequestHandler } from "express";
import { db, messagesTable, clientsTable, activityTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
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
    GenerateAiReplyBody.parse(req.body);
    const replies = [
      `Thank you for reaching out! I'd be happy to help you with that. Let me get back to you with the details shortly.`,
      `Hi there! I've reviewed your message and I want to make sure we address your needs properly. Could you share more details?`,
      `Thanks for contacting us! We're reviewing your request and will follow up within 24 hours with a comprehensive response.`,
      `Great to hear from you! Based on what you've shared, I think we can definitely help. Let me check our schedule and get back to you.`,
      `Hello! I appreciate you reaching out. We take all inquiries seriously and will have an answer for you very soon.`,
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    res.json({ reply });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

export const conversationsHandler: RequestHandler = async (req, res) => {
  try {
    const orgId = req.orgId!;
    const clients = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId))
      .orderBy(desc(clientsTable.createdAt));

    const conversations = await Promise.all(
      clients.map(async (client) => {
        const [lastMsg] = await db
          .select()
          .from(messagesTable)
          .where(and(eq(messagesTable.clientId, client.id), eq(messagesTable.orgId, orgId)))
          .orderBy(desc(messagesTable.createdAt))
          .limit(1);

        if (!lastMsg) return null;

        return {
          clientId: client.id,
          clientName: client.name,
          clientPhone: client.phone ?? null,
          lastMessage: lastMsg.content,
          lastMessageAt: lastMsg.createdAt.toISOString(),
          unreadCount: 0,
        };
      })
    );

    res.json(conversations.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};
