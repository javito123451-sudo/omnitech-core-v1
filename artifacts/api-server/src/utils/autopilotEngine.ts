import {
  db,
  autopilotTasksTable,
  autopilotRunsTable,
  clientsTable,
  quotesTable,
  activityTable,
  organizationsTable,
  type AutopilotTask,
} from "@workspace/db";
import { eq, and, lt, lte, gte, desc, isNull, or } from "drizzle-orm";
import { getWhatsAppCreds } from "./integrationCreds";

// ── Trigger type definitions ──────────────────────────────────────────────────
export const TRIGGER_LABELS: Record<string, string> = {
  daily:                   "Diariamente",
  weekly:                  "Cada semana",
  monthly:                 "Cada mes",
  inactive_clients_30d:    "Clientes inactivos 30 días",
  quotes_expiring_7d:      "Presupuestos por vencer (7 días)",
};

export const ACTION_LABELS: Record<string, string> = {
  strategic_brief:    "Briefing estratégico",
  notify_owner:       "Notificar al propietario",
  send_whatsapp:      "Enviar WhatsApp",
  update_client_status: "Actualizar estado de cliente",
  log_activity:       "Registrar actividad",
};

// ── Evaluate whether a task should run now ───────────────────────────────────
export function shouldRunTask(task: AutopilotTask): boolean {
  const now = new Date();

  // Condition-based triggers fire every minute (engine evaluates the condition)
  if (task.triggerType === "inactive_clients_30d" || task.triggerType === "quotes_expiring_7d") {
    // Run once per day max — check if lastRunAt was more than 23 hours ago
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
    case "daily":
      return new Date(now.getTime() + 24 * 3_600_000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 3_600_000);
    case "monthly":
      return new Date(now.getTime() + 30 * 24 * 3_600_000);
    default:
      // condition-based — re-evaluate in 23h
      return new Date(now.getTime() + 23 * 3_600_000);
  }
}

