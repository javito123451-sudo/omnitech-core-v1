import { Router } from "express";
import { randomBytes } from "crypto";
import {
  db, orgIntegrationsTable, integrationEventsTable,
  clientsTable, quotesTable, agentMemoryTable, organizationsTable, messagesTable,
  knowledgeBaseTable, appointmentsTable, activityTable,
} from "@workspace/db";
import { eq, and, desc, asc, isNotNull, isNull, ne, ilike, gte, inArray } from "drizzle-orm";
import { decryptCredentials, logIntegrationEvent } from "../utils/integrationCreds";
import { transcribeAudio } from "../utils/transcribeAudio";
import { pauseAutopilotOnReply } from "../utils/autopilotPause";

// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 imports
// ═══════════════════════════════════════════════════════════════════════════
import { executeSkill, getOpenAIFunctionsForChannel, isSkillAllowedForChannel } from "../skills";
import { classifyIntent, intentToSkill, Intent, validateIntentParams } from "../intents/intentEngine";
import { getProviderSingleton } from "../ai/types";

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
interface TgUser    { id: number; first_name: string; last_name?: string; username?: string; }
interface TgAudio   { file_id: string; duration: number; mime_type?: string; file_size?: number; }
interface TgMessage {
  message_id: number;
  from?:      TgUser;
  chat:       { id: number };
  text?:      string;
  voice?:     TgAudio; // voice note (OGG/OPUS)
  audio?:     TgAudio; // audio file
}
interface TgUpdate { update_id: number; message?: TgMessage; }

// ── Download voice/audio from Telegram CDN ────────────────────────────────────
async function downloadTelegramAudio(token: string, fileId: string): Promise<Buffer | null> {
  try {
    const fileRes  = await fetch(TG(token, `getFile?file_id=${encodeURIComponent(fileId)}`));
    const fileData = await fileRes.json() as { ok: boolean; result?: { file_path: string } };
    if (!fileData.ok || !fileData.result?.file_path) {
      console.warn(`[downloadTelegramAudio] getFile failed for file_id=${fileId.slice(0, 20)}`);
      return null;
    }
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
    const audioRes    = await fetch(downloadUrl);
    if (!audioRes.ok) {
      console.warn(`[downloadTelegramAudio] Download failed: HTTP ${audioRes.status}`);
      return null;
    }
    return Buffer.from(await audioRes.arrayBuffer());
  } catch (err) {
    console.error("[downloadTelegramAudio] Error:", String(err));
    return null;
  }
}

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

// ── CRM-001: Greeting-only pattern — do NOT auto-create CRM contact from these ─
// Matches bare greetings / single-word / short filler messages with no CRM value.
const GREETING_ONLY_RE =
  /^(?:hola+|buenas?|buenos\s+d[ií]as?|buenas\s+tardes?|buenas\s+noches?|buen\s+d[ií]a|good\s+(?:morning|afternoon|evening|day)|hi+|hey+|hello+|saludos|ey+|ola+|yo+|ok+|k+|👋+)[!¡.,?…\s]*$/i;

// ── CRM-LEAD-001: Telegram bot commands (/start, /help…) never create a lead ──
const COMMAND_RE = /^\/\w+/;

// ── CRM-LEAD-003: Transactional intents that DO qualify for lead creation ──────
// These indicate the user wants to schedule, buy, or be contacted — CRM value.
const TRANSACTIONAL_INTENT_RE =
  /\b(cita|reuni[oó]n|reserva|reservar|agendar|agenda\s+una|presupuesto|oferta\s+comercial|precio\s+de|costo|coste|contratar|contrataci[oó]n|demo|llamada|ll[aá]mame|quiero\s+hablar|hablar\s+con|ponerse\s+en\s+contacto|quiero\s+que\s+me\s+cont|contactad|contactar|quiero\s+empezar|me\s+interesa\s+contratar|quiero\s+contratar)\b/i;

// ── Helper: detect qualifying contact data (phone or email) in message text ────
function hasValidContactData(text: string): boolean {
  const hasPhone = /\b\d[\d\s\-().]{5,}\d\b/.test(text);
  const hasEmail = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text);
  return hasPhone || hasEmail;
}

