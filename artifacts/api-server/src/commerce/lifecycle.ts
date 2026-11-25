/**
 * Ciclo de vida de licencias comerciales: suspender / reactivar / cancelar.
 * NUNCA borra datos de empresa: solo cambia license_plans.is_active y el estado de la suscripción.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { bumpOrgModuleVersion } from "../lib/moduleVersion";
import { dbRows, getPolicy } from "./settings";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export async function auditActivation(
  ex: Executor,
  e: { activationRequestId?: number | null; captureRequestId?: number | null; subscriptionId?: number | null; actor: string; action: string; from?: string | null; to?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await ex.execute(sql`
    INSERT INTO activation_audit_logs (activation_request_id, capture_request_id, subscription_id, actor, action, from_status, to_status, details)
    VALUES (${e.activationRequestId ?? null}::int, ${e.captureRequestId ?? null}::int, ${e.subscriptionId ?? null}::int, ${e.actor}::text, ${e.action}::text,
            ${e.from ?? null}::text, ${e.to ?? null}::text, ${JSON.stringify(e.details ?? {})}::jsonb)`);
}

interface SubRow { id: number; status: string; org_id: number | null; license_id: number | null }

async function lockSub(ex: Executor, id: number): Promise<SubRow | null> {
  return dbRows<SubRow>(await ex.execute(sql`
    SELECT id, status, org_id, license_id FROM commerce_subscriptions WHERE id = ${id}::int FOR UPDATE`))[0] ?? null;
}

async function setLicenseActive(ex: Executor, sub: SubRow, active: boolean): Promise<void> {
  if (sub.license_id) {
    await ex.execute(sql`UPDATE license_plans SET is_active = ${active}::boolean, updated_at = NOW() WHERE id = ${sub.license_id}::int`);
  }
  if (sub.org_id) bumpOrgModuleVersion(sub.org_id);
}

export async function suspendSubscription(ex: Executor, subId: number, reason: string, actor: string): Promise<boolean> {
  const sub = await lockSub(ex, subId);
  if (!sub || sub.status === "suspended" || sub.status === "cancelled" || sub.status === "expired") return false;
  await ex.execute(sql`UPDATE commerce_subscriptions SET status='suspended', suspend_reason=${reason}::text, updated_at=NOW() WHERE id=${subId}::int`);
  await setLicenseActive(ex, sub, false);
  await auditActivation(ex, { subscriptionId: subId, actor, action: "subscription_suspended", from: sub.status, to: "suspended", details: { reason } });
  return true;
}

export async function reactivateSubscription(ex: Executor, subId: number, reason: string, actor: string): Promise<boolean> {
  const sub = await lockSub(ex, subId);
  if (!sub || !["suspended", "past_due", "paused"].includes(sub.status)) return false;
  await ex.execute(sql`UPDATE commerce_subscriptions SET status='active', suspend_reason=NULL, failed_attempts=0, grace_until=NULL, updated_at=NOW() WHERE id=${subId}::int`);
  await setLicenseActive(ex, sub, true);
  await auditActivation(ex, { subscriptionId: subId, actor, action: "subscription_reactivated", from: sub.status, to: "active", details: { reason } });
  return true;
}

export async function cancelSubscription(ex: Executor, subId: number, actor: string, reason = "cancelled"): Promise<boolean> {
  const sub = await lockSub(ex, subId);
  if (!sub || sub.status === "cancelled") return false;
  await ex.execute(sql`UPDATE commerce_subscriptions SET status='cancelled', cancelled_at=NOW(), suspend_reason=${reason}::text, updated_at=NOW() WHERE id=${subId}::int`);
  if (sub.license_id) {
    await ex.execute(sql`UPDATE license_plans SET is_active=FALSE, valid_until=NOW(), updated_at=NOW() WHERE id=${sub.license_id}::int`);
  }
  if (sub.org_id) bumpOrgModuleVersion(sub.org_id);
  await auditActivation(ex, { subscriptionId: subId, actor, action: "subscription_cancelled", from: sub.status, to: "cancelled", details: { reason } });
  return true;
}

/** Pago fallido: marca past_due, abre periodo de gracia y suspende al superar el umbral configurado. */
export async function recordPaymentFailure(ex: Executor, subId: number, actor: string): Promise<void> {
  const policy = await getPolicy();
  const sub = await lockSub(ex, subId);
  if (!sub || !["active", "past_due"].includes(sub.status)) return;
  const rows = dbRows<{ failed_attempts: number }>(await ex.execute(sql`
    UPDATE commerce_subscriptions
       SET failed_attempts = failed_attempts + 1,
           status = 'past_due',
           grace_until = COALESCE(grace_until, NOW() + make_interval(days => ${policy.graceDays}::int)),
           updated_at = NOW()
     WHERE id = ${subId}::int RETURNING failed_attempts`));
  await auditActivation(ex, { subscriptionId: subId, actor, action: "payment_failed", from: sub.status, to: "past_due", details: { attempts: rows[0]?.failed_attempts, graceDays: policy.graceDays } });
  if ((rows[0]?.failed_attempts ?? 0) >= policy.suspendAfterFailedAttempts) {
    await suspendSubscription(ex, subId, "payment_failed_threshold", actor);
  }
}

/** Pago correcto (primero o renovación). Reactiva solo suspensiones por impago, nunca por reembolso/contracargo. */
export async function recordPaymentSuccess(ex: Executor, subId: number, actor: string): Promise<void> {
  const policy = await getPolicy();
  const sub = dbRows<SubRow & { suspend_reason: string | null }>(await ex.execute(sql`
    SELECT id, status, org_id, license_id, suspend_reason FROM commerce_subscriptions WHERE id=${subId}::int FOR UPDATE`))[0];
  if (!sub) return;
  if (sub.status === "suspended") {
    const byPayment = sub.suspend_reason?.startsWith("payment_") ?? false;
    if (policy.autoReactivateOnPayment && byPayment) await reactivateSubscription(ex, subId, "payment_recovered", actor);
    return;
  }
  if (["pending", "past_due"].includes(sub.status)) {
    await ex.execute(sql`UPDATE commerce_subscriptions SET status='active', failed_attempts=0, grace_until=NULL, updated_at=NOW() WHERE id=${subId}::int`);
    await auditActivation(ex, { subscriptionId: subId, actor, action: "payment_confirmed", from: sub.status, to: "active" });
  } else if (sub.status === "active") {
    await ex.execute(sql`UPDATE commerce_subscriptions SET failed_attempts=0, grace_until=NULL, updated_at=NOW() WHERE id=${subId}::int`);
  }
}

/** Barrido periódico (cron): suspende suscripciones past_due con el periodo de gracia vencido. */
export async function sweepGracePeriods(): Promise<number> {
  const due = dbRows<{ id: number }>(await db.execute(sql`
    SELECT id FROM commerce_subscriptions WHERE status='past_due' AND grace_until IS NOT NULL AND grace_until < NOW()`));
  let n = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => { if (await suspendSubscription(tx, id, "payment_grace_expired", "system:grace-sweep")) n++; });
  }
  return n;
}
