import { Router } from "express";
import OpenAI from "openai";

export const calendarAiRouter = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

calendarAiRouter.post("/", async (req, res) => {
  try {
    const { action, context } = req.body as {
      action: "create" | "summary" | "follow-up" | "suggest-time";
      context: Record<string, unknown>;
    };

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "create") {
      systemPrompt = `Eres un asistente CRM experto en español. El usuario describe una cita en lenguaje natural.
Extrae los datos y responde con un JSON con estos campos (sin markdown):
{
  "title": "título conciso de la cita",
  "type": "demo|llamada|reunión|propuesta|onboarding|seguimiento|otro",
  "description": "descripción o agenda breve",
  "suggestedStartTime": "HH:MM",
  "suggestedDuration": 60
}
Usa el tipo más apropiado. suggestedDuration en minutos (30, 45, 60, 90, 120).`;
      userPrompt = `Descripción del usuario: "${context.description}"`;
    } else if (action === "summary") {
      systemPrompt = `Eres un asistente CRM experto en español. Resume la siguiente cita de forma profesional y concisa en 2-3 oraciones. Incluye el cliente, tipo, hora y puntos clave.`;
      userPrompt = `Cita: ${JSON.stringify(context, null, 2)}`;
    } else if (action === "follow-up") {
      systemPrompt = `Eres un asistente CRM experto en español. Genera un mensaje de seguimiento profesional y amigable en español para enviar al cliente después de la cita. El mensaje debe ser corto (2-3 párrafos), cálido y orientado a continuar la relación. No incluyas asunto de email.`;
      userPrompt = `Datos de la cita: ${JSON.stringify(context, null, 2)}`;
    } else if (action === "suggest-time") {
      systemPrompt = `Eres un asistente CRM experto en español. Sugiere 3 franjas horarias óptimas para una reunión, considerando el contexto del cliente y el tipo de cita. Responde con un JSON sin markdown:
{
  "suggestions": [
    { "label": "Ej. Mañana 10:00", "reason": "Horario prime para decisiones" },
    { "label": "...", "reason": "..." },
    { "label": "...", "reason": "..." }
  ],
  "tip": "Consejo breve sobre el mejor momento para este tipo de reunión"
}`;
      userPrompt = `Contexto: ${JSON.stringify(context, null, 2)}`;
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    if (action === "create" || action === "suggest-time") {
      try {
        const parsed = JSON.parse(raw);
        return res.json({ result: parsed });
      } catch {
        return res.json({ result: raw });
      }
    }

    res.json({ result: raw });
  } catch (err) {
    console.error("calendar-ai error:", err);
    res.status(500).json({ error: String(err) });
  }
});
