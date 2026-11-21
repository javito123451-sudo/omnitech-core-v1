// OmniCommerce Bridge — los 15 escenarios obligatorios, end-to-end contra Postgres real
// y a través del endpoint HTTP real del webhook (firma HMAC incluida).
// Simulación controlada: payloads con la forma de los webhooks de Shopify, sin cobros reales.
//
// Requiere DATABASE_URL apuntando a una BD desechable con las migraciones aplicadas
// (ver docs/omnicommerce/README.md). Sin ella, se salta limpiamente.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createHmac, randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, organizationsTable, usersTable, licensePlansTable, moduleConfigsTable, orgInvitationsTable,
  commerceOrdersTable, commerceSubscriptionsTable, commerceWebhookEventsTable, activationRequestsTable,
  activationAuditLogsTable, billingHistoryTable,
} from "@workspace/db";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const SECRET = "whsec-test";
const SHOP = "omnitech-test.myshopify.com";

describe.skipIf(!hasRealDb)("OmniCommerce Bridge — escenarios obligatorios", () => {
  let baseUrl = "";
  let server: import("http").Server;
  let bridge: typeof import("../bridge");
  let activation: typeof import("../activation");
  let commerceAdminRouter: import("express").Router;
  let adminUserId = 0;
  const createdOrgIds: number[] = [];
  const run = Date.now();
  let seq = 0;
  const ext = () => `${run}${++seq}`;

  beforeAll(async () => {
    process.env["SHOPIFY_WEBHOOK_SECRET"] = SECRET;
    process.env["SHOPIFY_SHOP_DOMAIN"] = SHOP;
    process.env["COMMERCE_GRACE_DAYS"] = "3";
    delete process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"]; // sin Admin API: no se llama a Shopify real
    bridge = await import("../bridge");
    activation = await import("../activation");
    const { commerceWebhooksRouter } = await import("../../routes/commerceWebhooks");
    ({ commerceAdminRouter } = await import("../../routes/commerce-admin"));

    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
    app.use("/commerce/webhooks", commerceWebhooksRouter);
    // Admin con identidad inyectada por cabecera SOLO en este test (simula requireSuperAdmin).
    app.use("/cc/commerce", (req, _res, next) => {
      req.clerkUserId = "test_admin";
      req.isSuperAdmin = req.header("x-test-role") === "SUPER_ADMIN";
      req.userId = adminUserId;
      next();
    }, commerceAdminRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const [u] = await db.insert(usersTable).values({ clerkId: `test_admin_${run}`, email: `admin-${run}@test.local`, name: "Admin Test" })
      .returning({ id: usersTable.id });
    adminUserId = u!.id;
  });

  afterAll(async () => {
    server?.close();
    if (createdOrgIds.length) {
      await db.delete(orgInvitationsTable).where(inArray(orgInvitationsTable.orgId, createdOrgIds));
    }
    await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
    // Los registros commerce_* de prueba se conservan a propósito (no hay borrado en cascada por diseño).
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function send(topic: string, payload: unknown, opts: { webhookId?: string; secret?: string; shop?: string } = {}) {
    const body = JSON.stringify(payload);
    const hmac = createHmac("sha256", opts.secret ?? SECRET).update(body).digest("base64");
    const res = await fetch(`${baseUrl}/commerce/webhooks/shopify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Shopify-Hmac-Sha256": hmac, "X-Shopify-Topic": topic,
        "X-Shopify-Shop-Domain": opts.shop ?? SHOP, "X-Shopify-Webhook-Id": opts.webhookId ?? randomUUID(),
      },
      body,
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }
  async function admin(path: string, body: unknown, role = "SUPER_ADMIN") {
    const res = await fetch(`${baseUrl}/cc/commerce${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-role": role }, body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }
  const order = (id: string, financial_status: string, extra: Record<string, unknown> = {}) => ({
    id, name: `#T${id.slice(-4)}`, email: `cliente${id}@test.local`, financial_status, total_price: "149.00", currency: "EUR",
    test: false, customer: { id: `c${id}`, email: `cliente${id}@test.local`, first_name: "Cliente", last_name: id },
    note_attributes: [{ name: "Empresa", value: `Empresa Test ${id}` }, { name: "NIF", value: "B00000000" }],
    line_items: [{ sku: "omnitech-plan-starter", title: "OmniTech Core Starter", quantity: 1, price: "149.00", variant_id: 1 }],
    ...extra,
  });
  const requestFor = async (externalOrderId: string) => {
    const [o] = await db.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.externalOrderId, externalOrderId));
    const [r] = await db.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, o!.id));
    return { order: o!, req: r! };
  };
  const orgStatus = async (id: number) => (await db.select({ s: organizationsTable.status }).from(organizationsTable).where(eq(organizationsTable.id, id)))[0]?.s;

  // Estado compartido del "cliente feliz" (escenarios 1, 4–9, 13).
  const happy = ext();
  let happyOrgId = 0;
  const contractId = `sc${happy}`;

  it("1 · compra satisfactoria → pedido registrado y solicitud pendiente de revisión", async () => {
    const r = await send("orders/create", order(happy, "paid"));
    expect(r.status).toBe(200);
    const { order: o, req } = await requestFor(happy);
    expect(o.financialStatus).toBe("paid");
    expect(req.status).toBe("pending_review");
    expect(req.requestedPlan).toBe("starter");
  });

  it("2 · pedido duplicado → un único pedido, una única solicitud, un único cobro", async () => {
    await send("orders/updated", order(happy, "paid"));
    await send("orders/paid", order(happy, "paid"));
    const orders = await db.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.externalOrderId, happy));
    expect(orders).toHaveLength(1);
    const reqs = await db.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, orders[0]!.id));
    expect(reqs).toHaveLength(1);
    const charges = await db.select().from(billingHistoryTable).where(eq(billingHistoryTable.orderId, orders[0]!.id));
    expect(charges.filter((c) => c.kind === "charge")).toHaveLength(1);
  });

  const pending = ext();
  it("3 · pago pendiente → solicitud en pending_payment, no aprobable", async () => {
    await send("orders/create", order(pending, "pending"));
    const { req } = await requestFor(pending);
    expect(req.status).toBe("pending_payment");
    expect(req.paymentVerified).toBe(false);
    const r = await admin(`/activation-requests/${req.id}/approve`, {});
    expect(r.status).toBe(409);
  });

  it("4 · pago confirmado → pasa a pending_review con pago verificado y cobro registrado", async () => {
    await send("orders/paid", order(pending, "paid"));
    const { req, order: o } = await requestFor(pending);
    expect(req.status).toBe("pending_review");
    expect(req.paymentVerified).toBe(true);
    const audit = await db.select().from(activationAuditLogsTable).where(eq(activationAuditLogsTable.activationRequestId, req.id));
    expect(audit.map((a) => a.action)).toContain("payment_confirmed");
    const charges = await db.select().from(billingHistoryTable).where(eq(billingHistoryTable.orderId, o.id));
    expect(charges.some((c) => c.kind === "charge")).toBe(true);
  });

  it("5 · solicitud pendiente → la compra NO ha creado empresa ni licencia", async () => {
    const { req } = await requestFor(happy);
    expect(req.orgId).toBeNull();
    expect(req.activatedAt).toBeNull();
  });

  it("6/7/8 · aprobación administrativa → crea workspace, asigna módulos del plan y genera licencia", async () => {
    await send("subscription_contracts/create", { id: contractId, status: "active", customer_id: `c${happy}`, origin_order_id: happy });
    const { req } = await requestFor(happy);
    const r = await admin(`/activation-requests/${req.id}/approve`, { notes: "OK test" });
    expect(r.status).toBe(200);
    expect(r.body["orgCreated"]).toBe(true);
    happyOrgId = r.body["orgId"] as number;
    createdOrgIds.push(happyOrgId);

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, happyOrgId));
    expect(org!.plan).toBe("starter");
    expect(org!.status).toBe("active");
    expect(org!.name).toBe(`Empresa Test ${happy}`);
    expect(org!.taxId).toBe("B00000000");
    const mods = await db.select().from(moduleConfigsTable).where(eq(moduleConfigsTable.orgId, happyOrgId));
    expect(mods.map((m) => m.moduleSlug).sort()).toEqual(
      ["ai_agents", "crm", "knowledge_base", "omni_accounting", "omni_agent_factory", "omni_marketing", "portal_cliente", "quotes", "whatsapp"]);
    const lic = await db.select().from(licensePlansTable).where(eq(licensePlansTable.orgId, happyOrgId));
    expect(lic).toHaveLength(1);
    expect(lic[0]!.plan).toBe("starter");
    const inv = await db.select().from(orgInvitationsTable).where(eq(orgInvitationsTable.orgId, happyOrgId));
    expect(inv[0]!.role).toBe("owner");
    expect(inv[0]!.email).toBe(`cliente${happy}@test.local`);
    const after = await requestFor(happy);
    expect(after.req.status).toBe("activated");
    const [sub] = await db.select().from(commerceSubscriptionsTable).where(eq(commerceSubscriptionsTable.externalContractId, contractId));
    expect(sub!.orgId).toBe(happyOrgId);

    // Aprobar dos veces no crea otra empresa.
    const again = await admin(`/activation-requests/${req.id}/approve`, {});
    expect(again.status).toBe(409);
  });

  it("9 · renovación mensual → cobro de renovación registrado y suscripción activa", async () => {
    const r = await send("subscription_billing_attempts/success", { id: `ba${ext()}`, subscription_contract_id: contractId, order_id: null });
    expect(r.status).toBe(200);
    const [sub] = await db.select().from(commerceSubscriptionsTable).where(eq(commerceSubscriptionsTable.externalContractId, contractId));
    expect(sub!.status).toBe("active");
    const renewals = await db.select().from(billingHistoryTable).where(eq(billingHistoryTable.subscriptionId, sub!.id));
    expect(renewals.some((b) => b.kind === "renewal")).toBe(true);
  });

  it("10 · pago fallido → periodo de gracia; al vencer, la empresa se suspende (sin borrar datos)", async () => {
    await send("subscription_billing_attempts/failure", { id: `ba${ext()}`, subscription_contract_id: contractId, error_code: "card_declined" });
    let [sub] = await db.select().from(commerceSubscriptionsTable).where(eq(commerceSubscriptionsTable.externalContractId, contractId));
    expect(sub!.status).toBe("grace");
    expect(sub!.failedPaymentCount).toBe(1);
    expect(await orgStatus(happyOrgId)).toBe("active"); // durante la gracia sigue activa

    const out = await bridge.runCommercePolicyTick(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000));
    expect(out.suspended).toContain(happyOrgId);
    [sub] = await db.select().from(commerceSubscriptionsTable).where(eq(commerceSubscriptionsTable.externalContractId, contractId));
    expect(sub!.status).toBe("suspended");
    expect(await orgStatus(happyOrgId)).toBe("suspended");
    expect(await db.select().from(licensePlansTable).where(eq(licensePlansTable.orgId, happyOrgId))).toHaveLength(1);
  });

  it("13 · reactivación → un cobro correcto tras la suspensión reactiva la empresa", async () => {
    await send("subscription_billing_attempts/success", { id: `ba${ext()}`, subscription_contract_id: contractId });
    const [sub] = await db.select().from(commerceSubscriptionsTable).where(eq(commerceSubscriptionsTable.externalContractId, contractId));
    expect(sub!.status).toBe("active");
    expect(sub!.suspendedAt).toBeNull();
    expect(await orgStatus(happyOrgId)).toBe("active");
  });

  it("9b · pedido de renovación (Shopify Subscriptions) → se registra como renovación y NO abre solicitud", async () => {
    const id = ext();
    await send("orders/create", order(id, "paid", { source_name: "subscription_contract", customer: { id: `c${happy}`, email: `cliente${happy}@test.local` } }));
    const [o] = await db.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.externalOrderId, id));
    expect(await db.select().from(activationRequestsTable).where(eq(activationRequestsTable.orderId, o!.id))).toHaveLength(0);
    const [b] = await db.select().from(billingHistoryTable).where(eq(billingHistoryTable.orderId, o!.id));
    expect(b!.kind).toBe("renewal");
    expect(b!.orgId).toBe(happyOrgId);
  });

  it("11 · cancelación → la empresa se suspende en el siguiente tick y conserva sus datos", async () => {
    await send("subscription_contracts/update", { id: contractId, status: "cancelled", customer_id: `c${happy}`, origin_order_id: happy });
    const out = await bridge.runCommercePolicyTick(new Date(Date.now() + 1000));
    expect(out.suspended).toContain(happyOrgId);
    expect(await orgStatus(happyOrgId)).toBe("suspended");
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, happyOrgId));
    expect(org).toBeTruthy();
  });

  it("12 · reembolso → reembolso total de un pedido sin activar lo rechaza automáticamente", async () => {
    const id = ext();
    await send("orders/create", order(id, "paid"));
    await send("refunds/create", { id: `r${id}`, order_id: id, transactions: [{ id: 1, amount: "149.00", kind: "refund", status: "success" }] });
    const { req, order: o } = await requestFor(id);
    expect(o.financialStatus).toBe("refunded");
    expect(req.status).toBe("rejected");
    const refunds = (await db.select().from(billingHistoryTable).where(eq(billingHistoryTable.orderId, o.id))).filter((b) => b.kind === "refund");
    expect(refunds).toHaveLength(1);
  });

  it("14 · acceso no autorizado → firma inválida, otra tienda o rol sin permiso son rechazados", async () => {
    const id = ext();
    expect((await send("orders/create", order(id, "paid"), { secret: "falso" })).status).toBe(401);
    expect((await send("orders/create", order(id, "paid"), { shop: "intrusa.myshopify.com" })).status).toBe(401);
    expect(await db.select().from(commerceOrdersTable).where(eq(commerceOrdersTable.externalOrderId, id))).toHaveLength(0);

    await send("orders/create", order(id, "paid"));
    const { req } = await requestFor(id);
    expect((await admin(`/activation-requests/${req.id}/approve`, {}, "STAFF_OMNITECH")).status).toBe(403);
    expect((await admin(`/activation-requests/${req.id}/reject`, { reason: "x" }, "STAFF_OMNITECH")).status).toBe(403);
    // Pedido de prueba (test mode) no se puede activar en producción.
    const t = ext();
    await send("orders/create", order(t, "paid", { test: true }));
    const testReq = await requestFor(t);
    const tr = await admin(`/activation-requests/${testReq.req.id}/approve`, {});
    expect(tr.status).toBe(409);
    expect(String(tr.body["error"])).toMatch(/prueba/);
  });

  it("15 · reenvío de webhook → mismo X-Shopify-Webhook-Id se ignora; un fallo se reintenta y converge", async () => {
    const id = ext();
    const webhookId = randomUUID();
    const first = await send("orders/create", order(id, "paid"), { webhookId });
    const dup = await send("orders/create", order(id, "paid"), { webhookId });
    expect(first.body["outcome"]).toBe("processed");
    expect(dup.body["outcome"]).toBe("duplicate");

    // Reembolso que llega ANTES que su pedido: falla, Shopify reintentará (500)…
    const lateId = ext();
    const refundHook = randomUUID();
    const early = await send("refunds/create", { id: `r${lateId}`, order_id: lateId, transactions: [{ id: 1, amount: "149.00" }] }, { webhookId: refundHook });
    expect(early.status).toBe(500);
    const [ev] = await db.select().from(commerceWebhookEventsTable).where(eq(commerceWebhookEventsTable.eventId, refundHook));
    expect(ev!.status).toBe("failed");
    // …llega el pedido, y el reintento manual desde Control Center lo procesa.
    await send("orders/create", order(lateId, "paid"));
    const retry = await admin(`/webhook-events/${ev!.id}/retry`, {});
    expect(retry.body["outcome"]).toBe("processed");
    const [evAfter] = await db.select().from(commerceWebhookEventsTable).where(eq(commerceWebhookEventsTable.id, ev!.id));
    expect(evAfter!.payload).toBeNull(); // RGPD: el payload no se conserva tras procesar
    expect((await requestFor(lateId)).req.status).toBe("rejected");
  });

  it("extra · rechazar y pedir información quedan auditados", async () => {
    const a = ext();
    await send("orders/create", order(a, "paid"));
    const ra = await requestFor(a);
    expect((await admin(`/activation-requests/${ra.req.id}/request-info`, { message: "Necesitamos el NIF correcto" })).status).toBe(200);
    expect((await requestFor(a)).req.status).toBe("info_requested");
    expect((await admin(`/activation-requests/${ra.req.id}/reject`, {})).status).toBe(400);
    expect((await admin(`/activation-requests/${ra.req.id}/reject`, { reason: "Datos fiscales no válidos" })).status).toBe(200);
    const actions = (await db.select().from(activationAuditLogsTable).where(eq(activationAuditLogsTable.activationRequestId, ra.req.id))).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["created", "info_requested", "rejected"]));
    void activation;
  });
});
