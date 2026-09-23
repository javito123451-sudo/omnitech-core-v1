// OmniSeller Fase 6 — Follow-up Engine (sibling tick, punto 16 del mandato).
//
// Tick propio de OmniSeller, PROVIDER/CANAL-agnóstico, disparado por
// POST /internal-cron/omniseller-followup (mismo patrón serverless que ya
// usa el resto de tareas programadas, ver routes/internalCron.ts) — NUNCA
// por un cron.schedule() residente en el proceso. No modifica ni depende de
// autopilotScheduler.ts/autopilotEngine.ts (Autopilot de clientes queda
// intacto).
//
// Seguro ante ejecuciones concurrentes (dos ticks a la vez, o un tick que se
// solapa con el siguiente): la reclamación de cada fila es una ÚNICA UPDATE
// condicional (WHERE id=... AND status IN (...) AND next_run_at <= now()),
// NUNCA un SELECT seguido de un INSERT/UPDATE incondicional (el patrón que
// SÍ tiene una ventana de carrera real en autopilotEngine.runAutopilotTask,
// ver auditoría de Fase 6) — si dos ticks compiten por la misma fila, la
// UPDATE de uno de los dos afecta 0 filas y ese tick simplemente pasa a la
// siguiente candidata.
import cron from "node-cron";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import {
  db, appointmentsTable, leadMessagesTable, outreachEventsTable, outreachFollowupsTable,
  type OutreachFollowup,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { logAuditSystem } from "../../utils/auditLogger";
import { OUTREACH_MAX_ATTEMPTS, checkContactAndChannel, isCooldownActive, isSuppressed, type OutreachChannel } from "../outreachGuard";
import { sendFollowupMessage } from "../outreachService";
import {
  OUTREACH_FOLLOWUP_AUDIT, FOLLOWUP_COOLDOWN_RECHECK_MS, FOLLOWUP_SEND_RETRY_MS,
  cancelFollowupSequence, createNextAttempt, isFollowupKillSwitchActive, loadAnchorMessage, prepareFollowupMessage,
} from "./followupService";

const TICK_BATCH_LIMIT = 25;
// Estados desde los que una fila es reclamable por el tick: "scheduled"
// (primera vez o reprogramada tras un retry) y "skipped" (cooldown/kill
// switch de envío pausados — no consumen intento, ver comentario de
// cabecera de lib/db/src/schema/outreachFollowups.ts).
const CLAIMABLE_STATUSES = ["scheduled", "skipped"] as const;

export interface FollowupTickResult { candidates: number; claimed: number; }

export async function runFollowupTick(): Promise<FollowupTickResult> {
  const now = new Date();
  const candidates = await db.select({ id: outreachFollowupsTable.id, orgId: outreachFollowupsTable.orgId })
    .from(outreachFollowupsTable)
    .where(and(inArray(outreachFollowupsTable.status, CLAIMABLE_STATUSES), lte(outreachFollowupsTable.nextRunAt, now)))
    .orderBy(outreachFollowupsTable.nextRunAt)
    .limit(TICK_BATCH_LIMIT);

  let claimed = 0;
  for (const candidate of candidates) {
    // Punto 15 — kill switch de Follow-up, comprobado ANTES de tocar la
    // fila. Si está desactivado para esta organización: no se reclama, no
    // se ejecuta, no se altera nada — se pasa a la siguiente candidata.
    if (await isFollowupKillSwitchActive(candidate.orgId)) continue;

    const row = await claimFollowup(candidate.id);
    if (!row) continue; // otro tick ya la reclamó entre la consulta y aquí

    claimed++;
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.due, { attempt: row.attempt });
    await processClaimedFollowup(row).catch(async (err) => {
      await finalizeRow(row.id, { status: "blocked", reason: `internal_error:${err instanceof Error ? err.message : String(err)}` });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { error: String(err) });
    });
  }

  return { candidates: candidates.length, claimed };
}

