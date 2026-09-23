// OmniSeller Fase 6 — Follow-up Service.
//
// Responsabilidades (punto 17 del mandato): programar la secuencia (activar
// el intento 1), consultar estado, cancelar, preparar el lead_message del
// intento y crear el siguiente intento cuando corresponde, controlar
// attempt/max_attempts, trazabilidad. El envío real (reserve→send→settle,
// suppression, cooldown, kill switch de envío, IntegrationManager) vive
// EXCLUSIVAMENTE en outreach/outreachService.ts (sendFollowupMessage /
// executeSend) — este archivo nunca llama a IntegrationManager ni reserva
// créditos directamente (punto 8/9).
//
// "Integración con confirmación existente" (mencionada en el punto 17): NO
// se usa confirmationStore.ts aquí — ese mecanismo es para confirmación
// humana POR MENSAJE (modelo A/C); el modelo aprobado para Fase 6 es B
// (secuencia aprobada UNA VEZ, ver scheduleFollowupSequence). Decisión
// explícita, documentada también en outreachService.sendFollowupMessage.
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, leadMessagesTable, leadResultsTable, leadSearchesTable, leadContactsTable, outreachFollowupsTable,
  type OutreachFollowupStatus,
} from "@workspace/db";
import { isModuleEnabled } from "../../middlewares/requireModule";

// Cadencia de la primera implementación (punto 5) — aritmética por
// next_run_at, sin horario comercial/timezone (punto 23, documentado como
// límite explícito de esta fase). CADENCE_DAYS[i] = días desde que el paso
// anterior de la secuencia se completó hasta que debe correr el intento
// (i+1)-ésimo. Estructura preparada para hacerse configurable sin rehacer
// el motor: un único punto de lectura (aquí), nunca hardcodeado en el tick.
export const FOLLOWUP_CADENCE_DAYS: readonly number[] = [3, 4, 7];
export const FOLLOWUP_MAX_ATTEMPTS = FOLLOWUP_CADENCE_DAYS.length; // 3

// Kill switch PROPIO de Follow-up (punto 15) — DISTINTO del de envío
// (omni_seller_outreach, outreachService.ts). FAIL-CLOSED a propósito
// (mismo criterio que el kill switch de envío): crear/ejecutar nuevas
// acciones de follow-up automáticas es lo bastante sensible como para no
// proceder ante un estado ambiguo (error de caché/DB). Desactivarlo NUNCA
// altera ni cancela filas ya almacenadas — ver followupEngine.ts, que ni
// siquiera consulta filas de una organización con este switch apagado.
export const FOLLOWUP_KILL_SWITCH_SLUG = "omni_seller_followup";

export async function isFollowupKillSwitchActive(orgId: number): Promise<boolean> {
  try {
    return !(await isModuleEnabled(orgId, FOLLOWUP_KILL_SWITCH_SLUG));
  } catch {
    return true; // fail closed
  }
}

// Reprogramaciones que NO consumen un intento de la secuencia (cooldown
// transitorio de Outreach, 5 min — outreachGuard.OUTREACH_COOLDOWN_MS) o que
// pausan un intento sin avanzar (kill switch de ENVÍO activo, que se espera
// se reactive). Valores propios de esta fase, documentados como ajustables
// sin rehacer el motor (mismo criterio que la cadencia).
export const FOLLOWUP_COOLDOWN_RECHECK_MS = 15 * 60 * 1000;   // 15 min
export const FOLLOWUP_SEND_RETRY_MS       = 60 * 60 * 1000;   // 1 h — también usado para el retry de un provider_error con intentos restantes (punto 4)

export const OUTREACH_FOLLOWUP_AUDIT = {
  scheduled: "outreach.followup_scheduled",
  due:       "outreach.followup_due",
  skipped:   "outreach.followup_skipped",
  cancelled: "outreach.followup_cancelled",
  blocked:   "outreach.followup_blocked",
  sent:      "outreach.followup_sent",
  failed:    "outreach.followup_failed",
  approved:  "outreach.followup_approved",
} as const;

