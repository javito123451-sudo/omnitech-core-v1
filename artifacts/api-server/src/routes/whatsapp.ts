import { Router } from "express";
import {
  db,
  clientsTable,
  activityTable,
  appointmentsTable,
  messagesTable,
  quotesTable,
  agentMemoryTable,
  integrationEventsTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, desc, gt, isNotNull, inArray } from "drizzle-orm";
import OpenAI from "openai";
import {
  getWhatsAppCreds,
  resolveWhatsAppVerifyTokens,
  logIntegrationEvent,
} from "../utils/integrationCreds";

export const whatsappRouter = Router();
export const whatsappWebhookRouter = Router();

// ── Meta webhook payload types ────────────────────────────────────────────────
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

// ── Acceptance / rejection keyword detection ──────────────────────────────────
const ACCEPTANCE_RE =
  /\b(acepto|aprobado?|apruebo|lo apruebo|aceptamos|lo acepto|s[ií] acepto|s[ií] confirmo|s[ií] quiero|de acuerdo|confirmado?|confirmamos|adelante|perfecto|estupendo|fenomenal|trato hecho|dale|ok|vale|por supuesto|claro que s[ií]|me parece bien|me va bien|lo quiero|lo tomamos|quiero seguir|acepto el presupuesto|apruebo el presupuesto|confirmo el presupuesto)\b/i;

const REJECTION_RE =
  /\b(rechazo|rechazado?|no acepto|no (lo )?quiero|cancelar?|cancelo|no me interesa|no por ahora|declin[oa]r?|denegado?|no procede|no gracias|lo descarto|no vamos a seguir|no seguimos)\b/i;

// ── Phone normalization — compare last 9 digits ───────────────────────────────
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

// ── Send WhatsApp message with full logging ───────────────────────────────────
async function sendAutoReply(orgId: number, toPhone: string, message: string): Promise<boolean> {
  const toClean = toPhone.replace(/\D/g, "");
  try {
    const creds = await getWhatsAppCreds(orgId);
    if (!creds) {
      console.warn(`[waSend] ❌ Sin credenciales WhatsApp para org ${orgId} — mensaje no enviado`);
      return false;
    }
    console.log(`[waSend] → to=+${toClean.slice(-9)} | org=${orgId} | text="${message.slice(0, 60)}..."`);

    const r = await fetch(
      "https://graph.facebook.com/v19.0/" + creds.phoneNumberId + "/messages",
      {
        method:  "POST",
        headers: { "Authorization": "Bearer " + creds.accessToken, "Content-Type": "application/json" },
        body:    JSON.stringify({
          messaging_product: "whatsapp",
          to:   toClean,
          type: "text",
          text: { body: message },
        }),
      },
    );
    const body = await r.json() as { messages?: { id: string }[]; error?: { message: string; code?: number } };
    if (r.ok) {
      console.log(`[waSend] ✅ enviado a +${toClean.slice(-9)} | msgId=${body.messages?.[0]?.id ?? "?"}`);
      return true;
    }
    console.error(`[waSend] ❌ Meta error ${r.status}: ${body.error?.message ?? JSON.stringify(body)} | to=+${toClean.slice(-9)}`);
    return false;
  } catch (err) {
    console.error(`[waSend] ❌ excepción de red a +${toClean.slice(-9)}:`, err);
    return false;
  }
}