async function generateTelegramAIReply(params: {
  orgId:         number;
  orgName:       string;
  text:          string;
  senderName:    string;
  chatId:        number; // guest identity — used to build history when no CRM client is linked
  excludeMsgId?: number;  // ID of the just-saved inbound message — exclude from history
  client:        { id: number; name: string; status: string; leadScore?: string | null; company?: string | null; tags?: string | null; notes?: string | null } | null;
}): Promise<string | null> {
  const { orgId, orgName, text, senderName, chatId, excludeMsgId, client } = params;

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
      // No CRM client linked (guest conversation) — build history from external_id
      // (chat_id) instead, so the AI still remembers what the guest said earlier.
      : db.select()
          .from(messagesTable)
          .where(
            excludeMsgId
              ? and(eq(messagesTable.orgId, orgId), eq(messagesTable.externalId, String(chatId)), eq(messagesTable.channel, "telegram"), ne(messagesTable.id, excludeMsgId))
              : and(eq(messagesTable.orgId, orgId), eq(messagesTable.externalId, String(chatId)), eq(messagesTable.channel, "telegram")),
          )
          .orderBy(desc(messagesTable.createdAt))
          .limit(20),
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
6. Presupuesto/Demo → Ofrece agendar una demo o llamada con el equipo; si piden un presupuesto formal, NO lo crees tú — dile que un asesor se lo prepara y llama a escalate_to_human
7. Conversión → Cierra agendando una cita, o escala con escalate_to_human: "Te pongo en contacto con uno de nuestros asesores ahora"

REGLAS OBLIGATORIAS:
- Responde SIEMPRE en español
- Máximo 3-4 frases por respuesta (Telegram = mensajes breves)
- Tono cálido, cercano y profesional. Tutea siempre (tú/te)
- 1-2 emojis por respuesta máximo
- SIEMPRE termina con una pregunta que avance la conversación
- NO menciones que eres IA ni GPT — eres el asistente del equipo
- NO inventes precios, datos o servicios no documentados
- Si detectas interés comercial → recoge datos de contacto
- NUNCA crees presupuestos desde aquí bajo ningún concepto — no tienes esa herramienta en este canal; si te piden uno, escala con escalate_to_human
- Si no puedes resolver algo con las herramientas disponibles → llama a escalate_to_human (no inventes ni intentes resolverlo de otra forma) y responde: "Te pongo en contacto con un asesor"
REGLAS DE CITAS — DETECCIÓN DE INTENCIÓN (NO interpretar libremente, seguir estas reglas exactas):

INTENCIÓN CONSULTAR ("¿Cuándo tengo cita?", "¿Qué citas tengo?", "¿Cuál es mi próxima reunión?", "¿Cuándo me llamáis?", "¿Qué tengo agendado?", "¿seguro?"):
→ Llama get_client_appointments. Muestra SOLO citas pending o confirmed. Ignora cancelled/rescheduled/completed. NUNCA respondas fechas desde tu memoria.

INTENCIÓN CANCELAR ("Cancela mi cita", "Cancelar cita", "Anula mi cita", "No puedo asistir", "No voy a poder acudir", "Cancela la reunión", "Cancela la llamada", "Elimina mi cita"):
→ Llama cancel_appointment DIRECTAMENTE (sin paso previo de get_client_appointments). Si el usuario menciona una fecha ("mi cita del 15 de agosto", "la del jueves"), pásala en el parámetro date (YYYY-MM-DD) para que el tool sepa exactamente cuál — si no la menciona, no pases date.
→ Si el tool devuelve needsClarification:true (hay varias citas activas que coinciden), NO elijas una por tu cuenta — muestra las opciones (fecha y hora de cada una) y pregunta cuál es. Vuelve a llamar a cancel_appointment con appointment_id o date una vez el usuario aclare.
→ Respuesta obligatoria tras éxito: "Tu cita ha sido cancelada correctamente."

INTENCIÓN REPROGRAMAR ("Cambia mi cita", "Reprograma mi cita", "Mueve mi cita", "Pásala al...", "Cambia la fecha", "Cambia la hora", "Necesito otro horario"):
→ Llama reschedule_appointment DIRECTAMENTE con la nueva fecha/hora (sin paso previo de get_client_appointments). Si el usuario menciona la fecha de la cita ACTUAL que quiere cambiar ("la cita del 15 de agosto"), pásala en el parámetro date (YYYY-MM-DD) — distinto de new_date, que es la fecha nueva.
→ Si el tool devuelve needsClarification:true (hay varias citas activas que coinciden), NO elijas una por tu cuenta — muestra las opciones (fecha y hora de cada una) y pregunta cuál es. Vuelve a llamar a reschedule_appointment con appointment_id o date una vez el usuario aclare.
→ Respuesta obligatoria tras éxito: "Tu cita ha sido reprogramada para [fecha y hora]."

INTENCIÓN NUEVA CITA ("Quiero una cita", "Agenda una reunión", "Reserva una llamada", "Quiero hablar con un asesor", "Necesito una demo"):
→ Si hay bloque "CLIENTE IDENTIFICADO:" en este prompt: llama create_appointment DIRECTAMENTE con la fecha/hora que indique el usuario. No pidas datos de contacto — el cliente ya existe en el CRM.
→ CRM-002 (solo si NO hay bloque "CLIENTE IDENTIFICADO:"): Pide nombre completo (y si es fácil, teléfono o email) de forma natural. En cuanto tengas al menos el nombre y la fecha/hora, llama create_appointment DIRECTAMENTE pasando guest_name (y guest_phone/guest_email si los tiene) — NO crees ni busques un cliente en el CRM antes de agendar, la cita se crea como cita de invitado.

INTENCIÓN FUERA DE ALCANCE (cualquier cosa que NO sea consultar/cancelar/reprogramar/crear una cita: facturación, precios exactos, presupuestos formales, temas legales, soporte técnico, quejas, o cualquier otra petición): NO intentes resolverlo tú ni inventes una respuesta. Llama a escalate_to_human con reason (qué pide) y summary (resumen de la conversación), y responde con naturalidad que un miembro del equipo se pondrá en contacto en breve.

REGLA DE VALIDACIÓN (CRM-003): Después de create_appointment/reschedule_appointment/cancel_appointment, el tool verifica en la base de datos. SOLO confirma éxito si el tool devuelve success:true Y verified:true. NUNCA confirmes desde tu memoria ni si el tool devuelve error.
REGLA DE VISIBILIDAD: Citas activas = solo pending y confirmed. Nunca muestres cancelled/rescheduled/completed.
REGLA DE ALCANCE DE HERRAMIENTAS: En este canal SOLO tienes create_appointment, reschedule_appointment, cancel_appointment, get_appointments y escalate_to_human. No tienes acceso a contabilidad, listado de clientes, presupuestos ni tareas — ni menciones esas cosas como si pudieras hacerlas.
- IMPORTANTE: Recuerda TODO lo que el usuario te ha dicho en esta conversación${kbBlock}${memoryBlock}${clientBlock}${dateBlock}`;

  // ── 4. Tool definitions (Ava V2: auto-generated from Skill Engine) ───────────
  // Restricted catalog: Telegram is an unauthenticated public channel, so AVA
  // only gets appointment self-service + escalate_to_human here — never the
  // full CRM/accounting catalog (see skills/index.ts).
  const tgTools = getOpenAIFunctionsForChannel("customer");

  // ── 5. Build messages array ───────────────────────────────────────────────────
  const loopMessages: import("../ai/types").Message[] = [
    { role: "system", content: systemPrompt },
    ...convHistory,
    { role: "user", content: text },
  ];

  console.log(
    `[TG Memoria] AI call: ${loopMessages.length} messages total ` +
    `(1 system + ${convHistory.length} history + 1 current)`,
  );

  try {
    const aiProvider = getProviderSingleton();

    // ── Multi-round tool calling loop (max 4 rounds) ──────────────────────────
    // Supports sequential patterns like: get_client_appointments → reschedule_appointment
    // All tool calls are routed through executeSkill() for deterministic DB-backed results.
    let totalTokens = 0;
    let lastAppointmentId: number | undefined;
    const MAX_ROUNDS = 4;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await aiProvider.generate(loopMessages, {
        model:       "gpt-4o-mini",
        temperature: round === 0 ? 0.72 : 0.65,
        maxTokens:   round < MAX_ROUNDS - 1 ? 600 : 400,
        tools:       tgTools,
        toolChoice:  "auto",
      });

      totalTokens += response.usage?.totalTokens ?? 0;
      const textReply = response.text;
      const toolCalls = response.toolCalls;

      // ── No tool call → this is the final text reply ───────────────────────
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`[TG Memoria] Respuesta generada | round=${round} | tokens=${totalTokens} | len=${textReply.length}`);
        return textReply || null;
      }

      // ── Execute ALL tool calls returned in this round ─────────────────
      // OpenAI may batch multiple tool calls in one response; we MUST
      // push a tool-response message for every tool_call_id in the
      // assistant message — otherwise round+1 gets a 400 BadRequestError.
      const toolResponseMessages: import("../ai/types").Message[] = [];

      for (const tc of toolCalls) {
        const tName = tc.function.name;
        let tArgs: Record<string, unknown> = {};
        try { tArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* malformed args */ }

        console.log(`[TG Tool] round=${round} calling=${tName} | args=${tc.function.arguments.slice(0, 200)}`);

        // Hard code-level barrier (not just "the model wasn't offered this
        // tool") — Telegram is a customer channel, so reject anything outside
        // the restricted catalog even if a tool call for it somehow comes
        // back from the model.
        if (!isSkillAllowedForChannel(tName, "customer")) {
          console.warn(`[TG Tool] ⛔ Blocked disallowed tool call for customer channel: ${tName}`);
          toolResponseMessages.push({
            role:         "tool",
            tool_call_id: tc.id,
            content:      JSON.stringify({ error: "Herramienta no disponible en este canal." }),
          });
          continue;
        }

        const skillResult = await executeSkill(
          tName,
          tArgs,
          orgId,
          {
            client: client ? { id: client.id, name: client.name } : null,
            channel: "telegram",
            lastAppointmentId,
            // Always populated — lets guest (no-client) skills resolve "my
            // appointment" from the sender's chat_id, not just from
            // conversation-turn memory (see FIX-AU / guest appointment actions).
            guestIdentity: String(chatId),
          },
        );
        if (skillResult.lastAppointmentId) {
          lastAppointmentId = skillResult.lastAppointmentId;
        }
        const toolResult = skillResult.result;
        console.log(`[TG Tool] ${tName} → ${toolResult.slice(0, 250)}`);

        toolResponseMessages.push({
          role:         "tool",
          tool_call_id: tc.id,
          content:      toolResult,
        });
      }

      // Append assistant message then ALL tool responses — one per tool_call_id.
      loopMessages.push({
        role:       "assistant",
        content:    textReply || "",
        tool_calls: toolCalls,
      });
      for (const trm of toolResponseMessages) {
        loopMessages.push(trm);
      }
    }

    // Safety fallback if loop exhausted without a text reply
    console.warn("[TG Memoria] Tool loop exhausted without text reply");
    return null;

  } catch (err) {
    console.error("[Telegram AI] AI error:", err);
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

    // ── TZ: Parse date + time as Europe/Madrid local → convert to UTC ─────────
    const [y, mo, d] = dateStr.split("-").map(Number);
    if (!y || !mo || !d) {
      return JSON.stringify({ error: `Formato de fecha inválido: "${dateStr}". Usa YYYY-MM-DD.` });
    }
    const normalizedTime = startTimeStr.slice(0, 5); // "HH:MM"
    const startTime = madridLocalToUTC(dateStr, normalizedTime);
    const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);
    console.log(
      `[TZ create_appointment] ` +
      `hora_recibida="${normalizedTime}" | tz=Europe/Madrid | ` +
      `utc_stored="${startTime.toISOString()}" | ` +
      `madrid_display="${apptTimeDisplay(startTime)}"`
    );

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

    // ── CRM-003: DB READ-BACK VALIDATION ────────────────────────────────────────
    if (!appointment) {
      return JSON.stringify({ error: "Error al crear la cita: la inserción no devolvió registro. Intenta de nuevo." });
    }
    // Re-read from DB to guarantee the stored value is what we display
    const [savedAppt] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, appointment.id), eq(appointmentsTable.orgId, orgId)));

    if (!savedAppt || Math.abs(savedAppt.startTime.getTime() - startTime.getTime()) > 60_000) {
      return JSON.stringify({ error: "Error de validación: la cita no se pudo verificar en la base de datos." });
    }

    const localDate = apptDateDisplay(savedAppt.startTime);
    const localTime = apptTimeDisplay(savedAppt.startTime);

    await db.insert(activityTable).values({
      orgId,
      type:        "appointment_scheduled",
      description: `Cita "${title}" agendada con ${resolvedClient.name} para el ${localDate} a las ${localTime} (vía Telegram)`,
      clientName:  resolvedClient.name,
    }).catch(() => {/* non-critical */});

    // Log integration event
    logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: "appointment_created", status: "processed",
      summary:     `Cita #${savedAppt.id} creada: "${title}" con ${resolvedClient.name} el ${localDate} a las ${localTime}`,
      payloadJson: { appointmentId: savedAppt.id, clientId: resolvedClient.id, date: dateStr, startTime: startTimeStr },
    });

    console.log(`[TG Appointment] ✅ Created appointment #${savedAppt.id} | client=${resolvedClient.name} | ${dateStr} ${localTime}`);

    return JSON.stringify({
      success:       true,
      appointmentId: savedAppt.id,
      clientName:    resolvedClient.name,
      title,
      date:          localDate,
      time:          localTime,
      duration:      durationMinutes,
      status:        "pending",
      type:          apptType,
      description,
      location,
      message:       `Cita #${savedAppt.id} creada en el CRM para ${resolvedClient.name} el ${localDate} a las ${localTime}.`,
    });
  } catch (err) {
    console.error("[TG Appointment] Error creating appointment:", err);
    return JSON.stringify({ error: String(err) });
  }
}

