// ── Generación de mensajes de seguimiento comercial (Client Autopilot) ─────────
// Mismo patrón que whatsapp.ts POST /generate (buildSystemPrompt/buildUserPrompt
// + getProviderSingleton) pero orientado a la secuencia de seguimiento de
// autopilotEngine.ts en vez de al generador manual de WhatsApp.
import { getProviderSingleton } from "../ai/types";
import type { Client, AutopilotTask } from "@workspace/db";

export interface FollowupTriggerConfig {
  intervalsDays: number[];
  mode: "approval" | "autopilot";
  preferredChannel?: "whatsapp" | "telegram" | "email";
}

const CHANNEL_INSTRUCTIONS: Record<string, string> = {
  whatsapp: "Máximo 350 caracteres. Tono cercano e informal. Como mucho 1-2 emojis. Cierra con una pregunta o CTA claro.",
  telegram: "Máximo 400 caracteres. Tono cercano. Como mucho 1 emoji. Cierra con una pregunta abierta.",
  email: "Formato email breve (80-150 palabras). Tono profesional pero cercano, casi sin emojis. Cierra con una llamada a la acción concreta.",
};

function buildSystemPrompt(step: number, channel: string): string {
  const channelInstr = CHANNEL_INSTRUCTIONS[channel] ?? CHANNEL_INSTRUCTIONS["whatsapp"];
  return `Eres un comercial humano escribiendo un mensaje de seguimiento genuino — no un bot ni una plantilla.

Este es el seguimiento número ${step} de una secuencia comercial. Cada seguimiento de la secuencia debe sonar distinto de los anteriores: nunca repitas la misma apertura, estructura o cierre entre seguimientos consecutivos.

Reglas OBLIGATORIAS:
- Tono humano, natural, profesional, cercano. Nunca robótico ni de plantilla.
- Breve. No agresivo. Nunca "spam" ni presión excesiva.
- Si hay un dolor principal y/o un recurso ya enviado al cliente, haz referencia a ellos de forma natural e integrada en la frase — no los repitas literalmente como si fuera una etiqueta.
- No abras siempre con la misma fórmula ("Hola, ¿cómo va todo?") — varía la apertura según el número de seguimiento.
- ${channelInstr}
- Solo el texto del mensaje. Sin explicaciones, sin comillas, sin markdown.`;
}

function buildUserPrompt(
  client: Pick<Client, "name" | "company" | "contactPerson" | "sector" | "commercialStatus" | "dolorPrincipal" | "recursoEnviado" | "resultado" | "lastContactAt">,
  step: number,
): string {
  const parts: string[] = [];
  parts.push("DATOS DEL CLIENTE / PROSPECTO:");
  parts.push(`- Nombre: ${client.name}`);
  if (client.company) parts.push(`- Empresa: ${client.company}`);
  if (client.contactPerson) parts.push(`- Persona de contacto: ${client.contactPerson}`);
  if (client.sector) parts.push(`- Sector: ${client.sector}`);
  if (client.commercialStatus) parts.push(`- Estado comercial: ${client.commercialStatus}`);
  if (client.dolorPrincipal) parts.push(`- Dolor principal detectado: ${client.dolorPrincipal}`);
  if (client.recursoEnviado) parts.push(`- Recurso ya enviado: ${client.recursoEnviado}`);
  if (client.resultado) parts.push(`- Resultado / última conclusión registrada: ${client.resultado}`);
  if (client.lastContactAt) {
    parts.push(`- Último contacto: ${new Date(client.lastContactAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`);
  }
  parts.push(`\nGENERA el mensaje de seguimiento número ${step} de la secuencia, para reactivar la conversación con este cliente.`);
  return parts.join("\n");
}

/** Genera el texto del seguimiento N para un cliente. No envía nada — solo produce el texto. */
export async function generateFollowupMessage(
  client: Client,
  task: AutopilotTask,
  step: number,
): Promise<string> {
  const cfg = (task.triggerConfig ?? {}) as Partial<FollowupTriggerConfig>;
  const channel = cfg.preferredChannel ?? client.preferredChannel ?? "whatsapp";

  const aiProvider = getProviderSingleton();
  // Temperatura ligeramente distinta por paso — ayuda a que los 3 mensajes de
  // una misma secuencia no lean como copias unos de otros.
  const temperature = Math.min(0.7 + (step - 1) * 0.05, 0.85);

  const result = await aiProvider.generate(
    [
      { role: "system", content: buildSystemPrompt(step, channel) },
      { role: "user", content: buildUserPrompt(client, step) },
    ],
    { model: "gpt-4o-mini", temperature, maxTokens: 250 },
  );

  return result.text.trim();
}
