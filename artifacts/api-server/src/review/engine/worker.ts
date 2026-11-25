// Worker de la cola de envíos (review_messages).
//
//  · Reclamación atómica por campaña: UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED): dos workers
//    (u hojas de réplica) nunca reciben el mismo mensaje.
//  · Límites: ritmo de la campaña, ritmo y tope diario del proveedor y tope mensual de la empresa; ventana
//    horaria y horas de silencio en la zona horaria de la empresa. Lo que no cabe se queda en cola.
//  · Justo antes de enviar se vuelve a ejecutar el guard (el consentimiento pudo revocarse tras encolar).
//  · Errores clasificados: transitorios → reintento con espera creciente (máx. 3 intentos); permanentes → failed;
//    destino inválido → supresión SOLO de ese canal; de configuración → se PAUSA la campaña.
//  · Garantía «como máximo una vez»: un envío que quedó «sending» y cuyo bloqueo caducó NO se reenvía sola
//    (no se puede saber si el proveedor llegó a enviarlo): pasa a «failed» (lease_expired) para revisión manual.
import { and, eq, sql } from "drizzle-orm";
import { db, reviewCampaignsTable, reviewEventsTable, reviewMessagesTable, reviewSettingsTable, reviewTemplatesTable, reviewLocationsTable, outreachSuppressionsTable, organizationsTable } from "@workspace/db";
import { isReviewModuleEnabled } from "../access";
import { getProvider, registry, type ProviderRegistry } from "../channels/registry";
import { checkEligibility } from "../guard";
import { publicBaseUrl, reviewLink, unsubscribeLink } from "../links";
import { canSendNow, type HourRange } from "./window";

export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 5 * 60_000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

export interface TickStats {
  now: string; campaigns: number; claimed: number; sent: number; skipped: number; retried: number; failed: number;
  leaseExpired: number; remindersQueued: number; completed: number; paused: number[]; blocked: Record<string, string>;
}

function rows<T>(r: unknown): T[] { return (r as { rows: T[] }).rows; }
const ts = (d: Date) => d.toISOString();
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

interface Claimed { id: number; org_id: number; campaign_id: number; contact_id: number; channel: string; kind: string; attempts: number; tracking_token: string }

async function addEvent(orgId: number, messageId: number | null, contactId: number | null, type: string, payload: Record<string, unknown>) {
  await db.insert(reviewEventsTable).values({ orgId, messageId, contactId, type, payload }).catch(() => {});
}

async function bumpUsage(orgId: number, channel: string, field: "sent" | "failed" | "delivered", now: Date) {
  const period = now.toISOString().slice(0, 7);
  const col = sql.raw(field);
  await db.execute(sql`INSERT INTO review_usage (org_id, period, channel, ${col}, updated_at) VALUES (${orgId}::integer, ${period}::text, ${channel}::text, 1, now())
    ON CONFLICT (org_id, period, channel) DO UPDATE SET ${col} = review_usage.${col} + 1, updated_at = now()`);
}

async function recoverStaleLeases(now: Date, orgId?: number): Promise<number> {
  const cutoff = new Date(now.getTime() - LEASE_MS);
  const stale = rows<{ id: number; org_id: number; contact_id: number }>(await db.execute(sql`
    UPDATE review_messages SET status = 'failed', error_code = 'lease_expired', locked_at = NULL, locked_by = NULL, updated_at = ${ts(now)}::timestamp,
      error_message = 'El worker se interrumpió durante el envío. No se reenvía automáticamente para evitar un duplicado; revisa y reintenta manualmente.'
    WHERE status = 'sending' AND locked_at < ${ts(cutoff)}::timestamp ${orgId ? sql`AND org_id = ${orgId}::integer` : sql``} RETURNING id, org_id, contact_id`));
  for (const s of stale) await addEvent(s.org_id, s.id, s.contact_id, "error", { code: "lease_expired" });
  return stale.length;
}

