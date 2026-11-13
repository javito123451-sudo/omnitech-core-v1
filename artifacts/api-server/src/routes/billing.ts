import { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, quotesTable, clientsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, resolveOrg } from "../middlewares/auth";

export const billingRouter = Router();

const STRIPE_API = "https://api.stripe.com/v1";
const PLAN_CONFIG = {
  starter: {
    upfrontPrice: "price_1UbMxyR9AWvOm3bbLpfYwJmY",
    monthlyPrice: "price_1UbMqGR9AWvOm3bbSwwafXBq",
    amount: 29700,
  },
  professional: {
    upfrontPrice: "price_1UbMy0R9AWvOm3bb09TiHws5",
    monthlyPrice: "price_1UbMriR9AWvOm3bbqNkNX8Px",
    amount: 74700,
  },
  enterprise: {
    upfrontPrice: "price_1UbMy2R9AWvOm3bbno00rRoC",
    monthlyPrice: "price_1UbMrkR9AWvOm3bbDVrnrewa",
    annualPrice: "price_1UbMx3R9AWvOm3bbp9dkFSZk",
    amount: 300000,
    annualAmount: 1000000,
  },
} as const;

type Plan = keyof typeof PLAN_CONFIG;

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no está configurada");
  return key;
}

async function stripeRequest(path: string, method: "GET" | "POST", params?: URLSearchParams, idempotencyKey?: string) {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: params,
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = (payload.error as { message?: string } | undefined)?.message ?? "Error de Stripe";
    throw new Error(message);
  }
  return payload;
}

function verifyStripeSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const parts = signature.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0 || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return signatures.some((candidate) => {
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

billingRouter.post("/checkout", requireAuth, resolveOrg, async (req, res) => {
  try {
    const orgId = (req as Request & { orgId?: number }).orgId;
    const { quoteId, plan, recurringConsent, annual } = req.body as {
      quoteId?: number; plan?: Plan; recurringConsent?: boolean; annual?: boolean;
    };
    if (!orgId || !quoteId || !plan || !(plan in PLAN_CONFIG)) {
      res.status(400).json({ error: "quoteId y un plan válido son obligatorios" });
      return;
    }
    if (recurringConsent !== true) {
      res.status(400).json({ error: "El cliente debe aceptar expresamente la renovación y el importe recurrente antes de continuar." });
      return;
    }
    if (annual && plan !== "enterprise") {
      res.status(400).json({ error: "La modalidad anual está disponible únicamente para Enterprise." });
      return;
    }

    const [quote] = await db.select().from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    if (!quote || quote.status !== "accepted") {
      res.status(409).json({ error: "Solo se puede iniciar el cobro de un presupuesto aceptado." });
      return;
    }
    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, quote.clientId), eq(clientsTable.orgId, orgId)));
    if (!client?.email) {
      res.status(400).json({ error: "El cliente necesita un email válido para el Checkout." });
      return;
    }

    const config = PLAN_CONFIG[plan];
    const params = new URLSearchParams();
    params.set("mode", annual ? "subscription" : "payment");
    params.set("success_url", `${process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? "https://app.omnitech-core.com/billing/success"}?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", process.env.STRIPE_CHECKOUT_CANCEL_URL ?? "https://app.omnitech-core.com/billing/cancel");
    params.set("customer_email", client.email);
    if (!annual) {
      params.set("customer_creation", "always");
      params.set("payment_intent_data[setup_future_usage]", "off_session");
      params.set("line_items[0][price]", config.upfrontPrice);
      params.set("line_items[0][quantity]", "1");
      params.set("metadata[omni_flow]", "quarterly_first_purchase");
      params.set("metadata[recurring_price_id]", config.monthlyPrice);
      params.set("metadata[trial_months]", "4");
    } else {
      params.set("line_items[0][price]", config.annualPrice!);
      params.set("line_items[0][quantity]", "1");
      params.set("subscription_data[metadata][omni_flow]", "enterprise_annual");
      params.set("subscription_data[metadata][org_id]", String(orgId));
      params.set("subscription_data[metadata][quote_id]", String(quoteId));
      params.set("subscription_data[metadata][client_id]", String(client.id));
      params.set("subscription_data[metadata][plan]", plan);
    }
    params.set("metadata[org_id]", String(orgId));
    params.set("metadata[quote_id]", String(quoteId));
    params.set("metadata[client_id]", String(client.id));
    params.set("metadata[plan]", plan);
    params.set("metadata[recurring_consent]", "true");
    const session = await stripeRequest("/checkout/sessions", "POST", params, `omni-checkout-${orgId}-${quoteId}-${plan}-${annual ? "annual" : "quarterly"}`);
    res.status(201).json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo iniciar Checkout" });
  }
});

billingRouter.post("/webhook", async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.header("stripe-signature");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!secret || !signature || !rawBody || !verifyStripeSignature(rawBody, signature, secret)) {
    res.status(400).json({ error: "Firma de Stripe no válida" });
    return;
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch {
    res.status(400).json({ error: "Payload inválido" });
    return;
  }

  try {
    const seen = await db.execute(sql`SELECT 1 FROM stripe_webhook_events WHERE event_id = ${event.id} LIMIT 1`);
    if ((seen as { rows: unknown[] }).rows.length > 0) {
      res.json({ received: true, duplicate: true });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = (session.metadata ?? {}) as Record<string, string>;
      if (metadata.omni_flow === "quarterly_first_purchase" && session.payment_status === "paid") {
        const customerId = String(session.customer ?? "");
        const paymentIntentId = String(session.payment_intent ?? "");
        const recurringPriceId = metadata.recurring_price_id;
        if (!customerId || !paymentIntentId || !recurringPriceId || metadata.recurring_consent !== "true") {
          throw new Error("Checkout pagado sin datos suficientes para programar la renovación");
        }
        const intent = await stripeRequest(`/payment_intents/${paymentIntentId}`, "GET");
        const paymentMethod = String(intent.payment_method ?? "");
        if (!paymentMethod) throw new Error("No se ha guardado un método de pago para la renovación");
        const trialEnd = new Date();
        trialEnd.setUTCMonth(trialEnd.getUTCMonth() + 4);
        const subscriptionParams = new URLSearchParams();
        subscriptionParams.set("customer", customerId);
        subscriptionParams.set("default_payment_method", paymentMethod);
        subscriptionParams.set("items[0][price]", recurringPriceId);
        subscriptionParams.set("trial_end", String(Math.floor(trialEnd.getTime() / 1000)));
        subscriptionParams.set("collection_method", "charge_automatically");
        subscriptionParams.set("metadata[org_id]", metadata.org_id ?? "");
        subscriptionParams.set("metadata[quote_id]", metadata.quote_id ?? "");
        subscriptionParams.set("metadata[client_id]", metadata.client_id ?? "");
        subscriptionParams.set("metadata[plan]", metadata.plan ?? "");
        subscriptionParams.set("metadata[omni_flow]", "quarterly_then_monthly");
        await stripeRequest("/subscriptions", "POST", subscriptionParams, `omni-subscription-${event.id}`);
      }
    }

    await db.execute(sql`INSERT INTO stripe_webhook_events (event_id, event_type, processed_at) VALUES (${event.id}, ${event.type}, NOW()) ON CONFLICT (event_id) DO NOTHING`);
    res.json({ received: true });
  } catch (error) {
    console.error("[Stripe webhook]", error);
    res.status(500).json({ error: "No se pudo procesar el evento; Stripe reintentará la entrega." });
  }
});
