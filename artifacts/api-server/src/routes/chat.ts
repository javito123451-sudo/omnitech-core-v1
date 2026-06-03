import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const BASE_SYSTEM_PROMPT = `Eres Omniflow AI, el asistente de inteligencia artificial integrado en el CRM Omniflow. Ayudas a equipos de ventas y negocios hispanohablantes a gestionar clientes, redactar mensajes, crear presupuestos, agendar citas y analizar su rendimiento comercial.

Contexto del sistema:
- CRM enfocado en el mercado español e hispanohablante
- Usuarios: vendedores, account managers, directores comerciales
- Funciones principales: gestión de clientes, pipeline de ventas, comunicaciones, calendario

Instrucciones:
- Responde SIEMPRE en español, de forma profesional pero cercana
- Usa formato Markdown cuando sea útil (negritas, listas, tablas)
- Sé conciso pero completo — respuestas de máximo 400 palabras salvo que pidan algo detallado
- Cuando generes presupuestos, usa formato de tabla Markdown
- Cuando sugiereas mensajes para clientes, ponlos entre comillas en bloque con >
- Propón siempre un siguiente paso accionable al final de tu respuesta
- No menciones que eres GPT o que eres de OpenAI — eres Omniflow AI`;

interface ClientContext {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  status?: string;
  tags?: string;
  notes?: string;
  value?: number;
}

const STATUS_ES: Record<string, string> = {
  lead: "Prospecto",
  active: "Activo",
  inactive: "Inactivo",
  churned: "Perdido",
};

function buildSystemPrompt(clientContext?: ClientContext): string {
  if (!clientContext) return BASE_SYSTEM_PROMPT;

  const lines = [
    `Nombre: ${clientContext.name}`,
    clientContext.company  ? `Empresa: ${clientContext.company}` : null,
    clientContext.status   ? `Estado: ${STATUS_ES[clientContext.status] ?? clientContext.status}` : null,
    clientContext.email    ? `Correo: ${clientContext.email}` : null,
    clientContext.phone    ? `Teléfono: ${clientContext.phone}` : null,
    clientContext.value    ? `Valor del trato: €${clientContext.value.toLocaleString("es-ES")}` : null,
    clientContext.tags     ? `Etiquetas: ${clientContext.tags}` : null,
    clientContext.notes    ? `Notas del CRM: ${clientContext.notes}` : null,
  ].filter(Boolean).join("\n");

  return `${BASE_SYSTEM_PROMPT}

---
🎯 CLIENTE EN FOCO
${lines}

El usuario está trabajando con este cliente en concreto. Usa su nombre, empresa y situación real para personalizar TODAS tus respuestas. Cuando redactes mensajes, dirígete al cliente por su nombre. Cuando hagas presupuestos, menciona su empresa. Haz que cada respuesta sea 100% específica a este cliente.
---`;
}

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
    res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    return;
  }

  const openai = new OpenAI({ apiKey });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildSystemPrompt(clientContext) },
        ...messages,
      ],
      stream: true,
      max_tokens: 700,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export { router as chatRouter };