// ── AI reply generation for WhatsApp messages ─────────────────────────────────
async function generateWhatsAppAIReply(params: {
  orgId:     number;
  orgName:   string;
  text:      string;
  fromPhone: string;
  client:    { name: string; status: string; company?: string | null; tags?: string | null; notes?: string | null } | null;
}): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  const { orgName, text, fromPhone, client } = params;

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
      memories.map((m) => `- ${m.memoryKey}: ${String(m.memoryVal ?? "").slice(0, 120)}`).join("\n")
    : "";

  const clientBlock = client
    ? `\n\nCLIENTE IDENTIFICADO:\n- Nombre: ${client.name}\n- Estado: ${client.status}${client.company ? `\n- Empresa: ${client.company}` : ""}${client.tags ? `\n- Etiquetas: ${client.tags}` : ""}${client.notes ? `\n- Notas: ${String(client.notes).slice(0, 200)}` : ""}`
    : "";

  const systemPrompt =
    `Eres el asistente virtual de ${orgName} en WhatsApp Business. Respondes en nombre del negocio de forma profesional, cálida y concisa.

REGLAS OBLIGATORIAS:
- Responde SIEMPRE en español
- Máximo 3-4 frases por respuesta (WhatsApp = mensajes cortos)
- Tono cercano pero profesional. Tutea al cliente (tú/te)
- Usa emojis con moderación (1-2 máximo)
- Si preguntan por servicios o precios que no conoces, ofrece ponerte en contacto
- Termina siempre con una pregunta o invitación a continuar
- NO menciones que eres IA ni GPT — eres el asistente del negocio
- NO inventes precios ni datos concretos que no te han dado${memoryBlock}${clientBlock}`;

  const userMessage = client
    ? `El cliente ${client.name} escribe: "${text}"`
    : `Un usuario desde el número +${fromPhone.slice(-9)} escribe: "${text}"`;

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
    console.error("[WhatsApp AI] Generación fallida:", err);
    return null;
  }
}

