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
    console.warn(`[resolveOrg] 401 — clerkUserId missing on req (requireAuth bypassed?)`);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));

    if (!user) {
      console.warn(
        `[resolveOrg] 403 — clerkUserId=${clerkUserId} not found in usersTable` +
        ` | method=${req.method} url=${req.url}`,
      );
      res.status(403).json({ error: "User not provisioned. Call /api/auth/me first." });
      return;
    }

    const [membership] = await db
      .select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role })
      .from(orgMembersTable)
      .where(eq(orgMembersTable.userId, user.id));

    if (!membership) {
      console.warn(
        `[resolveOrg] 403 no_org — userId=${user.id} clerkUserId=${clerkUserId}` +
        ` | method=${req.method} url=${req.url}`,
      );
      res.status(403).json({ error: "no_org", message: "User has no organization." });
      return;
    }

    req.userId = user.id;
    req.orgId  = membership.orgId;
    req.orgRole = membership.role;
    next();
  } catch (err) {
    console.error(`[resolveOrg] 500 — ${String(err)} | method=${req.method} url=${req.url}`);
    res.status(500).json({ error: String(err) });
  }
};
