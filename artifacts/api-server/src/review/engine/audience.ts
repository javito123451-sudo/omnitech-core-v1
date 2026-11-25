// Audiencia elegible de una campaña, calculada EN SQL (miles de contactos) con exactamente las mismas
// reglas que guard.ts (que se vuelve a ejecutar contacto a contacto justo antes de enviar):
// activo y no anonimizado · dirección del canal · consentimiento vigente · sin baja/supresión ·
// no contactado recientemente por otra campaña · no encolado ya en esta campaña.
import { sql, type SQL } from "drizzle-orm";
import { db, type ReviewCampaign } from "@workspace/db";
import type { AudienceFilter } from "../audience";

export const REQUEST_COOLDOWN_DAYS = Number(process.env["REVIEW_REQUEST_COOLDOWN_DAYS"] ?? 90);

function rows<T>(r: unknown): T[] { return (r as { rows: T[] }).rows; }

function baseConditions(orgId: number, c: Pick<ReviewCampaign, "locationId">, f: AudienceFilter): SQL {
  const parts: SQL[] = [sql`c.org_id = ${orgId}::integer`, sql`c.location_id = ${c.locationId}::integer`];
  if (f.services?.length) parts.push(sql`c.service IN (${sql.join(f.services.map((s) => sql`${s}::text`), sql`, `)})`);
  if (f.serviceDateFrom) parts.push(sql`c.service_date >= ${f.serviceDateFrom}::date`);
  if (f.serviceDateTo) parts.push(sql`c.service_date <= ${f.serviceDateTo}::date`);
  if (f.source) parts.push(sql`c.source = ${f.source}::text`);
  if (f.batchId) parts.push(sql`c.batch_id = ${f.batchId}::integer`);
  return sql.join(parts, sql` AND `);
}

function flagsCte(orgId: number, c: Pick<ReviewCampaign, "id" | "locationId" | "channel">, f: AudienceFilter): SQL {
  const isEmail = c.channel === "email";
  const addr = isEmail ? sql`b.email_norm IS NOT NULL` : sql`b.phone_e164 IS NOT NULL`;
  const suppressMatch = isEmail ? sql`s.email = b.email_norm` : sql`s.phone IN (b.phone_e164, substr(b.phone_e164, 2))`;
  return sql`
    WITH base AS (
      SELECT c.id, c.org_id, c.status, c.anonymized_at, c.email_norm, c.phone_e164
      FROM review_contacts c WHERE ${baseConditions(orgId, c, f)}
    ), flags AS (
      SELECT b.id,
        (b.status = 'active' AND b.anonymized_at IS NULL) AS active,
        (${addr}) AS has_addr,
        EXISTS (SELECT 1 FROM review_consents k WHERE k.org_id = b.org_id AND k.contact_id = b.id AND k.channel = ${c.channel}::text AND k.revoked_at IS NULL) AS consent,
        EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.org_id = b.org_id AND (s.channel IS NULL OR s.channel = ${c.channel}::text) AND ${suppressMatch}) AS suppressed,
        EXISTS (SELECT 1 FROM review_messages m WHERE m.org_id = b.org_id AND m.contact_id = b.id AND m.channel = ${c.channel}::text AND m.kind = 'request'
                AND m.campaign_id <> ${c.id}::integer AND m.status IN ('queued','sending','sent','delivered','read')
                AND m.created_at > now() - make_interval(days => ${REQUEST_COOLDOWN_DAYS}::integer)) AS recent,
        EXISTS (SELECT 1 FROM review_messages m WHERE m.campaign_id = ${c.id}::integer AND m.contact_id = b.id AND m.kind = 'request') AS already
      FROM base b
    )`;
}

export interface AudiencePreview {
  matchingContacts: number; eligible: number;
  excluded: { notActive: number; missingAddress: number; noConsent: number; suppressed: number; recentlyContacted: number; alreadyInCampaign: number };
}

export async function previewAudience(orgId: number, c: Pick<ReviewCampaign, "id" | "locationId" | "channel">, f: AudienceFilter): Promise<AudiencePreview> {
  const [r] = rows<Record<string, string>>(await db.execute(sql`
    ${flagsCte(orgId, c, f)}
    SELECT count(*) AS total,
      count(*) FILTER (WHERE active AND has_addr AND consent AND NOT suppressed AND NOT recent AND NOT already) AS eligible,
      count(*) FILTER (WHERE NOT active) AS not_active,
      count(*) FILTER (WHERE active AND NOT has_addr) AS missing_address,
      count(*) FILTER (WHERE active AND has_addr AND NOT consent) AS no_consent,
      count(*) FILTER (WHERE active AND has_addr AND consent AND suppressed) AS suppressed,
      count(*) FILTER (WHERE active AND has_addr AND consent AND NOT suppressed AND recent) AS recent,
      count(*) FILTER (WHERE active AND has_addr AND consent AND NOT suppressed AND NOT recent AND already) AS already
    FROM flags`));
  const n = (k: string) => Number(r?.[k] ?? 0);
  return { matchingContacts: n("total"), eligible: n("eligible"), excluded: {
    notActive: n("not_active"), missingAddress: n("missing_address"), noConsent: n("no_consent"), suppressed: n("suppressed"),
    recentlyContacted: n("recent"), alreadyInCampaign: n("already"),
  } };
}

/** Inserta un envío «request» en cola por cada contacto elegible. Idempotente (ON CONFLICT DO NOTHING sobre la clave de idempotencia). */
export async function enqueueAudience(tx: Pick<typeof db, "execute">, orgId: number, c: Pick<ReviewCampaign, "id" | "locationId" | "channel">, f: AudienceFilter, runAt: Date): Promise<number> {
  const r = await tx.execute(sql`
    ${flagsCte(orgId, c, f)}
    INSERT INTO review_messages (org_id, campaign_id, contact_id, channel, kind, seq, status, next_attempt_at, tracking_token, created_at, updated_at)
    SELECT ${orgId}::integer, ${c.id}::integer, f.id, ${c.channel}::text, 'request', 0, 'queued', ${runAt.toISOString()}::timestamp,
           replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now(), now()
    FROM flags f WHERE f.active AND f.has_addr AND f.consent AND NOT f.suppressed AND NOT f.recent AND NOT f.already
    ON CONFLICT DO NOTHING`);
  return (r as { rowCount?: number }).rowCount ?? 0;
}
