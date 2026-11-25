/**
 * Captación y autorización previa.
 * Orden obligatorio: 1) se capta (formulario público)  2) un SUPER_ADMIN autoriza plan y módulos
 * 3) el cliente puede contratar  4) pagado el pedido, un administrador activa (activation.ts).
 * Sin autorización vigente y coincidente con el plan, la activación se rechaza.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PLAN_PRODUCTS, MODULE_PRODUCTS } from "./catalog";
import { auditActivation, type Executor } from "./lifecycle";
import { dbRows } from "./settings";

export class CaptureError extends Error {
  constructor(public code: "invalid_input" | "not_found" | "invalid_state", message: string) { super(message); }
}

export interface CaptureInput {
  email: string; name: string; company?: string; phone?: string; planInterest?: string; modulesInterest?: string[];
  message?: string; consentPrivacy: boolean; consentMarketing?: boolean; source?: string;
}
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** Devuelve siempre éxito para el visitante (sin enumerar emails); `created` solo para uso interno/tests. */
export async function createCaptureRequest(i: CaptureInput): Promise<{ created: boolean }> {
  const email = clip(i.email, 320)?.toLowerCase() ?? "";
  const name = clip(i.name, 200);
  if (!EMAIL_RE.test(email)) throw new CaptureError("invalid_input", "Email no válido");
  if (!name) throw new CaptureError("invalid_input", "Falta el nombre");
  if (i.consentPrivacy !== true) throw new CaptureError("invalid_input", "Es obligatorio aceptar la política de privacidad");
  const plan = i.planInterest && PLAN_PRODUCTS.some((p) => p.plan === i.planInterest) ? i.planInterest : null;
  const modules = (i.modulesInterest ?? []).filter((m) => MODULE_PRODUCTS.some((x) => x.slug === m)).slice(0, 30);
  const r = dbRows<{ id: number }>(await db.execute(sql`
    INSERT INTO commerce_capture_requests (email, name, company, phone, plan_interest, modules_interest, message, source, consent_privacy_at, consent_marketing)
    VALUES (${email}::text, ${name}::text, ${clip(i.company, 200)}::text, ${clip(i.phone, 40)}::text, ${plan}::text, ${JSON.stringify(modules)}::jsonb,
            ${clip(i.message, 2000)}::text, ${clip(i.source, 40) ?? "shopify_store"}::text, NOW(), ${i.consentMarketing === true}::boolean)
    ON CONFLICT (lower(email)) WHERE status IN ('new','info_requested','authorized') DO NOTHING RETURNING id`));
  if (r[0]) await auditActivation(db, { captureRequestId: r[0].id, actor: "public:form", action: "capture_received", to: "new" });
  return { created: !!r[0] };
}

export interface CaptureActor { clerkId: string }

async function lockCapture(tx: Executor, id: number) {
  const r = dbRows<{ id: number; status: string; email: string }>(await tx.execute(sql`SELECT id, status, email FROM commerce_capture_requests WHERE id=${id}::int FOR UPDATE`))[0];
  if (!r) throw new CaptureError("not_found", "Solicitud de captación no encontrada");
  return r;
}

export async function authorizeCapture(id: number, actor: CaptureActor, o: { plan: string; modules?: string[]; validDays?: number }) {
  if (!PLAN_PRODUCTS.some((p) => p.plan === o.plan)) throw new CaptureError("invalid_input", "Plan no válido");
  const modules = o.modules ?? [];
  const bad = modules.filter((m) => !MODULE_PRODUCTS.some((x) => x.slug === m));
  if (bad.length) throw new CaptureError("invalid_input", `Módulos no válidos: ${bad.join(", ")}`);
  const days = Math.min(Math.max(Math.trunc(o.validDays ?? 14), 1), 90);
  return db.transaction(async (tx) => {
    const c = await lockCapture(tx, id);
    if (!["new", "info_requested", "authorized"].includes(c.status)) throw new CaptureError("invalid_state", `La solicitud está en estado '${c.status}'`);
    await tx.execute(sql`UPDATE commerce_capture_requests SET status='authorized', authorized_plan=${o.plan}::text, authorized_modules=${JSON.stringify(modules)}::jsonb,
      authorized_until=NOW() + make_interval(days => ${days}::int), decided_by=${actor.clerkId}::text, decided_at=NOW(), updated_at=NOW() WHERE id=${id}::int`);
    await auditActivation(tx, { captureRequestId: id, actor: actor.clerkId, action: "capture_authorized", from: c.status, to: "authorized", details: { plan: o.plan, modules, validDays: days } });
    return { id, status: "authorized", email: c.email, plan: o.plan, validDays: days };
  });
}

async function decide(id: number, actor: CaptureActor, to: "rejected" | "info_requested", note: string) {
  if (!note?.trim()) throw new CaptureError("invalid_input", "Se requiere un motivo/mensaje");
  return db.transaction(async (tx) => {
    const c = await lockCapture(tx, id);
    if (!["new", "info_requested", "authorized"].includes(c.status)) throw new CaptureError("invalid_state", `La solicitud está en estado '${c.status}'`);
    await tx.execute(sql`UPDATE commerce_capture_requests SET status=${to}::text, authorized_plan=NULL, authorized_until=NULL, decided_by=${actor.clerkId}::text, decided_at=NOW(), decision_note=${note}::text, updated_at=NOW() WHERE id=${id}::int`);
    await auditActivation(tx, { captureRequestId: id, actor: actor.clerkId, action: to === "rejected" ? "capture_rejected" : "capture_info_requested", from: c.status, to, details: { note } });
    return { id, status: to, email: c.email };
  });
}
export const rejectCapture = (id: number, a: CaptureActor, reason: string) => decide(id, a, "rejected", reason);
export const requestCaptureInfo = (id: number, a: CaptureActor, msg: string) => decide(id, a, "info_requested", msg);

/** Autorización vigente (no caducada) para ese email y plan. Se consulta al registrar un pedido pagado. */
export async function findValidAuthorization(ex: Executor, email: string | null, plan: string | null): Promise<{ id: number; modules: string[] } | null> {
  if (!email || !plan) return null;
  const r = dbRows<{ id: number; authorized_modules: string[] }>(await ex.execute(sql`
    SELECT id, authorized_modules FROM commerce_capture_requests
     WHERE lower(email)=lower(${email}::text) AND status='authorized' AND authorized_plan=${plan}::text AND authorized_until > NOW()
     ORDER BY id DESC LIMIT 1`))[0];
  return r ? { id: r.id, modules: r.authorized_modules ?? [] } : null;
}

export async function expireAuthorizations(): Promise<number> {
  const r = dbRows<{ id: number }>(await db.execute(sql`
    UPDATE commerce_capture_requests c SET status='expired', updated_at=NOW() WHERE c.status='authorized' AND c.authorized_until < NOW()
       AND NOT EXISTS (SELECT 1 FROM activation_requests ar WHERE ar.capture_request_id=c.id) RETURNING c.id`));
  for (const { id } of r) await auditActivation(db, { captureRequestId: id, actor: "system:expiry", action: "capture_authorization_expired", from: "authorized", to: "expired" });
  return r.length;
}
