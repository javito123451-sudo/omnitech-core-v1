import { Router } from "express";
import { logAiCall, checkBudgetBlocked } from "../utils/aiUsageLogger";
import { isModuleEnabled } from "../middlewares/requireModule";

// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 imports
// ═══════════════════════════════════════════════════════════════════════════
import { executeSkill, getOpenAIFunctions, getSkill } from "../skills";
import { getProviderSingleton } from "../ai/types";

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
  invoicesTable,
  invoiceItemsTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and, asc, desc, gte, lt, inArray, ilike, sum, count, sql } from "drizzle-orm";

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
  aiProvider: ReturnType<typeof getProviderSingleton>,
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
    const qRes = await aiProvider.embed(userMessage.slice(0, 500));
    const qVec = qRes.embedding;
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

// ── Timezone helper: Europe/Madrid local → UTC (probe technique) ──────────────
// Converts a date string (YYYY-MM-DD) + time string (HH:MM) expressed in
// Europe/Madrid local time into the equivalent real UTC Date.
// Handles DST automatically (CET = UTC+1 in winter, CEST = UTC+2 in summer).
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

// ── CRM Tools (Ava V2: auto-generated from Skill Engine) ─────────────────────
const CRM_TOOLS = getOpenAIFunctions();
const CRM_TOOL_NAMES = new Set(CRM_TOOLS.map(t => t.function.name));

