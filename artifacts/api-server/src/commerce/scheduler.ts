import { logger } from "../lib/logger";
import { retryDueEvents } from "./ingest";
import { sweepGracePeriods } from "./lifecycle";
import { expireAuthorizations } from "./capture";

export async function runCommerceTick(): Promise<{ retried: number; suspended: number; expired: number }> {
  const retried = await retryDueEvents();
  const suspended = await sweepGracePeriods();
  const expired = await expireAuthorizations(); // autorizaciones sin compra a tiempo (las ya compradas no caducan)
  return { retried, suspended, expired };
}

/** Proceso persistente (Render): tick cada 5 min. Idempotente: seguro aunque coincida con el cron externo. */
export function startCommerceScheduler(): void {
  setInterval(() => { runCommerceTick().catch((err) => logger.error({ err }, "[Commerce] tick falló")); }, 5 * 60 * 1000).unref();
}
