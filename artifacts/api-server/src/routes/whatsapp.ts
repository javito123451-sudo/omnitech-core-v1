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
  knowledgeBaseTable,
} from "@workspace/db";
import { eq, and, desc, asc, gt, isNotNull, ne, inArray } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 imports
// ═══════════════════════════════════════════════════════════════════════════
import { getProviderSingleton } from "../ai/types";
import { executeSkill, getOpenAIFunctions } from "../skills";
import { classifyIntent, intentToSkill, Intent } from "../intents/intentEngine";

import {
  getWhatsAppCreds,
  resolveWhatsAppVerifyTokens,
  logIntegrationEvent,
} from "../utils/integrationCreds";
import { logAuditSystem } from "../utils/auditLogger";
import { IntegrationManager } from "../hub";

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

// ── Lead Intelligence keywords (same as Telegram) ─────────────────────────────
const LEAD_HOT_RE  = /\b(presupuesto|precio|coste|costo|cu\u00e1nto cuesta|cuanto vale|contratar|contratar\u00e9|demo|quiero contratar|quiero empezar|c\u00f3mo contrato|propuesta|oferta comercial|me interesa contratar)\b/i;
const LEAD_WARM_RE = /\b(informaci\u00f3n|m\u00e1s info|m\u00e1s informaci\u00f3n|me interesa|interesado|interesada|saber m\u00e1s|c\u00f3mo funciona|qu\u00e9 ofrec\u00e9is|qu\u00e9 servicios|qu\u00e9 hac\u00e9is|qu\u00e9 incluye|cu\u00e9ntame m\u00e1s|qu\u00e9 es|pod\u00e9is ayudarme)\b/i;

// ── Phone normalization — compare last 9 digits ───────────────────────────────
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

// ── Send WhatsApp message with full logging ───────────────────────────────────
/**
 * sendAutoReply — now routes through IntegrationManager.
 * Ava never talks directly to WhatsApp; always goes through the Hub.
 */
export async function sendAutoReply(orgId: number, toPhone: string, message: string): Promise<boolean> {
  const toClean = toPhone.replace(/\D/g, "");
  console.log(`[waSend] → to=+${toClean.slice(-9)} | org=${orgId} | text="${message.slice(0, 60)}..."`);

  const result = await IntegrationManager.send(orgId, "whatsapp", {
    to:      toClean,
    message,
  });

  if (result.success) {
    console.log(`[waSend] ✅ enviado a +${toClean.slice(-9)} | msgId=${result.providerId ?? "?"}`);
    return true;
  }
  console.error(`[waSend] ❌ ${result.error}`);
  return false;
}

