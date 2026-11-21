// Tests puros (sin BD) de OmniCommerce: firma HMAC, mapeo de Shopify y políticas.
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyShopifyHmac, isExpectedShop } from "../shopifyVerify";
import {
  normalizeFinancialStatus, isPaid, mapContractStatus, refundTotal, normalizeCustomer, orderStatusOf, noteAttribute, isRenewalOrder,
} from "../shopifyMapping";
import { loadPolicies, onPaymentFailed, onPaymentSucceeded, shouldSuspendNow } from "../policies";

const SECRET = "test-secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");

describe("verifyShopifyHmac", () => {
  const body = JSON.stringify({ id: 1, total_price: "149.00" });
  it("acepta una firma correcta sobre el cuerpo crudo", () => {
    expect(verifyShopifyHmac(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });
  it("rechaza firma de otro secreto, cuerpo alterado, cabecera ausente o secreto sin configurar", () => {
    expect(verifyShopifyHmac(Buffer.from(body), sign(body, "otro"), SECRET)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(body.replace("149", "1")), sign(body), SECRET)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(body), undefined, SECRET)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(body), sign(body), undefined)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(body), "basura", SECRET)).toBe(false);
  });
  it("valida el dominio de la tienda sin distinguir mayúsculas", () => {
    expect(isExpectedShop("OmniTech.myshopify.com", "omnitech.myshopify.com")).toBe(true);
    expect(isExpectedShop("otra.myshopify.com", "omnitech.myshopify.com")).toBe(false);
    expect(isExpectedShop("omnitech.myshopify.com", undefined)).toBe(false);
  });
});

describe("mapeo Shopify", () => {
  it("solo 'paid' cuenta como pago confirmado (authorized no)", () => {
    expect(isPaid(normalizeFinancialStatus("paid"))).toBe(true);
    expect(isPaid(normalizeFinancialStatus("authorized"))).toBe(false);
    expect(isPaid(normalizeFinancialStatus("partially_paid"))).toBe(false);
    expect(normalizeFinancialStatus(undefined)).toBe("pending");
  });
  it("mapea estados de contrato", () => {
    expect(mapContractStatus("ACTIVE")).toBe("active");
    expect(mapContractStatus("paused")).toBe("suspended");
    expect(mapContractStatus("cancelled")).toBe("cancelled");
    expect(mapContractStatus("failed")).toBe("past_due");
  });
  it("suma solo transacciones de reembolso correctas", () => {
    expect(refundTotal({ id: 1, order_id: 2, transactions: [
      { id: 1, amount: "100.00", kind: "refund", status: "success" },
      { id: 2, amount: "49.00", kind: "refund", status: "failure" },
      { id: 3, amount: "49.00" },
    ] })).toBe(149);
  });
  it("detecta pedidos de renovación", () => {
    expect(isRenewalOrder({ id: 1, source_name: "subscription_contract" })).toBe(true);
    expect(isRenewalOrder({ id: 1, tags: "VIP, Subscription Recurring Order" })).toBe(true);
    expect(isRenewalOrder({ id: 1, source_name: "web" })).toBe(false);
  });
  it("normaliza cliente, estado de pedido y atributos de checkout", () => {
    expect(normalizeCustomer({ id: 9, email: " Ana@X.ES ", first_name: "Ana", last_name: "Ruiz" }))
      .toMatchObject({ externalCustomerId: "9", email: "ana@x.es", name: "Ana Ruiz" });
    expect(orderStatusOf({ id: 1, cancelled_at: "2026-01-01" })).toBe("cancelled");
    expect(noteAttribute({ id: 1, note_attributes: [{ name: "NIF", value: " B12345678 " }] }, "nif")).toBe("B12345678");
  });
});

describe("políticas configurables", () => {
  const p = loadPolicies({ COMMERCE_GRACE_DAYS: "3", COMMERCE_ALLOW_TEST_ORDERS: "true" } as NodeJS.ProcessEnv);
  const now = new Date("2026-11-21T10:00:00Z");
  it("lee la configuración del entorno con valores por defecto seguros", () => {
    expect(p.graceDays).toBe(3);
    expect(p.allowTestOrders).toBe(true);
    expect(loadPolicies({} as NodeJS.ProcessEnv).allowTestOrders).toBe(false);
    expect(loadPolicies({} as NodeJS.ProcessEnv).graceDays).toBe(7);
  });
  it("un cobro fallido abre gracia y los reintentos no la alargan", () => {
    const r = onPaymentFailed("active", now, p, null);
    expect(r.status).toBe("grace");
    expect(r.graceUntil!.toISOString()).toBe("2026-11-24T10:00:00.000Z");
    const later = onPaymentFailed("grace", new Date("2026-11-23T10:00:00Z"), p, r.graceUntil);
    expect(later.graceUntil).toEqual(r.graceUntil);
  });
  it("un cobro correcto reactiva solo si la política lo permite", () => {
    expect(onPaymentSucceeded("suspended", p)).toEqual({ status: "active", reactivateOrg: true });
    expect(onPaymentSucceeded("suspended", { ...p, autoReactivateOnPayment: false }).reactivateOrg).toBe(false);
    expect(onPaymentSucceeded("cancelled", p).status).toBe("cancelled");
  });
  it("suspende al vencer la gracia o tras la cancelación, nunca dos veces", () => {
    const base = { cancelledAt: null, suspendedAt: null };
    expect(shouldSuspendNow({ ...base, status: "grace", graceUntil: new Date("2026-11-20") }, now, p)).toBe(true);
    expect(shouldSuspendNow({ ...base, status: "grace", graceUntil: new Date("2026-11-30") }, now, p)).toBe(false);
    expect(shouldSuspendNow({ status: "cancelled", graceUntil: null, cancelledAt: now, suspendedAt: null }, now, p)).toBe(true);
    expect(shouldSuspendNow({ status: "grace", graceUntil: new Date("2026-11-20"), cancelledAt: null, suspendedAt: now }, now, p)).toBe(false);
  });
});
