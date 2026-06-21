import {
  db,
  autopilotTasksTable,
  autopilotRunsTable,
  clientsTable,
  quotesTable,
  activityTable,
  type AutopilotTask,
} from "@workspace/db";
import { eq, and, lt, lte, gte, desc, or, ne } from "drizzle-orm";
import { executeCrmTool } from "../routes/chat";
import { sendAutoReply } from "../routes/whatsapp";

// ── Trigger & action label maps (shared with frontend) ────────────────────────
export const TRIGGER_LABELS: Record<string, string> = {
  daily:                "Diariamente",
  weekly:               "Cada semana",
  monthly:              "Cada mes",
  inactive_clients_30d: "Clientes inactivos 30 días",
  quotes_expiring_7d:   "Presupuestos por vencer (7 días)",
};

export const ACTION_LABELS: Record<string, string> = {
  strategic_brief:      "Briefing estratégico",
  notify_owner:         "Notificar al propietario",
  send_whatsapp:        "Enviar WhatsApp",
  create_task:          "Crear seguimiento (actividad)",
  update_client_status: "Actualizar estado de cliente",
};

// ── Evaluate whether a task should run now ────────────────────────────────────
export function shouldRunTask(task: AutopilotTask): boolean {
  const now = new Date();

  // Condition-based triggers: run once per day max
  if (task.triggerType === "inactive_clients_30d" || task.triggerType === "quotes_expiring_7d") {
    if (!task.lastRunAt) return true;
    const hoursAgo = (now.getTime() - task.lastRunAt.getTime()) / 3_600_000;
    return hoursAgo >= 23;
  }

  // Time-based triggers: compare with nextRunAt
  if (!task.nextRunAt) return true;
  return now >= task.nextRunAt;
}

// ── Calculate the next run timestamp after a successful execution ─────────────
export function calcNextRunAt(triggerType: string): Date {
  const now = new Date();
  switch (triggerType) {
    case "daily":   return new Date(now.getTime() + 24         * 3_600_000);
    case "weekly":  return new Date(now.getTime() + 7  * 24   * 3_600_000);
    case "monthly": return new Date(now.getTime() + 30 * 24   * 3_600_000);
    default:        return new Date(now.getTime() + 23         * 3_600_000);
  }
}

