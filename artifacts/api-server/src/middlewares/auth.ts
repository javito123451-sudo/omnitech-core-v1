import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, orgMembersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hasPlatformRole } from "./superAdmin";
import { enterSupportMode, resolvePermissions } from "./permissions";
import { logAudit } from "../utils/auditLogger";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      clerkUserId?: string;
      orgId?: number;
      orgRole?: string;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;

  if (!clerkUserId) {
    const hasAuthHeader = !!req.headers["authorization"];
    const hasCookie     = !!(req.headers["cookie"] ?? "").includes("__session");
    console.warn(
      `[requireAuth] 401 Unauthorized` +
      ` | method=${req.method} url=${req.url}` +
      ` | userId=null sessionId=${auth?.sessionId ?? "null"}` +
      ` | hasAuthHeader=${hasAuthHeader} hasSessionCookie=${hasCookie}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.clerkUserId = clerkUserId;
  next();
};

export const resolveOrg = async (req: Request, res: Response, next: NextFunction) => {
  const clerkUserId = req.clerkUserId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));

    if (!user) {
      res.status(403).json({ error: "User not provisioned. Call /api/auth/me first." });
      return;
    }

    if (user.status === "suspended") {
      res.status(403).json({
        error:   "account_suspended",
        message: user.suspendedReason ?? "Tu cuenta ha sido suspendida. Contacta con soporte.",
      });
      return;
    }

    // ── SUPER_ADMIN workspace supervision override (Support Mode) ─────────────
    const wsOverrideHeader = req.headers["x-ws-override"];
    if (wsOverrideHeader && typeof wsOverrideHeader === "string") {
      const overrideOrgId = parseInt(wsOverrideHeader, 10);
      if (!isNaN(overrideOrgId) && overrideOrgId > 0) {
        const platformRole = await hasPlatformRole(clerkUserId);
        if (platformRole === "SUPER_ADMIN" || platformRole === "STAFF_OMNITECH") {
          const [targetOrg] = await db
            .select({ status: organizationsTable.status, name: organizationsTable.name })
            .from(organizationsTable)
            .where(eq(organizationsTable.id, overrideOrgId));
          if (!targetOrg) {
            res.status(404).json({ error: "workspace_not_found", message: "Workspace no encontrado." });
            return;
          }
          if (targetOrg.status === "suspended") {
            res.status(403).json({
              error:   "workspace_suspended",
              message: `El workspace "${targetOrg.name}" está suspendido.`,
            });
            return;
          }
          // Activate support mode: admin enters client workspace with audit trail
          const supportReason = (req.headers["x-support-reason"] as string) || "Sin motivo especificado";
          enterSupportMode(req, clerkUserId, overrideOrgId, "admin");
          req.userId  = user.id;
          req.orgId   = overrideOrgId;
          req.orgRole = "admin";
          logAudit({
            actorClerkId: clerkUserId,
            action: "support_mode_entered",
            resource: "workspace",
            resourceId: String(overrideOrgId),
            orgId: overrideOrgId,
            details: { platformRole, targetOrgName: targetOrg.name, reason: supportReason },
            severity: "warning",
            result: "success",
            req,
          });
          next();
          return;
        }
      }
    }

    // ── Multi-workspace support: pick active org from header or first membership ─
    const activeWsHeader = req.headers["x-active-workspace"];
    let memberships = await db
      .select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role, isSuspended: orgMembersTable.isSuspended })
      .from(orgMembersTable)
      .where(eq(orgMembersTable.userId, user.id));

    if (memberships.length === 0) {
      res.status(403).json({ error: "no_org", message: "User has no organization." });
      return;
    }

    // Filter out suspended memberships
    memberships = memberships.filter(m => !m.isSuspended);
    if (memberships.length === 0) {
      res.status(403).json({ error: "all_orgs_suspended", message: "Tus organizaciones están suspendidas." });
      return;
    }

    let selectedMembership = memberships[0];
    if (activeWsHeader && typeof activeWsHeader === "string") {
      const requestedOrgId = parseInt(activeWsHeader, 10);
      const found = memberships.find(m => m.orgId === requestedOrgId);
      if (found) selectedMembership = found;
    }

    const [org] = await db
      .select({ status: organizationsTable.status, name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, selectedMembership.orgId));

    if (org?.status === "suspended") {
      res.status(403).json({
        error:   "workspace_suspended",
        message: `El workspace "${org.name}" está suspendido. Contacta con soporte en support@omnitechcore.com`,
      });
      return;
    }

    req.userId  = user.id;
    req.orgId   = selectedMembership.orgId;
    req.orgRole = selectedMembership.role;
    next();
  } catch (err) {
    console.error(`[resolveOrg] 500 — ${String(err)} | method=${req.method} url=${req.url}`);
    res.status(500).json({ error: String(err) });
  }
};
