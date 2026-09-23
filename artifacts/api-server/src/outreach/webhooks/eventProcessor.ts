// OmniSeller Fase 5 — Event Processor.
//
// Núcleo PROVIDER-AGNÓSTICO de procesamiento de eventos entrantes de
// Outreach (delivery status + inbound). Las rutas de webhook (resendWebhook.ts,
// y las ramas aditivas en routes/whatsapp.ts / routes/telegram.ts) se
// encargan SOLO de verificar la autenticidad del webhook y normalizar el
// payload crudo del proveedor a la forma de aquí — todo lo demás
// (idempotencia, resolución de organización, tracking, suppression
// automática, audit, kill switch) vive en este único módulo, sin
// duplicarlo por proveedor.
//
// Responsabilidades explícitas (Paso 4): 1) idempotencia; 2) resolver
// organización; 3) localizar lead_message; 4) actualizar tracking; 5)
// aplicar suppression si corresponde; 6) registrar audit; 7) marcar el
// evento como processed/ignored/error.
//
// Explícitamente NO hace (Paso 4): no envía mensajes, no ejecuta IA, no
// ejecuta follow-up, no reserva OmniCredits, no llama a
// IntegrationManager.send(). Un webhook de entrega no es una acción nueva
// pagada — ver razonamiento en la auditoría de Fase 5, punto "OmniCredits".
import { and, eq, inArray } from "drizzle-orm";
import {
  db, leadMessagesTable, leadContactsTable, outreachSuppressionsTable, outreachEventsTable,
} from "@workspace/db";
import { isModuleEnabled } from "../../middlewares/requireModule";
import { logAuditSystem } from "../../utils/auditLogger";
import type { OutreachChannel } from "../outreachGuard";

// Kill switch de WEBHOOKS de Outreach — slug propio, DISTINTO del kill
// switch de ENVÍO (omni_seller_outreach, outreachService.ts). Apagar este no
// borra nada: el webhook se acepta técnicamente (200, para que el proveedor
// no lo reintente en bucle) pero no se aplican sus efectos (tracking/
// suppression) — Paso 15. A diferencia del kill switch de envío (que falla
// CERRADO porque un envío real es irreversible), aquí se reutiliza
// isModuleEnabled() TAL CUAL, con su comportamiento por defecto (fail-open:
// "sin fila = habilitado", y sigue habilitado si hay un error de caché/DB)
// — procesar un evento de tracking no es una acción irreversible hacia un
// tercero, así que no hay la misma razón para invertir esa semántica.
export const OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG = "omni_seller_webhooks";

export interface NormalizedOutreachEvent {
  provider:        OutreachChannel;
  externalEventId: string;
  eventType:       string;
  rawPayload:      unknown;
  /** Cómo se correlaciona este evento con un lead_message/organización — nunca se acepta un org_id que venga del propio proveedor (Paso 17). */
  correlate:
    | { by: "external_message_id"; externalMessageId: string }
    | { by: "resolved"; orgId: number; contactId: number; leadMessageId?: number };
}

export type ProcessOutreachEventResult =
  | { outcome: "processed"; leadMessageId: number | null; orgId: number }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "error"; reason: string };

interface ResolvedTarget {
  orgId:         number;
  leadMessageId: number | null;
  contactId:     number | null;
}

async function resolveTarget(evt: NormalizedOutreachEvent): Promise<ResolvedTarget | null> {
  if (evt.correlate.by === "external_message_id") {
    // Paso 7/17 — la organización se deriva EXCLUSIVAMENTE de nuestra propia
    // fila lead_messages, nunca de nada que el proveedor pudiera incluir en
    // el payload del webhook.
    const [msg] = await db
      .select({ id: leadMessagesTable.id, orgId: leadMessagesTable.orgId, contactId: leadMessagesTable.contactId })
      .from(leadMessagesTable)
      .where(and(eq(leadMessagesTable.provider, evt.provider), eq(leadMessagesTable.externalMessageId, evt.correlate.externalMessageId)));
    if (!msg) return null;
    return { orgId: msg.orgId, leadMessageId: msg.id, contactId: msg.contactId };
  }

  // "resolved" — la ruta (whatsapp.ts/telegram.ts) ya determinó org+contacto
  // de forma inequívoca (phone_number_id / secreto de webhook, ambos
  // mecanismos ya existentes y propios de cada proveedor). Se revalida aquí
  // que el contacto realmente pertenece a esa organización antes de aplicar
  // ningún efecto — defensa en profundidad contra cross-tenant.
  const [contact] = await db
    .select({ id: leadContactsTable.id })
    .from(leadContactsTable)
    .where(and(eq(leadContactsTable.id, evt.correlate.contactId), eq(leadContactsTable.orgId, evt.correlate.orgId)));
  if (!contact) return null;
  return { orgId: evt.correlate.orgId, leadMessageId: evt.correlate.leadMessageId ?? null, contactId: contact.id };
}