export interface AnchorMessage {
  id: number; orgId: number; resultId: number; contactId: number | null; channel: string;
  content: string; status: string; approvedBy: number | null; createdBy: number | null; sentAt: Date | null;
}

export async function loadAnchorMessage(orgId: number, leadMessageId: number): Promise<(AnchorMessage & { missionId: number | null }) | null> {
  const [row] = await db
    .select({
      id: leadMessagesTable.id, orgId: leadMessagesTable.orgId, resultId: leadMessagesTable.resultId,
      contactId: leadMessagesTable.contactId, channel: leadMessagesTable.channel, content: leadMessagesTable.content,
      status: leadMessagesTable.status, approvedBy: leadMessagesTable.approvedBy, createdBy: leadMessagesTable.createdBy,
      sentAt: leadMessagesTable.sentAt, missionId: leadSearchesTable.missionId,
    })
    .from(leadMessagesTable)
    .innerJoin(leadResultsTable, eq(leadMessagesTable.resultId, leadResultsTable.id))
    .leftJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(and(eq(leadMessagesTable.id, leadMessageId), eq(leadMessagesTable.orgId, orgId)));
  return row ?? null;
}

export type ScheduleFailureReason = "not_found" | "not_sent" | "no_contact" | "already_scheduled";
export type ScheduleResult =
  | { ok: true; followup: typeof outreachFollowupsTable.$inferSelect }
  | { ok: false; reason: ScheduleFailureReason };

/** Punto 6/19 — activa la secuencia (aprobación de la secuencia, UNA VEZ). Crea el intento 1. */
export async function scheduleFollowupSequence(opts: { orgId: number; leadMessageId: number }): Promise<ScheduleResult> {
  const anchor = await loadAnchorMessage(opts.orgId, opts.leadMessageId);
  if (!anchor) return { ok: false, reason: "not_found" };
  // El mensaje que origina la secuencia debe ser un envío YA REALIZADO —
  // "el mensaje que originó la secuencia" (punto 12) presupone que existió
  // un envío real; activar una secuencia sobre un draft/pending no tendría
  // "mensaje anterior" del que partir.
  if (anchor.status !== "sent") return { ok: false, reason: "not_sent" };
  if (!anchor.contactId) return { ok: false, reason: "no_contact" };

  const referenceDate = anchor.sentAt ?? new Date();
  const nextRunAt = addDays(referenceDate, FOLLOWUP_CADENCE_DAYS[0]!);

  // Idempotencia real de Postgres (punto 1) — nunca SELECT→INSERT.
  const [inserted] = await db.insert(outreachFollowupsTable).values({
    orgId: opts.orgId, leadMessageId: anchor.id, leadContactId: anchor.contactId,
    missionId: anchor.missionId ?? null, channel: anchor.channel,
    attempt: 1, maxAttempts: FOLLOWUP_MAX_ATTEMPTS, status: "scheduled", nextRunAt,
  }).onConflictDoNothing({ target: [outreachFollowupsTable.leadMessageId, outreachFollowupsTable.attempt] }).returning();

  if (!inserted) return { ok: false, reason: "already_scheduled" };
  return { ok: true, followup: inserted };
}

/** Punto 19 — desactivación manual. Cancela toda fila pendiente (scheduled/skipped) de la secuencia; nunca toca filas ya terminales (sent/failed/blocked/cancelled). */
export async function cancelFollowupSequence(opts: { orgId: number; leadMessageId: number; reason: string }): Promise<number> {
  const rows = await db.update(outreachFollowupsTable)
    .set({ status: "cancelled", reason: opts.reason, updatedAt: new Date() })
    .where(and(
      eq(outreachFollowupsTable.orgId, opts.orgId), eq(outreachFollowupsTable.leadMessageId, opts.leadMessageId),
      or(eq(outreachFollowupsTable.status, "scheduled"), eq(outreachFollowupsTable.status, "skipped")),
    ))
    .returning({ id: outreachFollowupsTable.id });
  return rows.length;
}