// ── AI reply generation for WhatsApp messages — Ava V2 pipeline (same as Telegram)
// Uses: KB + Memory + Conversation History + Tool Loop + Skill Engine
async function generateWhatsAppAIReply(params: {
  orgId:      number;
  orgName:    string;
  text:       string;
  fromPhone:  string;
  client:     { id: number; name: string; status: string; company?: string | null; tags?: string | null; notes?: string | null; leadScore?: string | null } | null;
  excludeMsgId?: number;
}): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  const { orgId, orgName, text, fromPhone, client, excludeMsgId } = params;

  // ── 1. Fetch concurrently: KB, memory, and conversation history ─────────────
  const [kbEntries, memories, rawHistoryRows] = await Promise.all([
    db.select()
      .from(knowledgeBaseTable)
      .where(and(eq(knowledgeBaseTable.orgId, orgId), eq(knowledgeBaseTable.isActive, true)))
      .orderBy(asc(knowledgeBaseTable.sortOrder))
      .limit(25),

    db.select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, "operator")))
      .orderBy(desc(agentMemoryTable.updatedAt))
      .limit(8),

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

  const convHistory: { role: "user" | "assistant"; content: string }[] = (rawHistoryRows as typeof rawHistoryRows)
    .reverse()
    .map((m) => ({
      role:    m.direction === "outbound" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  console.log(
    `[WA Memoria] clientId=${client?.id ?? "null"} | excludeMsgId=${excludeMsgId ?? "none"} | ` +
    `historyRows=${rawHistoryRows.length} | kbEntries=${kbEntries.length} | memories=${memories.length}`,
  );

  // ── 2. Build context blocks ───────────────────────────────────────────────
  const kbBlock = kbEntries.length > 0
    ? "\n\nBASE DE CONOCIMIENTO DE LA EMPRESA:\n" +
      kbEntries.map((e) => `[${e.category.toUpperCase()}] **${e.title}**\n${e.content.slice(0, 400)}`).join("\n\n")
    : "";

  const memoryBlock = memories.length > 0
    ? "\n\nCONTEXTO DEL NEGOCIO:\n" +
      memories.map((m) => `- ${m.memoryKey}: ${String(m.memoryVal ?? "").slice(0, 120)}`).join("\n")
    : "";

  const clientBlock = client
    ? `\n\nCLIENTE IDENTIFICADO:
- Nombre: ${client.name}
- Estado CRM: ${client.status}
- Lead Score: ${client.leadScore ?? "cold"}${client.company ? `\n- Empresa: ${client.company}` : ""}${client.tags ? `\n- Etiquetas: ${client.tags}` : ""}${client.notes ? `\n- Historial: ${String(client.notes).slice(0, 300)}` : ""}`
    : "";

  // Madrid date/time block
  const now    = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  const dateBlock = `\n\n🗓️ FECHA Y HORA ACTUAL (Madrid): ${dateStr}, ${timeStr}. Usa esta fecha para interpretar "hoy", "mañana", "este jueves" etc. al agendar citas.`;

  // ── 3. System prompt (same rules as Telegram, adapted for WhatsApp) ───────
  const systemPrompt = `Eres el asistente comercial inteligente de *${orgName}* en WhatsApp Business. Actúas como comercial consultivo senior.

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
- Máximo 3-4 frases por respuesta (WhatsApp = mensajes cortos)
- Tono cálido, cercano y profesional. Tutea siempre (tú/te)
- 1-2 emojis por respuesta máximo
- SIEMPRE termina con una pregunta que avance la conversación
- NO menciones que eres IA ni GPT — eres el asistente del equipo
- NO inventes precios, datos o servicios no documentados
- Si detectas interés comercial → recoge datos de contacto
- Si no puedes resolver → escala: "Te pongo en contacto con un asesor"

REGLAS DE CITAS — DETECCIÓN DE INTENCIÓN (NO interpretar libremente, seguir estas reglas exactas):

INTENCIÓN CONSULTAR ("¿Cuándo tengo cita?", "¿Qué citas tengo?", "¿Cuál es mi próxima reunión?", "¿Cuándo me llamáis?", "¿Qué tengo agendado?", "¿seguro?"):
→ Llama get_client_appointments. Muestra SOLO citas pending o confirmed. Ignora cancelled/rescheduled/completed. NUNCA respondas fechas desde tu memoria.

INTENCIÓN CANCELAR ("Cancela mi cita", "Cancelar cita", "Anula mi cita", "No puedo asistir", "No voy a poder acudir", "Cancela la reunión", "Cancela la llamada", "Elimina mi cita"):
→ Llama cancel_appointment DIRECTAMENTE (sin paso previo de get_client_appointments). El tool encuentra automáticamente la próxima cita activa.
→ Respuesta obligatoria tras éxito: "Tu cita ha sido cancelada correctamente."

INTENCIÓN REPROGRAMAR ("Cambia mi cita", "Reprograma mi cita", "Mueve mi cita", "Pásala al...", "Cambia la fecha", "Cambia la hora", "Necesito otro horario"):
→ Llama reschedule_appointment DIRECTAMENTE con la nueva fecha/hora (sin paso previo de get_client_appointments). El tool encuentra automáticamente la próxima cita activa.
→ Respuesta obligatoria tras éxito: "Tu cita ha sido reprogramada para [fecha y hora]."

INTENCIÓN NUEVA CITA ("Quiero una cita", "Agenda una reunión", "Reserva una llamada", "Quiero hablar con un asesor", "Necesito una demo"):
→ Si hay bloque "CLIENTE IDENTIFICADO:" en este prompt: llama create_appointment DIRECTAMENTE con la fecha/hora que indique el usuario. No pidas datos de contacto — el cliente ya existe en el CRM.
→ CRM-002 (solo si NO hay bloque "CLIENTE IDENTIFICADO:"): No crees la cita. Primero pide nombre completo y teléfono o email. Una vez recogidos, el sistema registrará al contacto y podrás crear la cita.

REGLA DE VALIDACIÓN (CRM-003): Después de create_appointment/reschedule_appointment/cancel_appointment, el tool verifica en la base de datos. SOLO confirma éxito si el tool devuelve success:true Y verified:true. NUNCA confirmes desde tu memoria ni si el tool devuelve error.
REGLA DE VISIBILIDAD: Citas activas = solo pending y confirmed. Nunca muestres cancelled/rescheduled/completed.
- IMPORTANTE: Recuerda TODO lo que el usuario te ha dicho en esta conversación${kbBlock}${memoryBlock}${clientBlock}${dateBlock}`;

  // ── 4. Tool definitions (same as Telegram) ─────────────────────────────────
  const waTools = getOpenAIFunctions();

  // ── 5. Build messages array ───────────────────────────────────────────────
  const loopMessages: import("../ai/types").Message[] = [
    { role: "system", content: systemPrompt },
    ...convHistory,
    { role: "user", content: text },
  ];

  console.log(
    `[WA Memoria] AI call: ${loopMessages.length} messages total ` +
    `(1 system + ${convHistory.length} history + 1 current)`,
  );

  try {
    const aiProvider = getProviderSingleton();

    // ── Multi-round tool calling loop (max 4 rounds) ─────────────────────────
    let totalTokens = 0;
    let lastAppointmentId: number | undefined;
    const MAX_ROUNDS = 4;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await aiProvider.generate(loopMessages, {
        model:       "gpt-4o-mini",
        temperature: round === 0 ? 0.72 : 0.65,
        maxTokens:   round < MAX_ROUNDS - 1 ? 600 : 400,
        tools:       waTools,
        toolChoice:  "auto",
      });

      totalTokens += response.usage?.totalTokens ?? 0;
      const textReply = response.text;
      const toolCalls = response.toolCalls;

      // ── No tool call → this is the final text reply ─────────────────────
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`[WA Memoria] Respuesta generada | round=${round} | tokens=${totalTokens} | len=${textReply.length}`);
        return textReply || null;
      }

      // ── Execute the tool call ──────────────────────────────────────────
      const toolCall = toolCalls[0]!;
      const toolName = toolCall.function.name;
      const args     = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

      console.log(`[WA Tool] round=${round} calling=${toolName} | args=${toolCall.function.arguments.slice(0, 200)}`);

      // ══ Ava V2: Route tool calls through the Skill Engine ══
      const skillResult = await executeSkill(
        toolName,
        args,
        orgId,
        {
          client: client ? { id: client.id, name: client.name } : null,
          channel: "whatsapp",
          lastAppointmentId,
        },
      );
      // Update conversational context for next round
      if (skillResult.lastAppointmentId) {
        lastAppointmentId = skillResult.lastAppointmentId;
      }
      const toolResult = skillResult.result;

      console.log(`[WA Tool] ${toolName} → ${toolResult.slice(0, 250)}`);

      // Append assistant message + tool result for next round
      loopMessages.push({
        role:        "assistant",
        content:     textReply,
        tool_calls:  toolCalls,
      });
      loopMessages.push({
        role:         "tool",
        tool_call_id: toolCall.id,
        content:      toolResult,
      });
    }

    console.warn("[WA Memoria] Tool loop exhausted without text reply");
    return null;

  } catch (err) {
    console.error("[WhatsApp AI] AI error:", err);
    return null;
  }
}

