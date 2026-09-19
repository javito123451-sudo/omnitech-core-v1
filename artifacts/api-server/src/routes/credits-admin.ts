/**
 * OmniCredits — administración para Super Admin.
 *
 * Se monta en Control Center (bajo requireSuperAdmin), en /control-center/credits.
 * Lectura: consumo global, por workspace/agente/modelo, concedido, consumido,
 * ajustes, compras, devoluciones, errores y consumo anómalo. Escritura (créditos,
 * planes, precios): solo SUPER_ADMIN real (req.isSuperAdmin es estricto aquí,
 * STAFF_OMNITECH no), y TODA operación queda en audit_logs con el antes y el
 * después. Los saldos no se editan: solo se generan movimientos de ledger.
 */
import { Router, type Request, type Response } from "express";
import { logAudit } from "../utils/auditLogger";
import {
  adjustCredits, expireCredits, grantCredits, listLedger, refundCredits, verifyLedgerIntegrity,
} from "../credits/creditService";
import { CreditError, ReferenceConflictError } from "../credits/errors";
import { detectAnomalies, raiseAnomalyAlerts } from "../credits/alerts";
import { listPlanConfigs, upsertPlanConfig, type PlanPatch } from "../credits/planService";
import { listPurchases, recordPurchase, reversePurchase } from "../credits/purchaseService";
import { listPacks, purchasePack, upsertPack, type PackPatch } from "../credits/packService";
import { getDashboard, getGlobalOverview } from "../credits/reporting";
import { renewSubscription } from "../credits/subscriptionService";
import { deactivateModelPricing, getPricingReport, listPricing, PricingError, setModelPricing, type PricingInput } from "../ai-gateway/pricingService";
import { applyOfficialPricing, type OfficialPriceInput } from "../ai-gateway/officialPricing";

export const creditsAdminRouter = Router();

const orgIdOf = (req: Request): number | null => {
  const id = Number(req.params["orgId"]);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function requireStrictSuperAdmin(req: Request, res: Response): boolean {
  if (req.isSuperAdmin) return true;
  res.status(403).json({ error: "Solo SUPER_ADMIN puede modificar créditos, planes o precios." });
  return false;
}

function fail(res: Response, err: unknown) {
  if (err instanceof ReferenceConflictError) { res.status(409).json({ status: err.code, error: err.message, reference: err.reference }); return; }
  if (err instanceof CreditError || err instanceof PricingError) { res.status(400).json({ error: err.message }); return; }
  res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
}

const audit = (req: Request, action: string, resourceId: string | number, orgId: number | undefined, details: Record<string, unknown>) =>
  logAudit({ actorClerkId: req.clerkUserId!, action, resource: "credits", resourceId, orgId, details, severity: "warning", req });

// ── Lectura global ───────────────────────────────────────────────────────────

creditsAdminRouter.get("/overview", async (req, res) => {
  try { res.json(await getGlobalOverview({ days: req.query["days"] ? Number(req.query["days"]) : undefined })); } catch (err) { fail(res, err); }
});

creditsAdminRouter.get("/anomalies", async (_req, res) => {
  try { res.json(await detectAnomalies()); } catch (err) { fail(res, err); }
});

// Registra (una vez al día por org) las alertas de consumo anómalo detectadas.
creditsAdminRouter.post("/anomalies/raise", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const raised = await raiseAnomalyAlerts();
    res.json({ raised: raised.length, alerts: raised });
  } catch (err) { fail(res, err); }
});

// ── Precios de modelos (configuración, con vigencia) ─────────────────────────

creditsAdminRouter.get("/pricing", async (req, res) => {
  try {
    res.json(await listPricing({ provider: req.query["provider"] as string | undefined, model: req.query["model"] as string | undefined }));
  } catch (err) { fail(res, err); }
});

creditsAdminRouter.put("/pricing", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const body = req.body as PricingInput & { effectiveFrom?: string };
    const result = await setModelPricing({ ...body, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined }, req.clerkUserId ?? null);
    await audit(req, "ai_pricing_changed", result.current.id, undefined, { provider: body.provider, model: body.model, previous: result.previous, current: result.current });
    res.status(201).json(result);
  } catch (err) { fail(res, err); }
});

