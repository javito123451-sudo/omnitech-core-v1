/**
 * Activación automática: pedido PAGADO + autorización vigente del mismo plan ⇒ se activa sin segundo paso manual.
 * La autorización (manual, de un SUPER_ADMIN) sigue siendo la decisión humana; el actor de la activación es quien autorizó.
 * Configurable: commerce_settings.auto_activate_when_paid_and_authorized (por defecto true).
 * Se dispara: (a) tras procesar `orders/paid`, (b) al autorizar una captación que ya tiene compra pagada, (c) en el tick de 5 min.
 * No activa si: pedido sin pagar, solicitud en 'info_requested', líneas de pedido sin catálogo, plan distinto o sin autorización.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { approveActivation, ActivationError } from "./activation";
import { auditActivation } from "./lifecycle";
import { dbRows, getPolicy } from "./settings";

/** Enlaza compras ya pagadas (sin autorización en su momento) con una captación recién autorizada del mismo email y plan. */
export async function linkExistingPaidPurchases(captureId: number): Promise<number> {
  const r = dbRows<{ id: number }>(await db.execute(sql`
    UPDATE activation_requests ar SET capture_request_id = c.id, updated_at = NOW(),
           requested_modules = (SELECT COALESCE(jsonb_agg(DISTINCT m), '[]'::jsonb) FROM jsonb_array_elements_text(ar.requested_modules || c.authorized_modules) m)
      FROM commerce_capture_requests c
      JOIN commerce_orders o ON TRUE
     WHERE c.id = ${captureId}::int AND c.status = 'authorized' AND ar.capture_request_id IS NULL AND ar.status = 'pending'
       AND o.id = ar.order_id AND o.order_status = 'paid'
       AND ar.requested_plan = c.authorized_plan
       AND lower(COALESCE((SELECT email FROM commerce_customers WHERE id = ar.customer_id), o.email)) = lower(c.email)
    RETURNING ar.id`));
  for (const { id } of r) await auditActivation(db, { activationRequestId: id, captureRequestId: captureId, actor: "system:link", action: "purchase_linked_to_authorization", details: { captureId } });
  return r.length;
}

interface Eligible { id: number; capture_id: number; decided_by: string; company: string | null; email: string }

export async function autoActivateEligible(): Promise<{ activated: number; skipped: number }> {
  if (!(await getPolicy()).autoActivateWhenPaidAndAuthorized) return { activated: 0, skipped: 0 };
  const list = dbRows<Eligible>(await db.execute(sql`
    SELECT ar.id, c.id AS capture_id, c.decided_by, c.company, c.email
      FROM activation_requests ar
      JOIN commerce_orders o ON o.id = ar.order_id AND o.order_status = 'paid'
      JOIN commerce_capture_requests c ON c.id = ar.capture_request_id AND c.status = 'authorized' AND c.authorized_plan = ar.requested_plan
     WHERE ar.status = 'pending' AND c.decided_by IS NOT NULL AND jsonb_array_length(ar.unmapped_items) = 0
     ORDER BY ar.id LIMIT 50`));
  let activated = 0; let skipped = 0;
  for (const e of list) {
    try {
      await approveActivation(e.id, { clerkId: e.decided_by }, { companyName: e.company ?? undefined, ownerEmail: e.email, automatic: true });
      await auditActivation(db, { activationRequestId: e.id, captureRequestId: e.capture_id, actor: "system:auto-activation", action: "auto_activated", details: { authorizedBy: e.decided_by } });
      activated++;
    } catch (err) {
      skipped++;
      if (err instanceof ActivationError && err.code === "invalid_state") continue; // otro proceso/administrador ya la gestionó
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ requestId: e.id, err: msg }, "[Commerce] activación automática no completada");
      const seen = dbRows(await db.execute(sql`SELECT 1 FROM activation_audit_logs WHERE activation_request_id=${e.id}::int AND action='auto_activation_failed' LIMIT 1`));
      if (!seen.length) await auditActivation(db, { activationRequestId: e.id, captureRequestId: e.capture_id, actor: "system:auto-activation", action: "auto_activation_failed", details: { reason: msg.slice(0, 300), needs: "activación manual" } });
    }
  }
  return { activated, skipped };
}

/** Atajo tras autorizar: enlaza compras ya pagadas y activa lo elegible. */
export async function onCaptureAuthorized(captureId: number): Promise<{ linked: number; activated: number }> {
  const linked = await linkExistingPaidPurchases(captureId);
  const { activated } = await autoActivateEligible();
  return { linked, activated };
}