async function claimFollowup(id: number): Promise<OutreachFollowup | null> {
  const [row] = await db.update(outreachFollowupsTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(and(
      eq(outreachFollowupsTable.id, id),
      inArray(outreachFollowupsTable.status, CLAIMABLE_STATUSES),
      lte(outreachFollowupsTable.nextRunAt, new Date()),
    ))
    .returning();
  return row ?? null;
}

async function processClaimedFollowup(row: OutreachFollowup): Promise<void> {
  const anchor = await loadAnchorMessage(row.orgId, row.leadMessageId);
  if (!anchor || !anchor.contactId) {
    await finalizeRow(row.id, { status: "blocked", reason: "anchor_not_found" });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { reason: "anchor_not_found" });
    return;
  }

  // Punto 12 — la respuesta del contacto tiene PRIORIDAD sobre el reloj.
  if (await hasContactReplied(row.orgId, row.leadContactId, row.channel, anchor.sentAt ?? row.createdAt)) {
    // cancelFollowupSequence solo apunta a filas scheduled/skipped — ESTA
    // fila ya está en "processing" (reclamada más arriba), así que necesita
    // su propio finalizeRow además de cancelar cualquier OTRA fila pendiente
    // de la misma secuencia.
    await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: "contact_replied" });
    await finalizeRow(row.id, { status: "cancelled", reason: "contact_replied" });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.cancelled, { reason: "contact_replied" });
    return;
  }

  // Contacto/canal — mismo guard que Fase 4 usa para crear el draft.
  const channelCheck = await checkContactAndChannel(row.orgId, anchor.resultId, row.leadContactId, row.channel);
  if (!channelCheck.ok) {
    await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: channelCheck.reason });
    await finalizeRow(row.id, { status: "blocked", reason: channelCheck.reason });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { reason: channelCheck.reason });
    return;
  }

  // Punto 10/13 — comprobación temprana de suppression (bounce/complaint/
  // opt-out ya los escribe Fase 5 aquí mismo; la protección REAL y
  // obligatoria sigue siendo executeSend() dentro de sendFollowupMessage).
  if (await isSuppressed(row.orgId, row.channel as OutreachChannel, channelCheck.destination)) {
    await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: "suppressed" });
    await finalizeRow(row.id, { status: "cancelled", reason: "suppressed" });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.cancelled, { reason: "suppressed" });
    return;
  }

  // Punto 11 — cooldown temprano (outreachGuard.isCooldownActive, sin
  // segunda tabla de cooldown). NO consume un intento: se reprograma la
  // MISMA fila poco después.
  if (await isCooldownActive(row.orgId, row.leadContactId, row.channel, row.generatedLeadMessageId ?? -1)) {
    await finalizeRow(row.id, { status: "skipped", reason: "cooldown_active", nextRunAt: addMs(new Date(), FOLLOWUP_COOLDOWN_RECHECK_MS) });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.skipped, { reason: "cooldown_active" });
    return;
  }

  // OmniSeller Fase 9 — appointment guard. Se ejecuta DESPUÉS de
  // suppression/cooldown y ANTES de crear/reenviar el lead_message del
  // intento (es decir, antes de que sendFollowupMessage pueda reservar
  // ningún crédito) — mismo criterio que el resto de guards tempranos de
  // esta función. Si el contacto ya tiene una reserva "realizada" (ver
  // hasActiveBooking), se cancela la secuencia completa igual que ante una
  // respuesta del contacto (cancelFollowupSequence + finalizeRow de ESTA
  // fila, ya en "processing") — reutiliza el mismo estado "cancelled" y la
  // misma acción de auditoría que ya existían, sin nueva taxonomía.
  if (await hasActiveBooking(row.orgId, row.leadContactId)) {
    await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: "appointment_booked" });
    await finalizeRow(row.id, { status: "cancelled", reason: "appointment_booked" });
    await audit(row, OUTREACH_FOLLOWUP_AUDIT.cancelled, { reason: "appointment_booked" });
    return;
  }

  // Punto 7 — crear (o reutilizar, si es un retry de un provider_error
  // anterior sobre la MISMA fila) el lead_message de este intento.
  let generatedLeadMessageId = row.generatedLeadMessageId;
  if (!generatedLeadMessageId) {
    const message = await prepareFollowupMessage(anchor, { orgId: row.orgId, channel: row.channel, leadContactId: row.leadContactId }, anchor.approvedBy ?? anchor.createdBy ?? 0);
    generatedLeadMessageId = message.id;
    await db.update(outreachFollowupsTable).set({ generatedLeadMessageId, updatedAt: new Date() }).where(eq(outreachFollowupsTable.id, row.id));
  }

  // Punto 8 — el envío real, íntegro, vive en outreachService.
  const result = await sendFollowupMessage({
    orgId: row.orgId, leadMessageId: generatedLeadMessageId, actingUserId: anchor.approvedBy ?? anchor.createdBy ?? 0,
  });

  // `row` es la fila reclamada ANTES de rellenar generatedLeadMessageId —
  // interpretSendResult necesita el id real (p. ej. para el retry de
  // provider_error, que relee sendAttempts de ESE mensaje).
  await interpretSendResult({ ...row, generatedLeadMessageId }, result);
}

