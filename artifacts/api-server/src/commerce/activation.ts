/**
 * Activación MANUAL. Único punto del sistema que crea empresa/workspace/licencia/módulos a
 * partir de una compra, y solo lo invoca un administrador autenticado desde el servidor
 * (routes/commerceControl.ts → requireSuperAdmin + SUPER_ADMIN). Ni el webhook ni el navegador
 * pueden aprobar: el cliente solo envía "aprobar"; el servidor verifica rol, estado y pago.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { bumpOrgModuleVersion } from "../lib/moduleVersion";
import { sendInvitationEmail, sendEmail } from "../lib/email";
import { logAuditSystem } from "../utils/auditLogger";
import { auditActivation } from "./lifecycle";
import { PLAN_PRODUCTS } from "./catalog";
import { dbRows } from "./settings";

export class ActivationError extends Error {
  constructor(public code: "not_found" | "invalid_state" | "payment_not_confirmed" | "not_authorized" | "invalid_input" | "approver_unknown", message: string) { super(message); }
}

export interface Actor { clerkId: string; email?: string }
export interface ApproveInput {
  companyName?: string;
  ownerEmail?: string;
  /** Vincular a una empresa existente en vez de crear una nueva. */
  existingOrgId?: number;
  seats?: number;
  baseUrl?: string;
  /** true cuando la activa el sistema (pago confirmado + autorización vigente); el actor es quien autorizó. */
  automatic?: boolean;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "empresa";

interface ReqRow {
  id: number; status: string; order_id: number; customer_id: number | null; subscription_id: number | null;
  requested_plan: string | null; requested_modules: string[]; order_status: string; capture_request_id: number | null;
  email: string | null; company: string | null; first_name: string | null; last_name: string | null; tax_id: string | null; phone: string | null;
}

async function loadLocked(tx: any, id: number): Promise<ReqRow> {
  const r = dbRows<ReqRow>(await tx.execute(sql`
    SELECT ar.id, ar.status, ar.order_id, ar.customer_id, ar.subscription_id, ar.requested_plan, ar.requested_modules, ar.capture_request_id,
           o.order_status, COALESCE(c.email, o.email) AS email, c.company, c.first_name, c.last_name, c.tax_id, c.phone
      FROM activation_requests ar
      JOIN commerce_orders o ON o.id = ar.order_id
      LEFT JOIN commerce_customers c ON c.id = ar.customer_id
     WHERE ar.id = ${id}::int FOR UPDATE OF ar`))[0];
  if (!r) throw new ActivationError("not_found", "Solicitud no encontrada");
  return r;
}

