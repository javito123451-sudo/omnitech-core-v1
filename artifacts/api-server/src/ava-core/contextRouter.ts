// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — Context Router
//
//  Decides whether a request is served in the SUPER_ADMIN or CRM context.
//  The client MAY hint which context it wants (e.g. "I'm on /control-center"),
//  but that hint is never trusted alone — this file re-derives the real role
//  from the backend on every request.
//
//  IMPORTANT — a subtlety found while auditing middlewares/auth.ts: resolveOrg()
//  sets req.isSuperAdmin = true for BOTH "SUPER_ADMIN" and "STAFF_OMNITECH"
//  platform roles (it's a coarse "can bypass workspace RBAC" flag used
//  elsewhere in the app). That is NOT strict enough for Ava Super Admin: the
//  approved design explicitly excludes STAFF_OMNITECH from Ava's admin
//  context. So this router does NOT read req.isSuperAdmin — it calls
//  hasPlatformRole() directly and checks for the literal "SUPER_ADMIN" role,
//  the same strict check requireSuperAdmin() and GET /control-center/check
//  already use.
// ═══════════════════════════════════════════════════════════════════════════

import type { Request } from "express";
import { hasPlatformRole } from "../middlewares/superAdmin";
import type { AvaContext, AvaContextType } from "./types";

export class AvaContextRouterError extends Error {}

export async function resolveAvaContext(
  req: Request,
  requested?: AvaContextType,
): Promise<AvaContext> {
  if (!req.clerkUserId || !req.userId || !req.orgId) {
    throw new AvaContextRouterError("No hay sesión/workspace resuelto para Ava.");
  }

  const platformRole = await hasPlatformRole(req.clerkUserId);
  const isRealSuperAdmin = platformRole === "SUPER_ADMIN";

  // The client may ask for "super_admin", but it's only ever granted when
  // the backend independently confirms the real platform role.
  if (requested === "super_admin") {
    if (!isRealSuperAdmin) {
      throw new AvaContextRouterError(
        "Ava Super Admin no está disponible para este usuario.",
      );
    }
    return {
      type: "super_admin",
      orgId: req.orgId,
      userId: req.userId,
      clerkUserId: req.clerkUserId,
      orgRole: req.orgRole ?? "none",
      platformRole,
    };
  }

  // Default / explicit "crm": always available to any authenticated,
  // org-scoped user — permission checks for individual CRM tools/actions
  // happen inside each tool, not here.
  return {
    type: "crm",
    orgId: req.orgId,
    userId: req.userId,
    clerkUserId: req.clerkUserId,
    orgRole: req.orgRole ?? "none",
    platformRole,
  };
}