export async function getFollowupSequence(orgId: number, leadMessageId: number) {
  return db.select().from(outreachFollowupsTable)
    .where(and(eq(outreachFollowupsTable.orgId, orgId), eq(outreachFollowupsTable.leadMessageId, leadMessageId)))
    .orderBy(outreachFollowupsTable.attempt);
}

export async function listFollowups(orgId: number, filters: { missionId?: number; status?: string } = {}) {
  const conditions = [eq(outreachFollowupsTable.orgId, orgId)];
  if (filters.missionId != null) conditions.push(eq(outreachFollowupsTable.missionId, filters.missionId));
  if (filters.status) conditions.push(eq(outreachFollowupsTable.status, filters.status));
  return db.select().from(outreachFollowupsTable).where(and(...conditions)).orderBy(outreachFollowupsTable.nextRunAt);
}

export async function getFollowupById(orgId: number, id: number) {
  const [row] = await db.select().from(outreachFollowupsTable)
    .where(and(eq(outreachFollowupsTable.id, id), eq(outreachFollowupsTable.orgId, orgId)));
  return row ?? null;
}

/** Punto 21 — org_id SIEMPRE derivado de la propia fila; nunca de un id arbitrario del caller. Valida la cadena mission→lead_result→lead_contact→lead_message→followup. */
export async function assertOwnedChain(orgId: number, followup: { leadMessageId: number; leadContactId: number; missionId: number | null }): Promise<boolean> {
  const [msg] = await db.select({ id: leadMessagesTable.id })
    .from(leadMessagesTable).where(and(eq(leadMessagesTable.id, followup.leadMessageId), eq(leadMessagesTable.orgId, orgId)));
  if (!msg) return false;
  const [contact] = await db.select({ id: leadContactsTable.id })
    .from(leadContactsTable).where(and(eq(leadContactsTable.id, followup.leadContactId), eq(leadContactsTable.orgId, orgId)));
  if (!contact) return false;
  return true;
}

/** Crea el siguiente intento tras un envío exitoso — idempotente (mismo constraint), referenceDate = ahora (cuándo se completó ESTE intento). */
export async function createNextAttempt(opts: {
  orgId: number; leadMessageId: number; leadContactId: number; missionId: number | null; channel: string; completedAttempt: number;
}): Promise<typeof outreachFollowupsTable.$inferSelect | null> {
  const nextAttempt = opts.completedAttempt + 1;
  if (nextAttempt > FOLLOWUP_MAX_ATTEMPTS) return null; // punto 14 — secuencia cerrada, no se crea más
  const nextRunAt = addDays(new Date(), FOLLOWUP_CADENCE_DAYS[nextAttempt - 1]!);
  const [inserted] = await db.insert(outreachFollowupsTable).values({
    orgId: opts.orgId, leadMessageId: opts.leadMessageId, leadContactId: opts.leadContactId,
    missionId: opts.missionId, channel: opts.channel, attempt: nextAttempt, maxAttempts: FOLLOWUP_MAX_ATTEMPTS,
    status: "scheduled", nextRunAt,
  }).onConflictDoNothing({ target: [outreachFollowupsTable.leadMessageId, outreachFollowupsTable.attempt] }).returning();
  return inserted ?? null; // undefined = otro tick ya lo creó — no es un error
}

/** Crea el lead_message del intento (contenido = copia literal del mensaje ancla — ver decisión documentada en el informe final, punto "fuera de alcance"). */
export async function prepareFollowupMessage(anchor: AnchorMessage, row: { orgId: number; channel: string; leadContactId: number }, actingUserId: number) {
  const [message] = await db.insert(leadMessagesTable).values({
    orgId: row.orgId, resultId: anchor.resultId, contactId: row.leadContactId, channel: row.channel,
    content: anchor.content, status: "draft", createdBy: actingUserId,
  }).returning();
  return message!;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export type { OutreachFollowupStatus };