async function interpretSendResult(
  row: OutreachFollowup,
  result: Awaited<ReturnType<typeof sendFollowupMessage>>,
): Promise<void> {
  switch (result.status) {
    case "sent": {
      await finalizeRow(row.id, { status: "sent", reason: null });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.sent, { externalMessageId: result.externalMessageId, creditsSpent: result.creditsSpent });
      // Punto 14 — solo un envío exitoso avanza la secuencia.
      const next = await createNextAttempt({
        orgId: row.orgId, leadMessageId: row.leadMessageId, leadContactId: row.leadContactId,
        missionId: row.missionId, channel: row.channel, completedAttempt: row.attempt,
      });
      if (next) await audit(next, OUTREACH_FOLLOWUP_AUDIT.scheduled, { attempt: next.attempt });
      return;
    }
    case "provider_error": {
      // Punto 4 — retry limitado reutilizando EL MISMO contador
      // (lead_messages.send_attempts / OUTREACH_MAX_ATTEMPTS) que Fase 4 ya
      // usa para el propio mensaje — sin inventar un segundo contador.
      const [msg] = await db.select({ sendAttempts: leadMessagesTable.sendAttempts })
        .from(leadMessagesTable).where(eq(leadMessagesTable.id, row.generatedLeadMessageId!));
      if (msg && msg.sendAttempts < OUTREACH_MAX_ATTEMPTS) {
        await finalizeRow(row.id, { status: "scheduled", reason: `provider_error_retry:${result.detail ?? ""}`, nextRunAt: addMs(new Date(), FOLLOWUP_SEND_RETRY_MS) });
        await audit(row, OUTREACH_FOLLOWUP_AUDIT.scheduled, { reason: "provider_error_retry", detail: result.detail });
      } else {
        await finalizeRow(row.id, { status: "failed", reason: result.detail ?? "provider_error" });
        await audit(row, OUTREACH_FOLLOWUP_AUDIT.failed, { reason: "provider_error_max_attempts", detail: result.detail });
      }
      return;
    }
    case "insufficient_credits":
      // Decisión documentada (informe Fase 6): no se reintenta
      // automáticamente ni se crea el siguiente intento — requiere
      // intervención manual tras recargar créditos, sin lógica de créditos
      // en el Follow-up Engine (punto 9).
      await finalizeRow(row.id, { status: "blocked", reason: "insufficient_credits" });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { reason: "insufficient_credits" });
      return;
    case "blocked_kill_switch":
      // Kill switch de ENVÍO (omni_seller_outreach) — se pausa el intento
      // (no se pierde, no avanza de intento) para reintentarlo cuando se
      // reactive.
      await finalizeRow(row.id, { status: "skipped", reason: "outreach_send_kill_switch_active", nextRunAt: addMs(new Date(), FOLLOWUP_SEND_RETRY_MS) });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.skipped, { reason: "outreach_send_kill_switch_active" });
      return;
    case "blocked_suppressed":
      await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: "suppressed_at_send" });
      await finalizeRow(row.id, { status: "cancelled", reason: "suppressed_at_send" });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.cancelled, { reason: "suppressed_at_send" });
      return;
    case "blocked_cooldown":
      await finalizeRow(row.id, { status: "skipped", reason: "cooldown_active_at_send", nextRunAt: addMs(new Date(), FOLLOWUP_COOLDOWN_RECHECK_MS) });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.skipped, { reason: "cooldown_active_at_send" });
      return;
    case "blocked_contact":
      await cancelFollowupSequence({ orgId: row.orgId, leadMessageId: row.leadMessageId, reason: result.detail ?? "blocked_contact" });
      await finalizeRow(row.id, { status: "blocked", reason: result.detail ?? "blocked_contact" });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { reason: "blocked_contact", detail: result.detail });
      return;
    case "blocked_max_attempts":
      await finalizeRow(row.id, { status: "failed", reason: "max_send_attempts_exceeded" });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.failed, { reason: "max_send_attempts_exceeded" });
      return;
    case "invalid_state":
      await finalizeRow(row.id, { status: "blocked", reason: "invalid_message_state" });
      await audit(row, OUTREACH_FOLLOWUP_AUDIT.blocked, { reason: "invalid_message_state" });
      return;
  }
}

