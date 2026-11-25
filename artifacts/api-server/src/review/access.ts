// Omni Review Bot — control de acceso del módulo.
//
// requireModule() (compartido) trata "sin fila en module_configs" como ACTIVADO
// y falla abierto ante un error de BD. Omni Review envía mensajes a clientes
// finales, así que aquí el criterio es el contrario: el módulo solo está activo
// si existe una fila con is_enabled = true, y ante cualquier duda se deniega.
import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, moduleConfigsTable } from "@workspace/db";

export const REVIEW_MODULE_SLUG = "omni_review";

export async function isReviewModuleEnabled(orgId: number): Promise<boolean> {
  const [cfg] = await db
    .select({ isEnabled: moduleConfigsTable.isEnabled })
    .from(moduleConfigsTable)
    .where(and(eq(moduleConfigsTable.orgId, orgId), eq(moduleConfigsTable.moduleSlug, REVIEW_MODULE_SLUG)));
  return cfg?.isEnabled === true;
}

export async function requireReviewModule(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Mismo criterio que requireModule: SUPER_ADMIN / STAFF_OMNITECH supervisan sin gate.
  if (req.isSuperAdmin) { next(); return; }
  const orgId = req.orgId;
  if (!orgId) { res.status(403).json({ error: "no_org_context" }); return; }
  try {
    if (await isReviewModuleEnabled(orgId)) { next(); return; }
    res.status(403).json({
      error: "module_disabled",
      module: REVIEW_MODULE_SLUG,
      message: "Omni Review Bot no está habilitado para este workspace. Un SUPER_ADMIN puede activarlo en Control Center → Módulos.",
    });
  } catch {
    // Fail-closed: un error de BD nunca abre el módulo.
    res.status(503).json({ error: "module_check_failed", message: "No se pudo verificar el estado del módulo." });
  }
}

/** orgId del contexto autenticado. NUNCA de la URL, la query ni el cuerpo. */
export function orgOf(req: Request): number {
  if (!req.orgId) throw new Error("Contexto de organización ausente");
  return req.orgId;
}
