import {
  db,
  autopilotTasksTable,
  autopilotRunsTable,
  clientsTable,
  quotesTable,
  activityTable,
  type AutopilotTask,
} from "@workspace/db";
import { eq, and, lt, lte, gte, desc, or, sql } from "drizzle-orm";
import { executeCrmTool } from "../routes/chat";
import { sendAutoReply } from "../routes/whatsapp";

// ── Label maps ────────────────────────────────────────────────────────────────
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

// ── Condition helpers — query DB to check if CRM condition is currently met ───
async function hasInactiveClients(orgId: number, days: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(and(
      eq(clientsTable.orgId, orgId),
      or(
        eq(clientsTable.status, "inactive"),
        and(eq(clientsTable.status, "lead"), lt(clientsTable.updatedAt, cutoff)),
      ),
    ));
  return (row?.count ?? 0) > 0;
}

async function hasExpiringQuotes(orgId: number, days: number): Promise<boolean> {
  const now    = new Date();
  const cutoff = new Date(now.getTime() + days * 86_400_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotesTable)
    .where(and(
      eq(quotesTable.orgId, orgId),
      eq(quotesTable.status, "sent"),
      lte(quotesTable.validUntil, cutoff),
      gte(quotesTable.validUntil, now),
    ));
  return (row?.count ?? 0) > 0;
}

// ── shouldRunTask — evaluates time AND CRM conditions ─────────────────────────
// Returns true only when the task is due AND (for condition-based triggers)
// the CRM condition is actually met.
export async function shouldRunTask(task: AutopilotTask): Promise<boolean> {
  const now = new Date();
  const trigCfg = (task.triggerConfig ?? {}) as Record<string, unknown>;

  // ── condition-based triggers ─────────────────────────────────────────────
  if (task.triggerType === "inactive_clients_30d" || task.triggerType === "quotes_expiring_7d") {
    // Rate-limit: run at most once per 23 h
    if (task.lastRunAt) {
      const hoursAgo = (now.getTime() - task.lastRunAt.getTime()) / 3_600_000;
      if (hoursAgo < 23) return false;
    }

    // Evaluate the actual CRM condition before running
    if (task.triggerType === "inactive_clients_30d") {
      const days = Number(trigCfg["days"] ?? 30);
      return hasInactiveClients(task.orgId, days);
    }
    if (task.triggerType === "quotes_expiring_7d") {
      const days = Number(trigCfg["days"] ?? 7);
      return hasExpiringQuotes(task.orgId, days);
    }
  }

  // ── time-based triggers: compare nextRunAt with current time ─────────────
  if (!task.nextRunAt) return true;
  return now >= task.nextRunAt;
}

// ── calcNextRunAt — compute the next scheduled timestamp ─────────────────────
export function calcNextRunAt(triggerType: string): Date {
  const now = new Date();
  switch (triggerType) {
    case "daily":   return new Date(now.getTime() + 24       * 3_600_000);
    case "weekly":  return new Date(now.getTime() + 7 * 24   * 3_600_000);
    case "monthly": return new Date(now.getTime() + 30 * 24  * 3_600_000);
    default:        return new Date(now.getTime() + 23       * 3_600_000); // condition-based
  }
}

// ── executeAction — dispatch to the correct action handler ────────────────────
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

    // ── notify_owner: log + optional WhatsApp via shared sendAutoReply ────────
    case "notify_owner": {
      const phone   = cfg["owner_phone"] as string | undefined;
      const message = cfg["message"]     as string | undefined ?? "Notificación de Ava Autopilot";

      // For condition-triggered tasks, build a context-aware message
      let contextMsg = message;
      if (task.triggerType === "inactive_clients_30d") {
        const days = Number(trigCfg["days"] ?? 30);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const rows = await db.select({ name: clientsTable.name })
          .from(clientsTable)
          .where(and(
            eq(clientsTable.orgId, orgId),
            or(eq(clientsTable.status, "inactive"), and(eq(clientsTable.status, "lead"), lt(clientsTable.updatedAt, cutoff))),
          ))
          .limit(5);
        if (rows.length > 0) {
          contextMsg = `⚠️ Clientes sin actividad en ${days}+ días: ${rows.map(r => r.name).join(", ")}`;
        }
      } else if (task.triggerType === "quotes_expiring_7d") {
        const days   = Number(trigCfg["days"] ?? 7);
        const cutoff = new Date(now.getTime() + days * 86_400_000);
        const rows = await db.select({ title: quotesTable.title, validUntil: quotesTable.validUntil })
          .from(quotesTable)
          .where(and(eq(quotesTable.orgId, orgId), eq(quotesTable.status, "sent"), lte(quotesTable.validUntil, cutoff), gte(quotesTable.validUntil, now)))
          .orderBy(quotesTable.validUntil)
          .limit(5);
        if (rows.length > 0) {
          contextMsg = `📋 Presupuestos por vencer en ${days} días: ${rows.map(r => `${r.title} (${r.validUntil?.toLocaleDateString("es-ES")})`).join("; ")}`;
        }
      }

      let result = `Notificación registrada: ${contextMsg}`;
      if (phone) {
        const sent = await sendAutoReply(orgId, phone, contextMsg);
        result = sent
          ? `WhatsApp enviado a ${phone}: ${contextMsg.slice(0, 80)}…`
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

    // ── update_client_status: bulk-update stale clients in the DB ─────────────
    case "update_client_status": {
      const days       = Number(trigCfg["days"]      ?? 30);
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

      const names   = targets.slice(0, 3).map(c => c.name).join(", ");
      const summary = `🔄 ${targets.length} cliente(s) actualizados "${fromStatus}" → "${toStatus}": ${names}${targets.length > 3 ? ` y ${targets.length - 3} más` : ""}`;
      await db.insert(activityTable).values({ orgId, type: "autopilot_status_update", description: summary, clientName: null });
      return summary;
    }

    // ── unrecognized action ───────────────────────────────────────────────────
    default:
      return `Acción no reconocida: ${task.actionType}`;
  }
}

// ── runAutopilotTask — idempotent execution with in-flight guard ──────────────
// nextRunAt is advanced ONLY after successful completion so that failed tasks
// remain eligible for retry on the next scheduler tick.
export async function runAutopilotTask(task: AutopilotTask): Promise<void> {
  // 1. Idempotency guard: skip if a run is already in progress for this task
  const inflight = await db
    .select({ id: autopilotRunsTable.id })
    .from(autopilotRunsTable)
    .where(and(eq(autopilotRunsTable.taskId, task.id), eq(autopilotRunsTable.status, "running")))
    .limit(1);
  if (inflight.length > 0) return;

  // 2. Insert run record as "running" — this acts as the distributed lock
  //    so a concurrent scheduler tick sees the in-flight guard above.
  const [run] = await db
    .insert(autopilotRunsTable)
    .values({ taskId: task.id, orgId: task.orgId, status: "running" })
    .returning();
  const runId = run!.id;

  try {
    const result = await executeAction(task, task.orgId);

    // 3. On success: mark run complete AND advance nextRunAt
    const nextRunAt = calcNextRunAt(task.triggerType);
    await Promise.all([
      db.update(autopilotRunsTable)
        .set({ status: "success", completedAt: new Date(), resultSummary: result.slice(0, 500) })
        .where(eq(autopilotRunsTable.id, runId)),
      db.update(autopilotTasksTable)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(autopilotTasksTable.id, task.id)),
    ]);
  } catch (err) {
    // 4. On failure: mark run as error; do NOT advance nextRunAt so the task
    //    remains eligible for retry on the next scheduler tick.
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