// Estado del pricing: modelos con precio oficial validado vs. provisionales (legacy / sin validar).
creditsAdminRouter.get("/pricing/report", async (_req, res) => {
  try { res.json(await getPricingReport()); } catch (err) { fail(res, err); }
});

// Carga de precios OFICIALES: todo-o-nada, con 'source' obligatorio y provisional=false. Sin valores por defecto.
creditsAdminRouter.post("/pricing/official", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const entries = (req.body as { entries?: Array<Omit<OfficialPriceInput, "effectiveFrom"> & { effectiveFrom?: string }> }).entries ?? [];
    const applied = await applyOfficialPricing(entries.map((e) => ({ ...e, effectiveFrom: e.effectiveFrom ? new Date(e.effectiveFrom) : undefined })), req.clerkUserId ?? null);
    for (const a of applied) {
      await audit(req, "ai_pricing_changed", a.current.id, undefined, { provider: a.current.provider, model: a.current.model, official: true, source: a.current.source, previous: a.previous, current: a.current });
    }
    res.status(201).json(applied);
  } catch (err) { fail(res, err); }
});

creditsAdminRouter.delete("/pricing/:id", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const row = await deactivateModelPricing(Number(req.params["id"]));
    if (!row) { res.status(404).json({ error: "Precio no encontrado o ya desactivado." }); return; }
    await audit(req, "ai_pricing_deactivated", row.id, undefined, { provider: row.provider, model: row.model });
    res.json(row);
  } catch (err) { fail(res, err); }
});

// ── Configuración comercial por plan ─────────────────────────────────────────

creditsAdminRouter.get("/plans", async (_req, res) => {
  try { res.json(await listPlanConfigs()); } catch (err) { fail(res, err); }
});

creditsAdminRouter.put("/plans/:plan", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const plan = String(req.params["plan"]);
    const result = await upsertPlanConfig(plan, req.body as PlanPatch, req.clerkUserId ?? null);
    await audit(req, "credit_plan_changed", plan, undefined, { plan, previous: result.previous, current: result.current });
    res.json(result);
  } catch (err) { fail(res, err); }
});

// ── Catálogo de OmniCredits extra (packs) ────────────────────────────────────

creditsAdminRouter.get("/packs", async (_req, res) => {
  try { res.json(await listPacks()); } catch (err) { fail(res, err); }
});

creditsAdminRouter.put("/packs/:code", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  try {
    const code = String(req.params["code"]);
    const result = await upsertPack(code, req.body as PackPatch, req.clerkUserId ?? null);
    await audit(req, "credit_pack_changed", code, undefined, { code, previous: result.previous, current: result.current });
    res.json(result);
  } catch (err) { fail(res, err); }
});

// ── Un workspace ─────────────────────────────────────────────────────────────

creditsAdminRouter.get("/:orgId", async (req, res) => {
  const orgId = orgIdOf(req);
  if (!orgId) { res.status(400).json({ error: "orgId no válido" }); return; }
  try {
    res.json({
      dashboard: await getDashboard(orgId, new Date(), { technical: true }), ledger: await listLedger(orgId, { limit: 50 }),
      purchases: await listPurchases(orgId, 20), integrity: await verifyLedgerIntegrity(orgId),
    });
  } catch (err) { fail(res, err); }
});

creditsAdminRouter.get("/:orgId/integrity", async (req, res) => {
  const orgId = orgIdOf(req);
  if (!orgId) { res.status(400).json({ error: "orgId no válido" }); return; }
  try { res.json(await verifyLedgerIntegrity(orgId)); } catch (err) { fail(res, err); }
});

