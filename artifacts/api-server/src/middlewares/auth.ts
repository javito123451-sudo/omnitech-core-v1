import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, orgMembersTable, organizationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

    // ── Check if user account is suspended ────────────────────────────────────
    if (user.status === "suspended") {
      res.status(403).json({
        error:   "account_suspended",
        message: user.suspendedReason ?? "Tu cuenta ha sido suspendida. Contacta con soporte.",
      });
      return;
    }

    const [membership] = await db
      .select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role })
      .from(orgMembersTable)
      .where(eq(orgMembersTable.userId, user.id));

    if (!membership) {
      res.status(403).json({ error: "no_org", message: "User has no organization." });
      return;
    }

    // ── Check if workspace is suspended ───────────────────────────────────────
    const [org] = await db
      .select({ status: organizationsTable.status, name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, membership.orgId));

    if (org?.status === "suspended") {
      res.status(403).json({
        error:   "workspace_suspended",
        message: `El workspace "${org.name}" está suspendido. Contacta con soporte en support@omnitechcore.com`,
      });
      return;
    }

    req.userId  = user.id;
    req.orgId   = membership.orgId;
    req.orgRole = membership.role;
    next();
  } catch (err) {
    console.error(`[resolveOrg] 500 — ${String(err)} | method=${req.method} url=${req.url}`);
    res.status(500).json({ error: String(err) });
  }
};
