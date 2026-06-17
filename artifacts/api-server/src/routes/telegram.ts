import { Router } from "express";
import { randomBytes } from "crypto";
import OpenAI from "openai";
import {
  db, orgIntegrationsTable, integrationEventsTable,
  clientsTable, quotesTable, agentMemoryTable, organizationsTable, messagesTable,
  knowledgeBaseTable, appointmentsTable, activityTable,
} from "@workspace/db";
import { eq, and, desc, asc, isNotNull, ne, ilike } from "drizzle-orm";
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

// ── LEAD_KEYWORDS for Phase 3 Lead Intelligence ──────────────────────────────
const LEAD_HOT_RE  = /\b(presupuesto|precio|coste|costo|cuánto cuesta|cuanto vale|contratar|contrataré|contrataré|demo|quiero contratar|quiero empezar|cómo contrato|propuesta|oferta comercial|me interesa contratar)\b/i;
const LEAD_WARM_RE = /\b(información|más info|más información|me interesa|interesado|interesada|saber más|cómo funciona|qué ofrecéis|qué servicios|qué hacéis|qué incluye|cuéntame más|qué es|podéis ayudarme)\b/i;

async function generateTelegramAIReply(params: {
  orgId:         number;
  orgName:       string;
  text:          string;
  senderName:    string;
  excludeMsgId?: number;  // ID of the just-saved inbound message — exclude from history
  client:        { id: number; name: string; status: string; leadScore?: string | null; company?: string | null; tags?: string | null; notes?: string | null } | null;
}): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  const { orgId, orgName, text, senderName, excludeMsgId, client } = params;

  // ── 1. Fetch concurrently: KB, memory, and conversation history ──────────────
  const [kbEntries, memories, rawHistoryRows] = await Promise.all([
    // Knowledge base — company info the bot can cite
    db.select()
      .from(knowledgeBaseTable)
      .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true)))
      .orderBy(asc(knowledgeBaseTable.sortOrder))
      .limit(25),

    // Agent memory — business context from operator
    db.select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, "operator")))
      .orderBy(desc(agentMemoryTable.updatedAt))
      .limit(8),

    // Conversation history — explicitly exclude current message by ID
    client
      ? db.select()
          .from(messagesTable)
          .where(
            excludeMsgId
              ? and(eq(messagesTable.orgId, orgId), eq(messagesTable.clientId, client.id), ne(messagesTable.id, excludeMsgId))
              : and(eq(messagesTable.orgId, orgId), eq(messagesTable.clientId, client.id)),
          )
          .orderBy(desc(messagesTable.createdAt))
          .limit(20)
      : Promise.resolve([]),
  ]);

  // Build chronological history (oldest → newest)
  const convHistory: { role: "user" | "assistant"; content: string }[] = (rawHistoryRows as typeof rawHistoryRows)
    .reverse()
    .map((m) => ({
      role:    m.direction === "outbound" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  // ── Debug logging ────────────────────────────────────────────────────────────
  console.log(
    `[TG Memoria] clientId=${client?.id ?? "null"} | excludeMsgId=${excludeMsgId ?? "none"} | ` +
    `historyRows=${rawHistoryRows.length} | kbEntries=${kbEntries.length} | memories=${memories.length}`,
  );
  if (convHistory.length > 0) {
    console.log(`[TG Memoria] Historial (${convHistory.length} msgs):`,
      convHistory.map((m, i) => `[${i}] ${m.role}: "${m.content.slice(0, 60)}"`).join(" | "),
    );
  } else {
    console.log(`[TG Memoria] ⚠️  Historial VACÍO — primera interacción o sin mensajes previos`);
  }

  // ── 2. Build context blocks ──────────────────────────────────────────────────
  const kbBlock = kbEntries.length > 0
    ? "\n\nBASE DE CONOCIMIENTO DE LA EMPRESA:\n" +
      kbEntries.map((e) => `[${e.category.toUpperCase()}] **${e.title}**\n${e.content.slice(0, 400)}`).join("\n\n")
    : "";

  const memoryBlock = memories.length > 0
    ? "\n\nCONTEXTO DEL NEGOCIO:\n" +
      memories.map((m) => `- ${m.memoryKey}: ${String(m.content ?? "").slice(0, 120)}`).join("\n")
    : "";

  const clientBlock = client
    ? `\n\nCLIENTE IDENTIFICADO:
- Nombre: ${client.name}
- Estado CRM: ${client.status}
- Lead Score: ${client.leadScore ?? "cold"}${client.company ? `\n- Empresa: ${client.company}` : ""}${client.tags ? `\n- Etiquetas: ${client.tags}` : ""}${client.notes ? `\n- Historial: ${String(client.notes).slice(0, 300)}` : ""}`
    : "";

  // Madrid date/time block so AI resolves "este jueves", "mañana", etc.
  const now    = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  const dateBlock = `\n\n🗓️ FECHA Y HORA ACTUAL (Madrid): ${dateStr}, ${timeStr}. Usa esta fecha para interpretar "hoy", "mañana", "este jueves" etc. al agendar citas.`;

  // ── 3. System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `Eres el asistente comercial inteligente de *${orgName}* en Telegram. Actúas como comercial consultivo senior.

MISIÓN: Convertir cada conversación en una oportunidad de negocio real.

FLUJO COMERCIAL ADAPTATIVO:
1. Captación → Saluda con energía y crea interés genuino
2. Descubrimiento → Pregunta abierta: ¿en qué puedo ayudarte?
3. Calificación → Entiende su situación: empresa, tamaño, necesidad urgente
4. Recogida de datos → Solicita nombre completo, empresa, email y teléfono de forma natural
5. Presentación → Presenta el servicio o módulo más adecuado a su necesidad
6. Presupuesto/Demo → Ofrece demo, llamada o envío de propuesta personalizada
7. Conversión → Cierra o escala: "Te pongo en contacto con uno de nuestros asesores ahora"

REGLAS OBLIGATORIAS:
- Responde SIEMPRE en español
- Máximo 3-4 frases por respuesta (Telegram = mensajes breves)
- Tono cálido, cercano y profesional. Tutea siempre (tú/te)
- 1-2 emojis por respuesta máximo
- SIEMPRE termina con una pregunta que avance la conversación
- NO menciones que eres IA ni GPT — eres el asistente del equipo
- NO inventes precios, datos o servicios no documentados
- Si detectas interés comercial → recoge datos de contacto
- Si no puedes resolver → escala: "Te pongo en contacto con un asesor"
- CITAS: Cuando el usuario proponga una fecha/hora para reunión, llamada o demo → llama SIEMPRE a create_appointment para guardarla en el CRM. No respondas confirmando sin haberla creado.
- IMPORTANTE: Recuerda TODO lo que el usuario te ha dicho en esta conversación${kbBlock}${memoryBlock}${clientBlock}${dateBlock}`;

  // ── 4. Tool definition: create_appointment ───────────────────────────────────
  const tgTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "create_appointment",
        description:
          "Crea una cita real en el calendario del CRM vinculada al cliente actual. " +
          "Úsala SIEMPRE que el usuario proponga una fecha y hora para reunión, llamada, demo o visita. " +
          "Interpreta fechas relativas ('este jueves', 'mañana', 'el lunes') usando la fecha actual del sistema.",
        parameters: {
          type: "object" as const,
          properties: {
            title: {
              type: "string",
              description: "Título de la cita. Ej: 'Llamada de presentación', 'Demo OmniTech', 'Reunión de seguimiento'.",
            },
            date: {
              type: "string",
              description: "Fecha en formato YYYY-MM-DD. Resuelve 'este jueves', 'mañana', etc. con la fecha actual del sistema.",
            },
            start_time: {
              type: "string",
              description: "Hora de inicio en formato HH:MM (24h). Ejemplo: '13:00'.",
            },
            duration_minutes: {
              type: "number",
              description: "Duración en minutos. Por defecto 60.",
            },
            description: {
              type: "string",
              description: "Notas o motivo de la cita. Opcional.",
            },
            location: {
              type: "string",
              description: "Lugar o enlace de videollamada. Opcional.",
            },
            type: {
              type: "string",
              enum: ["meeting", "call", "demo", "follow_up", "other"],
              description: "Tipo de cita. Por defecto 'call'.",
            },
          },
          required: ["title", "date", "start_time"],
        },
      },
    },
  ];

  // ── 5. Build messages array ───────────────────────────────────────────────────
  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...convHistory,
    { role: "user", content: text },
  ];

  console.log(
    `[TG Memoria] OpenAI call: ${openaiMessages.length} messages total ` +
    `(1 system + ${convHistory.length} history + 1 current)`,
  );

  try {
    const openai = new OpenAI({ apiKey });

    // ── First call: may return text OR a tool call ────────────────────────────
    const firstCall = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.72,
      max_tokens:  600,
      messages:    openaiMessages,
      tools:       tgTools,
      tool_choice: "auto",
    });

    const firstMsg = firstCall.choices[0]?.message;
    if (!firstMsg) return null;

    // ── Case A: direct text response (no tool call) ───────────────────────────
    if (!firstMsg.tool_calls || firstMsg.tool_calls.length === 0) {
      const reply = (firstMsg.content ?? "").trim();
      console.log(`[TG Memoria] Respuesta generada | tokens=${firstCall.usage?.total_tokens ?? 0} | len=${reply.length}`);
      return reply || null;
    }

    // ── Case B: tool call → execute it ───────────────────────────────────────
    const toolCall  = firstMsg.tool_calls[0]!;
    const toolName  = toolCall.function.name;
    const toolCallId = toolCall.id;
    let toolResult  = "";

    console.log(`[TG Tool] calling ${toolName} | args: ${toolCall.function.arguments}`);

    if (toolName === "create_appointment") {
      toolResult = await executeTelegramCreateAppointment(
        JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
        orgId,
        client,
      );
    } else {
      toolResult = JSON.stringify({ error: `Tool '${toolName}' no disponible en Telegram` });
    }

    console.log(`[TG Tool] ${toolName} result: ${toolResult.slice(0, 200)}`);

    // ── Second call: generate final human reply using tool result ─────────────
    const secondMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...openaiMessages,
      firstMsg,
      {
        role:         "tool",
        tool_call_id: toolCallId,
        content:      toolResult,
      },
    ];

    const secondCall = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.65,
      max_tokens:  400,
      messages:    secondMessages,
    });

    const finalReply = (secondCall.choices[0]?.message?.content ?? "").trim();
    const totalTokens = (firstCall.usage?.total_tokens ?? 0) + (secondCall.usage?.total_tokens ?? 0);
    console.log(`[TG Memoria] Respuesta generada | tokens=${totalTokens} | len=${finalReply.length}`);
    return finalReply || null;

  } catch (err) {
    console.error("[Telegram AI] OpenAI error:", err);
    return null;
  }
}

// ── Execute create_appointment for Telegram bot ────────────────────────────────
async function executeTelegramCreateAppointment(
  args: Record<string, unknown>,
  orgId: number,
  client: { id: number; name: string } | null,
): Promise<string> {
  try {
    const title           = String(args["title"]            ?? "Cita");
    const dateStr         = String(args["date"]             ?? "");
    const startTimeStr    = String(args["start_time"]       ?? "10:00");
    const durationMinutes = Number(args["duration_minutes"] ?? 60);
    const description     = args["description"] ? String(args["description"]) : null;
    const location        = args["location"]    ? String(args["location"])    : null;
    const apptType        = String(args["type"] ?? "call");

    if (!dateStr) {
      return JSON.stringify({ error: "Falta la fecha de la cita (format YYYY-MM-DD)." });
    }

    // Parse date + time → UTC timestamp
    const [h = "10", m = "00"] = startTimeStr.split(":");
    const [y, mo, d]           = dateStr.split("-").map(Number);
    if (!y || !mo || !d) {
      return JSON.stringify({ error: `Formato de fecha inválido: "${dateStr}". Usa YYYY-MM-DD.` });
    }
    const startTime = new Date(Date.UTC(y, mo - 1, d, parseInt(h), parseInt(m), 0));
    const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);

    // Resolve client: prefer the current Telegram client, fallback to org-wide search
    let resolvedClient = client
      ? await db.select().from(clientsTable)
          .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, client.id)))
          .then((r) => r[0] ?? null)
      : null;

    if (!resolvedClient) {
      return JSON.stringify({ error: "No se pudo identificar el cliente para esta cita. Asegúrate de que el contacto esté registrado en el CRM." });
    }

    const [appointment] = await db.insert(appointmentsTable).values({
      orgId,
      clientId:    resolvedClient.id,
      title,
      description,
      startTime,
      endTime,
      status:      "pending",
      type:        apptType,
      location,
      reminder:    false,
    }).returning();

    // Log activity (non-critical)
    const localDate = startTime.toLocaleDateString("es-ES", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      timeZone: "Europe/Madrid",
    });
    const localTime = `${h}:${m}`;

    await db.insert(activityTable).values({
      orgId,
      type:        "appointment_scheduled",
      description: `Cita "${title}" agendada con ${resolvedClient.name} para el ${localDate} a las ${localTime} (vía Telegram)`,
      clientName:  resolvedClient.name,
    }).catch(() => {/* non-critical */});

    // Log integration event
    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: "appointment_created", status: "processed",
      summary:     `Cita #${appointment!.id} creada: "${title}" con ${resolvedClient.name} el ${localDate} a las ${localTime}`,
      payloadJson: JSON.stringify({ appointmentId: appointment!.id, clientId: resolvedClient.id, date: dateStr, startTime: startTimeStr }),
    }).catch(() => {/* non-critical */});

    console.log(`[TG Appointment] ✅ Created appointment #${appointment!.id} | client=${resolvedClient.name} | ${dateStr} ${startTimeStr}`);

    return JSON.stringify({
      success:       true,
      appointmentId: appointment!.id,
      clientName:    resolvedClient.name,
      title,
      date:          localDate,
      time:          localTime,
      duration:      durationMinutes,
      status:        "pending",
      type:          apptType,
      description,
      location,
      message:       `Cita #${appointment!.id} creada en el CRM para ${resolvedClient.name} el ${localDate} a las ${localTime}.`,
    });
  } catch (err) {
    console.error("[TG Appointment] Error creating appointment:", err);
    return JSON.stringify({ error: String(err) });
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

  // ID of the just-saved inbound message (used to exclude it from history query)
  let savedInboundId: number | undefined;

  // 2. If client found, link telegram_chat_id and save inbound message to messages table
  if (client) {
    // Persist chat_id on client if not already set
    if (!client.telegramChatId || client.telegramChatId !== chatIdStr) {
      await db.update(clientsTable)
        .set({ telegramChatId: chatIdStr, updatedAt: new Date() })
        .where(eq(clientsTable.id, client.id));
    }
    // Save inbound message — use .returning() to get ID for history exclusion
    const [savedInbound] = await db.insert(messagesTable).values({
      orgId,
      clientId:  client.id,
      content:   text.slice(0, 2000),
      direction: "inbound",
      channel:   "telegram",
      isAi:      false,
      status:    "received",
    }).returning({ id: messagesTable.id });
    savedInboundId = savedInbound?.id;
    console.log(`[TG Memoria] Inbound saved: msgId=${savedInboundId ?? "?"} | clientId=${client.id}`);

    // ── Phase 3: Lead Intelligence detection ─────────────────────────────────
    const trimmedLower = text.toLowerCase();
    let newLeadScore: string | null = null;
    if (LEAD_HOT_RE.test(trimmedLower)) {
      newLeadScore = "caliente";
    } else if (LEAD_WARM_RE.test(trimmedLower) && client.leadScore !== "caliente") {
      newLeadScore = "tibio";
    }
    if (newLeadScore && newLeadScore !== client.leadScore) {
      db.update(clientsTable)
        .set({ leadScore: newLeadScore, leadIntent: text.slice(0, 500), updatedAt: new Date() })
        .where(eq(clientsTable.id, client.id))
        .catch((e) => console.error("[Lead Intelligence] update error:", e));
      logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "inbound",
        eventType: "lead_detected", status: "processed",
        summary:   `Lead ${newLeadScore} detectado · ${client.name}: "${text.slice(0, 80)}"`,
        payloadJson: JSON.stringify({ chatId, leadScore: newLeadScore, clientId: client.id }),
      });
    }
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
      excludeMsgId: savedInboundId,
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
          channel:   "telegram",
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
          orgId:     orgId,
          clientId:  client.id,
          channel:   "telegram",
          direction: "outbound",
          content:   message.trim().slice(0, 2000),
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