// Movimientos manuales. Nunca un "set saldo": cada uno es un movimiento de ledger inmutable.
creditsAdminRouter.post("/:orgId/entries", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  const orgId = orgIdOf(req);
  const { type, credits, reason, reference } = req.body as { type?: string; credits?: number; reason?: string; reference?: string };
  const amount = Number(credits);
  if (!orgId || !Number.isFinite(amount)) { res.status(400).json({ error: "orgId o credits no válidos" }); return; }
  // La referencia es la clave de idempotencia: obligatoria. Se acepta en el cuerpo o como cabecera Idempotency-Key.
  const key = (reference ?? req.header("idempotency-key") ?? "").trim() || null;
  if (!key) { res.status(400).json({ status: "CREDIT_INVALID", error: "Falta la referencia: envía `reference` en el cuerpo o la cabecera Idempotency-Key (evita aplicar dos veces un doble envío)." }); return; }
  const opts = { userClerkId: req.clerkUserId!, reference: key, reason, source: "manual" };
  try {
    const result =
      type === "grant"      ? await grantCredits(orgId, amount, opts) :
      type === "adjustment" ? await adjustCredits(orgId, amount, { ...opts, reason: reason ?? "" }) :
      type === "refund"     ? await refundCredits(orgId, amount, { ...opts, reason: reason ?? "" }) :
      type === "expiration" ? await expireCredits(orgId, amount, { ...opts, reason: reason ?? "" }) :
      null;
    if (!result) { res.status(400).json({ error: "type debe ser grant, adjustment, refund o expiration (las compras van en /purchases)" }); return; }
    await audit(req, `credits_${type}`, result.entry.id, orgId, {
      credits: amount, reason: reason ?? null, reference: key,
      balanceBefore: result.entry.balanceBefore, balanceAfter: result.entry.balanceAfter, duplicate: result.duplicate,
    });
    res.status(result.duplicate ? 200 : 201).json({ entry: result.entry, balance: result.balance, duplicate: result.duplicate });
  } catch (err) { fail(res, err); }
});

creditsAdminRouter.post("/:orgId/purchases", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  const orgId = orgIdOf(req);
  if (!orgId) { res.status(400).json({ error: "orgId no válido" }); return; }
  try {
    const b = req.body as { packCode?: string; credits?: number; priceAmount?: number; currency?: string; paymentReference?: string; expiresAt?: string };
    // paymentReference es la clave de idempotencia y es obligatoria (cuerpo o cabecera Idempotency-Key).
    const paymentReference = (b.paymentReference ?? req.header("idempotency-key") ?? "").trim();
    if (!paymentReference) { res.status(400).json({ status: "CREDIT_INVALID", error: "Falta paymentReference (o la cabecera Idempotency-Key): es la clave de idempotencia de la compra." }); return; }
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    // Compra de un pack del catálogo (créditos y precio salen del catálogo) o una compra libre.
    const result = b.packCode
      ? await purchasePack({ orgId, packCode: b.packCode, paymentReference, expiresAt, userClerkId: req.clerkUserId ?? null })
      : await recordPurchase({
          orgId, credits: Number(b.credits), priceAmount: b.priceAmount ?? null, currency: b.currency,
          paymentReference, expiresAt, userClerkId: req.clerkUserId ?? null,
        });
    if (!result.duplicate) {
      await audit(req, "credits_purchase", result.purchase.id, orgId, {
        packCode: b.packCode ?? null, credits: Number(result.purchase.credits), priceAmount: Number(result.purchase.priceAmount ?? 0),
        currency: result.purchase.currency, paymentReference, balanceAfter: result.entry?.balanceAfter,
      });
    }
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) { fail(res, err); }
});

creditsAdminRouter.post("/:orgId/purchases/:purchaseId/reverse", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  const orgId = orgIdOf(req);
  if (!orgId) { res.status(400).json({ error: "orgId no válido" }); return; }
  try {
    const purchaseId = Number(req.params["purchaseId"]);
    const { reason } = req.body as { reason?: string };
    const result = await reversePurchase(orgId, purchaseId, { reason: reason ?? "", userClerkId: req.clerkUserId ?? null });
    await audit(req, "credits_purchase_reversed", purchaseId, orgId, { reason, balanceAfter: result.entry.balanceAfter });
    res.json(result);
  } catch (err) { fail(res, err); }
});

// Renovación de los créditos incluidos del plan (idempotente por periodo).
creditsAdminRouter.post("/:orgId/renew", async (req, res) => {
  if (!requireStrictSuperAdmin(req, res)) return;
  const orgId = orgIdOf(req);
  if (!orgId) { res.status(400).json({ error: "orgId no válido" }); return; }
  try {
    const result = await renewSubscription(orgId, { userClerkId: req.clerkUserId ?? null });
    if (result.status === "granted" || result.expired > 0) await audit(req, "credits_subscription_renewed", result.period ?? "-", orgId, { ...result });
    res.json(result);
  } catch (err) { fail(res, err); }
});
