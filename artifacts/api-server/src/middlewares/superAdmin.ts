import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { platformRolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      isSuperAdmin?: boolean;
      platformRole?: string;
    }
  }
}

// In-memory cache to avoid a DB hit on every request (5 min TTL)
const roleCache = new Map<string, { role: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function resolveRole(clerkUserId: string): Promise<string | null> {
  const cached = roleCache.get(clerkUserId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.role;

  try {
    const [row] = await db
      .select()
      .from(platformRolesTable)
      .where(and(
        eq(platformRolesTable.clerkUserId, clerkUserId),
        eq(platformRolesTable.isActive, true),
      ));

    if (row) {
      roleCache.set(clerkUserId, { role: row.role, ts: Date.now() });
      return row.role;
    }
  } catch (err) {
    console.error("[SuperAdmin] Role lookup failed:", err);
  }
  return null;
}

export function clearRoleCache(clerkUserId: string) {
  roleCache.delete(clerkUserId);
}

// Middleware: verifica que el usuario tenga rol SUPER_ADMIN o STAFF_OMNITECH
export const requireSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const role = await resolveRole(clerkUserId);

  if (!role || (role !== "SUPER_ADMIN" && role !== "STAFF_OMNITECH")) {
    console.warn(`[SuperAdmin] 403 — clerkUserId=${clerkUserId} attempted to access ${req.url} | role=${role ?? "none"}`);
    res.status(403).json({ error: "Access denied. Super Admin only." });
    return;
  }

  req.clerkUserId   = clerkUserId;
  req.isSuperAdmin  = role === "SUPER_ADMIN";
  req.platformRole  = role;
  next();
};

// Helper: check if a clerkUserId has any platform role (for frontend check endpoint)
export async function hasPlatformRole(clerkUserId: string): Promise<string | null> {
  return resolveRole(clerkUserId);
}
