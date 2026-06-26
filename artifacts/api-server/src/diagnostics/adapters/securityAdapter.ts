/**
 * Omni Diagnostics — Security Adapter
 * Verifica: roles, permisos, variables críticas, tokens, accesos.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { DiagnosticAdapter, DiagnosticContext, ModuleDiagnosticResult } from "../types";

export const securityAdapter: DiagnosticAdapter = {
  name: "security",
  priority: 50,

  async run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult> {
    const checks: ModuleDiagnosticResult["checks"] = [];
    const issues: ModuleDiagnosticResult["issues"] = [];
    const recommendations: ModuleDiagnosticResult["recommendations"] = [];
    const t0 = Date.now();
    const orgId = ctx.orgId;

    // 1. SUPER_ADMIN check
    const adminT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count FROM platform_roles WHERE role = 'SUPER_ADMIN' AND is_active = true
      `);
      const count = Number((r as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "sec_super_admin",
        status: count > 0 ? "pass" : "fail",
        message: count > 0 ? `${count} SUPER_ADMIN activo(s)` : "Sin SUPER_ADMIN activo",
        durationMs: Date.now() - adminT0,
      });
      if (count === 0) {
        issues.push({
          id: "sec-no-superadmin",
          module: "security",
          severity: "critical",
          title: "Sin SUPER_ADMIN activo",
          description: "No hay ningún SUPER_ADMIN activo en el sistema.",
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({ name: "sec_super_admin", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - adminT0 });
    }

    // 2. Org members
    const memT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count FROM org_members WHERE org_id = ${orgId} AND is_suspended = false
      `);
      const count = Number((r as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "sec_org_members",
        status: "pass",
        message: `${count} miembros activos`,
        durationMs: Date.now() - memT0,
      });
    } catch (err) {
      checks.push({ name: "sec_org_members", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - memT0 });
    }

    // 3. Suspicious tokens
    const tokenT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count FROM client_portal_tokens
        WHERE org_id = ${orgId} AND expires_at < NOW()
      `);
      const expired = Number((r as { rows: Array<{ count: string }> }).rows[0]?.count ?? 0);
      checks.push({
        name: "sec_expired_tokens",
        status: expired === 0 ? "pass" : "warn",
        message: expired === 0 ? "Sin tokens expirados" : `${expired} tokens expirados`,
        durationMs: Date.now() - tokenT0,
      });
      if (expired > 0) {
        recommendations.push({
          id: "sec-expired-tokens",
          module: "security",
          severity: "warning",
          title: `${expired} tokens de portal expirados`,
          description: "Considerar limpiar tokens expirados para mantener la tabla limpia.",
        });
      }
    } catch (err) {
      checks.push({ name: "sec_expired_tokens", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - tokenT0 });
    }

    // 4. Critical env vars
    const critT0 = Date.now();
    const critical = ["DATABASE_URL", "CLERK_SECRET_KEY", "OPENAI_API_KEY"];
    const missing = critical.filter((e) => !process.env[e]);
    checks.push({
      name: "sec_critical_env",
      status: missing.length === 0 ? "pass" : "fail",
      message: missing.length === 0 ? "Variables críticas presentes" : `Faltan: ${missing.join(", ")}`,
      durationMs: Date.now() - critT0,
    });
    if (missing.length > 0) {
      issues.push({
        id: "sec-critical-missing",
        module: "security",
        severity: "critical",
        title: `Variables críticas faltantes: ${missing.join(", ")}`,
        description: "Estas variables son esenciales para la seguridad y funcionalidad del sistema.",
        autoFixable: false,
      });
    }

    // 5. NODE_ENV
    const envT0 = Date.now();
    const isProd = process.env.NODE_ENV === "production";
    checks.push({
      name: "sec_node_env",
      status: isProd ? "pass" : "warn",
      message: isProd ? "NODE_ENV=production" : `NODE_ENV=${process.env.NODE_ENV ?? "undefined"} (no es producción)`,
      durationMs: Date.now() - envT0,
    });
    if (!isProd) {
      recommendations.push({
        id: "sec-not-prod",
        module: "security",
        severity: "info",
        title: "Servidor en modo desarrollo",
        description: "NODE_ENV no es 'production'. Esto es correcto para desarrollo.",
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
      module: "security",
      score,
      status,
      checks,
      issues,
      recommendations,
      durationMs: Date.now() - t0,
    };
  },
};
