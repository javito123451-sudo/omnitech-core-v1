import { Router } from "express";
import { db, clientsTable, activityTable, appointmentsTable } from "@workspace/db";
import { eq, and, desc, gt } from "drizzle-orm";
import OpenAI from "openai";

export const whatsappRouter = Router();

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
  if (client.tags) parts.push("- Etiquetas: " + client.tags);
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

// ── POST /send — WhatsApp Business API stub ───────────────────────────────────
// Ready for future integration with Meta WhatsApp Business Cloud API
// Required env vars (when live): WHATSAPP_BUSINESS_PHONE_ID, WHATSAPP_ACCESS_TOKEN
whatsappRouter.post("/send", async (req, res) => {
  const phoneId    = process.env.WHATSAPP_BUSINESS_PHONE_ID;
  const token      = process.env.WHATSAPP_ACCESS_TOKEN;
  const orgId      = req.orgId!;
  const { to, message } = req.body as { to: string; message: string };

  if (!to || !message) {
    res.status(400).json({ error: "to y message son obligatorios" }); return;
  }

  if (!phoneId || !token) {
    res.json({
      success:  false,
      pending:  true,
      reason:   "whatsapp_business_not_configured",
      message:  "WhatsApp Business API no configurada. Conecta WHATSAPP_BUSINESS_PHONE_ID y WHATSAPP_ACCESS_TOKEN para activar el envío directo.",
      fallback: "https://wa.me/" + to.replace(/\D/g, "") + "?text=" + encodeURIComponent(message),
    });
    return;
  }

  try {
    const r = await fetch(
      "https://graph.facebook.com/v19.0/" + phoneId + "/messages",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to:      to.replace(/\D/g, ""),
          type:    "text",
          text:    { body: message },
        }),
      }
    );
    const data = await r.json() as { messages?: { id: string }[]; error?: { message: string } };
    if (!r.ok) {
      res.status(502).json({ error: data.error?.message ?? "Error WhatsApp API" }); return;
    }
    const messageId = data.messages?.[0]?.id;
    await db.insert(activityTable).values({
      orgId,
      type:        "whatsapp_sent",
      description: "Mensaje WhatsApp enviado vía API (ID: " + (messageId ?? "?") + ")",
    });
    res.json({ success: true, messageId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