// ── Core: process one incoming WhatsApp message ───────────────────────────────
async function processIncomingMessage(payload: {
  fromPhone:   string;
  text:        string;
  waMessageId: string;
}): Promise<void> {
  const { fromPhone, text } = payload;
  const normalizedIncoming  = normalizePhone(fromPhone);

  // 1. Find client by phone (across all orgs — normalize & compare last 9 digits)
  const allWithPhone = await db
    .select()
    .from(clientsTable)
    .where(isNotNull(clientsTable.phone));

  const client = allWithPhone.find((c) =>
    c.phone ? normalizePhone(c.phone) === normalizedIncoming : false,
  );

  // Log message_received with structured payload
  const basePayload: Record<string, unknown> = {
    phone:       fromPhone,
    phoneNorm:   normalizedIncoming,
    messageText: text.slice(0, 200),
    clientFound: !!client,
    clientId:    client?.id ?? null,
    clientName:  client?.name ?? null,
  };

  if (!client) {
    console.log(`[WhatsApp Webhook] Sin cliente para +${fromPhone} (${normalizedIncoming}) — mensaje no almacenado`);
    // Log for audit visibility even when no client matched
    logIntegrationEvent({
      orgId:           1, // generic — no org known
      integrationSlug: "whatsapp",
      direction:       "inbound",
      eventType:       "message_unknown_sender",
      status:          "processed",
      summary:         `Mensaje de número desconocido +${fromPhone.slice(-9)}: "${text.slice(0, 80)}"`,
      payloadJson:     { phone: fromPhone, phoneNorm: normalizedIncoming, messageText: text.slice(0, 200), clientFound: false },
    });
    return;
  }

  const orgId = client.orgId;

  // Lookup org name for AI context
  let orgName = "Nuestro negocio";
  try {
    const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (org?.name) orgName = org.name;
  } catch { /* non-critical */ }

  // 2. Store the inbound message
  await db.insert(messagesTable).values({
    orgId,
    clientId:  client.id,
    content:   text,
    direction: "inbound",
    isAi:      false,
    status:    "received",
  }).catch((err) => console.error("[WhatsApp Webhook] Message save failed:", err));

  // 3. Log activity
  await db.insert(activityTable).values({
    orgId,
    type:        "whatsapp_received",
    description: `Mensaje de ${client.name} vía WhatsApp: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`,
    clientName:  client.name,
  }).catch(() => {/* non-critical */});

  const trimmed = text.trim();

  // 4. Check for acceptance / rejection keywords
  const isAccepted = ACCEPTANCE_RE.test(trimmed);
  const isRejected = !isAccepted && REJECTION_RE.test(trimmed);

  // 5. Find the most recent sent/pending quote for this client
  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(
      and(
        eq(quotesTable.orgId,    orgId),
        eq(quotesTable.clientId, client.id),
        inArray(quotesTable.status, ["sent", "pending"]),
      ),
    )
    .orderBy(desc(quotesTable.updatedAt))
    .limit(1);

  const quotePayload = {
    quoteFound:    !!quote,
    quoteId:       quote?.id ?? null,
    quoteTitle:    quote?.title ?? null,
    quoteTotal:    quote?.total ?? null,
    quoteCurrency: quote?.currency ?? "EUR",
  };

  // 6. Log integration event — message received
  logIntegrationEvent({
    orgId,
    integrationSlug: "whatsapp",
    direction:       "inbound",
    eventType:       "message_received",
    status:          "processed",
    summary:         `Mensaje de ${client.name} (+${fromPhone.slice(-9)}): "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`,
    payloadJson:     {
      ...basePayload,
      ...quotePayload,
      isAcceptanceKeyword: isAccepted,
      isRejectionKeyword:  isRejected,
      result: isAccepted ? "keyword_accepted" : isRejected ? "keyword_rejected" : "no_keyword",
    },
  });

  // ── 7. Keyword path: acceptance / rejection with a pending quote ──────────────
  if ((isAccepted || isRejected) && quote) {

    const newQuoteStatus = isAccepted ? "accepted" : "rejected";
    const activityType   = isAccepted ? "quote_accepted" : "quote_rejected";
    const totalFormatted = new Intl.NumberFormat("es-ES", {
      style: "currency", currency: quote.currency ?? "EUR",
    }).format(quote.total ?? 0);
    const verb = isAccepted ? "ACEPTADO" : "RECHAZADO";

    // Update quote status
    await db
      .update(quotesTable)
      .set({ status: newQuoteStatus, updatedAt: new Date() })
      .where(eq(quotesTable.id, quote.id));

    // Promote client to "active" on acceptance (never demote)
    let clientPromoted = false;
    if (isAccepted && client.status !== "active") {
      await db
        .update(clientsTable)
        .set({ status: "active" })
        .where(eq(clientsTable.id, client.id));
      clientPromoted = true;
    }

    // Log activity feed
    await db.insert(activityTable).values({
      orgId,
      type:        activityType,
      description: `Presupuesto "${quote.title}" ${verb} por ${client.name} vía WhatsApp — ${totalFormatted}`,
      clientName:  client.name,
    });

    // Create memory entry (only on acceptance)
    let memoryCreated = false;
    if (isAccepted) {
      const memKey = `ventas:presupuesto_aceptado_${quote.id}`;
      const memVal = `Presupuesto "${quote.title}" ACEPTADO por ${client.name} vía WhatsApp el ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}. Importe: ${totalFormatted}. Cliente ascendido a activo automáticamente.`;
      await db
        .insert(agentMemoryTable)
        .values({
          orgId,
          agentSlug: "crm-assistant",
          memoryKey: memKey,
          memoryVal: memVal,
          title:     `Venta cerrada — ${client.name}`,
          category:  "ventas",
          tags:      "presupuesto,aceptado,whatsapp,automático",
          source:    "whatsapp_webhook",
        })
        .onConflictDoUpdate({
          target: [agentMemoryTable.orgId, agentMemoryTable.agentSlug, agentMemoryTable.memoryKey],
          set: { memoryVal: memVal, updatedAt: new Date() },
        })
        .catch((err) => console.error("[WhatsApp Webhook] Memory insert failed:", err));
      memoryCreated = true;
    }

    // Send keyword-specific auto-reply
    const keywordReplyText = isAccepted
      ? `¡Hola ${client.name.split(" ")[0]}! ✅ Hemos registrado tu confirmación del presupuesto "${quote.title}" por ${totalFormatted}. Nos pondremos en contacto contigo muy pronto para coordinar los próximos pasos. ¡Muchas gracias!`
      : `Hola ${client.name.split(" ")[0]}, hemos recibido tu respuesta sobre el presupuesto "${quote.title}". Si tienes alguna duda o quieres hablar sobre alternativas, estamos a tu disposición. ¡Gracias por considerarnos!`;

    const autoReplySent = await sendAutoReply(orgId, fromPhone, keywordReplyText);

    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "inbound",
      eventType:       isAccepted ? "quote_accepted" : "quote_rejected",
      status:          "processed",
      summary:         `Presupuesto "${quote.title}" ${verb} por ${client.name} — ${totalFormatted}`,
      payloadJson:     {
        phone: fromPhone, phoneNorm: normalizedIncoming,
        clientId: client.id, clientName: client.name, clientPromoted,
        quoteId: quote.id, quoteTitle: quote.title, quoteTotal: quote.total,
        quoteCurrency: quote.currency ?? "EUR", totalFormatted,
        result: newQuoteStatus, memoryCreated, autoReplySent,
      },
    });

    if (autoReplySent) {
      await db.insert(activityTable).values({
        orgId,
        type:        "whatsapp_sent",
        description: `Respuesta automática enviada a ${client.name} tras ${verb.toLowerCase()} presupuesto "${quote.title}"`,
        clientName:  client.name,
      }).catch(() => {});
    }

    console.log(`[WhatsApp Webhook] ✅ Quote #${quote.id} "${quote.title}" ${newQuoteStatus} by ${client.name} | memory=${memoryCreated} | autoReply=${autoReplySent}`);
    return; // keyword path handled — skip AI reply
  }

  // ── 8. AI reply for all other messages (no keyword match, or keyword without quote) ──
  console.log(`[WhatsApp Webhook] Generando respuesta IA para ${client.name} (+${fromPhone.slice(-9)})`);
  const aiReply = await generateWhatsAppAIReply({
    orgId,
    orgName,
    text,
    fromPhone,
    client,
  });

  if (!aiReply) {
    console.warn(`[WhatsApp Webhook] Sin respuesta IA para ${client.name} — OPENAI_API_KEY no configurada o error`);
    return;
  }

  // Store AI reply in messages table
  await db.insert(messagesTable).values({
    orgId,
    clientId:  client.id,
    content:   aiReply,
    direction: "outbound",
    isAi:      true,
    status:    "sent",
  }).catch((err) => console.error("[WhatsApp Webhook] AI message save failed:", err));

  // Send via WhatsApp Business API
  const aiSent = await sendAutoReply(orgId, fromPhone, aiReply);

  // Update message status if send failed
  if (!aiSent) {
    await db.update(messagesTable)
      .set({ status: "failed" })
      .where(and(
        eq(messagesTable.orgId,     orgId),
        eq(messagesTable.clientId,  client.id),
        eq(messagesTable.direction, "outbound"),
        eq(messagesTable.isAi,      true),
      ))
      .catch(() => {});
  }

  logIntegrationEvent({
    orgId,
    integrationSlug: "whatsapp",
    direction:       "outbound",
    eventType:       aiSent ? "ai_reply_sent" : "ai_reply_failed",
    status:          aiSent ? "processed" : "error",
    summary:         `IA ${aiSent ? "respondió" : "NO enviada"} a ${client.name}: "${aiReply.slice(0, 80)}${aiReply.length > 80 ? "…" : ""}"`,
    payloadJson:     { phone: fromPhone, clientId: client.id, clientName: client.name, aiReply, sent: aiSent },
  });

  if (aiSent) {
    await db.insert(activityTable).values({
      orgId,
      type:        "whatsapp_sent",
      description: `IA respondió a ${client.name} vía WhatsApp: "${aiReply.slice(0, 80)}${aiReply.length > 80 ? "…" : ""}"`,
      clientName:  client.name,
    }).catch(() => {});
  }

  console.log(`[WhatsApp Webhook] ${aiSent ? "✅" : "❌"} AI reply to ${client.name} | sent=${aiSent}`);
}