export async function approveActivation(requestId: number, actor: Actor, input: ApproveInput = {}) {
  const result = await db.transaction(async (tx) => {
    const approver = dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM users WHERE clerk_id=${actor.clerkId}::text`))[0];
    if (!approver) throw new ActivationError("approver_unknown", "El administrador no existe en users");
    const ar = await loadLocked(tx, requestId);
    if (!["pending", "info_requested"].includes(ar.status)) throw new ActivationError("invalid_state", `La solicitud está en estado '${ar.status}'`);
    if (ar.order_status !== "paid") throw new ActivationError("payment_not_confirmed", "El pago del pedido no está confirmado");
    // Autorización previa obligatoria: vigente y del mismo plan contratado. Sin ella NO se activa nunca.
    const cap = ar.capture_request_id ? dbRows<{ id: number; status: string; authorized_plan: string | null; authorized_until: string | null }>(await tx.execute(sql`
      SELECT id, status, authorized_plan, authorized_until FROM commerce_capture_requests WHERE id=${ar.capture_request_id}::int FOR UPDATE`))[0] : null;
    if (!cap || cap.status !== "authorized" || cap.authorized_plan !== ar.requested_plan)
      throw new ActivationError("not_authorized", "No hay una autorización previa vigente para este plan: la compra no se puede activar");
    const plan = ar.requested_plan;
    if (!plan || !PLAN_PRODUCTS.some((p) => p.plan === plan)) throw new ActivationError("invalid_input", "La solicitud no tiene un plan válido del catálogo");

    // 1. Empresa: vincular o crear
    let orgId: number;
    let orgName: string;
    if (input.existingOrgId) {
      const o = dbRows<{ id: number; name: string }>(await tx.execute(sql`SELECT id, name FROM organizations WHERE id=${input.existingOrgId}::int`))[0];
      if (!o) throw new ActivationError("invalid_input", "La empresa a vincular no existe");
      orgId = o.id; orgName = o.name;
      await tx.execute(sql`UPDATE organizations SET plan=${plan}::text WHERE id=${orgId}::int`);
    } else {
      orgName = (input.companyName ?? ar.company ?? `${ar.first_name ?? ""} ${ar.last_name ?? ""}`.trim()) || "";
      if (!orgName) throw new ActivationError("invalid_input", "Falta el nombre de la empresa");
      let slug = slugify(orgName);
      if (dbRows(await tx.execute(sql`SELECT 1 FROM organizations WHERE slug=${slug}::text`)).length) slug = `${slug}-${randomUUID().slice(0, 6)}`;
      const o = dbRows<{ id: number }>(await tx.execute(sql`
        INSERT INTO organizations (name, slug, plan, legal_name, tax_id, country, phone, email, wizard_state)
        VALUES (${orgName}::text, ${slug}::text, ${plan}::text, ${orgName}::text, ${ar.tax_id}::text, 'ES', ${ar.phone}::text, ${ar.email}::text,
                ${JSON.stringify({ createdByCommerce: true, activationRequestId: ar.id, orderId: ar.order_id })}::jsonb)
        RETURNING id`))[0]!;
      orgId = o.id;
    }

    // 2. Licencia (license_plans existente; la suspensión posterior solo toca is_active)
    const lic = dbRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO license_plans (org_id, plan, seats, is_active, billing_cycle, assigned_by, notes)
      VALUES (${orgId}::int, ${plan}::text, ${input.seats ?? 5}::int, TRUE, 'monthly', ${actor.clerkId}::text, ${"Activación comercial #" + ar.id}::text)
      RETURNING id`))[0]!;

    // 3. Módulos contratados explícitamente (los del plan los resuelve el gating existente de auth.ts)
    for (const slug of ar.requested_modules ?? []) {
      await tx.execute(sql`
        INSERT INTO module_configs (org_id, module_slug, is_enabled, updated_by) VALUES (${orgId}::int, ${slug}::text, TRUE, ${actor.clerkId}::text)
        ON CONFLICT (org_id, module_slug) DO UPDATE SET is_enabled=TRUE, updated_by=EXCLUDED.updated_by, updated_at=NOW()`);
    }

    // 4. Acceso del propietario: miembro si ya existe, invitación 'owner' si no
    const ownerEmail = (input.ownerEmail ?? ar.email ?? "").trim().toLowerCase();
    let invitation: { token: string; email: string; expiresAt: Date } | null = null;
    if (ownerEmail) {
      const u = dbRows<{ id: number }>(await tx.execute(sql`SELECT id FROM users WHERE lower(email)=${ownerEmail}::text LIMIT 1`))[0];
      if (u) {
        await tx.execute(sql`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}::int, ${u.id}::int, 'owner') ON CONFLICT (org_id, user_id) DO NOTHING`);
      } else {
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
        await tx.execute(sql`INSERT INTO org_invitations (org_id, invited_by, email, role, token, expires_at)
                             VALUES (${orgId}::int, ${approver.id}::int, ${ownerEmail}::text, 'owner', ${token}::text, ${expiresAt.toISOString()}::timestamptz)`);
        invitation = { token, email: ownerEmail, expiresAt };
      }
    }

    // 5. Estado comercial
    await tx.execute(sql`UPDATE commerce_capture_requests SET status='converted', updated_at=NOW() WHERE id=${cap.id}::int`);
    await tx.execute(sql`UPDATE activation_requests SET status='approved', decided_by=${actor.clerkId}::text, decided_at=NOW(), org_id=${orgId}::int, license_id=${lic.id}::int, updated_at=NOW() WHERE id=${ar.id}::int`);
    if (ar.subscription_id) {
      await tx.execute(sql`UPDATE commerce_subscriptions SET org_id=${orgId}::int, license_id=${lic.id}::int, plan=${plan}::text,
                           status = CASE WHEN status='pending' THEN 'active' ELSE status END, updated_at=NOW() WHERE id=${ar.subscription_id}::int`);
    }
    if (ar.customer_id) await tx.execute(sql`UPDATE commerce_customers SET org_id=${orgId}::int WHERE id=${ar.customer_id}::int`);
    await auditActivation(tx, { activationRequestId: ar.id, subscriptionId: ar.subscription_id, actor: actor.clerkId, action: "activation_approved", from: ar.status, to: "approved",
      details: { orgId, licenseId: lic.id, plan, modules: ar.requested_modules, linkedExisting: !!input.existingOrgId, automatic: input.automatic === true } });
    return { orgId, orgName, licenseId: lic.id, plan, invitation, customerEmail: ownerEmail || ar.email };
  });

  bumpOrgModuleVersion(result.orgId);
  await logAuditSystem({ actorClerkId: actor.clerkId, actorEmail: actor.email, action: "commerce_activation_approved", resource: "activation_request", resourceId: requestId, orgId: result.orgId, details: { plan: result.plan, licenseId: result.licenseId }, severity: "warning" });

  // 6. Correo de bienvenida: fuera de la transacción; su fallo no revierte la activación.
  let welcome: { ok: boolean; error?: string } = { ok: false, error: "sin email de destino" };
  if (result.invitation) {
    const base = input.baseUrl ?? process.env["PUBLIC_APP_URL"] ?? process.env["PUBLIC_URL"] ?? "";
    welcome = await sendInvitationEmail({ to: result.invitation.email, inviterName: "Omnitech-Core", orgName: result.orgName, role: "owner",
      acceptUrl: `${base}/invite/${result.invitation.token}`, expiresAt: result.invitation.expiresAt });
  } else if (result.customerEmail) {
    welcome = await sendEmail(result.customerEmail, `Tu entorno ${result.orgName} en Omnitech-Core está activo`,
      `<p>Hola, tu contratación ha sido aprobada y tu entorno <b>${result.orgName}</b> ya está activo. Accede con tu cuenta habitual.</p>`);
  }
  await db.execute(sql`SELECT 1`); // mantiene el orden antes de auditar el resultado del email
  await auditActivation(db, { activationRequestId: requestId, actor: "system:welcome-email", action: welcome.ok ? "welcome_email_sent" : "welcome_email_failed", details: { error: welcome.error } });
  return { ...result, welcomeEmailSent: welcome.ok };
}

async function transition(requestId: number, actor: Actor, to: "rejected" | "info_requested", note: string) {
  if (!note?.trim()) throw new ActivationError("invalid_input", "Se requiere un motivo/mensaje");
  return db.transaction(async (tx) => {
    const ar = await loadLocked(tx, requestId);
    if (!["pending", "info_requested"].includes(ar.status)) throw new ActivationError("invalid_state", `La solicitud está en estado '${ar.status}'`);
    await tx.execute(sql`UPDATE activation_requests SET status=${to}::text, decided_by=${actor.clerkId}::text, decided_at=NOW(), decision_note=${note}::text, updated_at=NOW() WHERE id=${requestId}::int`);
    await auditActivation(tx, { activationRequestId: requestId, actor: actor.clerkId, action: to === "rejected" ? "activation_rejected" : "info_requested", from: ar.status, to, details: { note } });
    return { id: requestId, status: to, customerEmail: ar.email };
  });
}

export const rejectActivation = (id: number, actor: Actor, reason: string) => transition(id, actor, "rejected", reason);
export const requestMoreInfo = (id: number, actor: Actor, message: string) => transition(id, actor, "info_requested", message);
