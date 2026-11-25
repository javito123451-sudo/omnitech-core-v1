/**
 * Ingesta de webhooks: persistencia idempotente + procesado con reintentos controlados.
 *  - Idempotencia: X-Shopify-Webhook-Id único (reenvíos = no-op).
 *  - Cada evento se procesa en UNA transacción: o se aplica entero o no se aplica nada.
 *  - Fallo → status 'failed', attempts+1, reintento con backoff exponencial; tras MAX_ATTEMPTS → 'dead'.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { HANDLERS } from "./handlers";
import { dbRows } from "./settings";

export const MAX_ATTEMPTS = 5;
export const backoffSeconds = (attempts: number) => Math.min(60 * 2 ** (attempts - 1), 6 * 3600);

export interface IngestInput { webhookId: string; topic: string; shopDomain: string | null; payload: unknown }
export interface IngestResult { duplicate: boolean; eventId: number | null; status: string }

export async function ingestWebhook(input: IngestInput): Promise<IngestResult> {
  const ins = dbRows<{ id: number }>(await db.execute(sql`
    INSERT INTO commerce_webhook_events (webhook_id, topic, shop_domain, payload)
    VALUES (${input.webhookId}::text, ${input.topic}::text, ${input.shopDomain}::text, ${JSON.stringify(input.payload ?? {})}::jsonb)
    ON CONFLICT (webhook_id) DO NOTHING RETURNING id`));
  if (!ins[0]) {
    const cur = dbRows<{ id: number; status: string }>(await db.execute(sql`SELECT id, status FROM commerce_webhook_events WHERE webhook_id=${input.webhookId}::text`))[0];
    return { duplicate: true, eventId: cur?.id ?? null, status: cur?.status ?? "unknown" };
  }
  const status = await processEvent(ins[0].id);
  return { duplicate: false, eventId: ins[0].id, status };
}

export async function processEvent(eventId: number): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const ev = dbRows<{ id: number; topic: string; payload: Record<string, unknown>; status: string }>(await tx.execute(sql`
        SELECT id, topic, payload, status FROM commerce_webhook_events
         WHERE id=${eventId}::int AND status IN ('received','failed') FOR UPDATE SKIP LOCKED`))[0];
      if (!ev) return "skipped";
      const handler = HANDLERS[ev.topic];
      if (!handler) {
        await tx.execute(sql`UPDATE commerce_webhook_events SET status='ignored', processed_at=NOW() WHERE id=${eventId}::int`);
        return "ignored";
      }
      await handler(tx, ev.payload);
      await tx.execute(sql`UPDATE commerce_webhook_events SET status='processed', processed_at=NOW(), last_error=NULL, next_retry_at=NULL, attempts=attempts+1 WHERE id=${eventId}::int`);
      return "processed";
    });
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    logger.error({ eventId, err: msg }, "[Commerce] fallo procesando webhook");
    const r = dbRows<{ attempts: number }>(await db.execute(sql`
      UPDATE commerce_webhook_events SET attempts = attempts + 1, last_error=${msg}::text,
             status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS}::int THEN 'dead' ELSE 'failed' END,
             next_retry_at = NOW() + make_interval(secs => LEAST(60 * power(2, attempts), 21600)::int)
       WHERE id=${eventId}::int RETURNING attempts`));
    return (r[0]?.attempts ?? 0) >= MAX_ATTEMPTS ? "dead" : "failed";
  }
}

/** Para el cron interno: reprocesa eventos fallidos cuyo reintento ya toca. */
export async function retryDueEvents(limit = 50): Promise<number> {
  const due = dbRows<{ id: number }>(await db.execute(sql`
    SELECT id FROM commerce_webhook_events WHERE status IN ('received','failed') AND attempts < ${MAX_ATTEMPTS}::int
       AND (next_retry_at IS NULL OR next_retry_at <= NOW()) ORDER BY id LIMIT ${limit}::int`));
  let ok = 0;
  for (const { id } of due) if ((await processEvent(id)) === "processed") ok++;
  return ok;
}