// ── GET /whatsapp/webhook — Meta hub verification (PUBLIC, no auth) ────────────
// Supports both env var token and per-org DB tokens for multi-tenant setups
whatsappWebhookRouter.get("/webhook", async (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"];

  if (mode !== "subscribe" || !token) {
    res.sendStatus(403);
    return;
  }

  try {
    const validTokens = await resolveWhatsAppVerifyTokens();
    if (validTokens.includes(token)) {
      console.log("[WhatsApp Webhook] ✅ Verified by Meta");
      res.status(200).send(String(challenge));
    } else {
      console.warn("[WhatsApp Webhook] ❌ Verification failed — token mismatch");
      res.sendStatus(403);
    }
  } catch (err) {
    console.error("[WhatsApp Webhook] Verification error:", err);
    res.sendStatus(403);
  }
});

// ── POST /whatsapp/webhook — Incoming messages (PUBLIC, no auth) ──────────────
whatsappWebhookRouter.post("/webhook", (req, res) => {
  // Meta requires an immediate 200 — process asynchronously
  res.sendStatus(200);

  const body = req.body as MetaWebhookPayload;
  if (!body || body.object !== "whatsapp_business_account") return;

  void (async () => {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        for (const msg of change.value.messages ?? []) {
          if (msg.type !== "text") continue;
          await processIncomingMessage({
            fromPhone:   msg.from,
            text:        msg.text?.body ?? "",
            waMessageId: msg.id,
          }).catch((err) =>
            console.error("[WhatsApp Webhook] Processing error:", err),
          );
        }
      }
    }
  })();
});