// ── Core: process one incoming WhatsApp message ───────────────────────────────
async function processIncomingMessage(payload: {
  fromPhone:    string;
  text:         string;
  waMessageId:  string;
  contactName?: string; // from Meta contacts[] array
}): Promise<void> {
  const { fromPhone, text, contactName } = payload;
  const normalizedIncoming = normalizePhone(fromPhone);

  // 1. Find client by phone (across all orgs — normalize & compare last 9 digits)
  const allWithPhone = await db
    .select()
    .from(clientsTable)
    .where(isNotNull(clientsTable.phone));

  let client = allWithPhone.find((c) =>
    c.phone ? normalizePhone(c.phone) === normalizedIncoming : false,
  ) ?? null;

  // Resolve the real first org for audit events (not hardcoded 1)
  let auditOrgId = 1;
  try {
    const [firstOrg] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
    if (firstOrg?.id) auditOrgId = firstOrg.id;
  } catch { /* non-critical */ }

  // 2. Auto-create client if not found (like Telegram does)
  if (!client) {
    const displayName = contactName?.trim() || `WhatsApp +${normalizedIncoming}`;
    console.log(`[WhatsApp Webhook] Número desconocido +${normalizedIncoming} — creando cliente automáticamente: "${displayName}"`);
    try {
      const [newClient] = await db.insert(clientsTable).values({
        orgId:  auditOrgId,
        name:   displayName,
        phone:  `+${fromPhone.replace(/\D/g, "")}`,
        status: "lead",
        tags:   "whatsapp,auto-creado",
        notes:  `Cliente creado automáticamente al contactar por WhatsApp el ${new Date().toLocaleDateString("es-ES")}`,
      }).returning();
      client = newClient ?? null;
      console.log(`[WhatsApp Webhook] ✅ Cliente auto-creado: id=${client?.id} name="${displayName}"`);
    } catch (err) {
      console.error("[WhatsApp Webhook] ❌ Error creando cliente automático:", err);
    }
  }

  // If we still have no client (insert failed), log and bail
  if (!client) {
    logIntegrationEvent({
      orgId:           auditOrgId,
      integrationSlug: "whatsapp",
      direction:       "inbound",
      eventType:       "message_unknown_sender",
      status:          "error",
      summary:         `No se pudo crear cliente para +${normalizedIncoming}: "${text.slice(0, 80)}"`,
      payloadJson:     { phone: fromPhone, phoneNorm: normalizedIncoming, messageText: text.slice(0, 200) },
    });
    return;
  }

  // Log message_received with structured payload
  const basePayload: Record<string, unknown> = {
    phone:       fromPhone,
    phoneNorm:   normalizedIncoming,
    messageText: text.slice(0, 200),
    clientFound: true,
    clientId:    client.id,
    clientName:  client.name,
  };

  const orgId = client.orgId;

  // Lookup org name for AI context
  let orgName = "Nuestro negocio";
  try {
    const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (org?.name) orgName = org.name;
  } catch { /* non-critical */ }

  // 2. Store the inbound message — use .returning() to get ID for history exclusion
  let savedInboundId: number | undefined;
  const [savedInbound] = await db.insert(messagesTable).values({
    orgId,
    clientId:  client.id,
    content:   text,
    direction: "inbound",
    channel:   "whatsapp",
    isAi:      false,
    status:    "received",
  }).returning({ id: messagesTable.id });
  savedInboundId = savedInbound?.id;
  console.log(`[WA Memoria] Inbound saved: msgId=${savedInboundId ?? "?"} | clientId=${client.id}`);

  // ── Phase 3: Lead Intelligence detection (same as Telegram) ───────────────
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
      orgId, integrationSlug: "whatsapp", direction: "inbound",
      eventType: "lead_detected", status: "processed",
      summary:   `Lead ${newLeadScore} detectado · ${client.name}: "${text.slice(0, 80)}"`,
      payloadJson: { phone: fromPhone, leadScore: newLeadScore, clientId: client.id },
    });
  }

  // 3. Log activity
  await db.insert(activityTable).values({
    orgId,
    type:        "whatsapp_received",
    description: `Mensaje de ${client.name} vía WhatsApp: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`,
    clientName:  client.name,
  }).catch(() => {/* non-critical */});

  logAuditSystem({
    actorClerkId: `system:whatsapp:${orgId}`,
    action:    "whatsapp_message_received",
    resource:  "whatsapp_message",
    resourceId: String(client.id),
    orgId,
    details: {
      clientId:   client.id,
      clientName: client.name,
      phone:      fromPhone.slice(-9),
      preview:    text.slice(0, 120),
      result:     "success",
    },
    severity: "info",
    result:   "success",
  });

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

    logAuditSystem({
      actorClerkId: `system:whatsapp:${orgId}`,
      action:    isAccepted ? "whatsapp_quote_accepted" : "whatsapp_quote_rejected",
      resource:  "quote",
      resourceId: String(quote.id),
      orgId,
      details: {
        clientId:   client.id,
        clientName: client.name,
        phone:      fromPhone.slice(-9),
        quoteId:    quote.id,
        quoteTitle: quote.title,
        quoteTotal: quote.total,
        currency:   quote.currency ?? "EUR",
        totalFormatted,
        clientPromoted: false,
        result: newQuoteStatus,
      },
      severity: "info",
      result:   "success",
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
    excludeMsgId: savedInboundId,
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
    channel:   "whatsapp",
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

  // Resolve a fallback orgId (first org in DB) for audit events where org is unknown
  const resolveAuditOrgId = async (): Promise<number> => {
    try {
      const [first] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
      return first?.id ?? 1;
    } catch { return 1; }
  };

  void (async () => {
    const auditOrgId = await resolveAuditOrgId();

    // Route through IntegrationManager first (Hub architecture)
    const received = await IntegrationManager.receive("whatsapp", body);
    if (received) {
      await processIncomingMessage({
        fromPhone:    received.from,
        text:         received.message,
        waMessageId:  received.providerId ?? undefined,
        contactName:  (received.metadata?.profileName as string) ?? undefined,
      }).catch((err) => console.error("[WhatsApp Webhook] Processing error:", err));
      return;
    }

    // Fallback: raw processing for non-text / status updates (backward compat)
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;

        // ── Status updates (delivered, read, failed, sent) ──────────────────
        for (const status of value.statuses ?? []) {
          logIntegrationEvent({
            orgId:           auditOrgId,
            integrationSlug: "whatsapp",
            direction:       "inbound",
            eventType:       `message_status_${status.status ?? "unknown"}`,
            status:          "processed",
            summary:         `Estado de mensaje: ${status.status} (ID: ${status.id?.slice(-12)}, para: +${String(status.recipient_id ?? "").slice(-9)})`,
            payloadJson:     { messageId: status.id, recipientId: status.recipient_id, status: status.status, timestamp: status.timestamp },
          });
        }

        if (change.field !== "messages") continue;

        // ── Text messages → full processing pipeline ─────────────────────────
        // contacts[] maps wa_id → display name provided by Meta
        const contactNameMap: Record<string, string> = {};
        for (const c of value.contacts ?? []) {
          if (c.wa_id && c.profile?.name) contactNameMap[c.wa_id] = c.profile.name;
        }

        for (const msg of value.messages ?? []) {
          if (msg.type === "text") {
            await processIncomingMessage({
              fromPhone:    msg.from,
              text:         msg.text?.body ?? "",
              waMessageId:  msg.id,
              contactName:  contactNameMap[msg.from],
            }).catch((err) =>
              console.error("[WhatsApp Webhook] Processing error:", err),
            );
          } else {
            // Non-text messages (image, audio, document, etc.) — log but don't process
            logIntegrationEvent({
              orgId:           auditOrgId,
              integrationSlug: "whatsapp",
              direction:       "inbound",
              eventType:       `message_non_text`,
              status:          "skipped",
              summary:         `Mensaje de tipo "${msg.type}" de +${String(msg.from ?? "").slice(-9)} — sin procesamiento`,
              payloadJson:     { type: msg.type, from: msg.from, messageId: msg.id },
            });
          }
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

  const aiProvider = getProviderSingleton();
  const result = await aiProvider.generate([
    { role: "system", content: buildSystemPrompt(messageType) },
    { role: "user",   content: buildUserPrompt(messageType, client, activity, nextAppointment ? { title: nextAppointment.title, startTime: nextAppointment.startTime, location: nextAppointment.location } : null) },
  ], {
    model:       "gpt-4o-mini",
    temperature: 0.7,
    maxTokens:   200,
  });

  const message = result.text.trim();

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
