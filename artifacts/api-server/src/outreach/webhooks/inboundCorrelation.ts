// OmniSeller Fase 5 — PASO 11/12: correlación de un mensaje ENTRANTE con una
// conversación de Outreach ya iniciada.
//
// Usado de forma ADITIVA por routes/whatsapp.ts y routes/telegram.ts: el
// org YA se resuelve por el mecanismo propio y existente de cada proveedor
// (phone_number_id para WhatsApp, secreto-en-URL para Telegram — ninguno de
// los dos se inventa aquí, ambos son la misma infraestructura que ya usa el
// bot de Autopilot). Esta función solo decide si, DENTRO de ese org ya
// conocido, el remitente corresponde INEQUÍVOCAMENTE a un lead_contact al
// que OmniSeller ya le envió al menos un mensaje por este canal. Si no hay
// una correlación clara, devuelve null — nunca se inventa una relación.
import { and, desc, eq } from "drizzle-orm";
import { db, leadContactsTable, leadMessagesTable } from "@workspace/db";
import type { OutreachChannel } from "../outreachGuard";

// Mismo criterio de normalización ya usado en routes/whatsapp.ts
// (normalizePhone: solo dígitos, últimos 9) — comparar por los últimos 9
// dígitos evita falsos negativos por diferencias de prefijo de país/formato
// entre lo que guardó Contact Finder en lead_contacts.phone y lo que manda
// el proveedor en el webhook. Se reimplementa aquí (no se importa de
// whatsapp.ts, que no lo exporta) en vez de cambiar ese archivo para
// exportarlo — cambio más aislado.
function last9Digits(v: string): string {
  return v.replace(/\D/g, "").slice(-9);
}

export interface InboundCorrelation {
  orgId:     number;
  contactId: number;
  /** El lead_message MÁS RECIENTE ya enviado a este contacto por este canal (para trazabilidad en outreach_events) — null si no se encuentra ninguno, aunque el contacto sí exista. */
  mostRecentLeadMessageId: number | null;
}

/**
 * `exact`: false (por defecto, WhatsApp) compara por los últimos 9 dígitos
 * — mismo criterio que ya usa routes/whatsapp.ts para el CRM, tolera
 * diferencias de prefijo de país/formato. true (Telegram) exige coincidencia
 * EXACTA del identificador: el chat_id de Telegram es un entero propio (no
 * un número de teléfono), y truncar a "los últimos 9 dígitos" podría hacer
 * coincidir dos chat_ids distintos por casualidad — un riesgo de
 * correlación cruzada que aquí se evita exigiendo coincidencia exacta.
 */
export async function correlateInboundContact(orgId: number, channel: OutreachChannel, senderIdentifier: string, exact = false): Promise<InboundCorrelation | null> {
  if (!senderIdentifier) return null;
  const normalizedSender = exact ? senderIdentifier.trim() : last9Digits(senderIdentifier);
  if (!normalizedSender || (!exact && normalizedSender.length < 6)) return null; // demasiado corto para ser un identificador real — no arriesgar un falso positivo

  const candidates = await db
    .select({ id: leadContactsTable.id, phone: leadContactsTable.phone })
    .from(leadContactsTable)
    .where(eq(leadContactsTable.orgId, orgId));

  const contact = candidates.find((c) => {
    if (!c.phone) return false;
    return exact ? c.phone.trim() === normalizedSender : last9Digits(c.phone) === normalizedSender;
  });
  if (!contact) return null;

  // Exigir que exista AL MENOS un envío real de Outreach a este contacto por
  // este canal — un lead_contact encontrado por Contact Finder sin ningún
  // mensaje enviado todavía no es "una conversación de OmniSeller", es solo
  // un dato de prospección; correlacionar aquí sería inventar una relación
  // que no existe.
  const [message] = await db
    .select({ id: leadMessagesTable.id })
    .from(leadMessagesTable)
    .where(and(
      eq(leadMessagesTable.orgId, orgId), eq(leadMessagesTable.contactId, contact.id), eq(leadMessagesTable.channel, channel),
      eq(leadMessagesTable.status, "sent"),
    ))
    .orderBy(desc(leadMessagesTable.updatedAt))
    .limit(1);

  if (!message) return null;

  return { orgId, contactId: contact.id, mostRecentLeadMessageId: message.id };
}
