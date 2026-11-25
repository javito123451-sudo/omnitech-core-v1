// Estados de entrega que informa el proveedor (webhooks de WhatsApp / Resend). Monótono: un estado
// nunca retrocede (delivered no vuelve a sent), un fallo tardío no pisa un entregado/leído, y los
// duplicados del webhook son inocuos (applied=false). Los instantes se rellenan con COALESCE: el primero gana.
//
// NOTA para quien conecte los webhooks: si devuelve messageId=null el mensaje aún no consta (el webhook
// pudo llegar antes de que el worker guardara el id del proveedor). El webhook debe responder con un
// código NO 2xx para que el proveedor reintente.
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";

export type ProviderStatus = "sent" | "delivered" | "read" | "failed";
const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

export interface StatusResult { applied: boolean; messageId: number | null; orgId: number | null }
type Row = { id: number; org_id: number; contact_id: number; channel: string; status: string };
const rowsOf = <T,>(r: unknown) => (r as { rows: T[] }).rows;

function timestamps(status: "sent" | "delivered" | "read", at: string): SQL {
  const t = sql`${at}::timestamp`;
  if (status === "read") return sql`read_at = COALESCE(read_at, ${t}), delivered_at = COALESCE(delivered_at, ${t}), sent_at = COALESCE(sent_at, ${t})`;
  if (status === "delivered") return sql`delivered_at = COALESCE(delivered_at, ${t}), sent_at = COALESCE(sent_at, ${t})`;
  return sql`sent_at = COALESCE(sent_at, ${t})`;
}

const bump = (orgId: number, channel: string, period: string, col: "delivered" | "failed") => db.execute(sql`
  INSERT INTO review_usage (org_id, period, channel, ${sql.raw(col)}, updated_at) VALUES (${orgId}::integer, ${period}::text, ${channel}::text, 1, now())
  ON CONFLICT (org_id, period, channel) DO UPDATE SET ${sql.raw(col)} = review_usage.${sql.raw(col)} + 1, updated_at = now()`);

export async function applyProviderStatus(p: { providerMessageId: string; status: ProviderStatus; at: Date; errorCode?: string | null; errorMessage?: string | null }): Promise<StatusResult> {
  const [m] = rowsOf<Row>(await db.execute(sql`SELECT id, org_id, contact_id, channel, status FROM review_messages WHERE provider_message_id = ${p.providerMessageId}::text LIMIT 1`));
  if (!m) return { applied: false, messageId: null, orgId: null };
  const at = p.at.toISOString(), period = at.slice(0, 7);
  let applied = false;

  if (p.status === "failed") {
    // Solo si aún no consta entregado/leído.
    const u = rowsOf(await db.execute(sql`UPDATE review_messages SET status = 'failed', error_code = ${p.errorCode ?? "provider_failed"}::text, error_message = ${p.errorMessage ?? null}::text, updated_at = now()
      WHERE id = ${m.id}::integer AND status IN ('sent','sending') RETURNING id`));
    applied = u.length > 0;
    if (applied) await bump(m.org_id, m.channel, period, "failed");
  } else {
    const incoming = RANK[p.status]!, current = RANK[m.status] ?? 0;
    const newStatus = incoming > current ? p.status : m.status;
    const u = rowsOf(await db.execute(sql`UPDATE review_messages SET ${timestamps(p.status, at)}, status = ${newStatus}::text, updated_at = now()
      WHERE id = ${m.id}::integer AND status NOT IN ('failed','skipped') RETURNING id`));
    applied = incoming > current && u.length > 0;
    if (applied && incoming >= RANK["delivered"]! && current < RANK["delivered"]!) await bump(m.org_id, m.channel, period, "delivered");
  }
  if (applied) await db.execute(sql`INSERT INTO review_events (org_id, message_id, contact_id, type, payload) VALUES (${m.org_id}::integer, ${m.id}::integer, ${m.contact_id}::integer, 'status_update', ${JSON.stringify({ status: p.status, errorCode: p.errorCode ?? null })}::jsonb)`);
  return { applied, messageId: m.id, orgId: m.org_id };
}