// ── Timezone helpers: Europe/Madrid ──────────────────────────────────────────
//
// STORAGE CONVENTION (Rule 1): All timestamps stored as real UTC.
// DISPLAY CONVENTION  (Rule 2): All timestamps shown in Europe/Madrid.
//
// CANONICAL SOURCE: src/utils/timezone.ts — this is a local copy kept here
// to avoid import cycles. Both implementations are identical.
// If you change the algorithm, update timezone.ts first, then copy here.
//
// madridLocalToUTC: converts a date+time string expressed in Europe/Madrid local
// time (as provided by the user / AI) into the equivalent UTC Date.
// Correctly handles both CET (UTC+1, winter) and CEST (UTC+2, summer) via Intl.
//
// Algorithm (probe technique):
//   1. Build a "naïve UTC" Date using the given HH:MM.
//   2. Ask Intl what Europe/Madrid shows for that UTC instant.
//   3. Shift by the difference to get the real UTC.
//
// Example: "2026-06-25 15:00 Madrid" (CEST = UTC+2)
//   probe = 15:00 UTC → Madrid shows 17:00
//   shift = 15:00 - 17:00 = −120 min
//   result = 15:00 UTC − 2 h = 13:00 UTC  ← stored  ✅
//   display: 13:00 UTC → Europe/Madrid → 15:00  ✅
function madridLocalToUTC(dateStr: string, timeStr: string): Date {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const [h,  m_]     = timeStr.split(":").map(Number);
  const probe = new Date(Date.UTC(yr!, mo! - 1, dy!, h!, m_!, 0));
  const fmt   = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts  = fmt.formatToParts(probe);
  const mh     = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const mmVal  = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMin = (h! * 60 + m_!) - (mh * 60 + mmVal);
  return new Date(probe.getTime() + shiftMin * 60_000);
}

