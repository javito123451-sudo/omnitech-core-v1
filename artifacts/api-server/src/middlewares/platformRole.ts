import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { platformRolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type PlatformRoleValue =
  | "SUPER_ADMIN"
  | "STAFF_OMNITECH"
  | "SOPORTE"
  | "DESARROLLADOR"
  | "BILLING"
  | "NONE";

export type WorkspaceRoleValue =
  | "owner"
  | "admin"
  | "manager"
  | "member"
  | "client"
  | "guest"
  | "read_only"
  | "vendedor"
  | "cliente";

const roleCache = new Map<string, { role: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function resolvePlatformRole(clerkUserId: string): Promise<string> {
  const cached = roleCache.get(clerkUserId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.role;

  try {
    const [row] = await db
      .select({ role: platformRolesTable.role })
      .from(platformRolesTable)
      .where(and(
        eq(platformRolesTable.clerkUserId, clerkUserId),
        eq(platformRolesTable.isActive, true),
      ));

    const role = row?.role ?? "NONE";
    roleCache.set(clerkUserId, { role, ts: Date.now() });
    return role;
  } catch (err) {
    console.error("[PlatformRole] lookup failed:", err);
    return "NONE";
  }
}

export function clearPlatformRoleCache(clerkUserId: string) {
  roleCache.delete(clerkUserId);
}

/**
 * Middleware factory: verifies that the authenticated user holds one of the
 * specified platform roles. Must be used AFTER requireAuth.
 *
 * Usage:
 *   router.use(requireAuth, requirePlatformRole("SUPER_ADMIN", "STAFF_OMNITECH"));
 */
export function requirePlatformRole(...roles: PlatformRoleValue[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId ?? req.clerkUserId;

    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const role = await resolvePlatformRole(clerkUserId);

    if (!roles.includes(role as PlatformRoleValue)) {
      console.warn(
        `[requirePlatformRole] 403 — clerkUserId=${clerkUserId} role=${role} ` +
        `attempted ${req.url} | required=[${roles.join(",")}]`
      );
      res.status(403).json({
        error: "access_denied",
        message: "No tienes permiso para acceder al Control Center.",
      });
      return;
    }

    req.clerkUserId  = clerkUserId;
    req.platformRole = role;
    req.isSuperAdmin = role === "SUPER_ADMIN";
    next();
  };
}