/** Recordatorio único y limitado: solo a quien recibió la solicitud hace ≥ N días y no ha hecho clic. */
async function enqueueReminders(now: Date, orgId?: number): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO review_messages (org_id, campaign_id, contact_id, channel, kind, seq, status, next_attempt_at, tracking_token, created_at, updated_at)
    SELECT m.org_id, m.campaign_id, m.contact_id, m.channel, 'reminder', 1, 'queued', ${ts(now)}::timestamp,
           replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now(), now()
    FROM review_messages m JOIN review_campaigns c ON c.id = m.campaign_id
    WHERE c.status = 'running' AND c.max_reminders >= 1 AND c.reminder_after_days IS NOT NULL ${orgId ? sql`AND c.org_id = ${orgId}::integer` : sql``}
      AND m.kind = 'request' AND m.status IN ('sent','delivered','read') AND m.first_clicked_at IS NULL
      AND m.sent_at <= ${ts(now)}::timestamp - make_interval(days => c.reminder_after_days)
    ON CONFLICT DO NOTHING`);
  return (r as { rowCount?: number }).rowCount ?? 0;
}

interface CampaignCtx {
  c: typeof reviewCampaignsTable.$inferSelect; tpl: typeof reviewTemplatesTable.$inferSelect; loc: typeof reviewLocationsTable.$inferSelect;
  org: { name: string; legalName: string | null; taxId: string | null; address: string | null };
  settings: typeof reviewSettingsTable.$inferSelect | undefined; provider: NonNullable<ReturnType<typeof getProvider>>; base: string;
}

async function setStatus(m: Claimed, workerId: string, set: Record<string, unknown>): Promise<boolean> {
  const [r] = await db.update(reviewMessagesTable).set({ ...set, lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(reviewMessagesTable.id, m.id), eq(reviewMessagesTable.status, "sending"), eq(reviewMessagesTable.lockedBy, workerId))).returning({ id: reviewMessagesTable.id });
  return !!r;
}

async function processMessage(m: Claimed, cx: CampaignCtx, workerId: string, now: Date, stats: TickStats): Promise<void> {
  const elig = await checkEligibility(m.org_id, m.contact_id, m.channel);
  if (!elig.ok) {
    if (await setStatus(m, workerId, { status: "skipped", skipReason: elig.reason })) { stats.skipped++; await addEvent(m.org_id, m.id, m.contact_id, "skipped", { reason: elig.reason }); }
    return;
  }
  const outcome = await cx.provider.send({
    orgId: m.org_id, messageId: m.id, to: elig.destination, contactName: elig.contact.name, service: elig.contact.service,
    location: { name: cx.loc.name },
    template: { id: cx.tpl.id, subject: cx.tpl.subject, body: cx.tpl.body, waTemplateName: cx.tpl.waTemplateName, waLanguage: cx.tpl.waLanguage, waStatus: cx.tpl.waStatus },
    links: { review: reviewLink(cx.base, m.tracking_token), unsubscribe: unsubscribeLink(cx.base, m.tracking_token) },
    sender: { name: cx.org.name, legalName: cx.org.legalName, taxId: cx.org.taxId, address: cx.org.address },
  }).catch((e): Awaited<ReturnType<typeof cx.provider.send>> => ({ ok: false, retryable: true, code: "provider_exception", message: String((e as Error).message ?? e).slice(0, 300) }));

  if (outcome.ok) {
    if (await setStatus(m, workerId, { status: "sent", sentAt: now, provider: cx.provider.providerId, providerMessageId: outcome.providerMessageId, errorCode: null, errorMessage: null })) {
      stats.sent++; await bumpUsage(m.org_id, m.channel, "sent", now);
      await db.execute(sql`UPDATE review_contacts SET last_activity_at = ${ts(now)}::timestamp WHERE id = ${m.contact_id}::integer AND org_id = ${m.org_id}::integer`);
    }
    return;
  }
  const retry = outcome.retryable && m.attempts < MAX_ATTEMPTS;
  if (retry) {
    const wait = BACKOFF_MS[Math.min(m.attempts - 1, BACKOFF_MS.length - 1)]!;
    if (await setStatus(m, workerId, { status: "queued", nextAttemptAt: new Date(now.getTime() + wait), errorCode: outcome.code, errorMessage: outcome.message })) {
      stats.retried++; await addEvent(m.org_id, m.id, m.contact_id, "retry", { attempt: m.attempts, code: outcome.code, inMs: wait });
    }
    return;
  }
  if (await setStatus(m, workerId, { status: "failed", errorCode: outcome.code, errorMessage: outcome.message, provider: cx.provider.providerId })) {
    stats.failed++; await bumpUsage(m.org_id, m.channel, "failed", now);
    await addEvent(m.org_id, m.id, m.contact_id, "error", { code: outcome.code, message: outcome.message, attempts: m.attempts });
  }
  if (outcome.invalidDestination) {
    // Supresión de ESE canal únicamente (un teléfono inválido no impide escribir al email del mismo contacto).
    const dest = elig.destination;
    await db.insert(outreachSuppressionsTable).values({ orgId: m.org_id, channel: m.channel, reason: "bounced", source: "omni_review", ...(m.channel === "email" ? { email: dest } : { phone: dest }) }).catch(() => {});
  }
  if (outcome.fatal) {
    const [p] = await db.update(reviewCampaignsTable).set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(reviewCampaignsTable.id, m.campaign_id), eq(reviewCampaignsTable.status, "running"))).returning({ id: reviewCampaignsTable.id });
    if (p) { stats.paused.push(m.campaign_id); await addEvent(m.org_id, null, null, "campaign_paused", { campaignId: m.campaign_id, code: outcome.code, message: outcome.message }); }
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]!; await fn(x); } }));
}

/** orgId opcional: procesa solo esa empresa (pruebas, ejecución manual y soporte). */
export async function runTick(opts: { orgId?: number; now?: Date; workerId?: string; providers?: ProviderRegistry; maxMs?: number; concurrency?: number } = {}): Promise<TickStats> {
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const deadline = Date.now() + (opts.maxMs ?? 50_000);
  const stats: TickStats = { now: ts(now), campaigns: 0, claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, leaseExpired: 0, remindersQueued: 0, completed: 0, paused: [], blocked: {} };
  const base = publicBaseUrl();

  stats.leaseExpired = await recoverStaleLeases(now, opts.orgId);
  stats.remindersQueued = await enqueueReminders(now, opts.orgId);

  const due = rows<{ id: number }>(await db.execute(sql`
    SELECT c.id FROM review_campaigns c JOIN organizations o ON o.id = c.org_id
    WHERE c.status IN ('scheduled','running') AND o.status <> 'suspended' ${opts.orgId ? sql`AND c.org_id = ${opts.orgId}::integer` : sql``}
      AND EXISTS (SELECT 1 FROM review_messages m WHERE m.campaign_id = c.id AND m.status = 'queued' AND m.next_attempt_at <= ${ts(now)}::timestamp)
    ORDER BY c.id`));

  for (const { id } of due) {
    if (Date.now() > deadline) break;
    const [c] = await db.select().from(reviewCampaignsTable).where(eq(reviewCampaignsTable.id, id));
    if (!c || (c.status !== "scheduled" && c.status !== "running")) continue;
    const block = (why: string) => { stats.blocked[String(id)] = why; };
    if (!base) { block("public_url_not_configured"); continue; }
    if (!(await isReviewModuleEnabled(c.orgId))) { block("module_disabled"); continue; }
    const provider = getProvider(c.channel, opts.providers ?? registry);
    if (!provider) { block("channel_not_available"); continue; }
    const [tpl] = c.templateId ? await db.select().from(reviewTemplatesTable).where(and(eq(reviewTemplatesTable.orgId, c.orgId), eq(reviewTemplatesTable.id, c.templateId))) : [];
    const [loc] = await db.select().from(reviewLocationsTable).where(and(eq(reviewLocationsTable.orgId, c.orgId), eq(reviewLocationsTable.id, c.locationId)));
    if (!tpl || !loc?.googleReviewUrl) { block("template_or_location_missing"); continue; }
    const ready = await provider.readiness(c.orgId, { id: tpl.id, subject: tpl.subject, body: tpl.body, waTemplateName: tpl.waTemplateName, waLanguage: tpl.waLanguage, waStatus: tpl.waStatus });
    if (!ready.ready) { block(`channel_not_ready: ${ready.reason}`); continue; }
    const [settings] = await db.select().from(reviewSettingsTable).where(eq(reviewSettingsTable.orgId, c.orgId));
    if (!canSendNow(now, settings?.timezone ?? "Europe/Madrid", c.sendWindow as HourRange | null, settings?.quietHours as HourRange | null)) { block("outside_send_window"); continue; }

    // Presupuesto de este tick = lo más restrictivo de: campaña, proveedor/min, proveedor/día y tope mensual.
    const since1m = new Date(now.getTime() - 60_000), since24h = new Date(now.getTime() - 24 * 3600_000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [u] = rows<Record<string, string>>(await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE campaign_id = ${id}::integer AND (status = 'sending' OR sent_at > ${ts(since1m)}::timestamp)) AS camp_1m,
        count(*) FILTER (WHERE channel = ${c.channel}::text AND (status = 'sending' OR sent_at > ${ts(since1m)}::timestamp)) AS chan_1m,
        count(*) FILTER (WHERE channel = ${c.channel}::text AND (status = 'sending' OR sent_at > ${ts(since24h)}::timestamp)) AS chan_24h,
        count(*) FILTER (WHERE status = 'sending' OR sent_at >= ${ts(monthStart)}::timestamp) AS month
      FROM review_messages WHERE org_id = ${c.orgId}::integer`));
    const budgets = [c.ratePerMinute - Number(u?.["camp_1m"] ?? 0), provider.limits.maxPerMinute - Number(u?.["chan_1m"] ?? 0)];
    if (provider.limits.maxPerDay != null) budgets.push(provider.limits.maxPerDay - Number(u?.["chan_24h"] ?? 0));
    if (settings?.monthlyMessageLimit != null) budgets.push(settings.monthlyMessageLimit - Number(u?.["month"] ?? 0));
    const budget = Math.min(...budgets, 500);
    if (budget <= 0) { block("rate_or_quota_exhausted"); continue; }

    const [orgRow] = await db.select({ name: organizationsTable.name, legalName: organizationsTable.legalName, taxId: organizationsTable.taxId, address: organizationsTable.address })
      .from(organizationsTable).where(eq(organizationsTable.id, c.orgId));
    const cx: CampaignCtx = { c, tpl, loc, org: orgRow ?? { name: "", legalName: null, taxId: null, address: null }, settings, provider, base };
    stats.campaigns++;

    // Mensajes de 20 en 20 para no dejar reclamado (y bloqueado) lo que no vamos a llegar a procesar.
    let remaining = budget;
    while (remaining > 0 && Date.now() < deadline) {
      const take = Math.min(remaining, 20);
      const claimed = rows<Claimed>(await db.execute(sql`
        WITH picked AS (
          SELECT id FROM review_messages WHERE campaign_id = ${id}::integer AND status = 'queued' AND next_attempt_at <= ${ts(now)}::timestamp
          ORDER BY next_attempt_at, id LIMIT ${take}::integer FOR UPDATE SKIP LOCKED
        )
        UPDATE review_messages m SET status = 'sending', locked_at = ${ts(now)}::timestamp, locked_by = ${workerId}::text, attempts = m.attempts + 1, updated_at = ${ts(now)}::timestamp
        FROM picked WHERE m.id = picked.id
        RETURNING m.id, m.org_id, m.campaign_id, m.contact_id, m.channel, m.kind, m.attempts, m.tracking_token`));
      if (claimed.length === 0) break;
      stats.claimed += claimed.length; remaining -= claimed.length;
      if (c.status === "scheduled") { await db.update(reviewCampaignsTable).set({ status: "running", updatedAt: new Date() }).where(and(eq(reviewCampaignsTable.id, id), eq(reviewCampaignsTable.status, "scheduled"))); c.status = "running"; }
      for (const part of chunk(claimed, 20)) await pool(part, opts.concurrency ?? 10, (m) => processMessage(m, cx, workerId, now, stats));
      // Si una campaña se pausó por un error de configuración, no seguir.
      if (stats.paused.includes(id)) break;
    }
  }

  // Campañas en marcha sin nada pendiente → completadas.
  const done = rows<{ id: number }>(await db.execute(sql`
    UPDATE review_campaigns c SET status = 'completed', updated_at = now()
    WHERE c.status = 'running' ${opts.orgId ? sql`AND c.org_id = ${opts.orgId}::integer` : sql``} AND NOT EXISTS (SELECT 1 FROM review_messages m WHERE m.campaign_id = c.id AND m.status IN ('queued','sending'))
      AND (c.max_reminders = 0 OR NOT EXISTS (SELECT 1 FROM review_messages m WHERE m.campaign_id = c.id AND m.kind = 'request' AND m.status IN ('sent','delivered','read')
           AND m.first_clicked_at IS NULL AND NOT EXISTS (SELECT 1 FROM review_messages r WHERE r.campaign_id = c.id AND r.contact_id = m.contact_id AND r.kind = 'reminder')))
    RETURNING c.id`));
  stats.completed = done.length;
  return stats;
}

// ── Planificador en proceso (mismo patrón que Autopilot / Follow-up) ─────────
import cron from "node-cron";
import { logger } from "../../lib/logger";
let started = false, running = false;
export function startReviewScheduler(): void {
  if (started) return;
  started = true;
  cron.schedule("* * * * *", async () => {
    if (running) return; // un tick a la vez por proceso; entre procesos manda SKIP LOCKED
    running = true;
    try { const s = await runTick(); if (s.claimed || s.leaseExpired || s.paused.length) logger.info({ review: s }, "[OmniReview] tick"); }
    catch (err) { logger.error({ err }, "[OmniReview] tick error"); }
    finally { running = false; }
  });
  logger.info("[OmniReview] scheduler started (every minute)");
}
