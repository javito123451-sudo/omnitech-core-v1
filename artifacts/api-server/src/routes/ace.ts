/**
 * ACE — REST API
 *
 * Exposes the Ava Context Engine to the frontend via two minimal endpoints:
 *
 *   GET  /api/ace/context   → read current context snapshot
 *   PATCH /api/ace/context  → update context fields (frontend-driven changes)
 *
 * Both endpoints require: requireAuth → resolveOrg (mounted in routes/index.ts).
 * Identity fields (orgId, userId, role, permissions) are always derived from
 * the authenticated request — the frontend cannot override them.
 *
 * Security:
 *  - Multi-tenant isolation: context is keyed orgId:userId from req.* — no
 *    user can read or write another org's context.
 *  - No secrets or sensitive data are stored in the context.
 *  - IP is captured from req.ip (already available via Express) — no extra work.
 */

import { Router, type Request, type Response } from "express";
import {
  getCurrentContext,
  setContext,
  updateContext,
  touchActivity,
  type AceContextUpdate,
} from "../ace";

export const aceRouter = Router();

// ── GET /api/ace/context ──────────────────────────────────────────────────
// Returns the current context snapshot for the authenticated user.
// If no context exists yet, initialises one from the request identity.

aceRouter.get("/context", (req: Request, res: Response) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;

  // Touch activity on every read — the user is clearly active
  touchActivity(orgId, userId);

  let ctx = getCurrentContext(orgId, userId);

  if (!ctx) {
    // First access — bootstrap from auth middleware context
    ctx = setContext(orgId, userId, req.clerkUserId!, {
      orgRole:      req.orgRole      ?? "member",
      permissions:  req.permissions ? [...req.permissions] : [],
      platformRole: (req as Request & { platformRole?: string }).platformRole ?? null,
      ipAddress:    req.ip ?? null,
      browser:      parseBrowser(req.headers["user-agent"]),
      device:       parseDevice(req.headers["user-agent"]),
      language:     (req.headers["accept-language"] ?? "").split(",")[0]?.trim() ?? null,
    });
  }

  res.json({ ok: true, context: ctx });
});

// ── PATCH /api/ace/context ────────────────────────────────────────────────
// Applies a partial update sent by the frontend.
// Identity fields are never accepted from the client payload.

aceRouter.patch("/context", (req: Request, res: Response) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;

  // Strip any identity fields the client may attempt to send
  const {
    userId: _u, clerkUserId: _c, orgId: _o,
    orgRole: _r, permissions: _p, platformRole: _pl,
    sessionStartedAt: _s, lastActivity: _la,
    ...safePayload
  } = req.body as Partial<AceContextUpdate & Record<string, unknown>>;

  // Ensure a context exists before updating
  let ctx = getCurrentContext(orgId, userId);
  if (!ctx) {
    ctx = setContext(orgId, userId, req.clerkUserId!, {
      orgRole:      req.orgRole      ?? "member",
      permissions:  req.permissions ? [...req.permissions] : [],
      ipAddress:    req.ip ?? null,
      browser:      parseBrowser(req.headers["user-agent"]),
      device:       parseDevice(req.headers["user-agent"]),
      language:     (req.headers["accept-language"] ?? "").split(",")[0]?.trim() ?? null,
    });
  }

  const updated = updateContext(orgId, userId, safePayload as AceContextUpdate);

  res.json({ ok: true, context: updated ?? ctx });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function parseBrowser(ua: string | undefined): string | null {
  if (!ua) return null;
  if (ua.includes("Chrome"))  return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari"))  return "Safari";
  if (ua.includes("Edge"))    return "Edge";
  return "Unknown";
}

function parseDevice(ua: string | undefined): string | null {
  if (!ua) return null;
  if (/Mobi|Android/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua))  return "tablet";
  return "desktop";
}
