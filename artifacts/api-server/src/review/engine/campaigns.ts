// Campañas: alta/edición (solo en borrador), lanzamiento con todas las comprobaciones previas,
// pausa/reanudación/cancelación, resultados derivados de la BD y registro de envíos.
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, reviewCampaignsTable, reviewLocationsTable, reviewMessagesTable, reviewSettingsTable, reviewTemplatesTable, reviewContactsTable,
  type ReviewCampaign,
} from "@workspace/db";
import { validateAudienceFilter, type AudienceFilter } from "../audience";
import { getProvider, registry, type ProviderRegistry } from "../channels/registry";
import { publicBaseUrl } from "../links";
import { ReviewInputError } from "../locations";
import { enqueueAudience, previewAudience } from "./audience";
import { validHourRange, DEFAULT_SEND_WINDOW } from "./window";

export class CampaignError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422, public readonly detail?: unknown) { super(message); this.name = "CampaignError"; }
}

export interface CampaignInput {
  name?: string; locationId?: number; templateId?: number; channel?: string;
  scheduleAt?: string | null; sendWindow?: unknown; ratePerMinute?: number; maxReminders?: number; reminderAfterDays?: number | null; audienceFilter?: unknown;
}

const bad = (field: string, msg: string) => new ReviewInputError(field, msg);

async function validate(orgId: number, i: CampaignInput, cur?: ReviewCampaign) {
  const name = (i.name ?? cur?.name ?? "").trim();
  if (!name || name.length > 200) throw bad("name", "El nombre es obligatorio (máx. 200).");
  const locationId = i.locationId ?? cur?.locationId;
  const templateId = i.templateId ?? cur?.templateId ?? undefined;
  const channel = i.channel ?? cur?.channel;
  if (!locationId) throw bad("locationId", "Elige un establecimiento.");
  if (channel !== "whatsapp" && channel !== "email") throw bad("channel", "Canal no soportado.");
  const [loc] = await db.select().from(reviewLocationsTable).where(and(eq(reviewLocationsTable.orgId, orgId), eq(reviewLocationsTable.id, locationId), eq(reviewLocationsTable.status, "active")));
  if (!loc) throw new CampaignError("location_not_found", "El establecimiento no existe en este workspace.", 404);
  if (!templateId) throw bad("templateId", "Elige una plantilla.");
  const [tpl] = await db.select().from(reviewTemplatesTable).where(and(eq(reviewTemplatesTable.orgId, orgId), eq(reviewTemplatesTable.id, templateId)));
  if (!tpl) throw new CampaignError("template_not_found", "La plantilla no existe en este workspace.", 404);
  if (tpl.channel !== channel) throw bad("templateId", `La plantilla es de ${tpl.channel} y la campaña de ${channel}.`);
  let audience: AudienceFilter;
  try { audience = validateAudienceFilter(i.audienceFilter ?? cur?.audienceFilter ?? {}); }
  catch (e) { throw bad("audienceFilter", (e as Error).message); }
  if (audience.locationId !== undefined && audience.locationId !== locationId) throw bad("audienceFilter", "El filtro de establecimiento debe coincidir con el de la campaña.");
  const rate = i.ratePerMinute ?? cur?.ratePerMinute ?? 30;
  if (!Number.isInteger(rate) || rate < 1 || rate > 600) throw bad("ratePerMinute", "Entre 1 y 600 mensajes por minuto.");
  const maxReminders = i.maxReminders ?? cur?.maxReminders ?? 0;
  if (maxReminders !== 0 && maxReminders !== 1) throw bad("maxReminders", "Como máximo 1 recordatorio.");
  const remAfter = i.reminderAfterDays !== undefined ? i.reminderAfterDays : cur?.reminderAfterDays ?? null;
  if (maxReminders === 1 && (!Number.isInteger(remAfter) || (remAfter as number) < 3 || (remAfter as number) > 30)) throw bad("reminderAfterDays", "Con recordatorio, indica entre 3 y 30 días de espera.");
  const sendWindow = i.sendWindow !== undefined ? i.sendWindow : cur?.sendWindow ?? DEFAULT_SEND_WINDOW;
  if (!validHourRange(sendWindow)) throw bad("sendWindow", "Ventana horaria inválida (startHour < endHour, 0–24).");
  let scheduleAt: Date | null = cur?.scheduleAt ?? null;
  if (i.scheduleAt !== undefined) {
    if (i.scheduleAt === null) scheduleAt = null;
    else { const d = new Date(i.scheduleAt); if (Number.isNaN(d.getTime())) throw bad("scheduleAt", "Fecha inválida (ISO 8601)."); scheduleAt = d; }
  }
  return { name, locationId, templateId, channel, audience, rate, maxReminders, remAfter: maxReminders === 1 ? (remAfter as number) : null, sendWindow, scheduleAt, loc, tpl };
}