async function markEvent(id: number, status: "processed" | "error" | "ignored", errorMessage?: string, patch?: { orgId?: number; leadMessageId?: number | null }) {
  await db.update(outreachEventsTable).set({
    status, errorMessage: errorMessage ?? null, processedAt: new Date(),
    ...(patch?.orgId !== undefined ? { orgId: patch.orgId } : {}),
    ...(patch?.leadMessageId !== undefined ? { leadMessageId: patch.leadMessageId } : {}),
  }).where(eq(outreachEventsTable.id, id));
}

/** Punto 5 de la checklist — bounce/complaint/opt_out automáticos, idempotentes contra reintentos del MISMO evento. */
async function ensureSuppression(orgId: number, opts: { email?: string | null; phone?: string | null; channel: OutreachChannel; reason: string }) {
  const destinationCol = opts.email ? outreachSuppressionsTable.email : outreachSuppressionsTable.phone;
  const destinationVal = opts.email ?? opts.phone;
  if (!destinationVal) return;

  const [existing] = await db.select({ id: outreachSuppressionsTable.id }).from(outreachSuppressionsTable).where(and(
    eq(outreachSuppressionsTable.orgId, orgId),
    eq(destinationCol, destinationVal),
    eq(outreachSuppressionsTable.channel, opts.channel),
    eq(outreachSuppressionsTable.reason, opts.reason),
    eq(outreachSuppressionsTable.source, "provider_webhook"),
  ));
  if (existing) return; // ya se registró esta MISMA supresión — no duplicar (idempotencia de efectos, no solo del evento)

  await db.insert(outreachSuppressionsTable).values({
    orgId, email: opts.email ?? null, phone: opts.phone ?? null, channel: opts.channel, reason: opts.reason, source: "provider_webhook",
  });
}

/** Tracking secundario en lead_messages — nunca toca el status principal (Paso 3/8). */
async function applyTracking(leadMessageId: number, orgId: number, eventType: string, occurredAt: Date) {
  const patch: Partial<typeof leadMessagesTable.$inferInsert> = { lastEventAt: occurredAt, deliveryStatus: eventType, updatedAt: new Date() };
  if (eventType === "delivered")  patch.deliveredAt = occurredAt;
  if (eventType === "bounced")    patch.bouncedAt   = occurredAt;
  if (eventType === "opened")     patch.openedAt    = occurredAt;
  if (eventType === "clicked")    patch.clickedAt   = occurredAt;
  await db.update(leadMessagesTable).set(patch).where(and(eq(leadMessagesTable.id, leadMessageId), eq(leadMessagesTable.orgId, orgId)));
}

const AUDIT_ACTION_BY_EVENT: Record<string, string> = {
  delivered:            "outreach.delivery_updated",
  bounced:               "outreach.bounce_detected",
  complained:             "outreach.complaint_detected",
  opened:                "outreach.delivery_updated",
  clicked:               "outreach.delivery_updated",
  whatsapp_status_sent:      "outreach.delivery_updated",
  whatsapp_status_delivered: "outreach.delivery_updated",
  whatsapp_status_read:      "outreach.delivery_updated",
  whatsapp_status_failed:    "outreach.delivery_updated",
  opt_out_detected:      "outreach.opt_out_detected",
  whatsapp_inbound:      "outreach.inbound_received",
  telegram_inbound:      "outreach.inbound_received",
};