// ── Internal: send WhatsApp message ──────────────────────────────────────────
async function sendWhatsApp(orgId: number, toPhone: string, message: string): Promise<boolean> {
  const toClean = toPhone.replace(/\D/g, "");
  try {
    const creds = await getWhatsAppCreds(orgId);
    if (!creds) return false;

    const r = await fetch(
      `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to:   toClean,
          type: "text",
          text: { body: message },
        }),
      },
    );
    return r.ok;
  } catch {
    return false;
  }
}

// ── Execute an autopilot task action ─────────────────────────────────────────
async function executeAction(task: AutopilotTask, orgId: number): Promise<string> {
  const cfg = (task.actionConfig ?? {}) as Record<string, unknown>;
  const trigCfg = (task.triggerConfig ?? {}) as Record<string, unknown>;
  const now = new Date();

  switch (task.actionType) {
    // ── strategic_brief: gather CRM metrics and log as activity ─────────────
    case "strategic_brief": {
      const [clients, quotes, appts] = await Promise.all([
        db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
        db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
        db.select().from(activityTable)
          .where(and(
            eq(activityTable.orgId, orgId),
            gte(activityTable.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
          ))
          .orderBy(desc(activityTable.createdAt))
          .limit(10),
      ]);

      const active   = clients.filter(c => c.status === "active").length;
      const leads    = clients.filter(c => c.status === "lead").length;
      const inactive = clients.filter(c => c.status === "inactive").length;
      const sentQ    = quotes.filter(q => q.status === "sent").length;
      const totalQ   = quotes.reduce((acc, q) => acc + Number(q.total ?? 0), 0);

      const summary = `📊 Briefing Autopilot (${now.toLocaleDateString("es-ES")}): ${clients.length} clientes (${active} activos, ${leads} leads, ${inactive} inactivos). ${sentQ} presupuesto(s) enviado(s) por €${Math.round(totalQ).toLocaleString("es-ES")}. ${appts.length} actividades esta semana.`;

      await db.insert(activityTable).values({
        orgId,
        type:        "autopilot_brief",
        description: summary,
        clientName:  null,
      });

      // Optionally send via WhatsApp if phone configured
      const ownerPhone = cfg["owner_phone"] as string | undefined;
      if (ownerPhone) await sendWhatsApp(orgId, ownerPhone, summary);

      return summary;
    }

    // ── notify_owner: send a WhatsApp / log activity with custom message ────
    case "notify_owner": {
      const phone   = cfg["owner_phone"]   as string | undefined;
      const message = cfg["message"]       as string | undefined ?? "Notificación de Ava Autopilot";

      let result = `Notificación registrada: ${message}`;

      if (phone) {
        const sent = await sendWhatsApp(orgId, phone, message);
        result = sent
          ? `WhatsApp enviado a ${phone}: ${message}`
          : `Fallo al enviar WhatsApp a ${phone} — notificación registrada localmente`;
      }

      await db.insert(activityTable).values({
        orgId,
        type:        "autopilot_notify",
        description: result,
        clientName:  null,
      });

      return result;
    }

    // ── send_whatsapp: send a message to a specific number ──────────────────
    case "send_whatsapp": {
      const phone   = cfg["phone"]   as string | undefined;
      const message = cfg["message"] as string | undefined ?? "Mensaje automático de Ava";

      if (!phone) return "Error: falta el número de teléfono en la configuración.";

      const sent = await sendWhatsApp(orgId, phone, message);
      const result = sent
        ? `WhatsApp enviado a ${phone}`
        : `Fallo al enviar WhatsApp a ${phone}`;

      await db.insert(activityTable).values({
        orgId,
        type:        "autopilot_whatsapp",
        description: result,
        clientName:  null,
      });

      return result;
    }

    // ── log_activity: generic activity log ───────────────────────────────────
    case "log_activity": {
      const message = cfg["message"] as string | undefined ?? "Actividad registrada por Ava Autopilot";
      await db.insert(activityTable).values({
        orgId,
        type:        "autopilot_log",
        description: message,
        clientName:  null,
      });
      return message;
    }

    default: {
      // ── trigger-based fallback: inactive_clients_30d ────────────────────
      if (task.triggerType === "inactive_clients_30d") {
        const days = Number(trigCfg["days"] ?? 30);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const inactiveClients = await db
          .select()
          .from(clientsTable)
          .where(and(
            eq(clientsTable.orgId, orgId),
            or(
              eq(clientsTable.status, "inactive"),
              and(eq(clientsTable.status, "lead"), lt(clientsTable.updatedAt, cutoff)),
            ),
          ))
          .limit(20);

        if (inactiveClients.length === 0) return "Sin clientes inactivos en este periodo.";

        const names = inactiveClients.slice(0, 5).map(c => c.name).join(", ");
        const summary = `⚠️ ${inactiveClients.length} cliente(s) sin actividad en ${days}+ días: ${names}${inactiveClients.length > 5 ? ` y ${inactiveClients.length - 5} más` : ""}`;

        await db.insert(activityTable).values({
          orgId,
          type:        "autopilot_inactive",
          description: summary,
          clientName:  null,
        });

        const phone = cfg["owner_phone"] as string | undefined;
        if (phone) await sendWhatsApp(orgId, phone, summary);

        return summary;
      }

      // ── trigger-based fallback: quotes_expiring_7d ───────────────────────
      if (task.triggerType === "quotes_expiring_7d") {
        const days = Number(trigCfg["days"] ?? 7);
        const cutoff = new Date(now.getTime() + days * 86_400_000);
        const expiring = await db
          .select()
          .from(quotesTable)
          .where(and(
            eq(quotesTable.orgId, orgId),
            eq(quotesTable.status, "sent"),
            lte(quotesTable.validUntil, cutoff),
            gte(quotesTable.validUntil, now),
          ))
          .orderBy(quotesTable.validUntil)
          .limit(10);

        if (expiring.length === 0) return "Sin presupuestos por vencer en este periodo.";

        const titles = expiring.slice(0, 3).map(q => `${q.title} (vence ${q.validUntil?.toLocaleDateString("es-ES")})`).join("; ");
        const summary = `📋 ${expiring.length} presupuesto(s) vencen en ${days} días: ${titles}${expiring.length > 3 ? ` y ${expiring.length - 3} más` : ""}`;

        await db.insert(activityTable).values({
          orgId,
          type:        "autopilot_quotes",
          description: summary,
          clientName:  null,
        });

        const phone = cfg["owner_phone"] as string | undefined;
        if (phone) await sendWhatsApp(orgId, phone, summary);

        return summary;
      }

      return `Acción desconocida: ${task.actionType}`;
    }
  }
}

// ── Run a single task (wraps execution in a run record) ──────────────────────
export async function runAutopilotTask(task: AutopilotTask): Promise<void> {
  const [run] = await db
    .insert(autopilotRunsTable)
    .values({
      taskId:   task.id,
      orgId:    task.orgId,
      status:   "running",
    })
    .returning();

  const runId = run!.id;

  try {
    const result = await executeAction(task, task.orgId);
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