// ── Message type definitions ──────────────────────────────────────────────────
type MessageType = "seguimiento" | "cita" | "recuperar";

function buildSystemPrompt(type: MessageType): string {
  const base = `Eres un experto en comunicación comercial para WhatsApp en español.
Genera mensajes profesionales, cálidos y personalizados optimizados para WhatsApp Business.

Reglas OBLIGATORIAS:
- Máximo 350 caracteres (WhatsApp es informal, sé conciso)
- Tutear al cliente (tú, te, tu) en tono cercano pero profesional
- Usar 1-2 emojis relevantes, no más
- Terminar SIEMPRE con una pregunta o CTA claro
- NO usar plantillas genéricas. El mensaje debe sonar genuinamente personal
- Incluir el nombre del cliente
- Solo el texto del mensaje, sin explicaciones ni comillas`;

  if (type === "seguimiento") {
    return base + `\n\nTIPO: Seguimiento comercial. El objetivo es saber cómo va el cliente, recordarle tu servicio/propuesta y mantener la relación activa.`;
  }
  if (type === "cita") {
    return base + `\n\nTIPO: Confirmación de cita. El objetivo es confirmar asistencia, recordar fecha/hora y generar anticipación positiva.`;
  }
  return base + `\n\nTIPO: Recuperación de cliente inactivo. El objetivo es reactivar el contacto con un cliente que no responde o lleva tiempo sin interacción. Mencionar algo concreto de su historial.`;
}

function buildUserPrompt(
  type: MessageType,
  client: { name: string; company?: string | null; status: string; tags?: string | null; notes?: string | null; value?: number | null },
  activity: { type: string; description: string; createdAt: Date }[],
  nextAppointment: { title: string; startTime: Date; location?: string | null } | null,
): string {
  const parts: string[] = [];

  parts.push("DATOS DEL CLIENTE:");
  parts.push("- Nombre: " + client.name);
  if (client.company) parts.push("- Empresa: " + client.company);
  parts.push("- Estado: " + client.status);
  if (client.tags)  parts.push("- Etiquetas: " + client.tags);
  if (client.notes) parts.push("- Notas CRM: " + client.notes);
  if (client.value) parts.push("- Valor estimado: " + client.value + " EUR");

  if (nextAppointment) {
    parts.push("\nPRÓXIMA CITA:");
    parts.push("- Servicio: " + nextAppointment.title);
    parts.push("- Fecha: " + nextAppointment.startTime.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
    parts.push("- Hora: " + nextAppointment.startTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
    if (nextAppointment.location) parts.push("- Lugar: " + nextAppointment.location);
  }

  if (activity.length > 0) {
    parts.push("\nHISTORIAL CRM (últimas interacciones):");
    activity.slice(0, 6).forEach((a) => {
      const date = a.createdAt.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      parts.push("- [" + date + "] " + a.type + ": " + a.description);
    });
  }

  const typeLabel =
    type === "seguimiento" ? "SEGUIMIENTO COMERCIAL" :
    type === "cita"        ? "CONFIRMACION DE CITA"  : "RECUPERACION DE CLIENTE";

  parts.push("\nGENERA UN MENSAJE DE " + typeLabel + " para WhatsApp.");

  return parts.join("\n");
}

// ── POST /generate ────────────────────────────────────────────────────────────
whatsappRouter.post("/generate", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId = req.orgId!;
  const { clientId, messageType } = req.body as { clientId: number; messageType: MessageType };

  if (!clientId || !messageType) {
    res.status(400).json({ error: "clientId y messageType son obligatorios" }); return;
  }
  if (!["seguimiento", "cita", "recuperar"].includes(messageType)) {
    res.status(400).json({ error: "messageType inválido" }); return;
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const activity = await db
    .select()
    .from(activityTable)
    .where(and(eq(activityTable.orgId, orgId), eq(activityTable.clientName, client.name)))
    .orderBy(desc(activityTable.createdAt))
    .limit(10);

  const now = new Date();
  const upcomingAppointments = await db
    .select()
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.orgId, orgId), eq(appointmentsTable.clientId, clientId), gt(appointmentsTable.startTime, now)))
    .orderBy(appointmentsTable.startTime)
    .limit(1);
  const nextAppointment = upcomingAppointments[0] ?? null;

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 200,
    messages: [
      { role: "system", content: buildSystemPrompt(messageType) },
      { role: "user",   content: buildUserPrompt(messageType, client, activity, nextAppointment ? { title: nextAppointment.title, startTime: nextAppointment.startTime, location: nextAppointment.location } : null) },
    ],
  });

  const message = (completion.choices[0]?.message?.content ?? "").trim();

  const phone = (client.phone ?? "").replace(/\D/g, "");
  const openWhatsAppUrl = phone
    ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message)
    : "https://wa.me/?text=" + encodeURIComponent(message);

  res.json({
    message,
    characterCount: message.length,
    type: messageType,
    openWhatsAppUrl,
    client: {
      id:      client.id,
      name:    client.name,
      phone:   client.phone,
      company: client.company,
      status:  client.status,
    },
    nextAppointment: nextAppointment
      ? { title: nextAppointment.title, startTime: nextAppointment.startTime.toISOString() }
      : null,
  });
});