export async function processOutreachEvent(evt: NormalizedOutreachEvent): Promise<ProcessOutreachEventResult> {
  // 1. Idempotencia + RECLAMACIÓN ATÓMICA de la fila de outreach_events.
  //
  // Fase 10 (auditoría de concurrencia) — versión anterior: se insertaba
  // con status "received" y, ante conflicto, se leía el status con un
  // SELECT separado para decidir "duplicado real" vs "reintento legítimo".
  // Eso dejaba una ventana real: dos entregas SIMULTÁNEAS del mismo evento
  // (reintento real de un proveedor, o el mismo payload firmado reenviado en
  // paralelo) podían pasar AMBAS el chequeo "no está processed todavía" y
  // reprocesar la fila a la vez — duplicando efectos no idempotentes por sí
  // mismos (audit log, y sobre todo ensureSuppression, que hace su propio
  // SELECT-then-INSERT sin constraint único).
  //
  // Arreglo: se inserta directamente como "processing" — una fila que se
  // acaba de INSERTAR es, por construcción, una reclamación exclusiva
  // (nadie más pudo haber insertado la misma clave única a la vez). Si ya
  // existe: "processed" → duplicado real; "processing" → OTRA petición la
  // está procesando AHORA MISMO → duplicado (nunca se reprocesa en
  // paralelo); "received" (filas de antes de este cambio) o "error" → se
  // reclama con una UPDATE condicional — la MISMA primitiva de reclamación
  // atómica que ya usa followupEngine.claimFollowup (Fase 6/9), nunca un
  // SELECT-then-UPDATE incondicional.
  const [inserted] = await db.insert(outreachEventsTable).values({
    provider: evt.provider, externalEventId: evt.externalEventId, eventType: evt.eventType,
    rawPayload: evt.rawPayload as object, status: "processing",
  }).onConflictDoNothing({ target: [outreachEventsTable.provider, outreachEventsTable.externalEventId] }).returning();

  let eventRow = inserted;
  if (!eventRow) {
    const [existing] = await db.select().from(outreachEventsTable).where(and(
      eq(outreachEventsTable.provider, evt.provider), eq(outreachEventsTable.externalEventId, evt.externalEventId),
    ));
    if (!existing) return { outcome: "error", reason: "conflicto de idempotencia sin fila existente (inesperado)" };
    if (existing.status === "processed") return { outcome: "duplicate" };
    if (existing.status === "processing") return { outcome: "duplicate" }; // otra entrega concurrente ya la está procesando

    const [claimed] = await db.update(outreachEventsTable)
      .set({ status: "processing" })
      .where(and(
        eq(outreachEventsTable.id, existing.id),
        inArray(outreachEventsTable.status, ["received", "error"]),
      ))
      .returning();
    if (!claimed) return { outcome: "duplicate" }; // otra petición ganó la reclamación entre el SELECT y el UPDATE
    eventRow = claimed;
  }

  let resolvedOrgId: number | null = null;
  try {
    // 2. Resolver organización + lead_message (nunca desde el payload).
    const target = await resolveTarget(evt);
    if (!target) {
      await markEvent(eventRow.id, "ignored", "No se pudo correlacionar con ningún lead_message/lead_contact de esta plataforma");
      return { outcome: "ignored", reason: "no_correlation" };
    }
    resolvedOrgId = target.orgId;

    // 3. Kill switch de webhooks (Paso 15) — se acepta el evento (ya
    // insertado arriba, así el proveedor no lo reintenta en bucle) pero no
    // se aplican sus efectos.
    const webhooksEnabled = await isModuleEnabled(target.orgId, OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG);
    if (!webhooksEnabled) {
      await markEvent(eventRow.id, "ignored", "omni_seller_webhooks desactivado para esta organización", { orgId: target.orgId, leadMessageId: target.leadMessageId });
      await logAuditSystem({
        actorClerkId: `system:outreach-webhook:${evt.provider}`, action: "outreach.webhook_blocked",
        resource: "outreach_event", resourceId: eventRow.id, orgId: target.orgId,
        details: { provider: evt.provider, eventType: evt.eventType, leadMessageId: target.leadMessageId },
        severity: "warning",
      });
      return { outcome: "ignored", reason: "kill_switch" };
    }

    // 4. Tracking + suppression según el tipo de evento.
    const occurredAt = new Date();
    if (target.leadMessageId) {
      await applyTracking(target.leadMessageId, target.orgId, evt.eventType, occurredAt);
    }

    if (evt.eventType === "bounced" || evt.eventType === "complained" || evt.eventType === "opt_out_detected") {
      let contact: { email: string | null; phone: string | null } | undefined;
      if (target.contactId) {
        [contact] = await db.select({ email: leadContactsTable.email, phone: leadContactsTable.phone })
          .from(leadContactsTable).where(eq(leadContactsTable.id, target.contactId));
      }
      const reason = evt.eventType === "bounced" ? "bounced" : evt.eventType === "complained" ? "complaint" : "opt_out";
      if (contact && (contact.email || contact.phone)) {
        await ensureSuppression(target.orgId, {
          email: evt.provider === "email" ? contact.email : null,
          phone: evt.provider !== "email" ? contact.phone : null,
          channel: evt.provider, reason,
        });
      }
    }

    // 5. Audit (taxonomía existente, sin cambios de esquema).
    await logAuditSystem({
      actorClerkId: `system:outreach-webhook:${evt.provider}`,
      action: AUDIT_ACTION_BY_EVENT[evt.eventType] ?? "outreach.delivery_updated",
      resource: "lead_message", resourceId: target.leadMessageId ?? target.contactId ?? eventRow.id,
      orgId: target.orgId,
      details: { provider: evt.provider, eventType: evt.eventType, leadMessageId: target.leadMessageId, contactId: target.contactId },
      severity: "info",
    });

    // 6. Marcar processed.
    await markEvent(eventRow.id, "processed", undefined, { orgId: target.orgId, leadMessageId: target.leadMessageId });
    return { outcome: "processed", leadMessageId: target.leadMessageId, orgId: target.orgId };
  } catch (err) {
    // Paso 19/13 — si algo falla a mitad de camino, la fila queda en
    // "error" (NO "processed"): un reintento del proveedor con el MISMO
    // external_event_id volverá a entrar aquí y reintentará el resto del
    // procesamiento sobre esta misma fila, en vez de perderse silenciosamente.
    const reason = err instanceof Error ? err.message : String(err);
    await markEvent(eventRow.id, "error", reason).catch(() => {});
    await logAuditSystem({
      actorClerkId: `system:outreach-webhook:${evt.provider}`, action: "outreach.provider_error",
      resource: "outreach_event", resourceId: eventRow.id,
      ...(resolvedOrgId !== null ? { orgId: resolvedOrgId } : {}),
      details: { provider: evt.provider, eventType: evt.eventType, error: reason },
      severity: "critical",
    }).catch(() => {});
    return { outcome: "error", reason };
  }
}