// ── Execute the action for a task ────────────────────────────────────────────
async function executeAction(task: AutopilotTask, orgId: number): Promise<string> {
  const cfg     = (task.actionConfig  ?? {}) as Record<string, unknown>;
  const trigCfg = (task.triggerConfig ?? {}) as Record<string, unknown>;
  const now = new Date();

  switch (task.actionType) {

    // ── strategic_brief: call shared executeCrmTool, log + optional WhatsApp ─
    case "strategic_brief": {
      const jsonResult = await executeCrmTool("get_strategic_brief", {}, orgId);
      type BriefData = {
        error?: string;
        kpis?: { total_clients: number; active_clients: number; leads: number; at_risk: number; pipeline_eur: number };
        main_risks?: string[];
      };
      const data = JSON.parse(jsonResult) as BriefData;

      if (data.error) return `Briefing no disponible: ${data.error}`;

      const k = data.kpis;
      const riskLine = data.main_risks?.length
        ? ` Riesgos: ${data.main_risks.slice(0, 2).join("; ")}.`
        : "";
      const summary = k
        ? `📊 Briefing Autopilot (${now.toLocaleDateString("es-ES")}): ${k.total_clients} clientes (${k.active_clients} activos, ${k.leads} leads, ${k.at_risk} en riesgo). Pipeline €${k.pipeline_eur.toLocaleString("es-ES")}.${riskLine}`
        : `📊 Briefing Autopilot (${now.toLocaleDateString("es-ES")}): análisis generado.`;

      await db.insert(activityTable).values({ orgId, type: "autopilot_brief", description: summary, clientName: null });

      const phone = cfg["owner_phone"] as string | undefined;
      if (phone) await sendAutoReply(orgId, phone, summary);

      return summary;
    }

    // ── notify_owner: log activity + optional WhatsApp via shared sendAutoReply
    case "notify_owner": {
      const phone   = cfg["owner_phone"] as string | undefined;
      const message = cfg["message"]     as string | undefined ?? "Notificación de Ava Autopilot";

      let result = `Notificación registrada: ${message}`;
      if (phone) {
        const sent = await sendAutoReply(orgId, phone, message);
        result = sent
          ? `WhatsApp enviado a ${phone}: ${message}`
          : `Fallo al enviar WhatsApp a ${phone} — registrado localmente`;
      }

      await db.insert(activityTable).values({ orgId, type: "autopilot_notify", description: result, clientName: null });
      return result;
    }

    // ── send_whatsapp: direct message via shared sendAutoReply ───────────────
    case "send_whatsapp": {
      const phone   = cfg["phone"]   as string | undefined;
      const message = cfg["message"] as string | undefined ?? "Mensaje automático de Ava";

      if (!phone) return "Error: falta el número de teléfono en la configuración.";

      const sent = await sendAutoReply(orgId, phone, message);
      const result = sent
        ? `WhatsApp enviado a ${phone}`
        : `Fallo al enviar WhatsApp a ${phone}`;

      await db.insert(activityTable).values({ orgId, type: "autopilot_whatsapp", description: result, clientName: null });
      return result;
    }

    // ── create_task: create follow-up activity entries for affected clients ──
    case "create_task": {
      const days   = Number(trigCfg["days"] ?? 30);
      const note   = cfg["note"] as string | undefined ?? "Seguimiento automático por Ava Autopilot";
      const cutoff = new Date(now.getTime() - days * 86_400_000);

      const staleClients = await db
        .select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.orgId, orgId),
          or(
            eq(clientsTable.status, "inactive"),
            and(eq(clientsTable.status, "lead"), lt(clientsTable.updatedAt, cutoff)),
          ),
        ))
        .limit(10);

      if (staleClients.length === 0) return "Sin clientes que requieran seguimiento en este periodo.";

      await Promise.all(
        staleClients.map(c =>
          db.insert(activityTable).values({
            orgId,
            type:        "autopilot_followup",
            description: `${note}: ${c.name}`,
            clientName:  c.name,
          }),
        ),
      );

      const names = staleClients.slice(0, 3).map(c => c.name).join(", ");
      return `✅ Seguimientos creados para ${staleClients.length} cliente(s): ${names}${staleClients.length > 3 ? ` y ${staleClients.length - 3} más` : ""}`;
    }

    // ── update_client_status: bulk-update stale clients' status in the DB ────
    case "update_client_status": {
      const days      = Number(trigCfg["days"]      ?? 30);
      const fromStatus = cfg["from_status"] as string | undefined ?? "lead";
      const toStatus   = cfg["to_status"]   as string | undefined ?? "inactive";
      const cutoff     = new Date(now.getTime() - days * 86_400_000);

      const targets = await db
        .select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.orgId, orgId),
          eq(clientsTable.status, fromStatus),
          lt(clientsTable.updatedAt, cutoff),
        ))
        .limit(20);

      if (targets.length === 0) return `Sin clientes con estado "${fromStatus}" inactivos ${days}+ días.`;

      await Promise.all(
        targets.map(c =>
          db.update(clientsTable)
            .set({ status: toStatus, updatedAt: new Date() })
            .where(and(eq(clientsTable.id, c.id), eq(clientsTable.orgId, orgId))),
        ),
      );

      const names = targets.slice(0, 3).map(c => c.name).join(", ");
      const summary = `🔄 ${targets.length} cliente(s) actualizados de "${fromStatus}" → "${toStatus}": ${names}${targets.length > 3 ? ` y ${targets.length - 3} más` : ""}`;
      await db.insert(activityTable).values({ orgId, type: "autopilot_status_update", description: summary, clientName: null });
      return summary;
    }

    // ── default: condition-triggered fallback (inactive_clients / quotes) ────
    default: {
      if (task.triggerType === "inactive_clients_30d") {
        const days   = Number(trigCfg["days"] ?? 30);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const rows   = await db.select({ id: clientsTable.id, name: clientsTable.name })
          .from(clientsTable)
          .where(and(
            eq(clientsTable.orgId, orgId),
            or(eq(clientsTable.status, "inactive"), and(eq(clientsTable.status, "lead"), lt(clientsTable.updatedAt, cutoff))),
          ))
          .limit(20);

        if (rows.length === 0) return "Sin clientes inactivos en este periodo.";

        const names   = rows.slice(0, 5).map(c => c.name).join(", ");
        const summary = `⚠️ ${rows.length} cliente(s) sin actividad en ${days}+ días: ${names}${rows.length > 5 ? ` y ${rows.length - 5} más` : ""}`;
        await db.insert(activityTable).values({ orgId, type: "autopilot_inactive", description: summary, clientName: null });
        return summary;
      }

      if (task.triggerType === "quotes_expiring_7d") {
        const days   = Number(trigCfg["days"] ?? 7);
        const cutoff = new Date(now.getTime() + days * 86_400_000);
        const rows   = await db.select().from(quotesTable)
          .where(and(eq(quotesTable.orgId, orgId), eq(quotesTable.status, "sent"), lte(quotesTable.validUntil, cutoff), gte(quotesTable.validUntil, now)))
          .orderBy(quotesTable.validUntil)
          .limit(10);

        if (rows.length === 0) return "Sin presupuestos por vencer en este periodo.";

        const titles  = rows.slice(0, 3).map(q => `${q.title} (${q.validUntil?.toLocaleDateString("es-ES")})`).join("; ");
        const summary = `📋 ${rows.length} presupuesto(s) vencen en ${days} días: ${titles}${rows.length > 3 ? ` y ${rows.length - 3} más` : ""}`;
        await db.insert(activityTable).values({ orgId, type: "autopilot_quotes", description: summary, clientName: null });
        return summary;
      }

      return `Acción no reconocida: ${task.actionType} (trigger: ${task.triggerType})`;
    }
  }
}