export async function createCampaign(orgId: number, userId: number | null, i: CampaignInput) {
  const v = await validate(orgId, i);
  const [row] = await db.insert(reviewCampaignsTable).values({
    orgId, locationId: v.locationId, templateId: v.templateId, name: v.name, channel: v.channel, scheduleAt: v.scheduleAt, sendWindow: v.sendWindow,
    ratePerMinute: v.rate, maxReminders: v.maxReminders, reminderAfterDays: v.remAfter, audienceFilter: v.audience, createdBy: userId,
  }).returning();
  return row!;
}

export async function getCampaign(orgId: number, id: number): Promise<ReviewCampaign | null> {
  const [r] = await db.select().from(reviewCampaignsTable).where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id)));
  return r ?? null;
}

export async function updateCampaign(orgId: number, id: number, i: CampaignInput) {
  const cur = await getCampaign(orgId, id);
  if (!cur) return null;
  if (cur.status !== "draft") throw new CampaignError("not_editable", "Solo se pueden editar campañas en borrador. Duplícala para cambiarla.", 409);
  const v = await validate(orgId, i, cur);
  const [row] = await db.update(reviewCampaignsTable).set({
    locationId: v.locationId, templateId: v.templateId, name: v.name, channel: v.channel, scheduleAt: v.scheduleAt, sendWindow: v.sendWindow,
    ratePerMinute: v.rate, maxReminders: v.maxReminders, reminderAfterDays: v.remAfter, audienceFilter: v.audience, updatedAt: new Date(),
  }).where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id), eq(reviewCampaignsTable.status, "draft"))).returning();
  if (!row) throw new CampaignError("not_editable", "La campaña ya no está en borrador.", 409);
  return row;
}

export async function duplicateCampaign(orgId: number, id: number, userId: number | null) {
  const c = await getCampaign(orgId, id);
  if (!c) return null;
  const [row] = await db.insert(reviewCampaignsTable).values({
    orgId, locationId: c.locationId, templateId: c.templateId, name: `${c.name} (copia)`.slice(0, 200), channel: c.channel, status: "draft",
    sendWindow: c.sendWindow, ratePerMinute: c.ratePerMinute, maxReminders: c.maxReminders, reminderAfterDays: c.reminderAfterDays, audienceFilter: c.audienceFilter, createdBy: userId,
  }).returning();
  return row!;
}

export async function listCampaigns(orgId: number) {
  const rows = await db.execute(sql`
    SELECT c.*, 
      (SELECT count(*) FROM review_messages m WHERE m.campaign_id = c.id AND m.kind = 'request')::int AS total_messages,
      (SELECT count(*) FROM review_messages m WHERE m.campaign_id = c.id AND m.sent_at IS NOT NULL)::int AS sent
    FROM review_campaigns c WHERE c.org_id = ${orgId}::integer ORDER BY c.id DESC LIMIT 200`);
  return (rows as unknown as { rows: Record<string, unknown>[] }).rows;
}

export async function audiencePreview(orgId: number, id: number) {
  const c = await getCampaign(orgId, id);
  if (!c) return null;
  return previewAudience(orgId, c, (c.audienceFilter ?? {}) as AudienceFilter);
}