// ── POST /send — WhatsApp Business API ────────────────────────────────────────
// Reads credentials from org_integrations first, falls back to env vars
whatsappRouter.post("/send", async (req, res) => {
  const orgId = req.orgId!;
  const { to, message } = req.body as { to: string; message: string };

  if (!to || !message) {
    res.status(400).json({ error: "to y message son obligatorios" }); return;
  }

  const creds = await getWhatsAppCreds(orgId);

  if (!creds) {
    res.json({
      success:  false,
      pending:  true,
      reason:   "whatsapp_business_not_configured",
      message:  "WhatsApp Business no configurado. Conéctalo en Integraciones.",
      fallback: "https://wa.me/" + to.replace(/\D/g, "") + "?text=" + encodeURIComponent(message),
    });
    return;
  }

  try {
    const r = await fetch(
      "https://graph.facebook.com/v19.0/" + creds.phoneNumberId + "/messages",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + creds.accessToken,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to:   to.replace(/\D/g, ""),
          type: "text",
          text: { body: message },
        }),
      },
    );
    const data = await r.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (!r.ok) {
      logIntegrationEvent({
        orgId,
        integrationSlug: "whatsapp",
        direction:       "outbound",
        eventType:       "message_send_failed",
        status:          "error",
        summary:         `Envío fallido a +${to.replace(/\D/g, "").slice(-9)}`,
        errorMessage:    data.error?.message ?? "Error desconocido de Meta API",
      });
      res.status(502).json({ error: data.error?.message ?? "Error WhatsApp API" });
      return;
    }

    const messageId = data.messages?.[0]?.id;

    await db.insert(activityTable).values({
      orgId,
      type:        "whatsapp_sent",
      description: "Mensaje WhatsApp enviado vía API" + (creds.source === "db" ? " (credenciales de Integraciones)" : "") + " (ID: " + (messageId ?? "?") + ")",
    });

    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "outbound",
      eventType:       "message_sent",
      status:          "processed",
      summary:         `Mensaje enviado a +${to.replace(/\D/g, "").slice(-9)} (ID: ${messageId ?? "?"})`,
    });

    res.json({ success: true, messageId });
  } catch (err) {
    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "outbound",
      eventType:       "message_send_failed",
      status:          "error",
      summary:         `Error de red enviando a +${to.replace(/\D/g, "").slice(-9)}`,
      errorMessage:    String(err),
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /test-send — Envía mensaje de prueba real vía Meta API ───────────────
whatsappRouter.post("/test-send", async (req, res) => {
  const orgId = req.orgId!;
  const { to } = req.body as { to: string };

  if (!to) {
    res.status(400).json({ error: "El campo 'to' (número de teléfono) es obligatorio." });
    return;
  }

  const creds = await getWhatsAppCreds(orgId);

  if (!creds) {
    res.status(400).json({
      error: "WhatsApp Business no configurado para esta organización. Conéctalo en Integraciones.",
    });
    return;
  }

  const testMessage = `🔧 Mensaje de prueba desde OmniTech Core — ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}`;
  const toClean     = to.replace(/\D/g, "");

  try {
    const r = await fetch(
      "https://graph.facebook.com/v19.0/" + creds.phoneNumberId + "/messages",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + creds.accessToken,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to:   toClean,
          type: "text",
          text: { body: testMessage },
        }),
      },
    );

    const data = await r.json() as { messages?: { id: string }[]; error?: { message: string; code?: number } };

    if (!r.ok) {
      logIntegrationEvent({
        orgId,
        integrationSlug: "whatsapp",
        direction:       "outbound",
        eventType:       "test_send_failed",
        status:          "error",
        summary:         `Mensaje de prueba fallido a +${toClean.slice(-9)}`,
        errorMessage:    data.error?.message ?? "Error desconocido de Meta API",
      });
      res.status(502).json({
        error:   data.error?.message ?? "Error WhatsApp API",
        code:    data.error?.code,
        success: false,
      });
      return;
    }

    const messageId = data.messages?.[0]?.id;

    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "outbound",
      eventType:       "test_sent",
      status:          "processed",
      summary:         `Mensaje de prueba enviado a +${toClean.slice(-9)} (ID: ${messageId ?? "?"}, fuente: ${creds.source})`,
    });

    res.json({
      success:    true,
      messageId,
      message:    testMessage,
      to:         toClean,
      credSource: creds.source,
    });
  } catch (err) {
    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "outbound",
      eventType:       "test_send_failed",
      status:          "error",
      summary:         `Error de red en mensaje de prueba a +${toClean.slice(-9)}`,
      errorMessage:    String(err),
    });
    res.status(500).json({ error: String(err), success: false });
  }
});