// ── Run a single task with idempotency guard and atomic nextRunAt advance ─────
export async function runAutopilotTask(task: AutopilotTask): Promise<void> {
  // 1. Guard: skip if already running to prevent concurrent duplicate executions
  const inflight = await db
    .select({ id: autopilotRunsTable.id })
    .from(autopilotRunsTable)
    .where(and(eq(autopilotRunsTable.taskId, task.id), eq(autopilotRunsTable.status, "running")))
    .limit(1);
  if (inflight.length > 0) return;

  // 2. Atomically advance nextRunAt BEFORE execution so the next scheduler tick
  //    won't pick this task up again while it's still running.
  const tempNextRun = calcNextRunAt(task.triggerType);
  await db.update(autopilotTasksTable)
    .set({ nextRunAt: tempNextRun, updatedAt: new Date() })
    .where(eq(autopilotTasksTable.id, task.id));

  // 3. Insert run record with status "running"
  const [run] = await db
    .insert(autopilotRunsTable)
    .values({ taskId: task.id, orgId: task.orgId, status: "running" })
    .returning();
  const runId = run!.id;

  try {
    const result = await executeAction(task, task.orgId);

    await Promise.all([
      db.update(autopilotRunsTable)
        .set({ status: "success", completedAt: new Date(), resultSummary: result.slice(0, 500) })
        .where(eq(autopilotRunsTable.id, runId)),
      db.update(autopilotTasksTable)
        .set({ lastRunAt: new Date(), nextRunAt: tempNextRun, updatedAt: new Date() })
        .where(eq(autopilotTasksTable.id, task.id)),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      db.update(autopilotRunsTable)
        .set({ status: "error", completedAt: new Date(), errorMessage: msg.slice(0, 500) })
        .where(eq(autopilotRunsTable.id, runId)),
      db.update(autopilotTasksTable)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(autopilotTasksTable.id, task.id)),
    ]);
    throw err;
  }
}