// ── LEGACY CRM_TOOLS (preserved for reference until full migration) ────────────
// These will be removed once all skills are migrated to the Skill Engine.
// The Skill Engine versions are now the canonical source of truth.
const _LEGACY_CRM_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
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
            enum: ["active", "all", "pending", "confirmed", "completed", "cancelled", "rescheduled"],
            description:
              "'active' (por defecto) = solo pendientes + confirmadas (nunca reprogramadas/canceladas/completadas) · " +
              "'pending' = solo pendientes · 'confirmed' = solo confirmadas · 'all' = cualquier estado.",
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
      name: "reschedule_appointment",
      description:
        "Reprograma (cambia la fecha y/u hora) de una cita ya existente en el CRM. " +
        "Úsala cuando el usuario diga 'cambia la cita', 'mueve la reunión', 'reprograma para', etc. " +
        "Usa get_appointments primero para obtener el ID si no lo tienes. " +
        "Verifica en la base de datos tras escribir y solo confirma si los datos coinciden.",
      parameters: {
        type: "object" as const,
        properties: {
          appointment_id: {
            type: "number",
            description: "ID de la cita a reprogramar.",
          },
          client_name: {
            type: "string",
            description: "Nombre del cliente (alternativa al ID). Se buscará la cita más reciente.",
          },
          new_date: {
            type: "string",
            description: "Nueva fecha en formato YYYY-MM-DD.",
          },
          new_start_time: {
            type: "string",
            description: "Nueva hora de inicio en formato HH:MM (24h).",
          },
          duration_minutes: {
            type: "number",
            description: "Nueva duración en minutos. Si no se indica, mantiene la duración original.",
          },
        },
        required: ["new_date", "new_start_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description:
        "Cancela una cita existente en el CRM (cambia su estado a 'cancelled'). " +
        "Úsala cuando el usuario diga 'cancela la cita', 'no vamos a poder', etc.",
      parameters: {
        type: "object" as const,
        properties: {
          appointment_id: {
            type: "number",
            description: "ID de la cita a cancelar.",
          },
          client_name: {
            type: "string",
            description: "Nombre del cliente (alternativa al ID). Se buscará la cita más próxima.",
          },
          reason: {
            type: "string",
            description: "Motivo de la cancelación. Opcional.",
          },
        },
        required: [],
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
  {
    type: "function",
    function: {
      name: "create_invoice",
      description:
        "Crea una factura real en el módulo de contabilidad y la guarda en la base de datos. " +
        "Úsala cuando el usuario diga 'crear factura', 'emitir factura', 'facturar a', o similar. " +
        "El módulo omni_accounting debe estar habilitado.",
      parameters: {
        type: "object" as const,
        properties: {
          client_name: {
            type: "string",
            description: "Nombre del cliente tal como aparece en el CRM.",
          },
          items: {
            type: "array",
            description: "Líneas de la factura. Mínimo 1.",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Descripción del servicio o producto." },
                quantity:    { type: "number", description: "Cantidad." },
                unit_price:  { type: "number", description: "Precio unitario en euros." },
              },
              required: ["description", "quantity", "unit_price"],
            },
          },
          tax_rate: {
            type: "number",
            description: "Porcentaje de IVA. Por defecto 21.",
          },
          notes: {
            type: "string",
            description: "Notas adicionales. Opcional.",
          },
          due_date: {
            type: "string",
            description: "Fecha de vencimiento en formato YYYY-MM-DD. Opcional.",
          },
        },
        required: ["client_name", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice",
      description:
        "Obtiene el detalle de una factura por su número o ID. " +
        "Úsala cuando el usuario pregunte por una factura específica.",
      parameters: {
        type: "object" as const,
        properties: {
          invoice_number: {
            type: "string",
            description: "Número de factura, ej: 'F2026-0001'.",
          },
          invoice_id: {
            type: "number",
            description: "ID numérico de la factura (alternativa al número).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_invoices",
      description:
        "Lista las facturas pendientes de cobro (estado: borrador, enviada, pago parcial). " +
        "Úsala para '¿qué facturas tengo pendientes?', '¿qué me deben?', '¿cuánto tengo por cobrar?'.",
      parameters: {
        type: "object" as const,
        properties: {
          include_overdue: {
            type: "boolean",
            description: "Si true, incluye solo las vencidas. Por defecto devuelve todas las pendientes.",
          },
          limit: {
            type: "number",
            description: "Número máximo de facturas. Por defecto 20.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_payment",
      description:
        "Registra un pago recibido contra una factura existente. La factura se marca como pagada automáticamente si el importe cubre el total. " +
        "Úsala cuando el usuario diga 'han pagado', 'registra el pago', 'marca como pagado', etc.",
      parameters: {
        type: "object" as const,
        properties: {
          invoice_number: {
            type: "string",
            description: "Número de factura, ej: 'F2026-0001'.",
          },
          amount: {
            type: "number",
            description: "Importe recibido en euros.",
          },
          method: {
            type: "string",
            enum: ["transfer", "card", "cash", "check", "other"],
            description: "Medio de pago. Por defecto 'transfer'.",
          },
          reference: {
            type: "string",
            description: "Referencia bancaria o número de transacción. Opcional.",
          },
        },
        required: ["invoice_number", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_debt",
      description:
        "Obtiene el total de deuda pendiente de un cliente (facturas no pagadas). " +
        "Úsala para '¿cuánto me debe X?', '¿qué deuda tiene el cliente Y?'.",
      parameters: {
        type: "object" as const,
        properties: {
          client_name: {
            type: "string",
            description: "Nombre del cliente.",
          },
        },
        required: ["client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_income",
      description:
        "Obtiene un resumen de ingresos, gastos y beneficio del mes actual o del año. " +
        "Úsala para '¿cuánto hemos ingresado este mes?', '¿cuál es el beneficio del mes?', '¿cómo van las ventas?'.",
      parameters: {
        type: "object" as const,
        properties: {
          period: {
            type: "string",
            enum: ["this_month", "this_year"],
            description: "'this_month' = mes actual · 'this_year' = acumulado anual. Por defecto 'this_month'.",
          },
        },
        required: [],
      },
    },
  },
];

// NOTE: CRM_TOOL_NAMES ya está definido arriba (línea 260)
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

// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2: executeCrmTool
// ═══════════════════════════════════════════════════════════════════════════
// Primero intenta el Skill Engine; si el skill no existe, fallback a legacy.
export async function executeCrmTool(
  toolName: string,
  args: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  // Ava V2: intenta el Skill Engine primero
  const skill = getSkill(toolName);
  if (skill) {
    console.log(`[executeCrmTool] Ava V2: delegando a Skill Engine — ${toolName}`);
    const result = await executeSkill(toolName, args, orgId, {});
    return result.result;
  }

  // Fallback: legacy logic for non-skills (e.g., get_recent_activity, get_strategic_brief)
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
      const statusFilter = (args["status_filter"] as string | undefined) ?? "active";
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
      // "active" (default) = pending + confirmed only — never rescheduled/cancelled/completed
      const activeStatuses = ["pending", "confirmed"];
      const statusCondition =
        statusFilter === "all"    ? undefined :
        statusFilter === "active" ? inArray(appointmentsTable.status, activeStatuses) :
        /* specific status */       eq(appointmentsTable.status, statusFilter);

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
      const analyticsOn = await isModuleEnabled(orgId, "analytics");
      if (!analyticsOn) {
        return JSON.stringify({ error: "El módulo Analytics no está habilitado para este workspace. No puedo generar análisis estratégico." });
      }
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

      // ── TZ: Parse date + time as Europe/Madrid local → real UTC ──────────────
      const [y, mo, d] = dateStr.split("-").map(Number);
      if (!y || !mo || !d) {
        return JSON.stringify({ error: `Formato de fecha inválido: "${dateStr}". Usa YYYY-MM-DD.` });
      }
      const normalizedTime = startTimeStr.slice(0, 5);
      const startTime = madridLocalToUTC(dateStr, normalizedTime);
      const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);
      console.log(
        `[TZ chat/create_appointment] ` +
        `hora_recibida="${normalizedTime}" | tz=Europe/Madrid | ` +
        `utc_stored="${startTime.toISOString()}"`
      );

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

    // ── create_invoice ──────────────────────────────────────────────────────
    if (toolName === "create_invoice") {
      const accountingEnabled = await isModuleEnabled(orgId, "omni_accounting");
      if (!accountingEnabled) {
        return JSON.stringify({ error: "El módulo de contabilidad (omni_accounting) no está habilitado para este workspace." });
      }

      const clientName = String(args["client_name"] ?? "");
      const rawItems   = (args["items"] as { description: string; quantity: number; unit_price: number }[]) ?? [];
      const taxRate    = Number(args["tax_rate"] ?? 21);
      const notes      = args["notes"]    ? String(args["notes"])    : null;
      const dueDateStr = args["due_date"] ? String(args["due_date"]) : null;

      if (!clientName || rawItems.length === 0) {
        return JSON.stringify({ error: "Se necesita client_name y al menos un ítem" });
      }

      const matchedClients = await db.select()
        .from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
        .limit(5);
      if (matchedClients.length === 0) {
        return JSON.stringify({ error: `No encontré ningún cliente que coincida con "${clientName}".` });
      }
      const client = matchedClients[0]!;

      const lineItems = rawItems.map((item, idx) => ({
        description: item.description,
        quantity:    Number(item.quantity)   || 1,
        unitPrice:   Number(item.unit_price) || 0,
        total:       (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
        orderIndex:  idx,
      }));
      const subtotal  = lineItems.reduce((acc, i) => acc + i.total, 0);
      const taxAmount = parseFloat(((subtotal * taxRate) / 100).toFixed(2));
      const total     = parseFloat((subtotal + taxAmount).toFixed(2));

      // Generate invoice number
      const year = new Date().getFullYear();
      const [{ cnt }] = await db.select({ cnt: count() }).from(invoicesTable)
        .where(and(eq(invoicesTable.orgId, orgId), gte(invoicesTable.createdAt, new Date(`${year}-01-01`))));
      const invoiceNumber = `F${year}-${String(Number(cnt ?? 0) + 1).padStart(4, "0")}`;

      const [inv] = await db.insert(invoicesTable).values({
        orgId,
        clientId: client.id,
        invoiceNumber,
        status: "draft",
        currency: "EUR",
        subtotal: String(subtotal),
        taxRate:  String(taxRate),
        taxAmount: String(taxAmount),
        total:    String(total),
        notes:    notes,
        dueDate:  dueDateStr ? new Date(dueDateStr) : null,
      }).returning();

      await db.insert(invoiceItemsTable).values(
        lineItems.map(item => ({
          invoiceId: inv!.id,
          description: item.description,
          quantity:  String(item.quantity),
          unitPrice: String(item.unitPrice),
          total:     String(parseFloat(item.total.toFixed(2))),
          orderIndex: item.orderIndex,
        })),
      );

      return JSON.stringify({
        success: true,
        invoiceId: inv!.id,
        invoiceNumber,
        clientName: client.name,
        total,
        taxRate,
        taxAmount,
        subtotal,
        status: "draft",
        items: lineItems.map(i => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: parseFloat(i.total.toFixed(2)) })),
        message: `Factura ${invoiceNumber} creada en borrador para ${client.name} — ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(total)}. Disponible en Contabilidad > Facturas.`,
      });
    }

    // ── get_invoice ─────────────────────────────────────────────────────────
    if (toolName === "get_invoice") {
      const invoiceNumber = args["invoice_number"] ? String(args["invoice_number"]) : null;
      const invoiceId     = args["invoice_id"]     ? Number(args["invoice_id"])     : null;

      if (!invoiceNumber && !invoiceId) {
        return JSON.stringify({ error: "Se necesita invoice_number o invoice_id" });
      }

      const conditions = [eq(invoicesTable.orgId, orgId)];
      if (invoiceNumber) conditions.push(eq(invoicesTable.invoiceNumber, invoiceNumber));
      if (invoiceId)     conditions.push(eq(invoicesTable.id, invoiceId));

      const [inv] = await db.select().from(invoicesTable).where(and(...conditions));
      if (!inv) return JSON.stringify({ error: "Factura no encontrada" });

      const invItems = await db.select().from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, inv.id));
      const invPayments = await db.select().from(paymentsTable)
        .where(eq(paymentsTable.invoiceId, inv.id));
      const client = inv.clientId
        ? await db.select({ name: clientsTable.name, company: clientsTable.company })
            .from(clientsTable).where(eq(clientsTable.id, inv.clientId)).then(r => r[0] ?? null)
        : null;

      const totalPaid = invPayments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

      return JSON.stringify({
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        client: client?.name ?? null,
        company: client?.company ?? null,
        total: parseFloat(String(inv.total)),
        totalPaid,
        balance: parseFloat(String(inv.total)) - totalPaid,
        dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("es-ES") : null,
        paidAt:  inv.paidAt  ? new Date(inv.paidAt).toLocaleDateString("es-ES")  : null,
        items: invItems.map(i => ({
          description: i.description,
          quantity:    parseFloat(String(i.quantity)),
          unitPrice:   parseFloat(String(i.unitPrice)),
          total:       parseFloat(String(i.total)),
        })),
      });
    }

    // ── list_pending_invoices ────────────────────────────────────────────────
    if (toolName === "list_pending_invoices") {
      const includeOverdue = args["include_overdue"] === true;
      const limit = Math.min(Number(args["limit"] ?? 20), 50);

      const statusFilter = includeOverdue
        ? ["sent", "partial"]
        : ["draft", "sent", "partial"];

      const rows = await db.select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        status: invoicesTable.status,
        total:  invoicesTable.total,
        dueDate: invoicesTable.dueDate,
        clientName: clientsTable.name,
      })
      .from(invoicesTable)
      .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
      .where(and(
        eq(invoicesTable.orgId, orgId),
        inArray(invoicesTable.status, statusFilter),
        ...(includeOverdue ? [sql`${invoicesTable.dueDate} < NOW()`] : []),
      ))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(limit);

      const pendingTotal = rows.reduce((s, r) => s + parseFloat(String(r.total)), 0);

      return JSON.stringify({
        count: rows.length,
        pendingTotal: Math.round(pendingTotal * 100) / 100,
        invoices: rows.map(r => ({
          invoiceNumber: r.invoiceNumber,
          client:  r.clientName ?? "Sin cliente",
          total:   parseFloat(String(r.total)),
          status:  r.status,
          dueDate: r.dueDate ? new Date(r.dueDate).toLocaleDateString("es-ES") : null,
          overdue: r.dueDate ? new Date(r.dueDate) < new Date() : false,
        })),
        message: rows.length === 0
          ? "No hay facturas pendientes."
          : `Hay ${rows.length} factura${rows.length !== 1 ? "s" : ""} pendiente${rows.length !== 1 ? "s" : ""} por un total de ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(pendingTotal)}.`,
      });
    }

    // ── register_payment ─────────────────────────────────────────────────────
    if (toolName === "register_payment") {
      const invoiceNumber = String(args["invoice_number"] ?? "");
      const amount        = Number(args["amount"] ?? 0);
      const method        = String(args["method"] ?? "transfer");
      const reference     = args["reference"] ? String(args["reference"]) : null;

      if (!invoiceNumber || amount <= 0) {
        return JSON.stringify({ error: "Se necesitan invoice_number y amount > 0" });
      }

      const [inv] = await db.select().from(invoicesTable)
        .where(and(eq(invoicesTable.invoiceNumber, invoiceNumber), eq(invoicesTable.orgId, orgId)));
      if (!inv) return JSON.stringify({ error: `Factura "${invoiceNumber}" no encontrada` });

      const [payment] = await db.insert(paymentsTable).values({
        orgId,
        invoiceId: inv.id,
        clientId:  inv.clientId ?? null,
        amount:    String(amount),
        currency:  "EUR",
        method,
        reference,
        paidAt:    new Date(),
      }).returning();

      // Auto-advance invoice status
      const [{ totalPaid }] = await db.select({ totalPaid: sum(paymentsTable.amount) })
        .from(paymentsTable).where(eq(paymentsTable.invoiceId, inv.id));
      const paid     = parseFloat(String(totalPaid ?? 0));
      const invTotal = parseFloat(String(inv.total));
      let newStatus  = inv.status;
      if (paid >= invTotal) {
        await db.update(invoicesTable)
          .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
          .where(eq(invoicesTable.id, inv.id));
        newStatus = "paid";
      } else if (paid > 0) {
        await db.update(invoicesTable)
          .set({ status: "partial", updatedAt: new Date() })
          .where(eq(invoicesTable.id, inv.id));
        newStatus = "partial";
      }

      const fmt = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
      return JSON.stringify({
        success:    true,
        paymentId:  payment!.id,
        invoiceNumber,
        amount,
        paid,
        balance:    Math.max(0, invTotal - paid),
        invoiceStatus: newStatus,
        message: newStatus === "paid"
          ? `Pago de ${fmt(amount)} registrado. La factura ${invoiceNumber} queda completamente pagada.`
          : `Pago parcial de ${fmt(amount)} registrado. Quedan ${fmt(invTotal - paid)} pendientes en ${invoiceNumber}.`,
      });
    }

    // ── get_client_debt ──────────────────────────────────────────────────────
    if (toolName === "get_client_debt") {
      const clientName = String(args["client_name"] ?? "");
      if (!clientName) return JSON.stringify({ error: "Se necesita client_name" });

      const matched = await db.select()
        .from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
        .limit(3);
      if (matched.length === 0) return JSON.stringify({ error: `No encontré el cliente "${clientName}"` });
      const client = matched[0]!;

      const invoices = await db.select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        total: invoicesTable.total,
        status: invoicesTable.status,
        dueDate: invoicesTable.dueDate,
      })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        eq(invoicesTable.clientId, client.id),
        inArray(invoicesTable.status, ["draft", "sent", "partial"]),
      ));

      const totalDebt = invoices.reduce((s, i) => s + parseFloat(String(i.total)), 0);
      const fmt = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

      return JSON.stringify({
        clientName: client.name,
        totalDebt,
        pendingInvoices: invoices.map(i => ({
          invoiceNumber: i.invoiceNumber,
          total:   parseFloat(String(i.total)),
          status:  i.status,
          overdue: i.dueDate ? new Date(i.dueDate) < new Date() : false,
        })),
        message: invoices.length === 0
          ? `${client.name} no tiene facturas pendientes.`
          : `${client.name} tiene una deuda pendiente de ${fmt(totalDebt)} en ${invoices.length} factura${invoices.length !== 1 ? "s" : ""}.`,
      });
    }

    // ── get_monthly_income ───────────────────────────────────────────────────
    if (toolName === "get_monthly_income") {
      const period     = String(args["period"] ?? "this_month");
      const now        = new Date();
      const startDate  = period === "this_year"
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const periodLabel = period === "this_year" ? "este año" : "este mes";

      const [{ revenue }] = await db.select({ revenue: sum(paymentsTable.amount) })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, startDate)));

      const [expRow] = await db.execute(sql`
        SELECT COALESCE(SUM(amount),0)::numeric AS expenses
        FROM expenses
        WHERE org_id = ${orgId} AND expense_date >= ${startDate}
      `) as unknown as [{ expenses: string }];

      const rev  = parseFloat(String(revenue ?? 0));
      const exp  = parseFloat(String(expRow?.expenses ?? 0));
      const profit = rev - exp;
      const fmt = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

      return JSON.stringify({
        period: periodLabel,
        revenue: rev,
        expenses: exp,
        profit,
        message: `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}: Ingresos ${fmt(rev)} · Gastos ${fmt(exp)} · Beneficio ${fmt(profit)}.`,
      });
    }

    // ── reschedule_appointment ──────────────────────────────────────────────
    if (toolName === "reschedule_appointment") {
      const appointmentIdArg = args["appointment_id"] ? Number(args["appointment_id"]) : null;
      const clientNameArg    = args["client_name"]    ? String(args["client_name"])    : null;
      const newDateStr       = String(args["new_date"]       ?? "");
      const newStartTimeStr  = String(args["new_start_time"] ?? "10:00");
      const durationArg      = args["duration_minutes"] != null ? Number(args["duration_minutes"]) : null;

      if (!newDateStr || !newStartTimeStr) {
        return JSON.stringify({ error: "Se necesitan new_date y new_start_time." });
      }

      // Resolve appointment: by ID or by client name (next upcoming pending/confirmed)
      let existing: typeof appointmentsTable.$inferSelect | undefined;
      if (appointmentIdArg) {
        [existing] = await db.select().from(appointmentsTable)
          .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
      } else if (clientNameArg) {
        const matchedClients = await db.select().from(clientsTable)
          .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientNameArg}%`)))
          .limit(3);
        if (matchedClients.length > 0) {
          const clientIds = matchedClients.map(c => c.id);
          // Find next upcoming active appointment (ASC, future first)
          const now = new Date();
          const futureActive = await db.select().from(appointmentsTable)
            .where(and(
              eq(appointmentsTable.orgId, orgId),
              inArray(appointmentsTable.status, ["pending", "confirmed"]),
              gte(appointmentsTable.startTime, now),
            ))
            .orderBy(asc(appointmentsTable.startTime))
            .limit(20);
          existing = futureActive.find(a => clientIds.includes(a.clientId));
          if (!existing) {
            // Fallback: any active (including past)
            const anyActive = await db.select().from(appointmentsTable)
              .where(and(
                eq(appointmentsTable.orgId, orgId),
                inArray(appointmentsTable.status, ["pending", "confirmed"]),
              ))
              .orderBy(asc(appointmentsTable.startTime))
              .limit(20);
            existing = anyActive.find(a => clientIds.includes(a.clientId));
          }
        }
      }

      if (!existing) {
        return JSON.stringify({ error: "No encontré ninguna cita activa (pending/confirmed) para reprogramar. Verifica que el cliente tenga citas activas." });
      }

      const [y, mo, d] = newDateStr.split("-").map(Number);
      if (!y || !mo || !d) {
        return JSON.stringify({ error: `Fecha inválida: "${newDateStr}". Usa YYYY-MM-DD.` });
      }
      const normalizedNewTime = newStartTimeStr.slice(0, 5);
      const newStartTime  = madridLocalToUTC(newDateStr, normalizedNewTime);
      const existingDur   = Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60_000);
      const effectiveDur  = durationArg ?? existingDur;
      const newEndTime    = new Date(newStartTime.getTime() + effectiveDur * 60_000);
      console.log(
        `[TZ chat/reschedule_appointment] ` +
        `hora_recibida="${normalizedNewTime}" | tz=Europe/Madrid | ` +
        `utc_stored="${newStartTime.toISOString()}"`
      );

      // ── STEP 1: Mark old appointment as "rescheduled" ────────────────────────
      if (existing.status === "rescheduled" || existing.status === "cancelled") {
        return JSON.stringify({
          error: `La cita #${existing.id} ya está "${existing.status}". ` +
                 `Usa get_appointments para ver las citas activas del cliente.`,
        });
      }
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

      // ── STEP 2: Create NEW appointment with new date/time ─────────────────────
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
        await db.update(appointmentsTable)
          .set({ status: existing.status })
          .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
        return JSON.stringify({ error: "Error al crear la nueva cita. Se restauró la cita original." });
      }

      // ── DB READ-BACK VALIDATION on new appointment ────────────────────────────
      const [verified] = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, newAppt.id), eq(appointmentsTable.orgId, orgId)));

      if (!verified || Math.abs(verified.startTime.getTime() - newStartTime.getTime()) > 60_000) {
        return JSON.stringify({ error: "Error de validación: la nueva cita no se creó correctamente en la base de datos." });
      }

      // Use raw ISO slice — DB stores wall-clock value as UTC-naive (no conversion)
      const isoDate  = verified.startTime.toISOString().slice(0, 10);
      const [vyr, vmo, vdy] = isoDate.split("-").map(Number);
      const localDate = new Date(vyr!, vmo! - 1, vdy!, 12, 0, 0).toLocaleDateString("es-ES", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      const localTime = verified.startTime.toISOString().slice(11, 16);

      await db.insert(activityTable).values({
        orgId,
        type:        "appointment_rescheduled",
        description: `Cita #${existing.id} "${existing.title}" marcada como reprogramada → nueva cita #${newAppt.id}: ${localDate} a las ${localTime}`,
        clientName:  null,
      }).catch(() => {/* non-critical */});

      return JSON.stringify({
        success:          true,
        verified:         true,
        oldAppointmentId: existing.id,
        newAppointmentId: newAppt.id,
        title:            existing.title,
        newDate:          localDate,
        newTime:          localTime,
        duration:         effectiveDur,
        status:           "pending",
        dbConfirmedAt:    verified.startTime.toISOString(),
        message:          `Tu cita ha sido reprogramada para ${localDate} a las ${localTime}.`,
      });
    }

    // ── cancel_appointment ──────────────────────────────────────────────────
    if (toolName === "cancel_appointment") {
      const appointmentIdArg = args["appointment_id"] ? Number(args["appointment_id"]) : null;
      const clientNameArg    = args["client_name"]    ? String(args["client_name"])    : null;
      const reason           = args["reason"]         ? String(args["reason"])         : null;

      let existing: typeof appointmentsTable.$inferSelect | undefined;
      if (appointmentIdArg) {
        [existing] = await db.select().from(appointmentsTable)
          .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
      } else if (clientNameArg) {
        const matchedClients = await db.select().from(clientsTable)
          .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientNameArg}%`)))
          .limit(3);
        if (matchedClients.length > 0) {
          const clientIds = matchedClients.map(c => c.id);
          // Find next upcoming active appointment (ASC, future first)
          const now = new Date();
          const futureActive = await db.select().from(appointmentsTable)
            .where(and(
              eq(appointmentsTable.orgId, orgId),
              inArray(appointmentsTable.status, ["pending", "confirmed"]),
              gte(appointmentsTable.startTime, now),
            ))
            .orderBy(asc(appointmentsTable.startTime))
            .limit(20);
          existing = futureActive.find(a => clientIds.includes(a.clientId));
          if (!existing) {
            const anyActive = await db.select().from(appointmentsTable)
              .where(and(
                eq(appointmentsTable.orgId, orgId),
                inArray(appointmentsTable.status, ["pending", "confirmed"]),
              ))
              .orderBy(asc(appointmentsTable.startTime))
              .limit(20);
            existing = anyActive.find(a => clientIds.includes(a.clientId));
          }
        }
      }

      if (!existing) {
        return JSON.stringify({ error: "No encontré ninguna cita activa (pending/confirmed) para cancelar." });
      }

      if (existing.status === "cancelled") {
        return JSON.stringify({ error: `La cita #${existing.id} ya estaba cancelada.` });
      }

      await db.update(appointmentsTable)
        .set({ status: "cancelled" })
        .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

      // ── DB READ-BACK VALIDATION ───────────────────────────────────────────────
      const [verified] = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

      if (!verified || verified.status !== "cancelled") {
        return JSON.stringify({ error: "Error de validación: no se pudo confirmar la cancelación en la base de datos." });
      }

      await db.insert(activityTable).values({
        orgId,
        type:        "appointment_cancelled",
        description: `Cita #${existing.id} "${existing.title}" cancelada${reason ? `: ${reason}` : ""}`,
        clientName:  null,
      }).catch(() => {/* non-critical */});

      return JSON.stringify({
        success:       true,
        verified:      true,
        appointmentId: existing.id,
        title:         existing.title,
        status:        "cancelled",
        reason,
        message:       "Tu cita ha sido cancelada correctamente.",
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
  /resumen ejecutivo|estado del negocio|situaci[oó]n actual|dashboard|an[aá]lisis comercial|informe ejecutivo|estado actual|panorama general|visi[oó]n general|overview|c[oó]mo va el negocio|c[oó]mo va mi negocio|c[oó]mo estamos|dame un resumen|resumen del d[ií]a|resumen de (la )?semana|qu[eé] debo hacer( hoy)?|d[oó]nde debo (centrarme|enfocarme|focalizarme)|en qu[eé] (me )?centrar|qu[eé] (me )?har[aá] ganar|ganar m[aá]s (dinero|pasta)|qu[eé] cliente.{0,20}priorizar|qu[eé] priorizo|a qui[eé]n (debo |debería )?llamar|por d[oó]nde empez|pr[oó]ximos pasos|siguiente(s)? paso(s)?|estrategia (del|de) (negocio|semana|mes)|d[oó]nde est[aá] el dinero|mayor impacto|mayor retorno|mejor oportunidad|\bceo\b|\bcoo\b|\bcfo\b|inversor(es)?|socio(s)? (estrat[eé]gico(s)?|de negocio|capitalista(s)?|\b)|para (el |los )?(socio|consejo|directorio|board|inversor)\b|junta (directiva|de (accionistas|socios))|consejo (de administraci[oó]n|directivo|asesor|\b)|para el (consejo|directorio|board)\b|pitch|due diligence|escalado|escalabilidad|escalar (el )?negocio|crecimiento (del negocio|sostenible|acelerado|exponencial)|plan de crecimiento|estrategia (empresarial|de negocio|comercial|de ventas|de expansi[oó]n)|an[aá]lisis estrat[eé]gico|visi[oó]n estrat[eé]gica|objetivo(s)? estrat[eé]gico(s)?|m[eé]tricas (clave|de negocio|para el)|kpi(s)?|retorno (de la )?(inversi[oó]n|inversion)|roi\b|margen(es)? (de beneficio|bruto|neto)|ticket medio|ltv\b|lifetime value|churn\b|tasa de (retenci[oó]n|abandono|conversi[oó]n)|pipeline (de ventas|comercial)|\bingresos\b|total (de )?ingresos|ingresos (del mes|del trimestre|anuales|generados|actuales)|cu[aá]nto (hemos? )?(ingresado|facturado|vendido)/i;

const EXECUTIVE_SYSTEM_ADDON = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 MODO INTELIGENCIA ESTRATÉGICA ACTIVO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
El usuario hace una pregunta estratégica o de alto nivel directivo. Los datos reales del CRM están adjuntos como resultados de herramientas.

⛔ PROHIBIDO ABSOLUTO:
- NO respondas con conocimiento general, marcos teóricos ni buenas prácticas genéricas
- NO inventes cifras, clientes ni métricas
- NO digas "típicamente", "en general", "suele ser" ni nada que no provenga del CRM
- Si no hay datos suficientes para responder algo, dilo explícitamente

✅ OBLIGATORIO antes de responder:
1. Consultar clientes y pipeline (ya en exec_1 / list_clients)
2. Consultar citas próximas y pendientes (exec_2 y exec_3)
3. Consultar actividad e ingresos recientes (exec_4)
4. Leer el scoring calculado (exec_5 / get_strategic_brief con kpis.pipeline_eur y confirmed_eur)
5. Basar CADA afirmación en esos datos — cita el dato de origen

FÓRMULA DE SCORING (ya calculada):
  score = valor_económico × 0.5 + proximidad_cierre × 0.2 + estado_pipeline × 0.2 + urgencia × 0.1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUCTURA SEGÚN EL CONTEXTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si menciona CEO, COO, CFO, Consejo, Junta, Inversor, Board o Pitch → INFORME PARA DIRECTIVOS:
📊 **Estado Actual del Negocio** — pipeline €X, confirmado €Y, clientes activos N
🏆 **Top 3 Clientes Estratégicos** — nombre, valor €, score, estado y próximo paso
📈 **Tendencia** — actividad del último mes: N interacciones, N citas, N presupuestos
⚠️ **Riesgos Identificados** — con impacto económico estimado en €
🚀 **Palancas de Crecimiento** — 2-3 acciones concretas con nombre de cliente y €€€ potencial

Si menciona Estrategia, Escalado, Crecimiento, KPIs, ROI, Pipeline → ANÁLISIS ESTRATÉGICO:
📈 **Situación Base** — métricas actuales del CRM (pipeline, conversión, actividad)
🎯 **Mayor Palanca de Crecimiento** — el cliente o segmento con mayor potencial de €
💰 **Oportunidad Económica Inmediata** — €€€ en presupuestos enviados pendientes de cierre
⚡ **Acción Estratégica #1** — la de mayor impacto con menor esfuerzo
📌 **Riesgo Principal** — qué puede frenar el crecimiento según los datos actuales

Si pregunta "¿Cómo va mi negocio?" o situación general → INFORME EJECUTIVO:
📊 **Estado del Negocio** — 2-3 métricas clave con €
🏆 **Top 3 Clientes por Impacto** — con score, valor € y acción recomendada
⚡ **Acción Más Rentable Esta Semana** — UNA acción concreta con nombre real
⚠️ **Riesgo Principal** — el mayor riesgo con su impacto económico

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
- Cada afirmación debe citar su fuente de datos (nombre del cliente, €, fecha)
- Responde con DECISIONES y DATOS, nunca con consejos genéricos
- Usa el score del get_strategic_brief para justificar la priorización
- Máximo 450 palabras — ejecutivo, directo, accionable
- Siempre termina con UNA acción concreta que el usuario debe hacer AHORA MISMO`;

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
  aiProvider: ReturnType<typeof getProviderSingleton>,
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
    extraction = await aiProvider.generate([
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
    ], {
      model:       "gpt-4o-mini",
      maxTokens:   400,
      temperature: 0.1,
      tools:       [SAVE_MEMORY_TOOL],
      toolChoice:  "auto",
    });
  } catch {
    return [];
  }

  const toolCalls = extraction.toolCalls ?? [];
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
        const embRes = await aiProvider.embed(
          `${normalizedKey} ${args.value}`.slice(0, 2000),
        );
        emb = embRes.embedding ?? null;
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

  // ── Budget guard ──────────────────────────────────────────────────────────
  const budgetCheck = await checkBudgetBlocked(orgId);
  if (budgetCheck.blocked) {
    res.status(429).json({
      error: `Límite de IA alcanzado (${budgetCheck.pct.toFixed(0)}% del presupuesto mensual). ${budgetCheck.reason ?? ""}`.trim(),
      code: "AI_BUDGET_EXCEEDED",
    });
    return;
  }

  const aiProvider = getProviderSingleton();

  // Load relevant memories via semantic search (isolated by orgId)
  let memories: AgentMemoryRow[] = [];
  const lastUserMessage = messages.filter(m => m.role === "user").at(-1)?.content ?? "";
  try {
    memories = await getRelevantMemories(aiProvider, orgId, lastUserMessage);
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
      const phase1 = await aiProvider.generate(apiMessages, {
        model:       "gpt-4o-mini",
        maxTokens:   300,
        temperature: 0.1,
        tools:       CRM_TOOLS,
        toolChoice:  "auto",
      });

      const crmToolCalls = (phase1.toolCalls ?? []).filter(
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
    const chatStreamStart = Date.now();
    let accumulatedResponse = "";
    let streamUsage: { promptTokens: number; completionTokens: number } | undefined;

    for await (const chunk of aiProvider.stream(apiMessages, {
      model:       "gpt-4o-mini",
      maxTokens:   isExecutive ? 1200 : 700,
      temperature: 0.7,
    })) {
      if (chunk.usage) streamUsage = chunk.usage;
      const token = chunk.token;
      if (token) {
        accumulatedResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // Log AI usage (fire-and-forget)
    logAiCall({
      orgId,
      userClerkId:  req.clerkUserId ?? null,
      functionName: isExecutive ? "chat_executive" : "chat_stream",
      model:        "gpt-4o-mini",
      tokensInput:  streamUsage?.promptTokens    ?? 0,
      tokensOutput: streamUsage?.completionTokens ?? 0,
      durationMs:   Date.now() - chatStreamStart,
    }).catch(() => {});

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
        aiProvider,
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
