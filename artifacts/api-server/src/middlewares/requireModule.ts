import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { moduleConfigsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// In-memory cache: `${orgId}:${slug}` → { enabled, ts }
const moduleCache = new Map<string, { enabled: boolean; ts: number }>();
const MODULE_CACHE_TTL = 2 * 60 * 1000; // 2 min

async function isModuleEnabled(orgId: number, slug: string): Promise<boolean> {
  const key    = `${orgId}:${slug}`;
  const cached = moduleCache.get(key);
  if (cached && Date.now() - cached.ts < MODULE_CACHE_TTL) return cached.enabled;

  const [cfg] = await db
    .select({ isEnabled: moduleConfigsTable.isEnabled })
    .from(moduleConfigsTable)
    .where(and(eq(moduleConfigsTable.orgId, orgId), eq(moduleConfigsTable.moduleSlug, slug)));

  // No entry = enabled by default (CRM is always on; premium modules default off only if explicitly disabled)
  const enabled = cfg ? (cfg.isEnabled ?? true) : true;
  moduleCache.set(key, { enabled, ts: Date.now() });
  return enabled;
}

export function clearModuleCache(orgId: number, slug?: string) {
  if (slug) {
    moduleCache.delete(`${orgId}:${slug}`);
  } else {
    for (const key of moduleCache.keys()) {
      if (key.startsWith(`${orgId}:`)) moduleCache.delete(key);
    }
  }
}

export { isModuleEnabled };

export function requireModule(slug: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req as Request & { orgId?: number }).orgId;
    if (!orgId) { next(); return; }

    try {
      const enabled = await isModuleEnabled(orgId, slug);
      if (!enabled) {
        res.status(403).json({
          error:   "module_disabled",
          module:  slug,
          message: `El módulo "${slug}" no está habilitado para tu organización. Contacta con tu administrador.`,
        });
        return;
      }
      next();
    } catch {
      next(); // fail open — don't block requests on cache errors
    }
  };
}
