// ═══════════════════════════════════════════════════════════════════════════════
//  Activación manual — solo la ejecuta un SUPER_ADMIN desde Omni Control Center.
//
//  El navegador solo envía "apruebo la solicitud N" (+ opcionalmente a qué
//  empresa existente vincularla y a qué email invitar). Plan, módulos y estado
//  del pago se leen del servidor, nunca del cuerpo de la petición.
// ═══════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db, activationRequestsTable, activationAuditLogsTable, commerceOrdersTable, commerceCustomersTable,
  commerceSubscriptionsTable, billingHistoryTable, organizationsTable, licensePlansTable, moduleConfigsTable,
  orgInvitationsTable, type ActivationStatus,
} from "@workspace/db";
import { clearModuleCache } from "../middlewares/requireModule";
import { bumpOrgModuleVersion } from "../lib/moduleVersion";
import { modulesForPlan, SELLABLE_PLANS } from "../lib/planModules";
import { deliverInvitation } from "../lib/invitationDelivery";
import { sendEmail } from "../lib/email";
import { loadPolicies } from "./policies";
import { isAdminApiConfigured, fetchOrderPaymentState } from "./shopifyAdmin";

export class ActivationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

const REVIEWABLE: ActivationStatus[] = ["pending_review", "info_requested"];

export interface Actor { clerkUserId: string; userId: number | null }

export interface ApproveInput {
  linkOrgId?: number | null;   // vincular a una empresa existente en vez de crear una
  ownerEmail?: string | null;  // a quién invitar como owner (por defecto: email del cliente)
  notes?: string | null;
}

