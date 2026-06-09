import { Router } from "express";
import OpenAI from "openai";
import {
  db,
  agentMemoryTable,
  aiSessionsTable,
  aiMessagesTable,
  clientsTable,
  appointmentsTable,
  activityTable,
} from "@workspace/db";
import { eq, and, desc, gte, lt, inArray } from "drizzle-orm";

const router = Router();
const AGENT_SLUG = "operator";
type AgentMemoryRow = typeof agentMemoryTable.$inferSelect;

// ── Semantic helpers ──────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function getRelevantMemories(
  openai: OpenAI,
  orgId: number,
  userMessage: string,
  limit = 20,
): Promise<AgentMemoryRow[]> {
  const all = await db
    .select()
    .from(agentMemoryTable)
    .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, AGENT_SLUG)))
    .orderBy(desc(agentMemoryTable.updatedAt))
    .limit(200);

  if (all.length <= limit) return all;

  const withEmb = all.filter(r => r.embedding && (r.embedding as number[]).length > 0);
  if (withEmb.length === 0) return all.slice(0, limit);

  try {
    const qRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: userMessage.slice(0, 500),
    });
    const qVec = qRes.data[0]!.embedding;
    return all
      .map(r => ({
        mem: r,
        score: r.embedding ? cosineSimilarity(qVec, r.embedding as number[]) : 0.1,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.mem);
  } catch {
    return all.slice(0, limit);
  }
}

// ── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Eres OmniTech AI, el asistente de inteligencia artificial integrado en OmniTech Core. Ayudas a equipos de ventas y negocios hispanohablantes a gestionar clientes, redactar mensajes, crear presupuestos, agendar citas y analizar su rendimiento comercial.

Contexto del sistema:
- CRM enfocado en el mercado español e hispanohablante
- Usuarios: vendedores, account managers, directores comerciales
- Funciones principales: gestión de clientes, pipeline de ventas, comunicaciones, calendario

Instrucciones:
- Responde SIEMPRE en español, de forma profesional pero cercana
- Usa formato Markdown cuando sea útil (negritas, listas, tablas)
- Sé conciso pero completo — respuestas de máximo 400 palabras salvo que pidan algo detallado
- Cuando generes presupuestos, usa formato de tabla Markdown
- Cuando sugieras mensajes para clientes, ponlos entre comillas en bloque con >
- Propón siempre un siguiente paso accionable al final de tu respuesta
- No menciones que eres GPT o que eres de OpenAI — eres OmniTech AI

FORMATO EJECUTIVO VISUAL:
Cuando respondas sobre citas, actividad, clientes o resúmenes del CRM, usa este formato con emojis (solo las secciones relevantes):
📊 **Resumen** — cifras clave en 1-2 líneas
📅 **Citas** — lista limpia de citas con hora y cliente
👥 **Clientes** — clientes destacados o involucrados
⚠️ **Pendientes** — alertas, sin respuesta, sin confirmar
🚀 **Recomendación** — próximo paso accionable concreto

