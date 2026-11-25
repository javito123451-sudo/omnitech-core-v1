import { logger } from "../lib/logger";
import { retryDueEvents } from "./ingest";
import { sweepGracePeriods } from "./lifecycle";

export async function runCommerceTick(): Promise<{ retried: number; suspended: number }> {
  const retried = await retryDueEvents();
  const suspended = await sweepGracePeriods();
  return { retried, suspended };
}

/** Proceso persistente (Render): tick cada 5 min. Idempotente: seguro aunque coincida con el cron externo. */
export function startCommerceScheduler(): void {
  setInterval(() => { runCommerceTick().catch((err) => logger.error({ err }, "[Commerce] tick falló")); }, 5 * 60 * 1000).unref();
}