// ── GET /audit — Auditoría detallada de mensajes WhatsApp (Fase E) ─────────────
whatsappRouter.get("/audit", async (req, res) => {
  const orgId = req.orgId!;
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);

  try {
    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(eq(integrationEventsTable.integrationSlug, "whatsapp"))
      .orderBy(desc(integrationEventsTable.createdAt))
      .limit(limit);

    const parsed = events.map((e) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = e.payloadJson ? JSON.parse(e.payloadJson as string) as Record<string, unknown> : null;
      } catch { payload = null; }

      return {
        id:          e.id,
        orgId:       e.orgId,
        direction:   e.direction,
        eventType:   e.eventType,
        status:      e.status,
        summary:     e.summary,
        error:       e.errorMessage,
        createdAt:   e.createdAt.toISOString(),
        phone:       (payload?.["phone"] as string | null) ?? (payload?.["phoneNorm"] as string | null) ?? null,
        clientFound: (payload?.["clientFound"] as boolean | null) ?? null,
        clientName:  (payload?.["clientName"] as string | null) ?? null,
        clientId:    (payload?.["clientId"] as number | null) ?? null,
        quoteFound:  (payload?.["quoteFound"] as boolean | null) ?? null,
        quoteTitle:  (payload?.["quoteTitle"] as string | null) ?? null,
        quoteId:     (payload?.["quoteId"] as number | null) ?? null,
        quoteTotal:  (payload?.["quoteTotal"] as number | null) ?? null,
        quoteCurrency: (payload?.["quoteCurrency"] as string | null) ?? "EUR",
        result:      (payload?.["result"] as string | null) ?? null,
        memoryCreated:  (payload?.["memoryCreated"] as boolean | null) ?? null,
        autoReplySent:  (payload?.["autoReplySent"] as boolean | null) ?? null,
        clientPromoted: (payload?.["clientPromoted"] as boolean | null) ?? null,
        messageText: (payload?.["messageText"] as string | null) ?? null,
      };
    });

    // Filter to org's own events (orgId 0 = unmatched messages, include those too for audit)
    const filtered = parsed.filter((e) => e.orgId === orgId || e.orgId === 0);

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
