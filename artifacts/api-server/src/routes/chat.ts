import { Router } from "express";
import OpenAI from "openai";
import { db, agentMemoryTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

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

// ── Chat endpoint ─────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { messages, clientContext } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    clientContext?: ClientContext;
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildSystemPrompt(memories, clientContext) },
        ...messages,
      ],
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
