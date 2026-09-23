// OmniSeller Fase 4 — Outreach Service.
//
// Orquesta: draft → pending_confirmation → (confirmación humana) → sending
// → sent/failed, con OmniCredits reserve→envío→settle / error→releaseHold,
// kill switch, suppression, cooldown y auditoría. El envío real pasa por
// IntegrationManager.send() (Hub — Resend/WhatsApp Cloud API/Telegram, ya
// existentes) — este archivo NUNCA habla con un proveedor directamente, ni
// inventa un adaptador nuevo: reutiliza tal cual el mismo mecanismo que ya
// usa Autopilot para email/WhatsApp/Telegram salientes.
import { and, eq, lt, or } from "drizzle-orm";
import { db, leadMessagesTable, missionsTable } from "@workspace/db";
import { IntegrationManager } from "../hub";
import { isModuleEnabled } from "../middlewares/requireModule";
import { reserveCredits, settleCredits, releaseHold, InsufficientCreditsError } from "../credits/creditService";
import { dbConfirmationStore, type ConfirmationStore } from "./confirmationStore";
import {
  checkContactAndChannel, isSuppressed, isCooldownActive, exceedsMaxAttempts, OUTREACH_MAX_ATTEMPTS, type OutreachChannel,
} from "./outreachGuard";

// Coste PROVISIONAL en créditos de un envío de Outreach — igual de
// provisional que SEARCH_CREDIT_COST/RESEARCH_CREDIT_COST en fases
// anteriores; el pricing definitivo es trabajo de Fase 9.
export const OUTREACH_SEND_CREDIT_COST = 1;

// Slug de module_configs reutilizado como KILL SWITCH de Outreach — mismo
// mecanismo exacto que ya gobierna omni_seller/omni_leads (isModuleEnabled,
// caché de 2 min, "sin fila = habilitado"), pero comprobado aquí en línea
// (no como middleware de todo el router): apagar esto NO debe bloquear
// crear drafts, pedir Contact Finder ni ver misiones — solo el envío real.
// A diferencia de requireModule() (que falla ABIERTO ante un error de caché/
// DB porque bloquear toda la app por un fallo transitorio sería peor), aquí
// se falla CERRADO deliberadamente: un envío real e irreversible a un
// tercero es justo el tipo de acción que no debe proceder ante un estado
// ambiguo.
export const OUTREACH_KILL_SWITCH_SLUG = "omni_seller_outreach";

async function isOutreachKillSwitchActive(orgId: number): Promise<boolean> {
  try {
    return !(await isModuleEnabled(orgId, OUTREACH_KILL_SWITCH_SLUG));
  } catch {
    return true; // fail closed — ver comentario de arriba
  }
}

export type OutreachSendStatus =
  | "sent" | "blocked_kill_switch" | "blocked_suppressed" | "blocked_cooldown"
  | "blocked_contact" | "blocked_max_attempts" | "insufficient_credits" | "provider_error";

export interface OutreachSendResult {
  status: OutreachSendStatus;
  detail?: string;
  externalMessageId?: string;
  creditsSpent?: number;
}

interface LeadMessageRow {
  id: number; orgId: number; resultId: number; contactId: number | null; channel: string; content: string;
  status: string; sendAttempts: number;
}

