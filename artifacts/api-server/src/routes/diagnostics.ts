/**
 * Omni Diagnostics — API Routes
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DiagnosticEngine } from "../diagnostics/diagnosticEngine";
import { DiagnosticRegistry } from "../diagnostics/diagnosticRegistry";
import { hasPlatformRole } from "../middlewares/superAdmin";
import { logger } from "../lib/logger";

const router = Router();

import { requirePermission } from "../middlewares/permissions";

/**
 * POST /api/diagnostics/run
 * Ejecutar diagnóstico completo para el workspace actual.
 * SUPER_ADMIN puede hacerlo para cualquier org. Admin de workspace solo para su org.
 */
router.post("/run", requirePermission("diagnostics.read"), async (req, res) => {
  const r = req as typeof req & { orgId?: number; clerkUserId?: string; isSuperAdmin?: boolean };
  const orgId = r.orgId;
  const clerkUserId = r.clerkUserId;
  const isSuperAdmin = r.isSuperAdmin ?? false;

  if (!orgId) {
    res.status(400).json({ error: "No orgId resolved. Ensure workspace context is set." });
    return;
  }

  // Allow if super admin or if org matches
  const role = clerkUserId ? await hasPlatformRole(clerkUserId) : null;
  const isAdmin = isSuperAdmin || role === "SUPER_ADMIN" || role === "STAFF_OMNITECH";

  // For non-super-admins, they can only diagnose their own workspace (which is already resolved by resolveOrg)
  const scope = isAdmin ? (req.body.scope ?? "workspace") : "workspace";

  try {
    const report = await DiagnosticEngine.run({
      orgId,
      scope,
      runBy: clerkUserId,
    });
    res.json({
      id: report.id,
      score: report.score,
      status: report.status,
      summary: report.summary,
      modules: report.modules,
      issues: report.issues,
      recommendations: report.recommendations,
      createdAt: report.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "[Diagnostics] run failed");
    res.status(500).json({ error: "Diagnóstico falló", detail: (err as Error).message });
  }
});

/**
 * GET /api/diagnostics/latest
 * Último reporte del workspace.
 */
router.get("/latest", requirePermission("diagnostics.read"), async (req, res) => {
  const r = req as typeof req & { orgId?: number };
  const orgId = r.orgId;
  if (!orgId) {
    res.status(400).json({ error: "No orgId" });
    return;
  }

  try {
    const result = await db.execute(sql`
      SELECT id, org_id, run_by, scope, score, status, summary,
             modules, issues, recommendations, actions_taken, created_at
      FROM diagnostic_reports
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const rows = result as { rows: Array<Record<string, unknown>> };
    if (rows.rows.length === 0) {
      res.json({ report: null });
      return;
    }
    const row = rows.rows[0]!;
    res.json({
      report: {
        id: row.id,
        orgId: row.org_id,
        runBy: row.run_by,
        scope: row.scope,
        score: row.score,
        status: row.status,
        summary: row.summary,
        modules: typeof row.modules === "string" ? JSON.parse(row.modules) : row.modules,
        issues: typeof row.issues === "string" ? JSON.parse(row.issues) : row.issues,
        recommendations: typeof row.recommendations === "string" ? JSON.parse(row.recommendations) : row.recommendations,
        actionsTaken: typeof row.actions_taken === "string" ? JSON.parse(row.actions_taken) : row.actions_taken,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, "[Diagnostics] latest failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/diagnostics/:id
 * Reporte específico.
 */
router.get("/:id", requirePermission("workspace.view"), async (req, res) => {
  const r = req as typeof req & { orgId?: number };
  const orgId = r.orgId;
  const id = Number(req.params.id);

  if (!orgId || Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  try {
    const result = await db.execute(sql`
      SELECT id, org_id, run_by, scope, score, status, summary,
             modules, issues, recommendations, actions_taken, created_at
      FROM diagnostic_reports
      WHERE id = ${id} AND org_id = ${orgId}
    `);
    const rows = result as { rows: Array<Record<string, unknown>> };
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const row = rows.rows[0]!;
    res.json({
      report: {
        id: row.id,
        orgId: row.org_id,
        runBy: row.run_by,
        scope: row.scope,
        score: row.score,
        status: row.status,
        summary: row.summary,
        modules: typeof row.modules === "string" ? JSON.parse(row.modules) : row.modules,
        issues: typeof row.issues === "string" ? JSON.parse(row.issues) : row.issues,
        recommendations: typeof row.recommendations === "string" ? JSON.parse(row.recommendations) : row.recommendations,
        actionsTaken: typeof row.actions_taken === "string" ? JSON.parse(row.actions_taken) : row.actions_taken,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, "[Diagnostics] get report failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/diagnostics/history
 * Historial paginado.
 */
router.get("/history", requirePermission("workspace.view"), async (req, res) => {
  const r = req as typeof req & { orgId?: number };
  const orgId = r.orgId;
  if (!orgId) {
    res.status(400).json({ error: "No orgId" });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  const offset = Number(req.query.offset ?? 0);

  try {
    const result = await db.execute(sql`
      SELECT id, org_id, run_by, scope, score, status, summary,
             modules, issues, recommendations, actions_taken, created_at
      FROM diagnostic_reports
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = result as { rows: Array<Record<string, unknown>> };
    const reports = rows.rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      runBy: row.run_by,
      scope: row.scope,
      score: row.score,
      status: row.status,
      summary: row.summary,
      modules: typeof row.modules === "string" ? JSON.parse(row.modules) : row.modules,
      issues: typeof row.issues === "string" ? JSON.parse(row.issues) : row.issues,
      recommendations: typeof row.recommendations === "string" ? JSON.parse(row.recommendations) : row.recommendations,
      actionsTaken: typeof row.actions_taken === "string" ? JSON.parse(row.actions_taken) : row.actions_taken,
      createdAt: row.created_at,
    }));

    // Count total
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM diagnostic_reports WHERE org_id = ${orgId}
    `);
    const total = Number((countResult as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);

    res.json({ reports, total, limit, offset });
  } catch (err) {
    logger.error({ err }, "[Diagnostics] history failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/diagnostics/:id/fix
 * Auto-fix un issue del reporte.
 */
router.post("/:id/fix", requirePermission("workspace.manage"), async (req, res) => {
  const r = req as typeof req & { orgId?: number };
  const orgId = r.orgId;
  const id = Number(req.params.id);
  const { module, action, payload } = req.body as { module?: string; action?: string; payload?: Record<string, unknown> };

  if (!orgId || Number.isNaN(id) || !module || !action) {
    res.status(400).json({ error: "Missing module, action, or id" });
    return;
  }

  try {
    const result = await DiagnosticEngine.fix(
      { orgId, scope: "workspace" },
      module,
      action,
      payload,
    );

    // Record the action on the report
    await db.execute(sql`
      UPDATE diagnostic_reports
      SET actions_taken = COALESCE(actions_taken, '[]'::jsonb) || ${JSON.stringify([{ module, action, success: result.success, message: result.message, at: new Date().toISOString() }])}::jsonb,
          updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `);

    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Diagnostics] fix failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/diagnostics/modules
 * Lista de módulos de diagnóstico disponibles.
 */
router.get("/modules", requirePermission("workspace.view"), async (_req, res) => {
  const modules = DiagnosticRegistry.list().map((name) => ({
    name,
    priority: DiagnosticRegistry.get(name)?.priority ?? 100,
  }));
  res.json({ modules });
});

export const diagnosticsRouter = router;
