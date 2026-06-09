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
  quotesTable,
  quoteItemsTable,
} from "@workspace/db";
import { eq, and, desc, gte, lt, inArray, ilike } from "drizzle-orm";

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
- CRÍTICO: Cuando el usuario mencione una cita, reunión, llamada o evento con fecha + cliente, SIEMPRE llama a la herramienta create_appointment para guardarla en el sistema. No describas la cita sin crearla. Si falta información, usa valores por defecto razonables.
- CRÍTICO: Cuando el usuario pida crear un presupuesto con cliente + servicios, SIEMPRE llama a create_quote. No generes solo texto Markdown sin guardar el presupuesto real.

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
  {
    type: "function",
    function: {
      name: "get_strategic_brief",
      description:
        "Obtiene un briefing estratégico completo del negocio con scoring de clientes, prioridades de acción y forecast de ingresos. " +
        "DEBES usar esta herramienta SIEMPRE para preguntas como: '¿Cómo va mi negocio?', '¿Qué debo hacer hoy?', " +
        "'¿A qué cliente llamo?', '¿Dónde está el dinero?', '¿Qué me hará ganar más?', '¿Qué cliente priorizo?'. " +
        "Devuelve clientes rankeados por score económico, prioridades accionables y análisis de riesgos.",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description:
        "Crea una cita real en el calendario del CRM y la guarda en la base de datos. " +
        "DEBES usar esta herramienta siempre que el usuario mencione una fecha + cliente + motivo, " +
        "aunque lo diga de forma conversacional. Ejemplos: 'el martes tenemos reunión con X', " +
        "'agenda una llamada con Y para el viernes', 'el 22 de junio validamos con Z'. " +
        "Infiere la fecha en formato YYYY-MM-DD usando la fecha actual del sistema.",
      parameters: {
        type: "object" as const,
        properties: {
          client_name: {
            type: "string",
            description: "Nombre del cliente tal como aparece en el CRM. Se buscará por coincidencia.",
          },
          title: {
            type: "string",
            description: "Título de la cita. Ej: 'Reunión de validación', 'Llamada de seguimiento'.",
          },
          date: {
            type: "string",
            description:
              "Fecha en formato YYYY-MM-DD. Usa la fecha actual del sistema para resolver fechas relativas " +
              "como 'el martes', 'mañana', '22 de junio'. Ejemplo: '2026-06-22'.",
          },
          start_time: {
            type: "string",
            description: "Hora de inicio en formato HH:MM (24h). Por defecto '10:00'.",
          },
          duration_minutes: {
            type: "number",
            description: "Duración en minutos. Por defecto 60.",
          },
          description: {
            type: "string",
            description: "Descripción o motivo de la cita. Opcional.",
          },
          location: {
            type: "string",
            description: "Lugar o enlace de videollamada. Opcional.",
          },
          type: {
            type: "string",
            enum: ["meeting", "call", "demo", "follow_up", "other"],
            description: "Tipo de cita. Por defecto 'meeting'.",
          },
        },
        required: ["client_name", "title", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_quote",
      description:
        "Crea un presupuesto real y lo guarda en el CRM. " +
        "Úsala cuando el usuario diga 'crear presupuesto', 'hacer presupuesto', 'generar cotización' o similar. " +
        "Busca primero el cliente con list_clients si no tienes certeza del nombre exacto.",
      parameters: {
        type: "object" as const,
        properties: {
          client_name: {
            type: "string",
            description: "Nombre del cliente tal como aparece en el CRM. Se buscará por coincidencia.",
          },
          title: {
            type: "string",
            description: "Título descriptivo del presupuesto. Ej: 'Servicios de automatización Q3 2026'.",
          },
          items: {
            type: "array",
            description: "Líneas del presupuesto. Mínimo 1.",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Descripción del servicio o producto." },
                quantity:    { type: "number", description: "Cantidad. Por defecto 1." },
                unit_price:  { type: "number", description: "Precio unitario en euros." },
              },
              required: ["description", "quantity", "unit_price"],
            },
          },
          tax_rate: {
            type: "number",
            description: "Porcentaje de IVA. Por defecto 21 (IVA estándar España).",
          },
          notes: {
            type: "string",
            description: "Notas o condiciones del presupuesto. Opcional.",
          },
          valid_days: {
            type: "number",
            description: "Días de validez del presupuesto. Por defecto 30.",
          },
        },
        required: ["client_name", "title", "items"],
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

    // ── get_strategic_brief ──────────────────────────────────────────────────
    if (toolName === "get_strategic_brief") {
      const now = new Date();
      const thirtyAgo      = new Date(now.getTime() - 30  * 86_400_000);
      const sevenFromNow   = new Date(now.getTime() + 7   * 86_400_000);
      const fourteenAgo    = new Date(now.getTime() - 14  * 86_400_000);

      const [allClients, allQuotes, allAppointments, recentActivity] = await Promise.all([
        db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
        db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
        db.select().from(appointmentsTable)
           .where(eq(appointmentsTable.orgId, orgId))
           .orderBy(desc(appointmentsTable.startTime)),
        db.select().from(activityTable)
           .where(and(eq(activityTable.orgId, orgId), gte(activityTable.createdAt, thirtyAgo)))
           .orderBy(desc(activityTable.createdAt)).limit(30),
      ]);

      // Normalise client value to 0-100 (relative to max in portfolio)
      const maxValue = Math.max(...allClients.map(c => c.value ?? 0), 1);

      // Build lookup maps
      const quotesByClient = new Map<number, (typeof allQuotes[number])[]>();
      for (const q of allQuotes) {
        if (!quotesByClient.has(q.clientId)) quotesByClient.set(q.clientId, []);
        quotesByClient.get(q.clientId)!.push(q);
      }
      const apptsByClient = new Map<number, (typeof allAppointments[number])[]>();
      for (const a of allAppointments) {
        if (!apptsByClient.has(a.clientId)) apptsByClient.set(a.clientId, []);
        apptsByClient.get(a.clientId)!.push(a);
      }

      // Score each client
      const scored = allClients.map(client => {
        const quotes = quotesByClient.get(client.id) ?? [];
        const appts  = apptsByClient.get(client.id)  ?? [];

        // ── economic_value (0–100) ──────────────────────────────────────────
        let economicValue = 0;
        if (client.value && client.value > 0) {
          economicValue = Math.min(100, (client.value / maxValue) * 100);
        } else {
          economicValue = { active: 60, lead: 40, inactive: 20, churned: 5 }[client.status] ?? 30;
        }

        // ── close_proximity (0–100) ─────────────────────────────────────────
        let closeProximity = 10;
        const sentQuotes   = quotes.filter(q => q.status === "sent");
        const activeQuotes = quotes.filter(q => ["sent","draft"].includes(q.status));
        if (sentQuotes.length > 0) {
          const nearestExpiry = sentQuotes
            .filter(q => q.validUntil)
            .map(q => (q.validUntil!.getTime() - now.getTime()) / 86_400_000)
            .filter(d => d >= 0)
            .sort((a, b) => a - b)[0];
          if (nearestExpiry !== undefined) {
            closeProximity = nearestExpiry <= 3 ? 100 : nearestExpiry <= 7 ? 85 : nearestExpiry <= 14 ? 65 : 50;
          } else {
            closeProximity = 55; // sent but no expiry
          }
        } else if (activeQuotes.length > 0) {
          closeProximity = 30;
        }

        // ── pipeline_status (0–100) ─────────────────────────────────────────
        const hasCompletedAppt = appts.some(a => a.status === "completed");
        const pipelineStatus = client.status === "active"    ? 80
          : (client.status === "lead" && hasCompletedAppt)   ? 90
          : client.status === "lead"                         ? 55
          : client.status === "inactive"                     ? 20
          : /* churned */                                      5;

        // ── urgency (0–100) ─────────────────────────────────────────────────
        let urgency = 15;
        const upcomingAppts = appts.filter(a =>
          a.status !== "cancelled" && a.startTime >= now && a.startTime <= sevenFromNow,
        );
        const overdueAppts  = appts.filter(a =>
          a.status === "pending" && a.startTime < now,
        );
        const quoteSentRecently = sentQuotes.some(q =>
          q.createdAt >= fourteenAgo,
        );
        if (overdueAppts.length > 0)                           urgency = 95;
        else if (upcomingAppts.some(a => {
          const d = (a.startTime.getTime() - now.getTime()) / 86_400_000;
          return d <= 1;
        }))                                                    urgency = 100;
        else if (upcomingAppts.some(a => {
          const d = (a.startTime.getTime() - now.getTime()) / 86_400_000;
          return d <= 3;
        }))                                                    urgency = 80;
        else if (upcomingAppts.length > 0)                     urgency = 60;
        else if (quoteSentRecently)                            urgency = 50;

        // ── final score ─────────────────────────────────────────────────────
        const score = Math.round(
          economicValue   * 0.5 +
          closeProximity  * 0.2 +
          pipelineStatus  * 0.2 +
          urgency         * 0.1,
        );

        // Best action recommendation
        let recommendedAction = "Mantener seguimiento";
        if (overdueAppts.length > 0)
          recommendedAction = "Reprogramar cita vencida urgentemente";
        else if (sentQuotes.length > 0 && closeProximity >= 80)
          recommendedAction = "Hacer follow-up del presupuesto — expira pronto";
        else if (sentQuotes.length > 0)
          recommendedAction = "Llamar para seguimiento del presupuesto enviado";
        else if (pipelineStatus === 90)
          recommendedAction = "Lead caliente: enviar presupuesto ahora";
        else if (activeQuotes.length > 0)
          recommendedAction = "Finalizar y enviar presupuesto en borrador";
        else if (client.status === "active" && quotes.length === 0)
          recommendedAction = "Crear presupuesto — cliente activo sin propuesta";
        else if (client.status === "inactive")
          recommendedAction = "Campaña de reactivación urgente";
        else if (client.status === "churned")
          recommendedAction = "Preparar propuesta de recuperación";
        else if (upcomingAppts.length > 0)
          recommendedAction = "Preparar material para la cita próxima";

        return {
          id:               client.id,
          name:             client.name,
          company:          client.company,
          status:           client.status,
          value:            client.value,
          score,
          score_breakdown: {
            economic:  Math.round(economicValue),
            proximity: Math.round(closeProximity),
            pipeline:  pipelineStatus,
            urgency:   Math.round(urgency),
          },
          recommended_action: recommendedAction,
          active_quotes:      activeQuotes.length,
          sent_quotes:        sentQuotes.map(q => ({
            title: q.title, total: q.total, valid_until: q.validUntil?.toLocaleDateString("es-ES"),
          })),
          upcoming_appointments: upcomingAppts.map(a => ({
            title: a.title, date: a.startTime.toLocaleDateString("es-ES"),
            time: a.startTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
          })),
          overdue_appointments: overdueAppts.length,
        };
      });

      scored.sort((a, b) => b.score - a.score);

      // ── KPI summary ─────────────────────────────────────────────────────────
      const pipelineTotal   = allQuotes.filter(q => ["draft","sent"].includes(q.status)).reduce((s, q) => s + (q.total ?? 0), 0);
      const confirmedTotal  = allQuotes.filter(q => q.status === "accepted").reduce((s, q) => s + (q.total ?? 0), 0);
      const activeCount     = allClients.filter(c => c.status === "active").length;
      const leadCount       = allClients.filter(c => c.status === "lead").length;
      const atRiskCount     = allClients.filter(c => ["inactive","churned"].includes(c.status)).length;

      // ── Top risks ────────────────────────────────────────────────────────────
      const risks: string[] = [];
      if (atRiskCount > 0) risks.push(`${atRiskCount} cliente(s) inactivo(s)/perdido(s) — impacto directo en cartera`);
      const expiringQuotes = allQuotes.filter(q =>
        q.validUntil && ["sent","draft"].includes(q.status) &&
        q.validUntil <= sevenFromNow && q.validUntil >= now,
      );
      if (expiringQuotes.length > 0)
        risks.push(`${expiringQuotes.length} presupuesto(s) expiran en 7 días — €${expiringQuotes.reduce((s,q) => s+(q.total??0),0).toLocaleString("es-ES")} en riesgo`);
      const overdueAll = allAppointments.filter(a => a.status === "pending" && a.startTime < now);
      if (overdueAll.length > 0) risks.push(`${overdueAll.length} cita(s) vencida(s) sin reprogramar`);

      return JSON.stringify({
        generated_at: now.toISOString(),
        kpis: {
          total_clients: allClients.length,
          active_clients: activeCount,
          leads: leadCount,
          at_risk: atRiskCount,
          pipeline_eur: Math.round(pipelineTotal),
          confirmed_eur: Math.round(confirmedTotal),
          total_quotes: allQuotes.length,
          activity_30d: recentActivity.length,
        },
        top_clients_by_score: scored.slice(0, 8),
        top_priority: scored[0] ?? null,
        second_priority: scored[1] ?? null,
        third_priority: scored[2] ?? null,
        main_risks: risks,
        recent_activity_summary: recentActivity.slice(0, 5).map(a => ({
          type: a.type, description: a.description, client: a.clientName,
          date: a.createdAt.toLocaleDateString("es-ES"),
        })),
        instructions_for_ai:
          "Usa estos datos para responder con DECISIONES priorizadas por impacto económico. " +
          "Menciona los scores para justificar la priorización. " +
          "No muestres la tabla completa — presenta sólo lo relevante para la pregunta del usuario.",
      });
    }

    // ── create_appointment ───────────────────────────────────────────────────
    if (toolName === "create_appointment") {
      const clientName      = String(args["client_name"] ?? "");
      const title           = String(args["title"]       ?? "Cita");
      const dateStr         = String(args["date"]        ?? "");
      const startTimeStr    = String(args["start_time"]  ?? "10:00");
      const durationMinutes = Number(args["duration_minutes"] ?? 60);
      const description     = args["description"] ? String(args["description"]) : null;
      const location        = args["location"]    ? String(args["location"])    : null;
      const apptType        = String(args["type"] ?? "meeting");

      if (!clientName || !title || !dateStr) {
        return JSON.stringify({ error: "Se necesitan client_name, title y date" });
      }

      // Parse date + time into UTC timestamp
      const [h = "10", m = "00"] = startTimeStr.split(":");
      const [y, mo, d] = dateStr.split("-").map(Number);
      if (!y || !mo || !d) {
        return JSON.stringify({ error: `Formato de fecha inválido: "${dateStr}". Usa YYYY-MM-DD.` });
      }
      // Treat user-supplied time as Europe/Madrid local → store as UTC
      // Approximate: Madrid is UTC+2 in summer (CEST), UTC+1 in winter (CET)
      // For simplicity we'll just store the given time as-is UTC (AI knows it's Madrid)
      const startTime = new Date(Date.UTC(y, mo - 1, d, parseInt(h), parseInt(m), 0));
      const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);

      // Find client by name (fuzzy)
      const matchedClients = await db
        .select()
        .from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
        .limit(5);

      if (matchedClients.length === 0) {
        return JSON.stringify({ error: `No encontré ningún cliente que coincida con "${clientName}". Usa list_clients para verificar el nombre exacto.` });
      }
      const client = matchedClients[0]!;

      const [appointment] = await db.insert(appointmentsTable).values({
        orgId,
        clientId:    client.id,
        title,
        description,
        startTime,
        endTime,
        status:      "pending",
        type:        apptType,
        location,
        reminder:    false,
      }).returning();

      // Log activity
      await db.insert(activityTable).values({
        orgId,
        type:        "appointment_scheduled",
        description: `Cita "${title}" agendada con ${client.name} para el ${startTime.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}`,
        clientName:  client.name,
      }).catch(() => {/* non-critical */});

      const localDate = startTime.toLocaleDateString("es-ES", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      const localTime = `${h}:${m}`;

      return JSON.stringify({
        success:       true,
        appointmentId: appointment!.id,
        clientName:    client.name,
        clientCompany: client.company ?? null,
        title,
        date:          localDate,
        time:          localTime,
        duration:      durationMinutes,
        status:        "pending",
        type:          apptType,
        description,
        location,
        message:       `Cita #${appointment!.id} creada correctamente para ${client.name} el ${localDate} a las ${localTime}.`,
      });
    }

    // ── create_quote ────────────────────────────────────────────────────────
    if (toolName === "create_quote") {
      const clientName = String(args["client_name"] ?? "");
      const title      = String(args["title"]       ?? "Presupuesto");
      const rawItems   = (args["items"] as { description: string; quantity: number; unit_price: number }[]) ?? [];
      const taxRate    = Number(args["tax_rate"]    ?? 21);
      const notes      = args["notes"]      ? String(args["notes"])      : null;
      const validDays  = Number(args["valid_days"]  ?? 30);

      if (!clientName || rawItems.length === 0) {
        return JSON.stringify({ error: "Se necesita client_name y al menos un ítem" });
      }

      // Find client by name (fuzzy)
      const allClients = await db
        .select()
        .from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
        .limit(5);

      if (allClients.length === 0) {
        return JSON.stringify({ error: `No encontré ningún cliente que coincida con "${clientName}". Usa list_clients para verificar el nombre exacto.` });
      }
      const client = allClients[0]!;

      // Compute totals
      const lineItems = rawItems.map((item, idx) => ({
        description: item.description,
        quantity:    Number(item.quantity)   || 1,
        unitPrice:   Number(item.unit_price) || 0,
        total:       (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
        orderIndex:  idx,
      }));
      const subtotal  = lineItems.reduce((acc, i) => acc + i.total, 0);
      const taxAmount = subtotal * (taxRate / 100);
      const total     = subtotal + taxAmount;

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + validDays);

      const [quote] = await db.insert(quotesTable).values({
        orgId,
        clientId:  client.id,
        title,
        status:    "draft",
        subtotal,
        taxRate,
        taxAmount,
        total,
        notes,
        validUntil,
      }).returning();

      await db.insert(quoteItemsTable).values(
        lineItems.map(item => ({ ...item, quoteId: quote!.id })),
      );

      await db.insert(activityTable).values({
        orgId,
        type:        "quote_created",
        description: `Presupuesto "${title}" creado para ${client.name} — ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(total)}`,
        clientName:  client.name,
      }).catch(() => {/* non-critical */});

      return JSON.stringify({
        success:       true,
        quoteId:       quote!.id,
        quoteNumber:   String(quote!.id).padStart(5, "0"),
        clientName:    client.name,
        clientCompany: client.company ?? null,
        title,
        status:        "draft",
        subtotal:      Math.round(subtotal * 100) / 100,
        taxRate,
        taxAmount:     Math.round(taxAmount * 100) / 100,
        total:         Math.round(total * 100) / 100,
        validUntil:    validUntil.toLocaleDateString("es-ES"),
        items:         lineItems.map(i => ({
          description: i.description,
          quantity:    i.quantity,
          unitPrice:   i.unitPrice,
          total:       Math.round(i.total * 100) / 100,
        })),
        downloadPath: `/api/quotes/${quote!.id}/pdf`,
        message: `Presupuesto #${String(quote!.id).padStart(5, "0")} creado con éxito. Disponible en la sección Presupuestos.`,
      });
    }

    return JSON.stringify({ error: `Herramienta desconocida: ${toolName}` });
  } catch (err) {
    console.error(`[CRM Tool] ${toolName} error:`, String(err));
    return JSON.stringify({ error: `Error ejecutando ${toolName}: ${String(err)}` });
  }
}

// ── Executive dashboard detection ─────────────────────────────────────────────

const EXECUTIVE_KEYWORDS =
  /resumen ejecutivo|estado del negocio|situaci[oó]n actual|dashboard|an[aá]lisis comercial|informe ejecutivo|estado actual|panorama general|visi[oó]n general|overview|c[oó]mo va el negocio|c[oó]mo va mi negocio|c[oó]mo estamos|dame un resumen|resumen del d[ií]a|resumen de (la )?semana|qu[eé] debo hacer( hoy)?|d[oó]nde debo (centrarme|enfocarme|focalizarme)|en qu[eé] (me )?centrar|qu[eé] (me )?har[aá] ganar|ganar m[aá]s (dinero|pasta)|qu[eé] cliente.{0,20}priorizar|qu[eé] priorizo|a qui[eé]n (debo |debería )?llamar|por d[oó]nde empez|próximos pasos|siguiente(s)? paso(s)?|estrategia (del|de) (negocio|semana|mes)|d[oó]nde est[aá] el dinero|mayor impacto|mayor retorno|mejor oportunidad/i;

const EXECUTIVE_SYSTEM_ADDON = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 MODO INTELIGENCIA ESTRATÉGICA ACTIVO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
El usuario hace una pregunta estratégica. Los datos del CRM están adjuntos. Tu misión: responder con DECISIONES, no con datos.

FÓRMULA DE SCORING (ya calculada en get_strategic_brief):
  score = valor_económico × 0.5 + proximidad_cierre × 0.2 + estado_pipeline × 0.2 + urgencia × 0.1

ADAPTA la estructura según la pregunta del usuario:

Si pregunta "¿Cómo va mi negocio?" o similar → INFORME EJECUTIVO:
📊 **Estado del Negocio**  — 2-3 métricas clave con €
🏆 **Top 3 Clientes por Impacto** — con score, valor € y por qué priorizarlos
⚡ **Acción Más Rentable Esta Semana** — UNA acción concreta con nombre real
⚠️ **Riesgo Principal** — el mayor riesgo con su impacto económico estimado

Si pregunta "¿Qué debo hacer hoy?" o "¿Qué cliente priorizar?" → DECISIÓN DIRECTA:
🥇 **Prioridad #1** — cliente + acción + razón económica
🥈 **Prioridad #2** — cliente + acción + razón económica
🥉 **Prioridad #3** — cliente + acción + razón económica
📌 **Por qué este orden** — 1 frase con la lógica de priorización

Si pregunta "¿Qué me hará ganar más?" o "¿Dónde está el dinero?" → ANÁLISIS DE OPORTUNIDAD:
💰 **Mayor Oportunidad Inmediata** — cliente + valor potencial + próximo paso
📈 **Pipeline Total** — € en cartera vs € confirmado
🎯 **Acción de Mayor ROI** — la que tiene mejor ratio impacto/esfuerzo

REGLAS CRÍTICAS:
- Responde con DECISIONES, nunca con tablas de datos crudos
- Cita nombres reales, €€€ reales y fechas exactas del CRM
- Usa el score del get_strategic_brief para justificar la priorización
- Máximo 400 palabras — ejecutivo, directo, accionable
- Siempre termina con UNA acción que el usuario debe hacer AHORA MISMO`;

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
    // Detect executive dashboard / business summary requests
    const isExecutive = EXECUTIVE_KEYWORDS.test(lastUserMessage);

    // Build system prompt — inject executive addon when in executive mode
    const systemContent = buildSystemPrompt(memories, clientContext) +
      (isExecutive ? EXECUTIVE_SYSTEM_ADDON : "");

    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...messages,
    ];

    if (isExecutive) {
      // ── Executive mode: pre-fetch ALL CRM tables in parallel ─────────────
      // Skip phase 1 — we know exactly which data is needed for a full report.
      console.log(`[Chat] Executive mode triggered for org=${orgId}`);

      const [clientsData, upcomingData, pendingData, activityData, strategicData] = await Promise.all([
        executeCrmTool("list_clients",        { status: "all",      sort: "value_desc", limit: 50 }, orgId),
        executeCrmTool("get_appointments",    { date_filter: "upcoming",   status_filter: "all",     limit: 10 }, orgId),
        executeCrmTool("get_appointments",    { date_filter: "all",        status_filter: "pending",  limit: 20 }, orgId),
        executeCrmTool("get_recent_activity", { period: "this_month", limit: 30 }, orgId),
        executeCrmTool("get_strategic_brief", {}, orgId),
      ]);

      // Inject as synthetic tool call sequence (OpenAI requires paired calls+results)
      apiMessages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "exec_1", type: "function", function: { name: "list_clients",          arguments: '{"status":"all","sort":"value_desc"}' } },
          { id: "exec_2", type: "function", function: { name: "get_appointments",      arguments: '{"date_filter":"upcoming","status_filter":"all","limit":10}' } },
          { id: "exec_3", type: "function", function: { name: "get_appointments",      arguments: '{"date_filter":"all","status_filter":"pending","limit":20}' } },
          { id: "exec_4", type: "function", function: { name: "get_recent_activity",   arguments: '{"period":"this_month","limit":30}' } },
          { id: "exec_5", type: "function", function: { name: "get_strategic_brief",   arguments: '{}' } },
        ],
      });
      apiMessages.push(
        { role: "tool", tool_call_id: "exec_1", content: clientsData },
        { role: "tool", tool_call_id: "exec_2", content: upcomingData },
        { role: "tool", tool_call_id: "exec_3", content: pendingData },
        { role: "tool", tool_call_id: "exec_4", content: activityData },
        { role: "tool", tool_call_id: "exec_5", content: strategicData },
      );

      res.write(`data: ${JSON.stringify({ event: "tools_resolved", tools: ["list_clients", "get_appointments", "get_appointments", "get_recent_activity", "get_strategic_brief"] })}\n\n`);

    } else {
      // ── Phase 1: CRM tool resolution (non-streaming) ─────────────────────
      // Let OpenAI decide which tools to call based on the user's question.
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
        const toolResults = await Promise.all(
          crmToolCalls.map(async tc => {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* use {} */ }
            const result = await executeCrmTool(tc.function.name, args, orgId);
            console.log(`[CRM] tool=${tc.function.name} args=${tc.function.arguments} result_len=${result.length}`);
            return { role: "tool" as const, tool_call_id: tc.id, content: result };
          }),
        );

        apiMessages.push({ role: "assistant", content: null, tool_calls: crmToolCalls });
        apiMessages.push(...toolResults);
        res.write(`data: ${JSON.stringify({ event: "tools_resolved", tools: crmToolCalls.map(tc => tc.function.name) })}\n\n`);

        // Emit domain-specific events so the frontend can refresh relevant caches
        for (let i = 0; i < crmToolCalls.length; i++) {
          const tc = crmToolCalls[i];
          if (tc?.function.name === "create_appointment") {
            try {
              const apptResult = JSON.parse(toolResults[i]?.content ?? "{}") as Record<string, unknown>;
              if (apptResult["success"]) {
                res.write(`data: ${JSON.stringify({ event: "appointment_created", appointment: apptResult })}\n\n`);
              }
            } catch { /* non-critical */ }
          }
          if (tc?.function.name === "create_quote") {
            try {
              const qResult = JSON.parse(toolResults[i]?.content ?? "{}") as Record<string, unknown>;
              if (qResult["success"]) {
                res.write(`data: ${JSON.stringify({ event: "quote_created", quote: qResult })}\n\n`);
              }
            } catch { /* non-critical */ }
          }
        }
      }
    }

    // ── Phase 2: Final streaming response (always) ─────────────────────────
    // Executive reports get more token budget for complete structured output.
    const stream = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages:    apiMessages,
      stream:      true,
      max_tokens:  isExecutive ? 1200 : 700,
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
