/**
 * Omni Diagnostics — Integration Adapter
 * Verifica todas las integraciones registradas en el Integration Hub.
 * Usa IntegrationManager.healthCheck() para cada integración activa.
 * No tiene lógica específica de ningún proveedor.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { IntegrationManager } from "../../hub/integrationManager";
import { IntegrationRegistry } from "../../hub/integrationRegistry";
import type { DiagnosticAdapter, DiagnosticContext, ModuleDiagnosticResult } from "../types";
import { logger } from "../../lib/logger";

export const integrationsAdapter: DiagnosticAdapter = {
  name: "integrations",
  priority: 20,

  async run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult> {
    const checks: ModuleDiagnosticResult["checks"] = [];
    const issues: ModuleDiagnosticResult["issues"] = [];
    const recommendations: ModuleDiagnosticResult["recommendations"] = [];
    const t0 = Date.now();

    // 1. Hub status
    const hubT0 = Date.now();
    const registeredSlugs = IntegrationRegistry.list();
    checks.push({
      name: "hub_registry",
      status: registeredSlugs.length > 0 ? "pass" : "warn",
      message: registeredSlugs.length > 0
        ? `${registeredSlugs.length} adaptadores registrados: ${registeredSlugs.join(", ")}`
        : "No hay adaptadores registrados en el Hub",
      durationMs: Date.now() - hubT0,
    });

    // 2. Get org integrations
    const orgT0 = Date.now();
    let orgIntegrations: Array<{ integration_slug: string; status: string; config: string | null; credentials_enc: string | null; error_message: string | null }> = [];
    try {
      const result = await db.execute(sql`
        SELECT integration_slug, status, config, credentials_enc, error_message
        FROM org_integrations
        WHERE org_id = ${ctx.orgId}
      `);
      orgIntegrations = (result as { rows: typeof orgIntegrations }).rows;
      checks.push({
        name: "org_integrations_loaded",
        status: "pass",
        message: `${orgIntegrations.length} integraciones configuradas`,
        durationMs: Date.now() - orgT0,
      });
    } catch (err) {
      checks.push({
        name: "org_integrations_loaded",
        status: "fail",
        message: `Error: ${(err as Error).message}`,
        durationMs: Date.now() - orgT0,
      });
      issues.push({
        id: "int-load-fail",
        module: "integrations",
        severity: "critical",
        title: "No se pudieron cargar las integraciones",
        description: (err as Error).message,
        autoFixable: false,
      });
      return {
        module: "integrations",
        score: 0,
        status: "unhealthy",
        checks,
        issues,
        recommendations,
        durationMs: Date.now() - t0,
      };
    }

    // 3. Check each integration
    for (const row of orgIntegrations) {
      const slug = row.integration_slug;
      const hasAdapter = IntegrationRegistry.has(slug);
      const hasCredentials = !!row.credentials_enc;
      const status = row.status;

      const checkName = `integration_${slug}`;
      const checkT0 = Date.now();

      if (!hasAdapter) {
        checks.push({
          name: checkName,
          status: "fail",
          message: `Integración "${slug}" configurada pero no tiene adaptador en el Hub`,
          durationMs: Date.now() - checkT0,
        });
        issues.push({
          id: `int-${slug}-no-adapter`,
          module: "integrations",
          severity: "warning",
          title: `Adaptador ausente para ${slug}`,
          description: `La integración está configurada pero no hay adaptador registrado en el Hub.`,
          autoFixable: false,
        });
        continue;
      }

      if (!hasCredentials) {
        checks.push({
          name: checkName,
          status: "fail",
          message: `Integración "${slug}" sin credenciales`,
          durationMs: Date.now() - checkT0,
        });
        issues.push({
          id: `int-${slug}-no-creds`,
          module: "integrations",
          severity: "critical",
          title: `Sin credenciales: ${slug}`,
          description: `La integración ${slug} está configurada pero no tiene credenciales almacenadas.`,
          autoFixable: false,
        });
        continue;
      }

      if (status === "inactive") {
        checks.push({
          name: checkName,
          status: "skip",
          message: `Integración "${slug}" inactiva (no se ejecuta health check)`,
          durationMs: Date.now() - checkT0,
        });
        continue;
      }

      // Run health check via IntegrationManager
      try {
        const health = await IntegrationManager.healthCheck(ctx.orgId, slug);
        const allPass = health.results.every((r) => r.status === "pass");
        const someFail = health.results.some((r) => r.status === "fail");
        const hcMsg = `${health.results.filter((r) => r.status === "pass").length}/${health.results.length} checks OK — ${health.overall}`;

        checks.push({
          name: checkName,
          status: allPass ? "pass" : someFail ? "fail" : "warn",
          message: hcMsg,
          durationMs: Date.now() - checkT0,
          detail: { overall: health.overall, results: health.results.length },
        });

        if (someFail) {
          const failedChecks = health.results.filter((r) => r.status === "fail");
          issues.push({
            id: `int-${slug}-health-fail`,
            module: "integrations",
            severity: health.overall === "unhealthy" ? "critical" : "warning",
            title: `Health check falló: ${slug}`,
            description: `Checks fallidos: ${failedChecks.map((f) => f.name).join(", ")}. ${failedChecks.map((f) => f.message).join("; ")}`,
            autoFixable: false,
          });
        }
      } catch (err) {
        checks.push({
          name: checkName,
          status: "fail",
          message: `Error en health check: ${(err as Error).message}`,
          durationMs: Date.now() - checkT0,
        });
        issues.push({
          id: `int-${slug}-health-error`,
          module: "integrations",
          severity: "critical",
          title: `Health check error: ${slug}`,
          description: (err as Error).message,
          autoFixable: false,
        });
      }
    }

    // 4. Check for recent integration events
    const eventsT0 = Date.now();
    try {
      const evResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM integration_events
        WHERE org_id = ${ctx.orgId} AND status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
      `);
      const errorCount = Number((evResult as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "integration_events_24h",
        status: errorCount === 0 ? "pass" : errorCount > 5 ? "fail" : "warn",
        message: errorCount === 0 ? "Sin errores en 24h" : `${errorCount} errores en 24h`,
        durationMs: Date.now() - eventsT0,
      });
      if (errorCount > 5) {
        issues.push({
          id: "int-events-errors",
          module: "integrations",
          severity: "warning",
          title: `${errorCount} errores de integración en 24h`,
          description: "Hay errores recurrentes en las integraciones. Revisar logs.",
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({
        name: "integration_events_24h",
        status: "skip",
        message: `No se pudo consultar: ${(err as Error).message}`,
        durationMs: Date.now() - eventsT0,
      });
    }

    // Calculate score
    const passCount = checks.filter((c) => c.status === "pass").length;
    const total = checks.filter((c) => c.status !== "skip").length || 1;
    const score = Math.round((passCount / total) * 100);
    const status: ModuleDiagnosticResult["status"] = issues.some((i) => i.severity === "critical")
      ? "unhealthy"
      : issues.some((i) => i.severity === "warning") || checks.some((c) => c.status === "warn")
        ? "degraded"
        : "healthy";

    return {
      module: "integrations",
      score,
      status,
      checks,
      issues,
      recommendations,
      durationMs: Date.now() - t0,
    };
  },
};
