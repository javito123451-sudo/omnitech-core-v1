// Políticas de suspensión / reactivación — configurables por variables de entorno.
// Decisiones PURAS (sin BD) para poder testearlas.
import type { SubscriptionStatus } from "@workspace/db";

export interface CommercePolicies {
  /** Días de gracia tras un pago fallido antes de suspender la empresa. */
  graceDays: number;
  /** Días tras la cancelación antes de suspender (0 = en el siguiente tick). */
  cancelGraceDays: number;
  /** Suspender de inmediato ante un contracargo. */
  suspendOnChargeback: boolean;
  /** Suspender al reembolsar el pedido completo de una licencia ya activa. */
  suspendOnFullRefund: boolean;
  /** Reactivar automáticamente cuando entra un pago tras una suspensión por impago. */
  autoReactivateOnPayment: boolean;
  /** Permitir aprobar pedidos de prueba (Bogus Gateway / test mode). false en producción. */
  allowTestOrders: boolean;
  /** Intentos máximos antes de dejar de pedir reintentos a Shopify (queda para reintento manual). */
  maxWebhookAttempts: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export function loadPolicies(env: NodeJS.ProcessEnv = process.env): CommercePolicies {
  return {
    graceDays:               num(env["COMMERCE_GRACE_DAYS"], 7),
    cancelGraceDays:         num(env["COMMERCE_CANCEL_GRACE_DAYS"], 0),
    suspendOnChargeback:     bool(env["COMMERCE_SUSPEND_ON_CHARGEBACK"], true),
    suspendOnFullRefund:     bool(env["COMMERCE_SUSPEND_ON_FULL_REFUND"], true),
    autoReactivateOnPayment: bool(env["COMMERCE_AUTO_REACTIVATE"], true),
    allowTestOrders:         bool(env["COMMERCE_ALLOW_TEST_ORDERS"], false),
    maxWebhookAttempts:      num(env["COMMERCE_MAX_WEBHOOK_ATTEMPTS"], 5),
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** Tras un cobro fallido: pasa a gracia (si no estaba ya suspendida/cancelada). */
export function onPaymentFailed(
  current: SubscriptionStatus,
  now: Date,
  p: CommercePolicies,
  existingGraceUntil: Date | null,
): { status: SubscriptionStatus; graceUntil: Date | null } {
  if (current === "cancelled" || current === "expired" || current === "suspended") {
    return { status: current, graceUntil: existingGraceUntil };
  }
  // No alargar la gracia con cada reintento fallido: se mantiene la fecha original.
  const graceUntil = existingGraceUntil ?? new Date(now.getTime() + p.graceDays * DAY);
  return { status: "grace", graceUntil };
}

/** Tras un cobro correcto. */
export function onPaymentSucceeded(
  current: SubscriptionStatus,
  p: CommercePolicies,
): { status: SubscriptionStatus; reactivateOrg: boolean } {
  if (current === "cancelled" || current === "expired") return { status: current, reactivateOrg: false };
  if (current === "suspended") {
    return p.autoReactivateOnPayment
      ? { status: "active", reactivateOrg: true }
      : { status: "suspended", reactivateOrg: false };
  }
  return { status: "active", reactivateOrg: false };
}

/** Tick periódico: ¿hay que suspender la empresa ahora? */
export function shouldSuspendNow(
  s: { status: SubscriptionStatus; graceUntil: Date | null; cancelledAt: Date | null; suspendedAt: Date | null },
  now: Date,
  p: CommercePolicies,
): boolean {
  if (s.suspendedAt) return false;
  if (s.status === "grace" && s.graceUntil && s.graceUntil <= now) return true;
  if ((s.status === "cancelled" || s.status === "expired") && s.cancelledAt) {
    return s.cancelledAt.getTime() + p.cancelGraceDays * DAY <= now.getTime();
  }
  return false;
}