Nunca uses tablas técnicas con columnas de datos crudos. Presenta la información de forma ejecutiva y legible.`;

interface ClientContext {
  id?: number;
  name: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  status?: string;
  tags?: string | null;
  notes?: string | null;
  value?: number | null;
  lastInteraction?: string | null;
}

const STATUS_ES: Record<string, string> = {
  lead:     "Prospecto (en etapa de evaluación)",
  active:   "Cliente activo (relación vigente)",
  inactive: "Cliente inactivo (sin actividad reciente)",
  churned:  "Cliente perdido (canceló o dejó de comprar)",
};

function resolveMemoryLabel(m: AgentMemoryRow): string {
  if (m.title) return m.title;
  const i = m.memoryKey.indexOf(":");
  const name = i !== -1 ? m.memoryKey.slice(i + 1) : m.memoryKey;
  return name.replace(/_/g, " ");
}

function resolveMemoryCat(m: AgentMemoryRow): string {
  if (m.category) return m.category;
  const i = m.memoryKey.indexOf(":");
  return i !== -1 ? m.memoryKey.slice(0, i) : "info";
}

function buildSystemPrompt(
  memories: AgentMemoryRow[],
  clientContext?: ClientContext,
): string {
  // Inject current date/time (Spain timezone) so AI can reason about "hoy", "mañana", "esta semana"
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Europe/Madrid",
  });
  const timeStr = now.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
  const dateBlock = `\n\n🗓️ FECHA Y HORA ACTUAL (Madrid): ${dateStr}, ${timeStr}. Usa esta fecha para interpretar correctamente "hoy", "mañana" y "esta semana" al consultar citas y actividad.`;

  const memoryBlock =
    memories.length > 0
      ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 MEMORIA ORGANIZACIONAL (${memories.length} entradas)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memories.map(m => {
  const label = resolveMemoryLabel(m);
  const cat   = resolveMemoryCat(m);
  return `### ${label} [${cat}]\n${m.memoryVal}`;
}).join("\n\n")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCCIÓN CRÍTICA: La MEMORIA ORGANIZACIONAL contiene información oficial y real de esta organización. Cuando el usuario pregunte sobre servicios, procesos, clientes, decisiones, objetivos u cualquier información que ya esté en la memoria, DEBES responder usando esa información como fuente primaria y exacta. No inventes ni supongas — cita lo que está en la memoria.`
      : "";

  const base = BASE_SYSTEM_PROMPT + dateBlock + memoryBlock;

  if (!clientContext) return base;

  const lines = [
    `Nombre completo: ${clientContext.name}`,
    clientContext.company       ? `Empresa: ${clientContext.company}` : null,
    clientContext.status        ? `Estado en CRM: ${STATUS_ES[clientContext.status] ?? clientContext.status}` : null,
    clientContext.email         ? `Email: ${clientContext.email}` : null,
    clientContext.phone         ? `Teléfono: ${clientContext.phone}` : null,
    clientContext.value         ? `Valor del trato: €${clientContext.value.toLocaleString("es-ES")}` : null,
    clientContext.tags          ? `Etiquetas: ${clientContext.tags}` : null,
    clientContext.lastInteraction ? `Última interacción registrada: ${clientContext.lastInteraction}` : null,
    clientContext.notes         ? `Notas del CRM:\n${clientContext.notes}` : null,
  ].filter(Boolean).join("\n");

  return `${base}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CLIENTE EN FOCO
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCCIONES ESPECIALES PARA ESTE CLIENTE:
- Usa su nombre (${clientContext.name.split(" ")[0]}) de forma natural en tu respuesta
- Cuando redactes mensajes, diríjete al cliente directamente por su nombre
- Cuando hagas propuestas o presupuestos, menciona su empresa (${clientContext.company ?? clientContext.name})
- Ten en cuenta su estado actual (${clientContext.status ?? "desconocido"}) para adaptar el tono y la estrategia
- Si hay notas del CRM, úsalas para personalizar tu respuesta
- Si hay información de última interacción, menciónala si es relevante para dar contexto`;
}

// ── CRM Tools ─────────────────────────────────────────────────────────────────

// ── Date helpers (Spain / Madrid timezone) ───────────────────────────────────

function getMadridDayBounds(offsetDays = 0): { start: Date; end: Date } {
  const now = new Date();
  // Resolve "today" in Europe/Madrid by formatting + re-parsing
  const madridDateStr = now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }); // "YYYY-MM-DD"
  const [y, m, d] = madridDateStr.split("-").map(Number);
  // Create UTC midnight for that Madrid date
  const startUTC = new Date(Date.UTC(y!, m! - 1, d! + offsetDays, 0, 0, 0));
  const endUTC   = new Date(Date.UTC(y!, m! - 1, d! + offsetDays + 1, 0, 0, 0));
  return { start: startUTC, end: endUTC };
}

function getMadridWeekBounds(): { start: Date; end: Date } {
  const { start: todayStart } = getMadridDayBounds(0);
  const dow = todayStart.getUTCDay(); // 0=Sun … 6=Sat
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() + daysToMon);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return { start: weekStart, end: weekEnd };
}

function getMadridMonthStart(): Date {
  const now = new Date();
  const madridDateStr = now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  const [y, m] = madridDateStr.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1, 0, 0, 0));
}

// ── CRM Tools ─────────────────────────────────────────────────────────────────

const CRM_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_clients",
      description:
        "Lista clientes del CRM. Úsala para: listado completo, cuántos clientes hay, " +
        "conteo por estado, valor de cartera, último cliente creado, clientes que necesitan seguimiento.",
      parameters: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["all", "lead", "active", "inactive", "churned", "followup"],
            description:
              "'all' = todos · 'lead' = prospectos · 'active' = activos · " +
              "'inactive' = inactivos · 'churned' = perdidos · " +
              "'followup' = clientes que necesitan seguimiento (leads + inactivos).",
          },
          sort: {
            type: "string",
            enum: ["name", "created_desc", "value_desc"],
            description:
              "'name' = por nombre (defecto) · 'created_desc' = más recientes primero " +
              "(usar para ¿último cliente creado?) · 'value_desc' = por valor.",
          },
          limit: {
            type: "number",
            description: "Máximo clientes a devolver. Por defecto 50.",
          },
        },
        required: ["status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_appointments",
      description:
        "Obtiene citas del calendario con cliente asociado. " +
        "Úsala para: citas de hoy, mañana, esta semana, pendientes, próximas reuniones, historial.",
      parameters: {
        type: "object" as const,
        properties: {
          date_filter: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "upcoming", "past", "all"],
            description:
              "'today' = hoy · 'tomorrow' = mañana · 'this_week' = esta semana (lun-dom) · " +
              "'upcoming' = todas las futuras · 'past' = pasadas · 'all' = todas sin filtro de fecha.",
          },
          status_filter: {
            type: "string",
            enum: ["all", "pending", "confirmed", "completed", "cancelled"],
            description:
              "Filtra por estado de cita. 'pending' = pendientes de confirmar · 'all' = cualquier estado.",
          },
          limit: {
            type: "number",
            description: "Máximo de citas. Por defecto 20.",
          },
        },
        required: ["date_filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_activity",
      description:
        "Obtiene el registro de actividad del CRM: clientes añadidos, mensajes, citas, cambios de estado. " +
        "Úsala para preguntas sobre qué ocurrió hoy, esta semana, este mes o en general.",
      parameters: {
        type: "object" as const,
        properties: {
          period: {
            type: "string",
            enum: ["today", "this_week", "this_month", "all"],
            description:
              "'today' = hoy · 'this_week' = esta semana · 'this_month' = este mes · 'all' = todo.",
          },
          limit: {
            type: "number",
            description: "Número de entradas. Por defecto 30.",
          },
        },
        required: ["period"],
      },
    },
  },
];

const CRM_TOOL_NAMES = new Set(CRM_TOOLS.map(t => t.function.name));

const STATUS_LABEL: Record<string, string> = {
  lead:     "Prospecto",
  active:   "Activo",
  inactive: "Inactivo",
  churned:  "Perdido",
};

const APPT_STATUS_LABEL: Record<string, string> = {
  pending:   "⏳ Pendiente",
  confirmed: "✅ Confirmada",
  completed: "✔️ Completada",
  cancelled: "❌ Cancelada",
};

async function executeCrmTool(
  toolName: string,
  args: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  try {
    // ── list_clients ────────────────────────────────────────────────────────
    if (toolName === "list_clients") {
      const status = (args["status"] as string | undefined) ?? "all";
      const sort   = (args["sort"]   as string | undefined) ?? "name";
      const limit  = Math.min(Number(args["limit"] ?? 50), 100);

      const orderBy =
        sort === "created_desc" ? desc(clientsTable.createdAt) :
        sort === "value_desc"   ? desc(clientsTable.value)     :
        clientsTable.name;

      const whereClause =
        status === "all"
          ? eq(clientsTable.orgId, orgId)
          : status === "followup"
            ? and(eq(clientsTable.orgId, orgId), inArray(clientsTable.status, ["lead", "inactive"]))
            : and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, status));

      const rows = await db
        .select()
        .from(clientsTable)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit);

      const totalValue = rows.reduce((acc, c) => acc + (c.value ?? 0), 0);
      const byStatus: Record<string, number> = {};
      for (const c of rows) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

      return JSON.stringify({
        total: rows.length,
        totalValue: Math.round(totalValue),
        byStatus: Object.entries(byStatus).map(([s, n]) => ({
          status: s, label: STATUS_LABEL[s] ?? s, count: n,
        })),
        clients: rows.map(c => ({
          id:        c.id,
          name:      c.name,
          company:   c.company ?? null,
          status:    c.status,
          label:     STATUS_LABEL[c.status] ?? c.status,
          email:     c.email,
          phone:     c.phone ?? null,
          value:     c.value ?? 0,
          tags:      c.tags ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }

    // ── get_appointments ────────────────────────────────────────────────────
    if (toolName === "get_appointments") {
      const dateFilter   = (args["date_filter"]   as string | undefined) ?? "all";
      const statusFilter = (args["status_filter"] as string | undefined) ?? "all";
      const limit        = Math.min(Number(args["limit"] ?? 20), 50);
      const now          = new Date();

      // Build date range condition
      let dateCondition = undefined;
      if (dateFilter === "today") {
        const { start, end } = getMadridDayBounds(0);
        dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
      } else if (dateFilter === "tomorrow") {
        const { start, end } = getMadridDayBounds(1);
        dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
      } else if (dateFilter === "this_week") {
        const { start, end } = getMadridWeekBounds();
        dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
      } else if (dateFilter === "upcoming") {
        dateCondition = gte(appointmentsTable.startTime, now);
      } else if (dateFilter === "past") {
        dateCondition = lt(appointmentsTable.startTime, now);
      }

      // Build status condition
      const statusCondition =
        statusFilter !== "all" ? eq(appointmentsTable.status, statusFilter) : undefined;

      // Combine all conditions
      const conditions = [
        eq(appointmentsTable.orgId, orgId),
        dateCondition,
        statusCondition,
      ].filter(Boolean);

      const orderDir =
        dateFilter === "past" ? desc(appointmentsTable.startTime) : appointmentsTable.startTime;

      const baseSelect = {
        id:            appointmentsTable.id,
        title:         appointmentsTable.title,
        description:   appointmentsTable.description,
        startTime:     appointmentsTable.startTime,
        endTime:       appointmentsTable.endTime,
        status:        appointmentsTable.status,
        type:          appointmentsTable.type,
        location:      appointmentsTable.location,
        clientId:      appointmentsTable.clientId,
        clientName:    clientsTable.name,
        clientCompany: clientsTable.company,
      };

      const rows = await db
        .select(baseSelect)
        .from(appointmentsTable)
        .leftJoin(clientsTable, eq(appointmentsTable.clientId, clientsTable.id))
        .where(conditions.length === 1 ? conditions[0] : and(...conditions as Parameters<typeof and>))
        .orderBy(orderDir)
        .limit(limit);

      return JSON.stringify({
        total:       rows.length,
        date_filter: dateFilter,
        queried_at:  now.toISOString(),
        appointments: rows.map(r => ({
          id:            r.id,
          title:         r.title,
          description:   r.description ?? null,
          startTime:     r.startTime.toISOString(),
          endTime:       r.endTime.toISOString(),
          status:        r.status,
          statusLabel:   APPT_STATUS_LABEL[r.status] ?? r.status,
          type:          r.type ?? null,
          location:      r.location ?? null,
          clientName:    r.clientName ?? null,
          clientCompany: r.clientCompany ?? null,
        })),
      });
    }

    // ── get_recent_activity ─────────────────────────────────────────────────
    if (toolName === "get_recent_activity") {
      const period = (args["period"] as string | undefined) ?? "all";
      const limit  = Math.min(Number(args["limit"] ?? 30), 100);

      let periodCondition = undefined;
      if (period === "today") {
        const { start } = getMadridDayBounds(0);
        periodCondition = gte(activityTable.createdAt, start);
      } else if (period === "this_week") {
        const { start } = getMadridWeekBounds();
        periodCondition = gte(activityTable.createdAt, start);
      } else if (period === "this_month") {
        periodCondition = gte(activityTable.createdAt, getMadridMonthStart());
      }

      const conditions = [
        eq(activityTable.orgId, orgId),
        periodCondition,
      ].filter(Boolean);

      const rows = await db
        .select()
        .from(activityTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions as Parameters<typeof and>))
        .orderBy(desc(activityTable.createdAt))
        .limit(limit);

      return JSON.stringify({
        total:  rows.length,
        period,
        activity: rows.map(r => ({
          id:          r.id,
          type:        r.type,
          description: r.description,
          clientName:  r.clientName ?? null,
          createdAt:   r.createdAt.toISOString(),
        })),
      });
    }

    return JSON.stringify({ error: `Herramienta desconocida: ${toolName}` });
  } catch (err) {
    console.error(`[CRM Tool] ${toolName} error:`, String(err));
    return JSON.stringify({ error: `Error ejecutando ${toolName}: ${String(err)}` });
  }
}

// ── Memory extraction ─────────────────────────────────────────────────────────

const SAVE_MEMORY_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_memory",
    description:
      "Guarda un hecho importante en la memoria organizacional para referencia futura.",
    parameters: {
      type: "object" as const,
      properties: {
        key: {
          type: "string",
          description:
            "Clave única. Formato: categoria:nombre_descriptivo (guiones_bajos, sin espacios). " +
            "Ejemplos: client:juan_garcia, sop:proceso_onboarding, decision:politica_precios, " +
            "fact:sector_empresa, preference:estilo_comunicacion",
        },
        value: {
          type: "string",
          description: "Contenido del recuerdo. Máximo 200 caracteres. Conciso y factual.",
        },
        category: {
          type: "string",
          enum: ["client", "sop", "decision", "fact", "preference"],
          description: "Categoría del recuerdo.",
        },
      },
      required: ["key", "value", "category"],
    },
  },
};

async function extractAndSaveMemories(
  openai: OpenAI,
  orgId: number,
  lastUserMessage: string,
  aiResponse: string,
  existingMemories: AgentMemoryRow[],
): Promise<AgentMemoryRow[]> {
  const existingList =
    existingMemories.length > 0
      ? existingMemories
          .slice(0, 30)
          .map(m => `[${m.memoryKey}] ${m.memoryVal}`)
          .join("\n")
      : "Ninguna aún.";

  let extraction;
  try {
    extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 400,
      temperature: 0.1,
      tool_choice: "auto",
      tools: [SAVE_MEMORY_TOOL],
      messages: [
        {
          role: "system",
          content: `Eres un extractor de información organizacional. Analiza el intercambio y determina si hay hechos importantes que guardar en la memoria de la organización.

