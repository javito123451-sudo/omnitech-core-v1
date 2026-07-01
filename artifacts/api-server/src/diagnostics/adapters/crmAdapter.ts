/**
 * Omni Diagnostics — CRM Adapter
 * Verifica: clientes, citas, presupuestos, tareas, datos corruptos, duplicados, huérfanos.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { DiagnosticAdapter, DiagnosticContext, ModuleDiagnosticResult } from "../types";

function dbRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

export const crmAdapter: DiagnosticAdapter = {
  name: "crm",
  priority: 40,

  async run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult> {
    const checks: ModuleDiagnosticResult["checks"] = [];
    const issues: ModuleDiagnosticResult["issues"] = [];
    const recommendations: ModuleDiagnosticResult["recommendations"] = [];
    const t0 = Date.now();
    const orgId = ctx.orgId;

    // 1. Clients
    const clientsT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count,
               COUNT(*) FILTER (WHERE email IS NULL AND phone IS NULL) as no_contact,
               COUNT(*) FILTER (WHERE name IS NULL OR name = '') as no_name
        FROM clients WHERE org_id = ${orgId}
      `);
      const row = dbRows<{ count: string; no_contact: string; no_name: string }>(r)[0];
      const count = Number(row?.count ?? 0);
      const noContact = Number(row?.no_contact ?? 0);
      const noName = Number(row?.no_name ?? 0);
      checks.push({
        name: "crm_clients",
        status: count > 0 ? "pass" : "warn",
        message: count > 0 ? `${count} clientes` : "Sin clientes registrados",
        durationMs: Date.now() - clientsT0,
        detail: { count, noContact, noName },
      });
      if (noContact > 0) {
        issues.push({
          id: "crm-no-contact",
          module: "crm",
          severity: "warning",
          title: `${noContact} clientes sin contacto`,
          description: "Clientes sin email ni teléfono pueden no ser alcanzables.",
          autoFixable: false,
        });
      }
      if (noName > 0) {
        issues.push({
          id: "crm-no-name",
          module: "crm",
          severity: "warning",
          title: `${noName} clientes sin nombre`,
          description: "Clientes sin nombre dificultan la identificación.",
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({ name: "crm_clients", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - clientsT0 });
      issues.push({ id: "crm-clients-error", module: "crm", severity: "critical", title: "No se pudieron consultar clientes", description: (err as Error).message, autoFixable: false });
    }

    // 2. Duplicate emails
    const dupT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT email, COUNT(*) as cnt FROM clients
        WHERE org_id = ${orgId} AND email IS NOT NULL
        GROUP BY email HAVING COUNT(*) > 1
      `);
      const dups = dbRows<{ email: string; cnt: string }>(r);
      checks.push({
        name: "crm_duplicate_emails",
        status: dups.length === 0 ? "pass" : "warn",
        message: dups.length === 0 ? "Sin emails duplicados" : `${dups.length} emails duplicados`,
        durationMs: Date.now() - dupT0,
        detail: { duplicates: dups.map((d) => d.email) },
      });
      if (dups.length > 0) {
        issues.push({
          id: "crm-dup-emails",
          module: "crm",
          severity: "warning",
          title: `${dups.length} emails duplicados`,
          description: `Emails: ${dups.map((d) => d.email).join(", ")}`,
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({ name: "crm_duplicate_emails", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - dupT0 });
    }

    // 3. Appointments
    const aptT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count,
               COUNT(*) FILTER (WHERE client_id IS NULL) as orphan
        FROM appointments WHERE org_id = ${orgId}
      `);
      const row = dbRows<{ count: string; orphan: string }>(r)[0];
      const count = Number(row?.count ?? 0);
      const orphan = Number(row?.orphan ?? 0);
      checks.push({
        name: "crm_appointments",
        status: "pass",
        message: `${count} citas, ${orphan} huérfanas`,
        durationMs: Date.now() - aptT0,
        detail: { count, orphan },
      });
      if (orphan > 0) {
        issues.push({
          id: "crm-orphan-apt",
          module: "crm",
          severity: "warning",
          title: `${orphan} citas huérfanas`,
          description: "Citas sin cliente asociado.",
          autoFixable: true,
          fixAction: "repair_orphans",
          fixLabel: "Eliminar citas huérfanas",
        });
      }
    } catch (err) {
      checks.push({ name: "crm_appointments", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - aptT0 });
    }

    // 4. Quotes
    const quoteT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count FROM quotes WHERE org_id = ${orgId}
      `);
      const count = Number(dbRows<{ count: string }>(r)[0]?.count ?? 0);
      checks.push({ name: "crm_quotes", status: "pass", message: `${count} presupuestos`, durationMs: Date.now() - quoteT0 });
    } catch (err) {
      checks.push({ name: "crm_quotes", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - quoteT0 });
    }

    // 5. Tasks
    const taskT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count,
               COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM tasks WHERE org_id = ${orgId}
      `);
      const row = dbRows<{ count: string; pending: string }>(r)[0];
      const count = Number(row?.count ?? 0);
      const pending = Number(row?.pending ?? 0);
      checks.push({
        name: "crm_tasks",
        status: "pass",
        message: `${count} tareas, ${pending} pendientes`,
        durationMs: Date.now() - taskT0,
        detail: { count, pending },
      });
      if (pending > 20) {
        recommendations.push({
          id: "crm-tasks-backlog",
          module: "crm",
          severity: "info",
          title: `${pending} tareas pendientes`,
          description: "Hay un acumulado de tareas pendientes. Considerar revisar prioridades.",
        });
      }
    } catch (err) {
      checks.push({ name: "crm_tasks", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - taskT0 });
    }

    // 6. Orphan messages (messages without client)
    const msgT0 = Date.now();
    try {
      const r = await db.execute(sql`
        SELECT COUNT(*) as count FROM messages
        WHERE org_id = ${orgId} AND client_id IS NULL
      `);
      const orphan = Number(dbRows<{ count: string }>(r)[0]?.count ?? 0);
      checks.push({
        name: "crm_orphan_messages",
        status: orphan === 0 ? "pass" : "warn",
        message: orphan === 0 ? "Sin mensajes huérfanos" : `${orphan} mensajes huérfanos`,
        durationMs: Date.now() - msgT0,
      });
      if (orphan > 0) {
        issues.push({
          id: "crm-orphan-msg",
          module: "crm",
          severity: "info",
          title: `${orphan} mensajes huérfanos`,
          description: "Mensajes no vinculados a ningún cliente.",
          autoFixable: false,
        });
      }
    } catch (err) {
      checks.push({ name: "crm_orphan_messages", status: "fail", message: `Error: ${(err as Error).message}`, durationMs: Date.now() - msgT0 });
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
      module: "crm",
      score,
      status,
      checks,
      issues,
      recommendations,
      durationMs: Date.now() - t0,
    };
  },

  async fix(ctx, action, payload) {
    if (action === "repair_orphans") {
      try {
        const orgId = ctx.orgId;
        await db.execute(sql`
          DELETE FROM appointments
          WHERE org_id = ${orgId} AND client_id IS NULL
        `);
        return { success: true, message: "Citas huérfanas eliminadas." };
      } catch (err) {
        return { success: false, message: `Error: ${(err as Error).message}` };
      }
    }
    return { success: false, message: `Acción no soportada: ${action}` };
  },
};
