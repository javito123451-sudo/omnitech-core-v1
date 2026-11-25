// Panel principal: SOLO cifras derivadas de la base de datos. Nada estimado.
// Se separan explícitamente solicitudes enviadas, entregadas, clics y reseñas
// recibidas; si Google no está conectado, las reseñas se declaran "no disponibles"
// en lugar de mostrar un 0 que parezca un resultado.
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

function rows<T>(r: unknown): T[] { return (r as { rows: T[] }).rows; }

export interface ReviewOverview {
  locations: number;
  contacts: { total: number; active: number; unsubscribed: number };
  campaigns: { total: number; active: number };
  messages: { queued: number; sent: number; delivered: number; read: number; failed: number; skipped: number; clicked: number };
  reviews: { available: boolean; reason?: string; received: number; averageRating: number | null };
}

export async function getOverview(orgId: number): Promise<ReviewOverview> {
  const [counts] = rows<Record<string, string>>(await db.execute(sql`
    SELECT
      (SELECT count(*) FROM review_locations WHERE org_id = ${orgId}::integer AND status = 'active') AS locations,
      (SELECT count(*) FROM review_contacts  WHERE org_id = ${orgId}::integer) AS contacts_total,
      (SELECT count(*) FROM review_contacts  WHERE org_id = ${orgId}::integer AND status = 'active') AS contacts_active,
      (SELECT count(*) FROM review_contacts  WHERE org_id = ${orgId}::integer AND status = 'unsubscribed') AS contacts_unsub,
      (SELECT count(*) FROM review_campaigns WHERE org_id = ${orgId}::integer) AS campaigns_total,
      (SELECT count(*) FROM review_campaigns WHERE org_id = ${orgId}::integer AND status IN ('scheduled','running')) AS campaigns_active,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND status = 'queued')  AS m_queued,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND sent_at IS NOT NULL) AS m_sent,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND delivered_at IS NOT NULL) AS m_delivered,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND read_at IS NOT NULL) AS m_read,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND status = 'failed')  AS m_failed,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND status = 'skipped') AS m_skipped,
      (SELECT count(*) FROM review_messages WHERE org_id = ${orgId}::integer AND first_clicked_at IS NOT NULL) AS m_clicked,
      (SELECT count(*) FROM review_locations WHERE org_id = ${orgId}::integer AND status = 'active' AND gbp_location_id IS NOT NULL) AS gbp_connected
  `));
  const [rev] = rows<{ received: string; avg: string | null }>(await db.execute(sql`
    SELECT count(*) AS received, round(avg(rating)::numeric, 2) AS avg FROM review_reviews WHERE org_id = ${orgId}::integer
  `));
  const n = (v: string | undefined) => Number(v ?? 0);
  const gbpConnected = n(counts?.["gbp_connected"]) > 0;
  return {
    locations: n(counts?.["locations"]),
    contacts: { total: n(counts?.["contacts_total"]), active: n(counts?.["contacts_active"]), unsubscribed: n(counts?.["contacts_unsub"]) },
    campaigns: { total: n(counts?.["campaigns_total"]), active: n(counts?.["campaigns_active"]) },
    messages: {
      queued: n(counts?.["m_queued"]), sent: n(counts?.["m_sent"]), delivered: n(counts?.["m_delivered"]), read: n(counts?.["m_read"]),
      failed: n(counts?.["m_failed"]), skipped: n(counts?.["m_skipped"]), clicked: n(counts?.["m_clicked"]),
    },
    reviews: gbpConnected
      ? { available: true, received: n(rev?.received), averageRating: rev?.avg == null ? null : Number(rev.avg) }
      : { available: false, reason: "Google Business Profile no está conectado: las reseñas recibidas no se pueden leer todavía.", received: 0, averageRating: null },
  };
}