function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "empresa";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function approveActivation(requestId: number, actor: Actor, input: ApproveInput, baseUrl: string) {
  const policies = loadPolicies();

  // 1) Re-verificación del pago contra Shopify (si la Admin API está configurada) FUERA de la transacción.
  const [pre] = await db.select({ r: activationRequestsTable, o: commerceOrdersTable })
    .from(activationRequestsTable)
    .innerJoin(commerceOrdersTable, eq(commerceOrdersTable.id, activationRequestsTable.orderId))
    .where(eq(activationRequestsTable.id, requestId));
  if (!pre) throw new ActivationError("Solicitud no encontrada", 404);
  let verifiedVia = pre.r.paymentVerifiedVia ?? "webhook";
  if (pre.r.source === "shopify" && isAdminApiConfigured()) {
    const state = await fetchOrderPaymentState(pre.o.externalOrderId);
    if (!state.paid) throw new ActivationError(`Shopify indica que el pedido no está pagado (${state.financialStatus})`);
    if (state.test && !policies.allowTestOrders) throw new ActivationError("Pedido de prueba: no se puede activar en este entorno");
    verifiedVia = "admin_api";
  }

  const result = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(activationRequestsTable)
      .where(eq(activationRequestsTable.id, requestId)).for("update");
    if (!req) throw new ActivationError("Solicitud no encontrada", 404);
    if (!REVIEWABLE.includes(req.status as ActivationStatus)) {
      throw new ActivationError(`La solicitud está en estado "${req.status}" y no se puede aprobar`);
    }
    if (!req.paymentVerified) throw new ActivationError("El pago no está verificado");
    if (!req.requestedPlan || !(SELLABLE_PLANS as readonly string[]).includes(req.requestedPlan)) {
      throw new ActivationError("La solicitud no tiene un plan vendible asociado (revisa el SKU del producto)");
    }

    const [order] = await tx.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.id, req.orderId)).for("update");
    if (!order) throw new ActivationError("Pedido no encontrado", 404);
    if (order.orderStatus === "cancelled" || ["refunded", "voided"].includes(order.financialStatus)) {
      throw new ActivationError("El pedido está cancelado o reembolsado");
    }
    if (order.isTest && !policies.allowTestOrders) throw new ActivationError("Pedido de prueba: no se puede activar en este entorno");

    const [customer] = req.customerId
      ? await tx.select().from(commerceCustomersTable).where(eq(commerceCustomersTable.id, req.customerId))
      : [];

    // 2) Empresa: vincular o crear.
    let orgId: number;
    let orgCreated = false;
    if (input.linkOrgId) {
      const [org] = await tx.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, input.linkOrgId));
      if (!org) throw new ActivationError("La empresa a vincular no existe", 400);
      orgId = org.id;
    } else {
      const name = customer?.companyName || customer?.name || customer?.email || `Cliente pedido ${order.orderNumber ?? order.id}`;
      const [org] = await tx.insert(organizationsTable).values({
        name, slug: slugify(name), plan: req.requestedPlan, status: "active",
        legalName: customer?.companyName ?? null, taxId: customer?.taxId ?? null,
        email: customer?.email ?? null, phone: customer?.phone ?? null, country: "ES",
      }).returning({ id: organizationsTable.id });
      orgId = org!.id;
      orgCreated = true;
    }

    // 3) Licencia (license_plans no tiene UNIQUE(org_id): select + update/insert).
    const plan = req.requestedPlan;
    const [lic] = await tx.select({ id: licensePlansTable.id }).from(licensePlansTable)
      .where(and(eq(licensePlansTable.orgId, orgId), eq(licensePlansTable.isActive, true)));
    const licNote = `OmniCommerce: pedido ${order.orderNumber ?? order.externalOrderId} (${req.source})`;
    if (lic) {
      await tx.update(licensePlansTable).set({ plan, billingCycle: "monthly", notes: licNote, assignedBy: actor.clerkUserId, updatedAt: new Date() })
        .where(eq(licensePlansTable.id, lic.id));
    } else {
      await tx.insert(licensePlansTable).values({
        orgId, plan, billingCycle: "monthly", validFrom: new Date(), isActive: true, notes: licNote, assignedBy: actor.clerkUserId,
      });
    }
    await tx.update(organizationsTable).set({ plan, status: "active" }).where(eq(organizationsTable.id, orgId));

    // 4) Módulos del plan.
    for (const slug of modulesForPlan(plan)) {
      await tx.insert(moduleConfigsTable).values({ orgId, moduleSlug: slug, isEnabled: true, updatedBy: actor.clerkUserId })
        .onConflictDoUpdate({
          target: [moduleConfigsTable.orgId, moduleConfigsTable.moduleSlug],
          set: { isEnabled: true, updatedBy: actor.clerkUserId, updatedAt: new Date() },
        });
    }

    // 5) Vincular todo a la empresa.
    if (req.customerId) await tx.update(commerceCustomersTable).set({ orgId, updatedAt: new Date() }).where(eq(commerceCustomersTable.id, req.customerId));
    if (req.subscriptionId) {
      await tx.update(commerceSubscriptionsTable).set({ orgId, updatedAt: new Date() }).where(eq(commerceSubscriptionsTable.id, req.subscriptionId));
    }
    await tx.update(billingHistoryTable).set({ orgId }).where(and(eq(billingHistoryTable.orderId, order.id), isNull(billingHistoryTable.orgId)));

    const now = new Date();
    await tx.update(activationRequestsTable).set({
      status: "activated", orgId, reviewerClerkId: actor.clerkUserId, reviewNotes: input.notes ?? req.reviewNotes,
      paymentVerifiedVia: verifiedVia, decidedAt: now, activatedAt: now, lastError: null, updatedAt: now,
    }).where(eq(activationRequestsTable.id, req.id));
    await tx.insert(activationAuditLogsTable).values([
      { activationRequestId: req.id, actorClerkId: actor.clerkUserId, action: "approved", fromStatus: req.status, toStatus: "approved",
        details: { notes: input.notes ?? null, verifiedVia } },
      { activationRequestId: req.id, actorClerkId: actor.clerkUserId, action: "activated", fromStatus: "approved", toStatus: "activated",
        details: { orgId, orgCreated, plan, modules: modulesForPlan(plan) } },
    ]);

    // 6) Invitación de bienvenida (owner).
    const ownerEmail = (input.ownerEmail ?? customer?.email ?? "").trim().toLowerCase();
    let invitation: typeof orgInvitationsTable.$inferSelect | null = null;
    if (ownerEmail && EMAIL_RE.test(ownerEmail) && actor.userId) {
      [invitation] = await tx.insert(orgInvitationsTable).values({
        orgId, invitedBy: actor.userId, email: ownerEmail, role: "owner", token: randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning();
    }
    return { orgId, orgCreated, plan, invitation, ownerEmail };
  });

  clearModuleCache(result.orgId);
  bumpOrgModuleVersion(result.orgId);

  // El email va fuera de la transacción: si falla, la activación sigue en pie y se puede reenviar desde Invitaciones.
  const delivery = result.invitation ? await deliverInvitation(result.invitation, baseUrl) : null;
  return {
    ok: true, orgId: result.orgId, orgCreated: result.orgCreated, plan: result.plan,
    invitationSent: delivery?.emailSent ?? false, invitationError: delivery?.emailError ?? (result.invitation ? null : "Sin email válido o usuario invitante"),
    acceptUrl: delivery?.acceptUrl ?? null,
  };
}

