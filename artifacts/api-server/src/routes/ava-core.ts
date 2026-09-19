// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — routes
//  Mounted after requireAuth/resolveOrg/resolvePermissions (see routes/index.ts),
//  so req.orgId/req.userId/req.clerkUserId/req.orgRole are already resolved
//  from the backend before anything here runs.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { resolveAvaContext, AvaContextRouterError } from "../ava-core/contextRouter";
import { runAvaCoreAsk, confirmAvaAction } from "../ava-core/engine";
import { logAudit } from "../utils/auditLogger";
import { AiBudgetBlockedError } from "../ai-gateway/gateway";
import type { AvaAskRequest, AvaContextType } from "../ava-core/types";

export const avaCoreRouter = Router();

avaCoreRouter.post("/ask", async (req, res) => {
  try {
    const body = req.body as AvaAskRequest;
    const message = String(body.message ?? "").trim();
    if (!message) { res.status(400).json({ error: "message es requerido" }); return; }

    const requestedContext: AvaContextType | undefined =
      body.context === "super_admin" || body.context === "crm" ? body.context : undefined;

    const ctx = await resolveAvaContext(req, requestedContext);
    const response = await runAvaCoreAsk(ctx, message, body.sessionId);

    if (response.proposal) {
      await logAudit({
        actorClerkId: req.clerkUserId!,
        action: "ava_action_proposed",
        resource: "ava_action",
        resourceId: response.proposal.actionId,
        orgId: req.orgId,
        details: { actorType: "ava", contextType: ctx.type, proposal: response.proposal },
        req,
      });
    }

    res.json(response);
  } catch (err) {
    if (err instanceof AvaContextRouterError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof AiBudgetBlockedError) {
      res.status(429).json({ error: err.reason });
      return;
    }
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

avaCoreRouter.post("/confirm", async (req, res) => {
  try {
    const { confirmToken, confirm } = req.body as { confirmToken?: string; confirm?: boolean };
    if (!confirmToken || confirm !== true) {
      res.status(400).json({ error: "Se requiere confirmToken y confirm:true explícito." });
      return;
    }
    // The action itself is always executed in the CRM context — Ava Super
    // Admin has no writable actions in this phase.
    const ctx = await resolveAvaContext(req, "crm");

    const { actionId, params, result } = await confirmAvaAction(ctx, confirmToken);

    await logAudit({
      actorClerkId: req.clerkUserId!,
      action: "ava_action_executed",
      resource: "ava_action",
      resourceId: actionId,
      orgId: req.orgId,
      details: { actorType: "ava", contextType: ctx.type, params, result },
      severity: "warning",
      req,
    });

    res.json({ ok: true, actionId, result });
  } catch (err) {
    await logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "ava_action_failed",
      resource: "ava_action",
      orgId: req.orgId,
      details: { actorType: "ava", error: String(err instanceof Error ? err.message : err) },
      severity: "warning",
      req,
    });
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});