async function finalizeRow(id: number, patch: { status: string; reason: string | null; nextRunAt?: Date }): Promise<void> {
  await db.update(outreachFollowupsTable).set({
    status: patch.status, reason: patch.reason, updatedAt: new Date(),
    ...(patch.nextRunAt ? { nextRunAt: patch.nextRunAt } : {}),
  }).where(eq(outreachFollowupsTable.id, id));
}

async function audit(row: { id: number; orgId: number; leadMessageId: number; attempt: number }, action: string, details: Record<string, unknown>): Promise<void> {
  await logAuditSystem({
    actorClerkId: "system:outreach-followup-tick", action, resource: "outreach_followup", resourceId: row.id, orgId: row.orgId,
    details: { leadMessageId: row.leadMessageId, attempt: row.attempt, ...details },
    severity: action === OUTREACH_FOLLOWUP_AUDIT.failed || action === OUTREACH_FOLLOWUP_AUDIT.blocked ? "warning" : "info",
  }).catch(() => {});
}

/** Punto 12 — ¿hay un whatsapp_inbound/telegram_inbound recibido DESPUÉS de que se originó la secuencia, para este contacto+canal? Reutiliza outreach_events de Fase 5 tal cual, sin tabla nueva. */
async function hasContactReplied(orgId: number, contactId: number, channel: string, sinceDate: Date): Promise<boolean> {
  const [row] = await db.select({ id: outreachEventsTable.id })
    .from(outreachEventsTable)
    .innerJoin(leadMessagesTable, eq(outreachEventsTable.leadMessageId, leadMessagesTable.id))
    .where(and(
      eq(outreachEventsTable.orgId, orgId),
      inArray(outreachEventsTable.eventType, ["whatsapp_inbound", "telegram_inbound"]),
      eq(leadMessagesTable.contactId, contactId),
      eq(leadMessagesTable.channel, channel),
      gt(outreachEventsTable.receivedAt, sinceDate),
    ))
    .limit(1);
  return Boolean(row);
}

