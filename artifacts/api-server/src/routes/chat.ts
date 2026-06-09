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
import { eq, and, desc, gte, lt } from "drizzle-orm";

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
- No menciones que eres GPT o que eres de OpenAI — eres OmniTech AI`;

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

  const base = BASE_SYSTEM_PROMPT + memoryBlock;

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

const CRM_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_clients",
      description:
        "Lista los clientes del CRM con nombre, empresa, estado, valor económico y email. " +
        "Úsala ante preguntas sobre: lista de clientes, cuántos clientes hay, cuántos activos/prospectos/inactivos, " +
        "valor de la cartera, o cualquier consulta que implique datos de clientes.",
      parameters: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["all", "lead", "active", "inactive", "churned"],
            description:
              "Filtra por estado. 'all' devuelve todos. " +
              "'lead' = prospectos, 'active' = activos, 'inactive' = inactivos, 'churned' = perdidos.",
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
        "Obtiene citas y reuniones del calendario con nombre del cliente asociado. " +
        "Úsala ante preguntas sobre: próximas citas, reuniones programadas, agenda, historial de citas.",
      parameters: {
        type: "object" as const,
        properties: {
          period: {
            type: "string",
            enum: ["upcoming", "past", "all"],
            description: "'upcoming' = próximas, 'past' = pasadas, 'all' = todas.",
          },
          limit: {
            type: "number",
            description: "Máximo número de citas a devolver. Por defecto 10.",
          },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_activity",
      description:
        "Obtiene el registro de actividad reciente del CRM: clientes añadidos, mensajes enviados, " +
        "citas programadas, cambios de estado. Úsala ante preguntas sobre actividad, historial o últimas acciones.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Número de entradas de actividad a devolver. Por defecto 20.",
          },
        },
        required: [],
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

async function executeCrmTool(
  toolName: string,
  args: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  try {
    if (toolName === "list_clients") {
      const status = (args["status"] as string | undefined) ?? "all";
      const rows =
        status !== "all"
          ? await db
              .select()
              .from(clientsTable)
              .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, status)))
              .orderBy(clientsTable.name)
          : await db
              .select()
              .from(clientsTable)
              .where(eq(clientsTable.orgId, orgId))
              .orderBy(clientsTable.name);

      const totalValue = rows.reduce((acc, c) => acc + (c.value ?? 0), 0);
      const byStatus: Record<string, number> = {};
      for (const c of rows) {
        byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      }

      return JSON.stringify({
        total: rows.length,
        totalValue: Math.round(totalValue),
        byStatus: Object.entries(byStatus).map(([s, n]) => ({
          status: s,
          label: STATUS_LABEL[s] ?? s,
          count: n,
        })),
        clients: rows.map(c => ({
          id:      c.id,
          name:    c.name,
          company: c.company ?? null,
          status:  c.status,
          label:   STATUS_LABEL[c.status] ?? c.status,
          email:   c.email,
          phone:   c.phone ?? null,
          value:   c.value ?? 0,
          tags:    c.tags ?? null,
        })),
      });
    }

    if (toolName === "get_appointments") {
      const period = (args["period"] as string | undefined) ?? "all";
      const limit  = Math.min(Number(args["limit"] ?? 10), 50);
      const now    = new Date();

      const baseSelect = {
        id:          appointmentsTable.id,
        title:       appointmentsTable.title,
        description: appointmentsTable.description,
        startTime:   appointmentsTable.startTime,
        endTime:     appointmentsTable.endTime,
        status:      appointmentsTable.status,
        type:        appointmentsTable.type,
        location:    appointmentsTable.location,
        clientId:    appointmentsTable.clientId,
        clientName:  clientsTable.name,
        clientCompany: clientsTable.company,
      };

      let rows;
      if (period === "upcoming") {
        rows = await db
          .select(baseSelect)
          .from(appointmentsTable)
          .leftJoin(clientsTable, eq(appointmentsTable.clientId, clientsTable.id))
          .where(and(eq(appointmentsTable.orgId, orgId), gte(appointmentsTable.startTime, now)))
          .orderBy(appointmentsTable.startTime)
          .limit(limit);
      } else if (period === "past") {
        rows = await db
          .select(baseSelect)
          .from(appointmentsTable)
          .leftJoin(clientsTable, eq(appointmentsTable.clientId, clientsTable.id))
          .where(and(eq(appointmentsTable.orgId, orgId), lt(appointmentsTable.startTime, now)))
          .orderBy(desc(appointmentsTable.startTime))
          .limit(limit);
      } else {
        rows = await db
          .select(baseSelect)
          .from(appointmentsTable)
          .leftJoin(clientsTable, eq(appointmentsTable.clientId, clientsTable.id))
          .where(eq(appointmentsTable.orgId, orgId))
          .orderBy(desc(appointmentsTable.startTime))
          .limit(limit);
      }

      return JSON.stringify({
        total: rows.length,
        period,
        appointments: rows.map(r => ({
          ...r,
          startTime: r.startTime.toISOString(),
          endTime:   r.endTime.toISOString(),
        })),
      });
    }

    if (toolName === "get_recent_activity") {
      const limit = Math.min(Number(args["limit"] ?? 20), 50);
      const rows  = await db
        .select()
        .from(activityTable)
        .where(eq(activityTable.orgId, orgId))
        .orderBy(desc(activityTable.createdAt))
        .limit(limit);

      return JSON.stringify({
        total: rows.length,
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
