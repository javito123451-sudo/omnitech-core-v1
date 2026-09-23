// OmniSeller Fase 4 — Validaciones pre-envío de Outreach.
//
// Implementa los puntos 3-8 de la checklist obligatoria (org y lead ya se
// verifican en la ruta, igual que en Fase 2/3; crédito y confirmación humana
// se verifican en outreachService.ts / el endpoint de confirmación):
//   3. el contacto existe y pertenece a esta org+lead;
//   4. el contacto tiene el dato que exige el canal (email para "email",
//      teléfono para "whatsapp"/"telegram");
//   5. ni el email ni el teléfono del contacto están en la suppression list
//      para ese canal (o para "todos los canales");
//   6. el estado del propio lead_contact no es "invalido"/"rechazado";
//   7. cooldown por (org, contacto, canal) — no se ha enviado/está enviando
//      otro mensaje al mismo contacto por el mismo canal hace menos de
//      COOLDOWN_MS;
//   8. límites — un mensaje que ya falló demasiadas veces no se reintenta
//      indefinidamente.
//
// Cualquier fallo devuelve {ok:false, reason, httpStatus} y NO se envía
// nada — nunca se lanza una excepción para un rechazo esperado.
import { and, eq, gte, isNull, ne, or } from "drizzle-orm";
import { db, leadContactsTable, leadMessagesTable, outreachSuppressionsTable } from "@workspace/db";
import type { LeadContact } from "@workspace/db";

export const OUTREACH_COOLDOWN_MS = 5 * 60 * 1000; // 5 min entre envíos al mismo contacto por el mismo canal
export const OUTREACH_MAX_ATTEMPTS = 3; // intentos fallidos permitidos para el MISMO lead_message antes de bloquearlo

export type OutreachChannel = "email" | "whatsapp" | "telegram";
export const OUTREACH_CHANNELS: readonly OutreachChannel[] = ["email", "whatsapp", "telegram"];

export interface GuardFailure {
  ok: false;
  reason:
    | "contact_not_found"
    | "channel_invalid"
    | "contact_missing_channel_data"
    | "contact_status_blocked"
    | "suppressed"
    | "cooldown_active"
    | "max_attempts_exceeded";
  httpStatus: number;
  detail?: string;
}
export interface GuardSuccess { ok: true; contact: LeadContact; destination: string }
export type GuardResult = GuardFailure | GuardSuccess;

function destinationFor(channel: OutreachChannel, contact: LeadContact): string | null {
  if (channel === "email") return contact.email ?? null;
  return contact.phone ?? null; // whatsapp / telegram — mismo campo, el número de teléfono
}

/** Resuelve y valida el contacto + canal para un lead_message ya existente (contactId, channel ya fijados al crear el draft). */
export async function checkContactAndChannel(orgId: number, leadResultId: number, contactId: number, channel: string): Promise<GuardResult> {
  if (!OUTREACH_CHANNELS.includes(channel as OutreachChannel)) {
    return { ok: false, reason: "channel_invalid", httpStatus: 400, detail: `Canal no soportado: ${channel}` };
  }
  const [contact] = await db.select().from(leadContactsTable).where(and(
    eq(leadContactsTable.id, contactId), eq(leadContactsTable.orgId, orgId), eq(leadContactsTable.leadResultId, leadResultId),
  ));
  if (!contact) return { ok: false, reason: "contact_not_found", httpStatus: 404 };

  if (contact.status === "invalido" || contact.status === "rechazado") {
    return { ok: false, reason: "contact_status_blocked", httpStatus: 409, detail: `El contacto está en estado "${contact.status}"` };
  }

  const destination = destinationFor(channel as OutreachChannel, contact);
  if (!destination) {
    return { ok: false, reason: "contact_missing_channel_data", httpStatus: 409, detail: `El contacto no tiene ${channel === "email" ? "email" : "teléfono"}` };
  }

  return { ok: true, contact, destination };
}

/** Punto 5 — ¿está el destino en la suppression list de esta org para este canal (o para todos)? */
export async function isSuppressed(orgId: number, channel: OutreachChannel, destination: string): Promise<boolean> {
  const isEmail = channel === "email";
  const [row] = await db.select({ id: outreachSuppressionsTable.id }).from(outreachSuppressionsTable).where(and(
    eq(outreachSuppressionsTable.orgId, orgId),
    or(isNull(outreachSuppressionsTable.channel), eq(outreachSuppressionsTable.channel, channel)),
    isEmail ? eq(outreachSuppressionsTable.email, destination) : eq(outreachSuppressionsTable.phone, destination),
  ));
  return Boolean(row);
}

/** Punto 7 — cooldown por (org, contacto, canal): ¿hay OTRO mensaje enviado/enviándose a este mismo contacto+canal hace menos de OUTREACH_COOLDOWN_MS? */
export async function isCooldownActive(orgId: number, contactId: number, channel: string, excludeMessageId: number): Promise<boolean> {
  const since = new Date(Date.now() - OUTREACH_COOLDOWN_MS);
  const [row] = await db.select({ id: leadMessagesTable.id }).from(leadMessagesTable).where(and(
    eq(leadMessagesTable.orgId, orgId),
    eq(leadMessagesTable.contactId, contactId),
    eq(leadMessagesTable.channel, channel),
    ne(leadMessagesTable.id, excludeMessageId),
    or(eq(leadMessagesTable.status, "sending"), eq(leadMessagesTable.status, "sent")),
    gte(leadMessagesTable.updatedAt, since),
  ));
  return Boolean(row);
}

/** Punto 8 — límites: no reintentar un mensaje que ya acumuló demasiados fallos. attemptsSoFar viene del propio lead_message (se cuenta por auditoría, ver outreachService.ts). */
export function exceedsMaxAttempts(attemptsSoFar: number): boolean {
  return attemptsSoFar >= OUTREACH_MAX_ATTEMPTS;
}