function addMs(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

// ═══════════════════════════════════════════════════════════════════════════
// OmniSeller Fase 9 — Appointment guard.
//
// Relación reutilizada (sin tabla ni columna nueva): appointments.leadContactId
// — añadida en Fase 8 para el booking bridge — es EXACTAMENTE el enlace que
// hace falta aquí: cualquier cita (creada desde OmniSeller o, en el futuro,
// enlazada manualmente) que apunte a este lead_contact, en esta orgId.
//
// Semántica de "booking realizado" (documentada también en el informe de
// Fase 9, §3): cuentan "pending", "confirmed" y "completed" — el lead tiene
// una cita en curso o ya la tuvo, así que insistir con más follow-ups no
// tiene sentido en ninguno de los dos casos. NO cuenta "cancelled" (el lead
// no tiene ninguna reserva activa — el follow-up debe poder continuar) ni
// "rescheduled" (es el estado TERMINAL de la fila vieja que una
// reprogramación deja atrás — la fila nueva que la sustituye ya está en
// "pending" y esa es la que hace que la consulta cuente como reservado).
// Un lead con varias citas activas sigue contando como "ya reservó" con la
// primera que exista — LIMIT 1, comportamiento determinista independiente
// de cuántas haya.
const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "completed"] as const;

async function hasActiveBooking(orgId: number, leadContactId: number): Promise<boolean> {
  const [row] = await db.select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.orgId, orgId),
      eq(appointmentsTable.leadContactId, leadContactId),
      inArray(appointmentsTable.status, ACTIVE_BOOKING_STATUSES),
    ))
    .limit(1);
  return Boolean(row);
}

// ═══════════════════════════════════════════════════════════════════════════
// OmniSeller Fase 9 — scheduler real.
//
// La auditoría de Fase 7/8 confirmó que el mecanismo operativo REAL de este
// proyecto para tareas periódicas en producción (Render, proceso
// persistente) es node-cron residente dentro del propio proceso —
// exactamente como ya usa autopilotScheduler.ts (cron.schedule("* * * * *",
// runAutopilotTick)) — y que el workflow de GitHub Actions
// (.github/workflows/scheduled-tasks.yml) está desactivado y ni siquiera
// tiene un job para omniseller-followup.
//
// Se reutiliza ESE MISMO mecanismo (node-cron dentro del proceso residente),
// con su PROPIO registro — nunca se llama a runAutopilotTick ni se toca
// autopilotScheduler.ts: la lógica de OmniSeller sigue siendo independiente
// del CRM Autopilot, solo se comparte la infraestructura de scheduling ya
// residente. No se crea ningún cron externo nuevo (ni GitHub Actions, ni
// otro proceso) — ver informe Fase 9 §5.
//
// La ruta HTTP /internal/cron/omniseller-followup (Fase 6) NO se elimina:
// sigue disponible para un disparo manual/externo si algún día hiciera
// falta, pero deja de ser el único mecanismo — el disparo real y periódico
// en producción pasa a ser este scheduler residente.
let followupSchedulerStarted = false;

export function startFollowupScheduler(): void {
  if (followupSchedulerStarted) return;
  followupSchedulerStarted = true;

  // Cadencia real de los follow-ups es en DÍAS — cinco minutos es más que
  // suficiente para que ningún "due" espere de más, sin generar carga
  // innecesaria (misma granularidad que el resto de tareas periódicas del
  // proyecto — ver comentario de scheduled-tasks.yml sobre la frecuencia de
  // autopilot). El callback es async y PROPAGA la promesa de runFollowupTick
  // — node-cron no necesita esto, pero permite que un test invoque el
  // callback registrado y espere (await) a que el tick termine de verdad,
  // en vez de depender de un timeout arbitrario.
  cron.schedule("*/5 * * * *", async () => {
    try {
      await runFollowupTick();
    } catch (err) {
      logger.error({ err }, "[OmniSeller Followup] scheduler tick error");
    }
  });

  logger.info("[OmniSeller Followup] scheduler started (every 5 min, resident process)");
}