/** Punto 10 — confirmación humana + puntos 3-9 + 12 — envío real. Todo en una sola operación atómica por mensaje. */
export async function confirmAndSendMessage(opts: {
  orgId: number;
  confirmToken: string;
  consumedBy: number;
  leadMessageId: number;
  store?: ConfirmationStore;
}): Promise<OutreachSendResult | { status: "invalid_confirmation" }> {
  const store = opts.store ?? dbConfirmationStore;

  // Punto 10 — confirmación humana: atómica, de un solo uso, ligada a esta
  // org y a este mensaje concreto. Nunca se acepta contenido del body en
  // esta llamada — todo lo que se envía se relee de la fila ya existente.
  const consumed = await store.consume(opts.confirmToken, { orgId: opts.orgId, leadMessageId: opts.leadMessageId }, opts.consumedBy);
  if (!consumed) return { status: "invalid_confirmation" };

  // Transición atómica de estado — segunda defensa contra doble ejecución
  // concurrente (además del propio token de un solo uso): si dos peticiones
  // válidas llegaran a coexistir, solo una gana este UPDATE condicional.
  const [claimed] = await db.update(leadMessagesTable)
    .set({ status: "sending", sendAttemptedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(leadMessagesTable.id, opts.leadMessageId), eq(leadMessagesTable.orgId, opts.orgId),
      eq(leadMessagesTable.status, "pending_confirmation"),
    ))
    .returning();
  if (!claimed) return { status: "invalid_confirmation" };

  const message = claimed as unknown as LeadMessageRow;
  const result = await executeSend(message, opts.consumedBy);

  // OmniSeller Fase 6 — discrepancia encontrada y corregida (documentada en
  // el informe final): esta UPDATE nunca rellenaba `sent_at` en un envío
  // correcto — quedaba NULL para siempre incluso con status="sent". No lo
  // leía ningún llamador existente de Fase 1-4 (comprobado con grep antes
  // de este cambio), así que no cambia ningún comportamiento previo; pero
  // el Follow-up Engine SÍ necesita saber CUÁNDO se envió el mensaje ancla
  // para calcular la cadencia (punto 5 del mandato) — sin este fix, siempre
  // habría caído al fallback "ahora" (ver followupService.scheduleFollowupSequence),
  // que fecha la cadencia desde el momento de ACTIVAR la secuencia en vez
  // de desde el envío real.
  await db.update(leadMessagesTable).set({
    status: result.status === "sent" ? "sent"
      : result.status === "provider_error" || result.status === "insufficient_credits" ? "failed"
      : "blocked",
    approvedBy: opts.consumedBy,
    approvedAt: new Date(),
    ...(result.status === "sent" ? { sentAt: new Date() } : {}),
    externalMessageId: result.externalMessageId ?? null,
    errorMessage: result.detail ?? null,
    creditsSpent: result.creditsSpent ?? null,
    sendAttempts: result.status === "provider_error" ? message.sendAttempts + 1 : message.sendAttempts,
    updatedAt: new Date(),
  }).where(and(eq(leadMessagesTable.id, message.id), eq(leadMessagesTable.orgId, message.orgId)));

  return result;
}

// OmniSeller Fase 6 — Follow-up Engine: envío SIN confirmación humana por
// mensaje (el modelo aprobado, B, aprueba la SECUENCIA una sola vez — ver
// followup/followupService.ts — nunca cada intento individual). Reutiliza
// exactamente executeSend() (mismas comprobaciones, mismo reserve→send→settle,
// nunca un camino directo a IntegrationManager) — la ÚNICA diferencia con
// confirmAndSendMessage es la fuente de la reclamación atómica: en vez de
// consumir un token de outreach_confirmations, reclama el propio
// lead_message por estado, con dos puntos de entrada posibles:
//   - "draft"                          → primer intento de envío de este mensaje.
//   - "failed" con sendAttempts < OUTREACH_MAX_ATTEMPTS → reintento de un
//     fallo de proveedor anterior sobre el MISMO mensaje (punto 4 del
//     mandato: "el retry debe volver a utilizar el mismo flujo Outreach
//     existente" — se reutiliza tal cual el contador sendAttempts y el
//     límite OUTREACH_MAX_ATTEMPTS ya existentes de Fase 4, sin inventar un
//     segundo contador ni un sistema de retry paralelo).
// NO se usa confirmationStore aquí a propósito: ese mecanismo es
// específicamente para confirmación humana POR MENSAJE (modelo A/C), que
// el modelo B aprobado para Fase 6 no requiere — está documentado como
// decisión explícita, no como una omisión accidental del punto 17/6 del
// mandato ("integración con confirmación existente").
export async function sendFollowupMessage(opts: {
  orgId: number; leadMessageId: number; actingUserId: number;
}): Promise<OutreachSendResult | { status: "invalid_state" }> {
  const [claimed] = await db.update(leadMessagesTable)
    .set({ status: "sending", sendAttemptedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(leadMessagesTable.id, opts.leadMessageId), eq(leadMessagesTable.orgId, opts.orgId),
      or(
        eq(leadMessagesTable.status, "draft"),
        and(eq(leadMessagesTable.status, "failed"), lt(leadMessagesTable.sendAttempts, OUTREACH_MAX_ATTEMPTS)),
      ),
    ))
    .returning();
  if (!claimed) return { status: "invalid_state" };

  const message = claimed as unknown as LeadMessageRow;
  const result = await executeSend(message, opts.actingUserId);

  await db.update(leadMessagesTable).set({
    status: result.status === "sent" ? "sent"
      : result.status === "provider_error" || result.status === "insufficient_credits" ? "failed"
      : "blocked",
    approvedBy: opts.actingUserId,
    approvedAt: new Date(),
    ...(result.status === "sent" ? { sentAt: new Date() } : {}),
    externalMessageId: result.externalMessageId ?? null,
    errorMessage: "detail" in result ? (result.detail ?? null) : null,
    creditsSpent: result.creditsSpent ?? null,
    sendAttempts: result.status === "provider_error" ? message.sendAttempts + 1 : message.sendAttempts,
    updatedAt: new Date(),
  }).where(and(eq(leadMessagesTable.id, message.id), eq(leadMessagesTable.orgId, message.orgId)));

  return result;
}