export async function rejectActivation(requestId: number, actor: Actor, reason: string) {
  if (!reason?.trim()) throw new ActivationError("Indica el motivo del rechazo", 400);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(activationRequestsTable).where(eq(activationRequestsTable.id, requestId)).for("update");
    if (!req) throw new ActivationError("Solicitud no encontrada", 404);
    if (!["pending_payment", ...REVIEWABLE].includes(req.status as ActivationStatus)) {
      throw new ActivationError(`La solicitud está en estado "${req.status}" y no se puede rechazar`);
    }
    await tx.update(activationRequestsTable).set({
      status: "rejected", reviewerClerkId: actor.clerkUserId, reviewNotes: reason.trim(), decidedAt: new Date(), updatedAt: new Date(),
    }).where(eq(activationRequestsTable.id, req.id));
    await tx.insert(activationAuditLogsTable).values({
      activationRequestId: req.id, actorClerkId: actor.clerkUserId, action: "rejected", fromStatus: req.status, toStatus: "rejected",
      details: { reason: reason.trim() },
    });
    // El reembolso (si procede) se emite en Shopify; al llegar refunds/create queda en billing_history.
    return { ok: true, refundHint: "El rechazo no reembolsa: emite el reembolso desde Shopify si corresponde." };
  });
}

export async function requestMoreInfo(requestId: number, actor: Actor, message: string) {
  if (!message?.trim()) throw new ActivationError("Escribe qué información necesitas", 400);
  const out = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(activationRequestsTable).where(eq(activationRequestsTable.id, requestId)).for("update");
    if (!req) throw new ActivationError("Solicitud no encontrada", 404);
    if (!REVIEWABLE.includes(req.status as ActivationStatus) && req.status !== "pending_payment") {
      throw new ActivationError(`La solicitud está en estado "${req.status}"`);
    }
    const next: ActivationStatus = req.status === "pending_payment" ? "pending_payment" : "info_requested";
    await tx.update(activationRequestsTable).set({
      status: next, infoRequest: message.trim(), reviewerClerkId: actor.clerkUserId, updatedAt: new Date(),
    }).where(eq(activationRequestsTable.id, req.id));
    await tx.insert(activationAuditLogsTable).values({
      activationRequestId: req.id, actorClerkId: actor.clerkUserId, action: "info_requested", fromStatus: req.status, toStatus: next,
      details: { message: message.trim() },
    });
    const [customer] = req.customerId
      ? await tx.select({ email: commerceCustomersTable.email, name: commerceCustomersTable.name })
          .from(commerceCustomersTable).where(eq(commerceCustomersTable.id, req.customerId))
      : [];
    return { email: customer?.email ?? null, name: customer?.name ?? null };
  });

  let emailSent = false;
  if (out.email) {
    const safe = message.trim().replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
    const r = await sendEmail(out.email, "OmniTech Core — necesitamos un dato más para activar tu cuenta",
      `<p>Hola${out.name ? ` ${out.name}` : ""},</p><p>Estamos revisando tu contratación de OmniTech Core. Para completar la activación necesitamos:</p>` +
      `<blockquote>${safe.replace(/\n/g, "<br>")}</blockquote><p>Responde a este correo con la información y seguimos.</p><p>Equipo OmniTech Core</p>`);
    emailSent = r.ok;
  }
  return { ok: true, emailSent };
}