// ── Lanzamiento ──────────────────────────────────────────────────────────────
export async function launchCampaign(orgId: number, id: number, opts: { now?: Date; providers?: ProviderRegistry } = {}) {
  const now = opts.now ?? new Date();
  const c = await getCampaign(orgId, id);
  if (!c) return null;
  if (c.status !== "draft") throw new CampaignError("not_draft", `La campaña ya está «${c.status}».`, 409);
  const v = await validate(orgId, {}, c);
  if (!v.loc.googleReviewUrl) throw new CampaignError("location_without_review_link", "El establecimiento no tiene enlace de reseña de Google: añade su Place ID antes de lanzar.");
  if (!publicBaseUrl()) throw new CampaignError("public_url_not_configured", "Falta PUBLIC_URL en el servidor: sin ella no se pueden generar los enlaces de seguimiento y de baja.");
  const provider = getProvider(c.channel, opts.providers ?? registry);
  if (!provider) throw new CampaignError("channel_not_available", `El canal ${c.channel} no está disponible.`);
  const ready = await provider.readiness(orgId, { id: v.tpl.id, subject: v.tpl.subject, body: v.tpl.body, waTemplateName: v.tpl.waTemplateName, waLanguage: v.tpl.waLanguage, waStatus: v.tpl.waStatus });
  if (!ready.ready) throw new CampaignError("channel_not_ready", ready.reason);

  const [settings] = await db.select().from(reviewSettingsTable).where(eq(reviewSettingsTable.orgId, orgId));
  if (settings?.maxActiveCampaigns != null) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewCampaignsTable)
      .where(and(eq(reviewCampaignsTable.orgId, orgId), sql`${reviewCampaignsTable.status} IN ('scheduled','running')`));
    if (n >= settings.maxActiveCampaigns) throw new CampaignError("campaign_limit_exceeded", `Límite de campañas activas alcanzado (${settings.maxActiveCampaigns}).`);
  }
  const preview = await previewAudience(orgId, c, v.audience);
  if (preview.eligible === 0) throw new CampaignError("empty_audience", "No hay ningún contacto elegible con esos criterios.", 422, preview);
  if (settings?.monthlyMessageLimit != null) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewMessagesTable)
      .where(and(eq(reviewMessagesTable.orgId, orgId), sql`(${reviewMessagesTable.sentAt} >= ${monthStart.toISOString()}::timestamp OR ${reviewMessagesTable.status} IN ('queued','sending'))`));
    if (n + preview.eligible > settings.monthlyMessageLimit)
      throw new CampaignError("message_limit_exceeded", `Superaría el límite mensual de mensajes (${settings.monthlyMessageLimit}). Usados o en cola: ${n}, de esta campaña: ${preview.eligible}.`);
  }

  const future = v.scheduleAt && v.scheduleAt.getTime() > now.getTime() + 60_000;
  const runAt = future ? v.scheduleAt! : now;
  return db.transaction(async (tx) => {
    // Cambio de estado condicional: dos lanzamientos simultáneos no encolan dos veces.
    const [claimed] = await tx.update(reviewCampaignsTable).set({ status: future ? "scheduled" : "running", updatedAt: new Date() })
      .where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id), eq(reviewCampaignsTable.status, "draft"))).returning({ id: reviewCampaignsTable.id });
    if (!claimed) throw new CampaignError("not_draft", "La campaña ya fue lanzada.", 409);
    const enqueued = await enqueueAudience(tx, orgId, c, v.audience, runAt);
    return { campaignId: id, status: future ? "scheduled" : "running", enqueued, preview };
  });
}

// ── Pausa / reanudación / cancelación ────────────────────────────────────────
export async function pauseCampaign(orgId: number, id: number) {
  const [r] = await db.update(reviewCampaignsTable).set({ status: "paused", updatedAt: new Date() })
    .where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id), sql`${reviewCampaignsTable.status} IN ('scheduled','running')`)).returning();
  return r ?? null;
}
export async function resumeCampaign(orgId: number, id: number) {
  const [r] = await db.update(reviewCampaignsTable).set({ status: "running", updatedAt: new Date() })
    .where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id), eq(reviewCampaignsTable.status, "paused"))).returning();
  return r ?? null;
}
export async function cancelCampaign(orgId: number, id: number) {
  return db.transaction(async (tx) => {
    const [r] = await tx.update(reviewCampaignsTable).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(reviewCampaignsTable.orgId, orgId), eq(reviewCampaignsTable.id, id), sql`${reviewCampaignsTable.status} IN ('draft','scheduled','running','paused')`)).returning();
    if (!r) return null;
    await tx.update(reviewMessagesTable).set({ status: "skipped", skipReason: "campaign_cancelled", updatedAt: new Date() })
      .where(and(eq(reviewMessagesTable.orgId, orgId), eq(reviewMessagesTable.campaignId, id), eq(reviewMessagesTable.status, "queued")));
    return r;
  });
}