// ── Appointment time/date display helpers ─────────────────────────────────────
function apptTimeDisplay(d: Date): string {
  // UTC stored value → Europe/Madrid display
  return d.toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function apptDateDisplay(d: Date): string {
  return d.toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ── Execute get_client_appointments for Telegram bot ──────────────────────────
async function executeTelegramGetClientAppointments(
  args: Record<string, unknown>,
  orgId: number,
  client: { id: number; name: string } | null,
): Promise<string> {
  if (!client) {
    return JSON.stringify({ error: "Cliente no identificado. El contacto debe estar registrado en el CRM." });
  }
  try {
    const statusArg    = String(args["status"] ?? "active");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    // Active statuses: pending + confirmed (never show rescheduled/cancelled/completed by default)
    const activeStatuses = ["pending", "confirmed"];
    const statusCondition =
      statusArg === "all"       ? [] :
      statusArg === "active"    ? [inArray(appointmentsTable.status, activeStatuses)] :
      /* specific status */       [eq(appointmentsTable.status, statusArg)];

    const conditions = [
      eq(appointmentsTable.orgId, orgId),
      eq(appointmentsTable.clientId, client.id),
      gte(appointmentsTable.startTime, sevenDaysAgo), // last 7 days + all future
      ...statusCondition,
    ];

    // ASC order — nearest upcoming appointment first
    const rows = await db.select().from(appointmentsTable)
      .where(and(...conditions as Parameters<typeof and>))
      .orderBy(asc(appointmentsTable.startTime))
      .limit(10);

    // Identify the single next upcoming non-cancelled appointment
    const now    = new Date();
    const upcoming = rows.filter(r => r.status !== "cancelled" && r.startTime > now);
    const next   = upcoming[0] ?? null;

    console.log(`[TG Appointment] get_client_appointments → ${rows.length} rows for client #${client.id} | next=#${next?.id ?? "none"}`);

    return JSON.stringify({
      total:          rows.length,
      client:         client.name,
      nextUpcoming: next
        ? {
            id:          next.id,
            title:       next.title,
            date:        apptDateDisplay(next.startTime),
            time:        apptTimeDisplay(next.startTime),
            status:      next.status,
            type:        next.type ?? "meeting",
            location:    next.location ?? null,
          }
        : null,
      appointments: rows.map(r => ({
        id:          r.id,
        title:       r.title,
        date:        apptDateDisplay(r.startTime),
        time:        apptTimeDisplay(r.startTime),
        status:      r.status,
        type:        r.type ?? "meeting",
        location:    r.location ?? null,
        description: r.description ?? null,
      })),
    });
  } catch (err) {
    console.error("[TG Appointment] get_client_appointments error:", err);
    return JSON.stringify({ error: String(err) });
  }
}

// ── Execute reschedule_appointment for Telegram bot ───────────────────────────
// Strategy: mark old appointment as "rescheduled" + create a NEW appointment.
// Auto-resolves the next active appointment for the client when no ID is given.
async function executeTelegramRescheduleAppointment(
  args: Record<string, unknown>,
  orgId: number,
  client: { id: number; name: string } | null,
): Promise<string> {
  try {
    const appointmentIdArg = args["appointment_id"] ? Number(args["appointment_id"]) : null;
    const newDateStr       = String(args["new_date"]       ?? "");
    const newStartTimeStr  = String(args["new_start_time"] ?? "10:00");
    const durationArg      = args["duration_minutes"] != null ? Number(args["duration_minutes"]) : null;

    if (!newDateStr || !newStartTimeStr) {
      return JSON.stringify({ error: "Se necesitan new_date y new_start_time." });
    }

    // Resolve which appointment to reschedule
    let existing: typeof appointmentsTable.$inferSelect | undefined;

    if (appointmentIdArg) {
      // Explicit ID provided
      [existing] = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
    } else if (client) {
      // Auto-resolve: find next upcoming active appointment for this client
      const now = new Date();
      const candidates = await db.select().from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.orgId, orgId),
          eq(appointmentsTable.clientId, client.id),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
          gte(appointmentsTable.startTime, now),
        ))
        .orderBy(asc(appointmentsTable.startTime))
        .limit(1);
      existing = candidates[0];
      if (!existing) {
        // Try without future filter (includes recent past)
        const all = await db.select().from(appointmentsTable)
          .where(and(
            eq(appointmentsTable.orgId, orgId),
            eq(appointmentsTable.clientId, client.id),
            inArray(appointmentsTable.status, ["pending", "confirmed"]),
          ))
          .orderBy(asc(appointmentsTable.startTime))
          .limit(1);
        existing = all[0];
      }
    }

    if (!existing) {
      return JSON.stringify({ error: client
        ? `No se encontró ninguna cita activa (pending/confirmed) para ${client.name}. El cliente no tiene citas que reprogramar.`
        : "Se necesita appointment_id o el cliente debe estar identificado." });
    }
    if (existing.status === "rescheduled" || existing.status === "cancelled") {
      return JSON.stringify({
        error: `La cita #${existing.id} ya está "${existing.status}" y no se puede reprogramar. ` +
               `El cliente no tiene citas activas que reprogramar.`,
      });
    }

    // ── TZ: Parse new date + time as Europe/Madrid local → UTC ────────────────
    const [y, mo, d] = newDateStr.split("-").map(Number);
    if (!y || !mo || !d) {
      return JSON.stringify({ error: `Fecha inválida: "${newDateStr}". Usa formato YYYY-MM-DD.` });
    }
    const normalizedNewTime = newStartTimeStr.slice(0, 5);
    const newStartTime = madridLocalToUTC(newDateStr, normalizedNewTime);
    console.log(
      `[TZ reschedule_appointment] ` +
      `hora_recibida="${normalizedNewTime}" | tz=Europe/Madrid | ` +
      `utc_stored="${newStartTime.toISOString()}" | ` +
      `madrid_display="${apptTimeDisplay(newStartTime)}"`
    );

    // Duration: preserve original unless overridden
    const existingDuration  = Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60_000);
    const effectiveDuration = durationArg ?? existingDuration;
    const newEndTime        = new Date(newStartTime.getTime() + effectiveDuration * 60_000);

    // ── STEP 1: Mark old appointment as "rescheduled" ──────────────────────────
    await db.update(appointmentsTable)
      .set({ status: "rescheduled" })
      .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

    // CRM-003: DB read-back validation — confirm old appointment was updated
    const [oldVerified] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
    if (!oldVerified || oldVerified.status !== "rescheduled") {
      return JSON.stringify({
        error: `Error al marcar la cita original #${existing.id} como reprogramada. Estado actual: ${oldVerified?.status ?? "desconocido"}. No se creó la nueva cita.`,
      });
    }

    // ── STEP 2: Create NEW appointment with the new date/time ──────────────────
    const [newAppt] = await db.insert(appointmentsTable).values({
      orgId,
      clientId:    existing.clientId,
      title:       existing.title,
      description: existing.description ?? undefined,
      type:        existing.type        ?? undefined,
      location:    existing.location    ?? undefined,
      tags:        existing.tags        ?? undefined,
      startTime:   newStartTime,
      endTime:     newEndTime,
      status:      "pending",
      reminder:    existing.reminder,
    }).returning();

    if (!newAppt) {
      // Rollback: restore original status
      await db.update(appointmentsTable)
        .set({ status: existing.status })
        .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
      return JSON.stringify({ error: "Error al crear la nueva cita. Se restauró la cita original." });
    }

    // ── DB READ-BACK VALIDATION on NEW appointment ─────────────────────────────
    const [verified] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, newAppt.id), eq(appointmentsTable.orgId, orgId)));

    if (!verified || Math.abs(verified.startTime.getTime() - newStartTime.getTime()) > 60_000) {
      return JSON.stringify({ error: "Error de validación: la nueva cita no se creó correctamente en la base de datos." });
    }

    // Display time using helpers (no timezone conversion — stored value IS display value)
    const localDate = apptDateDisplay(verified.startTime);
    const localTime = apptTimeDisplay(verified.startTime);

    // Log activity (non-critical)
    await db.insert(activityTable).values({
      orgId,
      type:        "appointment_rescheduled",
      description: `Cita #${existing.id} "${existing.title}" marcada como reprogramada → nueva cita #${newAppt.id}: ${localDate} a las ${localTime} (vía Telegram)`,
      clientName:  null,
    }).catch(() => {/* non-critical */});

    logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: "appointment_rescheduled", status: "processed",
      summary:     `Cita #${existing.id} → reprogramada | nueva cita #${newAppt.id}: ${localDate} a las ${localTime}`,
      payloadJson: {
        oldAppointmentId: existing.id,
        newAppointmentId: newAppt.id,
        newDate:          newDateStr,
        newStartTime:     newStartTimeStr,
        dbVerified:       verified.startTime.toISOString(),
      },
    });

    console.log(`[TG Appointment] ✅ Reschedule: #${existing.id} → status=rescheduled | new #${newAppt.id} → ${localDate} ${localTime}`);

    return JSON.stringify({
      success:          true,
      verified:         true,
      oldAppointmentId: existing.id,
      newAppointmentId: newAppt.id,
      title:            existing.title,
      newDate:          localDate,
      newTime:          localTime,
      duration:         effectiveDuration,
      status:           "pending",
      message:          `Tu cita ha sido reprogramada para ${localDate} a las ${localTime}.`,
    });
  } catch (err) {
    console.error("[TG Appointment] Error rescheduling:", err);
    return JSON.stringify({ error: `Error al reprogramar: ${String(err)}` });
  }
}

