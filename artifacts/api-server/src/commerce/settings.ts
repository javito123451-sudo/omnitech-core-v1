import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const dbRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface CommercePolicy {
  graceDays: number;
  suspendAfterFailedAttempts: number;
  suspendOnFullRefund: boolean;
  suspendOnChargeback: boolean;
  autoReactivateOnPayment: boolean;
  autoActivateWhenPaidAndAuthorized: boolean;
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
    autoActivateWhenPaidAndAuthorized: bool("auto_activate_when_paid_and_authorized", true),
  };
}

/** Claves editables desde el panel (con validación). Nunca se aceptan claves arbitrarias. */
export const EDITABLE_SETTINGS: Record<string, "bool" | "int"> = {
  grace_days: "int", suspend_after_failed_attempts: "int", suspend_on_full_refund: "bool", suspend_on_chargeback: "bool",
  auto_reactivate_on_payment: "bool", auto_activate_when_paid_and_authorized: "bool",
};
export function validateSetting(key: string, value: unknown): string | null {
  const t = EDITABLE_SETTINGS[key];
  if (!t) return null;
  if (t === "bool") return typeof value === "boolean" ? String(value) : null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 365 ? String(value) : null;
}