// ── Resultados (derivados; nada estimado) ────────────────────────────────────
export async function campaignResults(orgId: number, id: number) {
  const c = await getCampaign(orgId, id);
  if (!c) return null;
  const rows = (r: unknown) => (r as { rows: Record<string, string>[] }).rows;
  const [t] = rows(await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE kind = 'request') AS requests,
      count(*) FILTER (WHERE kind = 'reminder') AS reminders,
      count(*) FILTER (WHERE status = 'queued') AS queued,
      count(*) FILTER (WHERE status = 'sending') AS sending,
      count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
      count(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
      count(*) FILTER (WHERE read_at IS NOT NULL) AS read,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'skipped') AS skipped,
      count(*) FILTER (WHERE first_clicked_at IS NOT NULL) AS clicked
    FROM review_messages WHERE org_id = ${orgId}::integer AND campaign_id = ${id}::integer`));
  const skip = rows(await db.execute(sql`SELECT skip_reason AS reason, count(*)::int AS n FROM review_messages WHERE org_id = ${orgId}::integer AND campaign_id = ${id}::integer AND status = 'skipped' GROUP BY 1 ORDER BY 2 DESC`));
  const err = rows(await db.execute(sql`SELECT error_code AS code, count(*)::int AS n FROM review_messages WHERE org_id = ${orgId}::integer AND campaign_id = ${id}::integer AND status = 'failed' GROUP BY 1 ORDER BY 2 DESC`));
  const n = (k: string) => Number(t?.[k] ?? 0);
  return {
    campaign: c,
    // Cuatro magnitudes distintas. Un clic NO es una reseña: las reseñas confirmadas solo vienen de la API de Google.
    messages: { requests: n("requests"), reminders: n("reminders"), queued: n("queued"), sending: n("sending"), sent: n("sent"), delivered: n("delivered"), read: n("read"), failed: n("failed"), skipped: n("skipped"), clicked: n("clicked") },
    skippedByReason: skip, failedByCode: err,
    reviews: { available: false, note: "Las reseñas confirmadas se leen de la API de Google Business Profile; no se estiman a partir de clics." },
  };
}

export async function listCampaignMessages(orgId: number, id: number, o: { status?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200), offset = Math.max(o.offset ?? 0, 0);
  const conds = [eq(reviewMessagesTable.orgId, orgId), eq(reviewMessagesTable.campaignId, id)];
  if (o.status) conds.push(eq(reviewMessagesTable.status, o.status));
  const rows = await db.select({
    id: reviewMessagesTable.id, contactId: reviewMessagesTable.contactId, kind: reviewMessagesTable.kind, status: reviewMessagesTable.status, skipReason: reviewMessagesTable.skipReason,
    attempts: reviewMessagesTable.attempts, errorCode: reviewMessagesTable.errorCode, errorMessage: reviewMessagesTable.errorMessage, sentAt: reviewMessagesTable.sentAt,
    deliveredAt: reviewMessagesTable.deliveredAt, readAt: reviewMessagesTable.readAt, firstClickedAt: reviewMessagesTable.firstClickedAt, contactName: reviewContactsTable.name,
  }).from(reviewMessagesTable).leftJoin(reviewContactsTable, eq(reviewContactsTable.id, reviewMessagesTable.contactId))
    .where(and(...conds)).orderBy(desc(reviewMessagesTable.id)).limit(limit).offset(offset);
  return { limit, offset, messages: rows };
}

/** Reencola los envíos fallidos reintentables (p. ej. tras corregir credenciales). La elegibilidad se vuelve a comprobar al enviar. */
export async function retryFailed(orgId: number, id: number): Promise<number> {
  const r = await db.update(reviewMessagesTable).set({ status: "queued", attempts: 0, errorCode: null, errorMessage: null, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(reviewMessagesTable.orgId, orgId), eq(reviewMessagesTable.campaignId, id), eq(reviewMessagesTable.status, "failed"),
      sql`${reviewMessagesTable.errorCode} NOT IN ('email_invalid_address','131026','131030','131021')`)).returning({ id: reviewMessagesTable.id });
  return r.length;
}
