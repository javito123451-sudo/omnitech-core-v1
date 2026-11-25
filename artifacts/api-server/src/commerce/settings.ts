import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const dbRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface CommercePolicy {
  graceDays: number;
  suspendAfterFailedAttempts: number;
  suspendOnFullRefund: boolean;
  suspendOnChargeback: boolean;
  autoReactivateOnPayment: boolean;
}

export async function getPolicy(): Promise<CommercePolicy> {
  const rows = dbRows<{ key: string; value: string }>(await db.execute(sql`SELECT key, value FROM commerce_settings`));
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => { const v = Number(m.get(k)); return Number.isFinite(v) ? v : d; };
  const bool = (k: string, d: boolean) => (m.has(k) ? m.get(k) === "true" : d);
  return {
    graceDays: num("grace_days", 7),
    suspendAfterFailedAttempts: num("suspend_after_failed_attempts", 3),
    suspendOnFullRefund: bool("suspend_on_full_refund", true),
    suspendOnChargeback: bool("suspend_on_chargeback", true),
    autoReactivateOnPayment: bool("auto_reactivate_on_payment", true),
  };
}