REGLAS:
- Solo guarda información DURABLE Y FACTUAL: datos de clientes, procesos, decisiones, hechos de la empresa, preferencias
- NO guardes: saludos, preguntas genéricas, respuestas que no contienen hechos nuevos
- Evita duplicar memorias ya existentes
- Si no hay nada digno de guardar, NO llames ninguna herramienta
- Máximo 2 memorias por intercambio

Memorias ya existentes:
${existingList}`,
        },
        {
          role: "user",
          content: `Usuario: "${lastUserMessage.slice(0, 400)}"`,
        },
        {
          role: "assistant",
          content: aiResponse.slice(0, 800),
        },
      ],
    });
  } catch {
    return [];
  }

  const toolCalls = extraction.choices[0]?.message?.tool_calls ?? [];
  const saved: AgentMemoryRow[] = [];

  for (const tc of toolCalls) {
    if (tc.function.name !== "save_memory") continue;
    try {
      const args = JSON.parse(tc.function.arguments) as {
        key: string;
        value: string;
        category: string;
      };
      // Ensure key has category prefix, normalize
      const rawName = args.key.replace(/^[^:]+:/, "").toLowerCase().replace(/\s+/g, "_");
      const normalizedKey = `${args.category}:${rawName}`;

      // Generate embedding for AI-saved memory
      let emb: number[] | null = null;
      try {
        const embRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: `${normalizedKey} ${args.value}`.slice(0, 2000),
        });
        emb = embRes.data[0]?.embedding ?? null;
      } catch { /* Non-critical */ }

      const [mem] = await db
        .insert(agentMemoryTable)
        .values({
          orgId,
          agentSlug: AGENT_SLUG,
          memoryKey: normalizedKey,
          memoryVal: args.value.slice(0, 500),
          category: args.category,
          embedding: emb,
          source: "ai",
        })
        .onConflictDoUpdate({
          target: [agentMemoryTable.orgId, agentMemoryTable.agentSlug, agentMemoryTable.memoryKey],
          set: {
            memoryVal: args.value.slice(0, 500),
            category: args.category,
            embedding: emb,
            source: "ai",
            updatedAt: new Date(),
          },
        })
        .returning();
      if (mem) saved.push(mem);
    } catch {
      // Non-critical — don't fail on memory save errors
    }
  }

  return saved;
}

// ── Session endpoints ──────────────────────────────────────────────────────────

router.get("/sessions", async (req, res) => {
  try {
    const sessions = await db
      .select()
      .from(aiSessionsTable)
      .where(and(eq(aiSessionsTable.orgId, req.orgId!), eq(aiSessionsTable.userId, req.userId!)))
      .orderBy(desc(aiSessionsTable.updatedAt))
      .limit(50);
    res.json(sessions.map(s => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(aiSessionsTable)
      .where(and(
        eq(aiSessionsTable.id, req.params.sessionId),
        eq(aiSessionsTable.orgId, req.orgId!),
        eq(aiSessionsTable.userId, req.userId!),
      ));
    if (!session) { res.status(404).json({ error: "Sesión no encontrada" }); return; }

    const msgs = await db
      .select()
      .from(aiMessagesTable)
      .where(eq(aiMessagesTable.sessionId, req.params.sessionId))
      .orderBy(aiMessagesTable.createdAt);

    res.json({
      session:  { ...session, createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() },
      messages: msgs.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { messages, clientContext, sessionId: incomingSessionId } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    clientContext?: ClientContext;
    sessionId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY no configurada" });
    return;
  }

  const orgId = req.orgId!;
  const openai = new OpenAI({ apiKey });

  // Load relevant memories via semantic search (isolated by orgId)
  let memories: AgentMemoryRow[] = [];
  const lastUserMessage = messages.filter(m => m.role === "user").at(-1)?.content ?? "";
  try {
    memories = await getRelevantMemories(openai, orgId, lastUserMessage);
    console.log(
      `[Chat] org=${orgId} memories_loaded=${memories.length}` +
      (memories.length > 0
        ? ` keys=[${memories.map(m => m.title ?? m.memoryKey).join(", ")}]`
        : " (none — assistant will respond without memory context)"),
    );
  } catch (memErr) {
    console.error("[Chat] FAILED to load memories:", String(memErr));
    // Continue without memory — non-fatal
  }

  // ── Session persistence ────────────────────────────────────────────────────
  let sessionId: string | undefined = incomingSessionId;
  try {
    if (sessionId) {
      // Existing session — verify ownership and bump updatedAt
      await db
        .update(aiSessionsTable)
        .set({ updatedAt: new Date() })
        .where(and(eq(aiSessionsTable.id, sessionId), eq(aiSessionsTable.orgId, orgId)));
    } else {
      // New session — create and title from first user message
      const title = lastUserMessage.slice(0, 60) || "Nueva conversación";
      const [newSession] = await db
        .insert(aiSessionsTable)
        .values({ orgId, userId: req.userId!, title, clientId: clientContext?.id ?? null })
        .returning();
      sessionId = newSession.id;
    }
    // Persist user message immediately (before streaming)
    await db.insert(aiMessagesTable).values({
      sessionId: sessionId!,
      role:      "user",
      content:   lastUserMessage,
    });
  } catch (sessionErr) {
    console.error("[Chat] Session persistence error:", String(sessionErr));
    // Non-fatal — continue; client will get undefined sessionId
    sessionId = incomingSessionId;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Tell client which sessionId to use for continuation
  res.write(`data: ${JSON.stringify({ event: "session_created", sessionId })}\n\n`);

  try {
    // ── Phase 1: CRM tool resolution (non-streaming) ───────────────────────
    // Build the initial messages array. We'll accumulate tool messages into it.
    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(memories, clientContext) },
      ...messages,
    ];

    // Call OpenAI with CRM tools to let it decide what data it needs.
    // max_tokens is kept low — this call is only for tool selection, not prose.
    const phase1 = await openai.chat.completions.create({
      model:        "gpt-4o-mini",
      messages:     apiMessages,
      tools:        CRM_TOOLS,
      tool_choice:  "auto",
      max_tokens:   300,
      temperature:  0.1,
    });

    const phase1Msg    = phase1.choices[0]?.message;
    const crmToolCalls = (phase1Msg?.tool_calls ?? []).filter(
      tc => CRM_TOOL_NAMES.has(tc.function.name),
    );

    if (crmToolCalls.length > 0) {
      // ── Execute CRM tools in parallel ──────────────────────────────────
      const toolResults = await Promise.all(
        crmToolCalls.map(async tc => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* use {} */ }

          const result = await executeCrmTool(tc.function.name, args, orgId);
          console.log(`[CRM] tool=${tc.function.name} args=${tc.function.arguments} result_len=${result.length}`);

          return {
            role:         "tool" as const,
            tool_call_id: tc.id,
            content:      result,
          };
        }),
      );

      // Append assistant tool-call message + tool results to message history
      apiMessages.push({ role: "assistant", content: null, tool_calls: crmToolCalls });
      apiMessages.push(...toolResults);

      // Signal to client that tools were resolved
      res.write(`data: ${JSON.stringify({ event: "tools_resolved", tools: crmToolCalls.map(tc => tc.function.name) })}\n\n`);
    }

    // ── Phase 2: Final streaming response ─────────────────────────────────
    // If no CRM tools were called, apiMessages is just system + user history.
    // If tools were called, apiMessages now includes tool results as context.
    const stream = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages:    apiMessages,
      stream:      true,
      max_tokens:  700,
      temperature: 0.7,
    });

    let accumulatedResponse = "";

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        accumulatedResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // Persist AI response to session (fire-and-forget)
    if (sessionId && accumulatedResponse.length > 0) {
      db.insert(aiMessagesTable)
        .values({ sessionId, role: "assistant", content: accumulatedResponse })
        .catch(err => console.error("[Chat] Failed to save AI message:", String(err)));
    }

    // Extract and save memories after streaming (non-blocking on the user)
    if (accumulatedResponse.length > 30 && messages.length > 0) {
      const lastUserMsg = [...messages]
        .reverse()
        .find(m => m.role === "user")?.content ?? "";

      const newMemories = await extractAndSaveMemories(
        openai,
        orgId,
        lastUserMsg,
        accumulatedResponse,
        memories,
      );

      for (const mem of newMemories) {
        res.write(`data: ${JSON.stringify({ event: "memory_saved", memory: mem })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export { router as chatRouter };
