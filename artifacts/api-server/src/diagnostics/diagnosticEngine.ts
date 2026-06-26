/**
 * Omni Diagnostics — Diagnostic Engine
 * Ejecuta todos los DiagnosticAdapter registrados, agrega puntuaciones
 * y genera el reporte final.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DiagnosticRegistry } from "./diagnosticRegistry";
import type {
  DiagnosticAdapter,
  DiagnosticContext,
  DiagnosticReport,
  ModuleDiagnosticResult,
  DiagnosticIssue,
  DiagnosticRecommendation,
} from "./types";
import { logger } from "../lib/logger";

async function storeReport(
  ctx: DiagnosticContext,
  score: number,
  status: DiagnosticReport["status"],
  summary: string,
  modules: ModuleDiagnosticResult[],
  issues: DiagnosticIssue[],
  recommendations: DiagnosticRecommendation[],
  actionsTaken: string[],
): Promise<number> {
  try {
    const result = await db.execute(sql`
      INSERT INTO diagnostic_reports (
        org_id, run_by, scope, score, status, summary,
        modules, issues, recommendations, actions_taken
      ) VALUES (
        ${ctx.orgId}, ${ctx.runBy ?? null}, ${ctx.scope}, ${score}, ${status}, ${summary},
        ${JSON.stringify(modules)}, ${JSON.stringify(issues)}, ${JSON.stringify(recommendations)}, ${JSON.stringify(actionsTaken)}
      )
      RETURNING id
    `);
    const rows = result as { rows: Array<{ id: number }> };
    const id = rows.rows[0]?.id;
    if (id) return id;
  } catch (e) {
    logger.error({ err: e }, "[Diagnostics] storeReport failed");
  }
  return 0;
}

export const DiagnosticEngine = {
  /**
   * Ejecutar diagnóstico completo con todos los adaptadores registrados.
   */
  async run(ctx: DiagnosticContext): Promise<DiagnosticReport> {
    const adapters = DiagnosticRegistry.getAll();
    const modules: ModuleDiagnosticResult[] = [];
    const allIssues: DiagnosticIssue[] = [];
    const allRecommendations: DiagnosticRecommendation[] = [];

    for (const adapter of adapters) {
      try {
        const t0 = Date.now();
        const result = await adapter.run(ctx);
        result.durationMs = Date.now() - t0;
        modules.push(result);
        allIssues.push(...result.issues);
        allRecommendations.push(...result.recommendations);
      } catch (err) {
        logger.error({ err, adapter: adapter.name }, "[Diagnostics] Adapter failed");
        modules.push({
          module: adapter.name,
          score: 0,
          status: "unhealthy",
          checks: [{ name: "adapter_exception", status: "fail", message: (err as Error).message, durationMs: 0 }],
          issues: [{
            id: `${adapter.name}-crash`,
            module: adapter.name,
            severity: "critical",
            title: `Módulo ${adapter.name} no responde`,
            description: `Excepción al ejecutar diagnóstico: ${(err as Error).message}`,
            autoFixable: false,
          }],
          recommendations: [],
          durationMs: 0,
        });
        allIssues.push({
          id: `${adapter.name}-crash`,
          module: adapter.name,
          severity: "critical",
          title: `Módulo ${adapter.name} no responde`,
          description: `Excepción al ejecutar diagnóstico: ${(err as Error).message}`,
          autoFixable: false,
        });
      }
    }

    // Calcular puntuación global
    const totalScore = modules.length > 0
      ? Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length)
      : 0;

    const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
    const warningCount = allIssues.filter((i) => i.severity === "warning").length;

    const status: DiagnosticReport["status"] = criticalCount > 0
      ? "unhealthy"
      : warningCount > 0
        ? "degraded"
        : "healthy";

    const summary = `${totalScore}/100 — ${modules.length} módulos analizados, ${criticalCount} críticos, ${warningCount} advertencias, ${allRecommendations.length} recomendaciones.`;

    const reportId = await storeReport(ctx, totalScore, status, summary, modules, allIssues, allRecommendations, []);

    return {
      id: reportId,
      orgId: ctx.orgId,
      runBy: ctx.runBy,
      scope: ctx.scope,
      score: totalScore,
      status,
      summary,
      modules,
      issues: allIssues,
      recommendations: allRecommendations,
      actionsTaken: [],
      createdAt: new Date().toISOString(),
    };
  },

  /**
   * Ejecutar auto-fix para un issue concreto.
   */
  async fix(
    ctx: DiagnosticContext,
    moduleName: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    const adapter = DiagnosticRegistry.get(moduleName);
    if (!adapter || !adapter.fix) {
      return { success: false, message: `Módulo "${moduleName}" no tiene auto-fix.` };
    }
    try {
      return await adapter.fix(ctx, action as any, payload);
    } catch (err) {
      logger.error({ err }, "[Diagnostics] fix failed");
      return { success: false, message: `Error: ${(err as Error).message}` };
    }
  },
};