// OmniSeller Fase 6 — exportada tal cual (antes privada de este módulo) para
// que el Follow-up Engine la reutilice EXACTAMENTE, sin duplicar ninguna de
// sus responsabilidades (kill switch de envío, contacto/canal, suppression,
// cooldown, créditos, IntegrationManager.send()) — mandato explícito del
// punto 8 de Fase 6 ("Utilizar: outreachService.executeSend()"). Ningún
// llamador de Fase 4/5 cambia: confirmAndSendMessage sigue siendo el único
// punto de entrada para el flujo con confirmación humana por mensaje; esto
// solo añade visibilidad del símbolo hacia afuera del módulo.
export async function executeSend(message: LeadMessageRow, actingUserId: number): Promise<OutreachSendResult> {
  if (await isOutreachKillSwitchActive(message.orgId)) {
    return { status: "blocked_kill_switch", detail: "El kill switch de Outreach está activo para esta organización" };
  }
  if (!message.contactId) {
    return { status: "blocked_contact", detail: "El mensaje no tiene un contacto asociado" };
  }
  if (exceedsMaxAttempts(message.sendAttempts)) {
    return { status: "blocked_max_attempts", detail: `Se superó el máximo de reintentos (${message.sendAttempts})` };
  }

  const check = await checkContactAndChannel(message.orgId, message.resultId, message.contactId, message.channel);
  if (!check.ok) return { status: "blocked_contact", detail: check.reason };

  if (await isSuppressed(message.orgId, message.channel as OutreachChannel, check.destination)) {
    return { status: "blocked_suppressed", detail: "El destino está en la suppression list" };
  }
  if (await isCooldownActive(message.orgId, message.contactId, message.channel, message.id)) {
    return { status: "blocked_cooldown", detail: "Cooldown activo para este contacto y canal" };
  }

  const reference = `outreach:send:${message.id}`;
  try {
    await reserveCredits({ orgId: message.orgId, credits: OUTREACH_SEND_CREDIT_COST, reference, userClerkId: null });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return { status: "insufficient_credits", detail: "Créditos insuficientes" };
    throw err;
  }

  try {
    const sendResult = await IntegrationManager.send(message.orgId, message.channel, {
      to: check.destination, message: message.content,
      metadata: { subject: "Mensaje de OmniSeller", omniSellerLeadMessageId: message.id },
    });
    if (!sendResult.success) {
      await releaseHold(message.orgId, reference).catch(() => {});
      return { status: "provider_error", detail: sendResult.error ?? "Fallo del proveedor" };
    }
    await settleCredits({
      orgId: message.orgId, reference, credits: OUTREACH_SEND_CREDIT_COST, userClerkId: null,
      metadata: { leadMessageId: message.id, channel: message.channel, actingUserId },
    }).catch(() => {});
    return { status: "sent", externalMessageId: sendResult.providerId, creditsSpent: OUTREACH_SEND_CREDIT_COST };
  } catch (err) {
    await releaseHold(message.orgId, reference).catch(() => {});
    return { status: "provider_error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** La Mission debe existir, ser de esta org y no estar cerrada — mismo criterio que Fase 2/3. */
export async function assertMissionOpen(orgId: number, missionId: number): Promise<{ ok: true } | { ok: false; httpStatus: number; error: string }> {
  // Fase 11 (auditoría — Parte 7, validación de entrada): un missionId no
  // numérico (p. ej. Number("abc") = NaN, típico de un path param mal
  // formado) llegaba tal cual hasta este SELECT y Postgres lo rechazaba con
  // una excepción sin capturar aquí — el caller (missions.ts) la convertía
  // en un 500 que filtraba el texto crudo de la consulta SQL (nombres de
  // columnas/tabla) en el cuerpo de la respuesta. Se rechaza aquí, en el
  // único punto compartido por las 3 rutas de Outreach que llaman a esta
  // función, en vez de repetir el guard en cada una.
  if (!Number.isFinite(missionId)) {
    return { ok: false, httpStatus: 400, error: "missionId inválido" };
  }
  const [mission] = await db.select({ id: missionsTable.id, status: missionsTable.status })
    .from(missionsTable).where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));
  if (!mission) return { ok: false, httpStatus: 404, error: "No encontrada" };
  if (mission.status === "completed" || mission.status === "cancelled") {
    return { ok: false, httpStatus: 409, error: `La misión está en estado "${mission.status}" y no admite Outreach` };
  }
  return { ok: true };
}
