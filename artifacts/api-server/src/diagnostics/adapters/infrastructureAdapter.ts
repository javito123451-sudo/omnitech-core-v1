/**
 * Omni Diagnostics — Infrastructure Adapter
 * Verifica: base de datos, variables de entorno, secrets, storage, logs.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { DiagnosticAdapter, DiagnosticContext, ModuleDiagnosticResult } from "../types";
import { logger } from "../../lib/logger";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "NODE_ENV",
  "PORT",
];

const RECOMMENDED_ENV = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_BUSINESS_PHONE_ID",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "PUBLIC_URL",
  "REPLIT_DEV_DOMAIN",
];

export const infrastructureAdapter: DiagnosticAdapter = {
  name: "infrastructure",
  priority: 10,

  async run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult> {
    const checks: ModuleDiagnosticResult["checks"] = [];
    const issues: ModuleDiagnosticResult["issues"] = [];
    const recommendations: ModuleDiagnosticResult["recommendations"] = [];
    const t0 = Date.now();

    // 1. Database connection
    const dbT0 = Date.now();
    try {
      const r = await db.execute(sql`SELECT NOW() as now`);
      const rows = r as { rows: Array<{ now: string }> };
      const ok = rows.rows.length > 0 && rows.rows[0]!.now;
      checks.push({
        name: "db_connection",
        status: ok ? "pass" : "fail",
        message: ok ? "Conexión a PostgreSQL activa" : "No se pudo conectar a PostgreSQL",
        durationMs: Date.now() - dbT0,
      });
      if (!ok) {
        issues.push({
          id: "infra-db-connection",
          module: "infrastructure",
          severity: "critical",
          title: "Base de datos no disponible",
          description: "PostgreSQL no responde. El sistema no puede funcionar sin base de datos.",
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({
        name: "db_connection",
        status: "fail",
        message: `Error: ${(err as Error).message}`,
        durationMs: Date.now() - dbT0,
      });
      issues.push({
        id: "infra-db-connection",
        module: "infrastructure",
        severity: "critical",
        title: "Base de datos no disponible",
        description: `PostgreSQL no responde: ${(err as Error).message}`,
        autoFixable: false,
      });
    }

    // 2. Environment variables
    const envT0 = Date.now();
    const missingRequired = REQUIRED_ENV.filter((e) => !process.env[e]);
    const missingRecommended = RECOMMENDED_ENV.filter((e) => !process.env[e]);
    checks.push({
      name: "env_required",
      status: missingRequired.length === 0 ? "pass" : "fail",
      message: missingRequired.length === 0
        ? "Todas las variables de entorno requeridas están definidas"
        : `Faltan: ${missingRequired.join(", ")}`,
      durationMs: Date.now() - envT0,
    });
    if (missingRequired.length > 0) {
      issues.push({
        id: "infra-env-missing",
        module: "infrastructure",
        severity: "critical",
        title: `Faltan ${missingRequired.length} variables de entorno críticas`,
        description: `Variables requeridas: ${missingRequired.join(", ")}`,
        autoFixable: false,
      });
    }
    if (missingRecommended.length > 0) {
      recommendations.push({
        id: "infra-env-recommended",
        module: "infrastructure",
        severity: "info",
        title: `Faltan ${missingRecommended.length} variables recomendadas`,
        description: `Variables recomendadas: ${missingRecommended.join(", ")}`,
      });
    }

    // 3. Secrets (simple check — presence)
    const secretsT0 = Date.now();
    const hasClerkKey = !!process.env["CLERK_SECRET_KEY"];
    const hasOpenAIKey = !!process.env["OPENAI_API_KEY"];
    checks.push({
      name: "secrets_present",
      status: hasClerkKey && hasOpenAIKey ? "pass" : "fail",
      message: hasClerkKey && hasOpenAIKey
        ? "Secrets principales configurados"
        : `Faltan: ${[!hasClerkKey && "CLERK_SECRET_KEY", !hasOpenAIKey && "OPENAI_API_KEY"].filter(Boolean).join(", ")}`,
      durationMs: Date.now() - secretsT0,
    });

    // 4. Storage (object storage / filesystem)
    const storageT0 = Date.now();
    try {
      const fs = await import("fs");
      const tmpDir = "/tmp";
      const canWrite = fs.existsSync(tmpDir) && fs.statSync(tmpDir).isDirectory();
      checks.push({
        name: "storage",
        status: canWrite ? "pass" : "warn",
        message: canWrite ? "Acceso a filesystem temporal disponible" : "Filesystem temporal limitado",
        durationMs: Date.now() - storageT0,
      });
    } catch {
      checks.push({
        name: "storage",
        status: "warn",
        message: "No se pudo verificar storage",
        durationMs: Date.now() - storageT0,
      });
    }

    // 5. Log health (check if logger is working)
    const logT0 = Date.now();
    try {
      logger.info("[Diagnostics] Ping de diagnóstico");
      checks.push({
        name: "logger",
        status: "pass",
        message: "Sistema de logs activo",
        durationMs: Date.now() - logT0,
      });
    } catch {
      checks.push({
        name: "logger",
        status: "warn",
        message: "No se pudo verificar logger",
        durationMs: Date.now() - logT0,
      });
    }

    // 6. CPU / Memory (process info)
    const memT0 = Date.now();
    const memUsage = process.memoryUsage();
    const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const highMem = heapMB > 512;
    checks.push({
      name: "memory",
      status: highMem ? "warn" : "pass",
      message: `Heap: ${heapMB}MB, RSS: ${rssMB}MB`,
      durationMs: Date.now() - memT0,
      detail: { heapMB, rssMB },
    });
    if (highMem) {
      recommendations.push({
        id: "infra-memory-high",
        module: "infrastructure",
        severity: "warning",
        title: "Uso de memoria elevado",
        description: `Heap: ${heapMB}MB — considerar reiniciar el servidor si persiste.`,
      });
    }

    // 7. Org-specific checks
    const orgT0 = Date.now();
    try {
      const orgResult = await db.execute(sql`SELECT COUNT(*) as count FROM organizations WHERE id = ${ctx.orgId}`);
      const orgCount = Number((orgResult as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "org_exists",
        status: orgCount > 0 ? "pass" : "fail",
        message: orgCount > 0 ? `Workspace ${ctx.orgId} existe` : `Workspace ${ctx.orgId} no encontrado`,
        durationMs: Date.now() - orgT0,
      });
      if (orgCount === 0) {
        issues.push({
          id: "infra-org-missing",
          module: "infrastructure",
          severity: "critical",
          title: "Workspace no encontrado",
          description: `El workspace ${ctx.orgId} no existe en la base de datos.`,
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({
        name: "org_exists",
        status: "fail",
        message: `Error: ${(err as Error).message}`,
        durationMs: Date.now() - orgT0,
      });
    }

    // 8. Slow queries
    const slowT0 = Date.now();
    try {
      const slowResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 seconds'
      `);
      const slowCount = Number((slowResult as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "slow_queries",
        status: slowCount === 0 ? "pass" : "warn",
        message: slowCount === 0 ? "No hay queries lentos" : `${slowCount} queries activos > 5s`,
        durationMs: Date.now() - slowT0,
      });
      if (slowCount > 0) {
        recommendations.push({
          id: "infra-slow-queries",
          module: "infrastructure",
          severity: "warning",
          title: "Queries lentos detectados",
          description: `${slowCount} queries activos llevan más de 5 segundos.`,
        });
      }
    } catch {
      checks.push({
        name: "slow_queries",
        status: "skip",
        message: "pg_stat_activity no disponible (permisos)",
        durationMs: Date.now() - slowT0,
      });
    }

    // Calculate score
    const passCount = checks.filter((c) => c.status === "pass").length;
    const total = checks.length;
    const score = total > 0 ? Math.round((passCount / total) * 100) : 0;
    const status: ModuleDiagnosticResult["status"] = issues.some((i) => i.severity === "critical")
      ? "unhealthy"
      : issues.some((i) => i.severity === "warning") || checks.some((c) => c.status === "warn")
        ? "degraded"
        : "healthy";

    return {
      module: "infrastructure",
      score,
      status,
      checks,
      issues,
      recommendations,
      durationMs: Date.now() - t0,
    };
  },
};