// ── Execute cancel_appointment for Telegram bot ───────────────────────────────
// Auto-resolves the next active appointment for the client when no ID is given.
async function executeTelegramCancelAppointment(
  args: Record<string, unknown>,
  orgId: number,
  client: { id: number; name: string } | null,
): Promise<string> {
  try {
    const appointmentIdArg = args["appointment_id"] ? Number(args["appointment_id"]) : null;
    const reason           = args["reason"] ? String(args["reason"]) : null;

    // Resolve which appointment to cancel
    let existing: typeof appointmentsTable.$inferSelect | undefined;

    if (appointmentIdArg) {
      // Explicit ID provided
      [existing] = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
    } else if (client) {
      // Auto-resolve: find next upcoming active appointment for this client
      const now = new Date();
      const candidates = await db.select().from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.orgId, orgId),
          eq(appointmentsTable.clientId, client.id),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
          gte(appointmentsTable.startTime, now),
        ))
        .orderBy(asc(appointmentsTable.startTime))
        .limit(1);
      existing = candidates[0];
      if (!existing) {
        // Fallback: most recent active (even if in the past)
        const all = await db.select().from(appointmentsTable)
          .where(and(
            eq(appointmentsTable.orgId, orgId),
            eq(appointmentsTable.clientId, client.id),
            inArray(appointmentsTable.status, ["pending", "confirmed"]),
          ))
          .orderBy(asc(appointmentsTable.startTime))
          .limit(1);
        existing = all[0];
      }
    }

    if (!existing) {
      return JSON.stringify({ error: client
        ? `No se encontró ninguna cita activa (pending/confirmed) para ${client.name}. El cliente no tiene citas que cancelar.`
        : "Se necesita appointment_id o el cliente debe estar identificado." });
    }

    if (existing.status === "cancelled") {
      return JSON.stringify({ error: `La cita #${existing.id} "${existing.title}" ya estaba cancelada.` });
    }

    // ── WRITE ──────────────────────────────────────────────────────────────────
    await db.update(appointmentsTable)
      .set({ status: "cancelled" })
      .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

    // ── DB READ-BACK VALIDATION ────────────────────────────────────────────────
    const [verified] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

    if (!verified || verified.status !== "cancelled") {
      return JSON.stringify({ error: "Error de validación: no se pudo confirmar la cancelación en la base de datos." });
    }

    // Display helpers for activity log
    const cancelledDate = apptDateDisplay(existing.startTime);
    const cancelledTime = apptTimeDisplay(existing.startTime);

    await db.insert(activityTable).values({
      orgId,
      type:        "appointment_cancelled",
      description: `Cita #${existing.id} "${existing.title}" (${cancelledDate} ${cancelledTime}) cancelada${reason ? `: ${reason}` : ""} (vía Telegram)`,
      clientName:  client?.name ?? null,
    }).catch(() => {/* non-critical */});

    logIntegrationEvent({
      orgId, integrationSlug: "telegram", direction: "inbound",
      eventType: "appointment_cancelled", status: "processed",
      summary:     `Cita #${existing.id} "${existing.title}" cancelada`,
      payloadJson: { appointmentId: existing.id, reason, date: cancelledDate, time: cancelledTime },
    });

    console.log(`[TG Appointment] ✅ Cancelled #${existing.id} | DB verified status=cancelled`);

    return JSON.stringify({
      success:       true,
      verified:      true,
      appointmentId: existing.id,
      title:         existing.title,
      cancelledDate,
      cancelledTime,
      status:        "cancelled",
      reason,
      message:       "Tu cita ha sido cancelada correctamente.",
    });
  } catch (err) {
    console.error("[TG Appointment] Error cancelling:", err);
    return JSON.stringify({ error: `Error al cancelar: ${String(err)}` });
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

  // ── CRM-LEAD-001/002/003/004: Gated lead creation ────────────────────────────
  //
  //  CRM-LEAD-001: Do NOT create a lead at conversation start (no matter the message).
  //  CRM-LEAD-002: Create lead only when: (name + phone) OR (name + email).
  //                Name always comes from Telegram. Phone/email must be in the message
  //                OR the user has expressed transactional intent (CRM-LEAD-003).
  //  CRM-LEAD-003: Transactional intent (cita/presupuesto/llamada/contacto) is enough
  //                to qualify — AI will then collect phone/email in that same flow.
  //  CRM-LEAD-004: Informational queries ("qué servicios ofrecéis", "transformación
  //                digital", etc.) must stay anonymous — NO lead created.
  //
  // Decision tree for unknown contacts:
  //   isGreetingOnly OR isCommand → CRM-001 static welcome, no lead
  //   isTransactionalIntent OR hasContactData → create lead  (CRM-LEAD-003 / CRM-LEAD-002)
  //   else (informational)         → anonymous AI reply, no lead  (CRM-LEAD-004)

  const isGreetingOnly       = GREETING_ONLY_RE.test(trimmed) && !hasValidContactData(text);
  const isCommandMsg         = COMMAND_RE.test(trimmed);
  const isTransactionalIntent = TRANSACTIONAL_INTENT_RE.test(text) || LEAD_HOT_RE.test(text);
  const hasContactData        = hasValidContactData(text);

  if (!client && (senderName || username)) {
    if (isGreetingOnly || isCommandMsg) {
      // CRM-001: pure greeting or /start — handled via static welcome below, no lead
      console.log(`[CRM-001] Greeting/command from unknown contact (chat_id=${chatIdStr}) — skipping lead creation`);
    } else if (isTransactionalIntent || hasContactData) {
      // CRM-LEAD-003 / CRM-LEAD-002: qualifying intent or has contact data → create lead
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
        console.log(`[CRM-LEAD-003] ✅ Lead created from transactional intent: ${newName} (id=${created?.id})`);
        logIntegrationEvent({
          orgId, integrationSlug: "telegram", direction: "inbound",
          eventType: "contact_created", status: "processed",
          summary: `Lead creado por intención transaccional: ${newName} (chat_id: ${chatIdStr})`,
          payloadJson: { chatId, senderName, username, userId: msg.from?.id, trigger: isTransactionalIntent ? "transactional_intent" : "contact_data" },
        });
      } catch (err) {
        console.error("[Telegram] Lead auto-create failed:", err);
      }
    } else {
      // CRM-LEAD-004: informational query — anonymous conversation, no lead in CRM
      console.log(`[CRM-LEAD-004] Informational msg — anonymous conversation, no lead (chat_id=${chatIdStr}) | text="${text.slice(0, 60)}"`);
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

  // 2. If client found, link telegram_chat_id
  if (client) {
    // Persist chat_id on client if not already set
    if (!client.telegramChatId || client.telegramChatId !== chatIdStr) {
      await db.update(clientsTable)
        .set({ telegramChatId: chatIdStr, updatedAt: new Date() })
        .where(eq(clientsTable.id, client.id));
    }
  }

  // Save inbound message — ALWAYS, regardless of whether a CRM client is linked.
  // Previously this insert lived inside `if (client)`, so anonymous/guest messages
  // were never persisted at all (unlike WhatsApp, where they at least made it into
  // the messages table). That silently dropped guest conversations and also meant
  // there was no history for the AI to build guest memory from. Uses .returning()
  // to get the ID for history exclusion.
  const [savedInbound] = await db.insert(messagesTable).values({
    orgId,
    clientId:     client?.id ?? null,
    externalId:   chatIdStr,
    externalName: senderName || username || null,
    content:      text.slice(0, 2000),
    direction:    "inbound",
    channel:      "telegram",
    isAi:         false,
    status:       "received",
  }).returning({ id: messagesTable.id });
  savedInboundId = savedInbound?.id;
  console.log(`[TG Memoria] Inbound saved: msgId=${savedInboundId ?? "?"} | clientId=${client?.id ?? "null (anónimo)"}`);

  // ── Client Autopilot: regla crítica — el cliente respondió, pausar de inmediato ──
  if (client) {
    pauseAutopilotOnReply(orgId, client.id).catch((err) =>
      console.error("[TG] pauseAutopilotOnReply error:", err),
    );
  }

  if (client) {
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

    // ── CRM-001: Greeting or command from unknown contact → static welcome, no AI call ──
    if (!client && (isGreetingOnly || isCommandMsg)) {
      const [orgRow] = await db.select({ name: organizationsTable.name })
        .from(organizationsTable).where(eq(organizationsTable.id, orgId));
      const orgLabel = orgRow?.name ?? "nuestro equipo";
      const welcomeReply =
        `¡Hola! 👋 Soy Ava, el asistente de *${orgLabel}*. ` +
        `¿En qué puedo ayudarte hoy? Si quieres agendar una cita, pedir un presupuesto o hablar con nuestro equipo, con gusto te atiendo. 😊`;
      await tgSend(token, chatId, welcomeReply);
      console.log(`[CRM-001] Static welcome sent to unknown contact chat_id=${chatIdStr}`);
      return;
    }

    // ── CRM-LEAD-004: Informational anonymous conversation ──────────────────────
    // No client in CRM, no transactional intent — respond helpfully but stay anonymous.
    // The AI will naturally guide the user toward a cita/presupuesto when appropriate.
    if (!client) {
      console.log(`[CRM-LEAD-004] Anonymous AI response (no lead) chat_id=${chatIdStr}`);
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
      chatId,
      excludeMsgId: savedInboundId,
      client: client ?? null,
    });

    console.log(`[Telegram AI] reply generated=${!!aiReply} | len=${aiReply?.length ?? 0}`);

    const replyText = aiReply
      ?? `👋 ¡Hola${senderName ? `, ${senderName}` : ""}! Gracias por escribirnos. En breve un miembro de nuestro equipo te atenderá. ¿Podemos ayudarte en algo más?`;

    const sent = await tgSend(token, chatId, replyText);

    if (aiReply) {
      // Save AI reply to messages table — always, even for guest (no-client)
      // conversations, so the guest thread has a full history (see FIX-AU).
      await db.insert(messagesTable).values({
        orgId,
        clientId:     client?.id ?? null,
        externalId:   chatIdStr,
        externalName: senderName || username || null,
        content:      aiReply.slice(0, 2000),
        direction:    "outbound",
        channel:      "telegram",
        isAi:         true,
        status:       sent ? "sent" : "failed",
      });
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
      if (!msg) return;

      // ── Text message → standard CRM pipeline ───────────────────────────────
      if (msg.text?.trim()) {
        await processIncomingTelegramMessage(conn.orgId, msg);
        return;
      }

      // ── Voice / audio note → transcribe with Whisper, process as text ───────
      const voiceFileId = msg.voice?.file_id ?? msg.audio?.file_id;
      if (voiceFileId) {
        const mimeType = msg.voice?.mime_type ?? msg.audio?.mime_type ?? "audio/ogg";
        const token = await getTelegramToken(conn.orgId);
        if (!token) {
          console.warn(`[Telegram Webhook] 🎤 No bot token for org ${conn.orgId} — cannot process voice`);
          return;
        }
        const audioBuffer = await downloadTelegramAudio(token, voiceFileId);
        if (!audioBuffer) return;

        const transcript = await transcribeAudio(audioBuffer, "voice.ogg", mimeType);
        if (!transcript?.trim()) {
          console.warn(`[Telegram Webhook] 🎤 Empty transcript for org ${conn.orgId} — ignoring`);
          return;
        }
        console.log(`[Telegram Webhook] 🎤 Voice transcribed for org ${conn.orgId}: "${transcript.slice(0, 80)}"`);
        await processIncomingTelegramMessage(conn.orgId, { ...msg, text: transcript });
        return;
      }

      // Non-text, non-audio → silently ignore (stickers, photos, etc.)
    } catch (err) {
      console.error("[Telegram Webhook] Error:", err);
    }
  })();
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /verify — comprueba que el Bot Token es válido ──────────────────────
import { requirePermission } from "../middlewares/permissions";