// ── GET /api/telegram/debug/:clientId — memory debug panel ───────────────────
telegramRouter.get("/debug/:clientId", async (req, res) => {
  const orgId    = (req as any).orgId as number;
  const clientId = Number(req.params.clientId);

  try {
    const [client, rawMessages, kbEntries, memories] = await Promise.all([
      db.select().from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, clientId)))
        .then((r) => r[0] ?? null),
      db.select().from(messagesTable)
        .where(and(eq(messagesTable.orgId, orgId), eq(messagesTable.clientId, clientId)))
        .orderBy(desc(messagesTable.createdAt))
        .limit(30),
      db.select({ title: knowledgeBaseTable.title, category: knowledgeBaseTable.category })
        .from(knowledgeBaseTable)
        .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true)))
        .limit(10),
      db.select({ key: agentMemoryTable.memoryKey })
        .from(agentMemoryTable)
        .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, "operator")))
        .limit(8),
    ]);

    if (!client) {
      res.status(404).json({ error: "Cliente no encontrado." });
      return;
    }

    // Simulate the history that would be sent to OpenAI
    // (as if we just received a new message and are about to reply)
    const simulatedHistory = [...rawMessages]
      .reverse()
      .map((m) => ({
        role:      m.direction === "outbound" ? "assistant" : "user",
        content:   m.content,
        isAi:      m.isAi,
        createdAt: m.createdAt,
        id:        m.id,
      }));

    res.json({
      client: {
        id:        client.id,
        name:      client.name,
        leadScore: client.leadScore,
        chatId:    client.telegramChatId,
      },
      summary: {
        totalMessages:  rawMessages.length,
        inboundCount:   rawMessages.filter((m) => m.direction === "inbound").length,
        outboundCount:  rawMessages.filter((m) => m.direction === "outbound").length,
        aiReplies:      rawMessages.filter((m) => m.isAi).length,
        kbEntries:      kbEntries.length,
        memories:       memories.length,
      },
      messages: rawMessages.map((m) => ({
        id:        m.id,
        direction: m.direction,
        isAi:      m.isAi,
        content:   m.content.slice(0, 200),
        createdAt: m.createdAt,
      })),
      contextSentToModel: {
        description: "Lo que se enviaría a OpenAI en el siguiente mensaje (excluye el último mensaje inbound)",
        historyMessages: simulatedHistory.slice(0, simulatedHistory.length > 1 ? simulatedHistory.length - 1 : 0),
        totalHistory: Math.max(0, simulatedHistory.length - 1),
        kbTitles: kbEntries.map((e) => `[${e.category}] ${e.title}`),
        memoryKeys: memories.map((m) => m.key),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/telegram/conversations — Phase 5 inbox list ─────────────────────
telegramRouter.get("/conversations", async (req, res) => {
  const orgId = (req as any).orgId as number;
  console.log(`[Telegram/conversations] orgId=${orgId}`);
  try {
    const clients = await db
      .select()
      .from(clientsTable)
      .where(and(
        eq(clientsTable.orgId, orgId),
        isNotNull(clientsTable.telegramChatId),
      ));

    console.log(`[Telegram/conversations] clients with telegram_chat_id: ${clients.length}`);

    const conversations = await Promise.all(clients.map(async (c) => {
      const [lastMsg] = await db
        .select()
        .from(messagesTable)
        .where(and(
          eq(messagesTable.orgId, orgId),
          eq(messagesTable.clientId, c.id),
          eq(messagesTable.channel, "telegram"),
        ))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);

      const countRows = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(and(
          eq(messagesTable.orgId, orgId),
          eq(messagesTable.clientId, c.id),
          eq(messagesTable.channel, "telegram"),
        ));

      return {
        clientId:            c.id,
        clientName:          c.name,
        chatId:              c.telegramChatId,
        leadScore:           c.leadScore ?? "cold",
        leadIntent:          c.leadIntent,
        status:              c.status,
        company:             c.company,
        phone:               c.phone,
        email:               c.email,
        lastMessage:         lastMsg?.content ?? null,
        lastMessageAt:       lastMsg?.createdAt ?? null,
        lastMessageDirection: lastMsg?.direction ?? null,
        lastMessageIsAi:     lastMsg?.isAi ?? null,
        messageCount:        countRows.length,
      };
    }));

    conversations.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    console.log(`[Telegram/conversations] returning ${conversations.length} conversations`);
    res.json(conversations);
  } catch (err) {
    console.error("[Telegram/conversations] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/telegram/conversations/:clientId — messages thread ───────────────
telegramRouter.get("/conversations/:clientId", async (req, res) => {
  const orgId    = (req as any).orgId as number;
  const clientId = Number(req.params.clientId);
  const limit    = Math.min(Number(req.query.limit ?? 100), 300);
  try {
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.orgId, orgId),
        eq(messagesTable.clientId, clientId),
      ))
      .orderBy(asc(messagesTable.createdAt))
      .limit(limit);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/telegram/conversations/:clientId/reply — manual CRM reply ──────
telegramRouter.post("/conversations/:clientId/reply", async (req, res) => {
  const orgId    = (req as any).orgId as number;
  const clientId = Number(req.params.clientId);
  const { message } = req.body as { message: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "Se requiere message." });
    return;
  }

  try {
    const client = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, clientId)))
      .then((r) => r[0] ?? null);

    if (!client?.telegramChatId) {
      res.status(404).json({ error: "Cliente sin chat_id de Telegram." });
      return;
    }

    const token = await getTelegramToken(orgId);
    if (!token) {
      res.status(404).json({ error: "Bot token no configurado." });
      return;
    }

    const sent = await tgSend(token, Number(client.telegramChatId), message.trim());

    await db.insert(messagesTable).values({
      orgId,
      clientId,
      content:   message.trim().slice(0, 2000),
      direction: "outbound",
      channel:   "telegram",
      isAi:      false,
      status:    sent ? "sent" : "failed",
    });

    await logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "outbound",
      eventType: sent ? "message_sent" : "message_send_failed",
      status:    sent ? "processed" : "error",
      summary:   `Respuesta manual desde CRM → ${client.name}: "${message.slice(0, 80)}"`,
      payloadJson: JSON.stringify({ clientId, chatId: client.telegramChatId }),
    });

    res.json({ success: sent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
      // config column is TEXT (JSON string) — must parse before spreading
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(integration.config ?? "{}"); } catch { config = {}; }
      let secret = config.webhookSecret as string | undefined;
      if (!secret) {
        secret = randomBytes(24).toString("hex");
        config = { ...config, webhookSecret: secret };
        await db.update(orgIntegrationsTable)
          .set({ config: JSON.stringify(config) })
          .where(eq(orgIntegrationsTable.id, integration.id));
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