telegramRouter.post("/verify", requirePermission("telegram.write"), async (req, res) => {
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
telegramRouter.post("/set-webhook", requirePermission("telegram.write"), async (req, res) => {
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

    // Determine the public base URL.
    // Priority: PUBLIC_URL (production secret) > REPLIT_DEV_DOMAIN (dev IDE) > x-forwarded-host > fallback
    const host    = process.env.PUBLIC_URL
      ? process.env.PUBLIC_URL
      : process.env.REPLIT_DEV_DOMAIN
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
telegramRouter.get("/webhook-info", requirePermission("telegram.read"), async (req, res) => {
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
telegramRouter.post("/test-send", requirePermission("telegram.write"), async (req, res) => {
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
telegramRouter.get("/audit", requirePermission("telegram.read"), async (req, res) => {
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
telegramRouter.get("/status", requirePermission("telegram.read"), async (req, res) => {
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
telegramRouter.post("/send", requirePermission("telegram.write"), async (req, res) => {
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

    // Save to messages table — always, even when the chat_id has no CRM client
    // linked, so guest threads sent to from here still show up in their history.
    try {
      const client = await db.select().from(clientsTable).where(and(
        eq(clientsTable.orgId, orgId),
        eq(clientsTable.telegramChatId, String(chatId)),
      )).then((r) => r[0] ?? null);

      await db.insert(messagesTable).values({
        orgId:        orgId,
        clientId:     client?.id ?? null,
        externalId:   String(chatId),
        externalName: client?.name ?? null,
        channel:      "telegram",
        direction:    "outbound",
        content:      message.trim().slice(0, 2000),
        status:       "sent",
        isAi:         false,
      });
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
telegramRouter.get("/debug/:clientId", requirePermission("telegram.read"), async (req, res) => {
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
telegramRouter.get("/conversations", requirePermission("telegram.read"), async (req, res) => {
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

    // ── Guest conversations — no CRM client linked, grouped by external_id (chat_id) ──
    // Anonymous Telegram chats (FIX-AU). Without this block guest threads never
    // showed up in the inbox even after their messages started being saved.
    const guestMessages = await db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.orgId, orgId),
        eq(messagesTable.channel, "telegram"),
        isNull(messagesTable.clientId),
        isNotNull(messagesTable.externalId),
      ))
      .orderBy(desc(messagesTable.createdAt));

    const guestGroups = new Map<string, typeof guestMessages>();
    for (const m of guestMessages) {
      const key = m.externalId as string;
      const arr = guestGroups.get(key);
      if (arr) arr.push(m); else guestGroups.set(key, [m]);
    }

    const guestConversations = Array.from(guestGroups.entries()).map(([externalId, msgs]) => {
      const lastMsg = msgs[0]; // guestMessages is already ordered desc → first is newest per group
      const named = msgs.find((m) => m.externalName);
      return {
        clientId:             null as number | null,
        clientName:           named?.externalName ?? externalId,
        chatId:               externalId,
        leadScore:            null as string | null,
        leadIntent:           null as string | null,
        status:               "guest",
        company:              null as string | null,
        phone:                null as string | null,
        email:                null as string | null,
        lastMessage:          lastMsg?.content ?? null,
        lastMessageAt:        lastMsg?.createdAt ?? null,
        lastMessageDirection: lastMsg?.direction ?? null,
        lastMessageIsAi:      lastMsg?.isAi ?? null,
        messageCount:         msgs.length,
      };
    });

    const allConversations = [...conversations, ...guestConversations];

    allConversations.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    console.log(`[Telegram/conversations] returning ${allConversations.length} conversations (${guestConversations.length} guest)`);
    res.json(allConversations);
  } catch (err) {
    console.error("[Telegram/conversations] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/telegram/conversations/:clientId — messages thread ───────────────
// Accepts a numeric CRM clientId, or "guest:<externalId>" (chat_id) for
// anonymous guest conversations with no CRM client linked — see FIX-AU.
telegramRouter.get("/conversations/:clientId", requirePermission("telegram.read"), async (req, res) => {
  const orgId    = (req as any).orgId as number;
  const rawParam = String(req.params.clientId ?? "");
  const limit    = Math.min(Number(req.query.limit ?? 100), 300);
  try {
    if (rawParam.startsWith("guest:")) {
      const externalId = rawParam.slice("guest:".length);
      const msgs = await db
        .select()
        .from(messagesTable)
        .where(and(
          eq(messagesTable.orgId, orgId),
          eq(messagesTable.externalId, externalId),
          eq(messagesTable.channel, "telegram"),
        ))
        .orderBy(asc(messagesTable.createdAt))
        .limit(limit);
      res.json(msgs);
      return;
    }

    const clientId = Number(rawParam);
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
// Accepts a numeric CRM clientId, or "guest:<externalId>" (chat_id) for guest
// conversations with no CRM client linked — see FIX-AU.
telegramRouter.post("/conversations/:clientId/reply", requirePermission("telegram.write"), async (req, res) => {
  const orgId    = (req as any).orgId as number;
  const rawParam = String(req.params.clientId ?? "");
  const { message } = req.body as { message: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "Se requiere message." });
    return;
  }

  try {
    if (rawParam.startsWith("guest:")) {
      const externalId = rawParam.slice("guest:".length);

      const token = await getTelegramToken(orgId);
      if (!token) {
        res.status(404).json({ error: "Bot token no configurado." });
        return;
      }

      const sent = await tgSend(token, Number(externalId), message.trim());

      await db.insert(messagesTable).values({
        orgId,
        clientId:     null,
        externalId,
        externalName: null,
        content:      message.trim().slice(0, 2000),
        direction:    "outbound",
        channel:      "telegram",
        isAi:         false,
        status:       sent ? "sent" : "failed",
      });

      await logIntegrationEvent({
        orgId, integrationSlug: "telegram", direction: "outbound",
        eventType: sent ? "message_sent" : "message_send_failed",
        status:    sent ? "processed" : "error",
        summary:   `Respuesta manual desde CRM → invitado ${externalId}: "${message.slice(0, 80)}"`,
        payloadJson: { externalId, chatId: externalId },
      });

      res.json({ success: sent });
      return;
    }

    const clientId = Number(rawParam);
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
