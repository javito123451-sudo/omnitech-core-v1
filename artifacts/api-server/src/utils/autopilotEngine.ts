import {
  db,
  autopilotTasksTable,
  autopilotRunsTable,
  clientsTable,
  quotesTable,
  activityTable,
  messagesTable,
  type AutopilotTask,
} from "@workspace/db";
import { eq, and, lt, lte, gte, gt, desc, or, sql } from "drizzle-orm";
import { executeCrmTool } from "../routes/chat";
import { NotificationService } from "../services/notificationService";
import type { NotifChannel } from "../services/notificationService";
import { generateFollowupMessage, type FollowupTriggerConfig } from "./autopilotMessages";
import { pauseAutopilotOnReply } from "./autopilotPause";
import { logAuditSystem } from "./auditLogger";

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
  send_notification:    "Enviar Notificación",
  // Legacy — kept for display compatibility; engine migrates to send_notification
  send_whatsapp:        "Enviar Notificación (WA)",
  create_task:          "Crear seguimiento (actividad)",
  update_client_status: "Actualizar estado de cliente",
  client_followup:      "Seguimiento comercial (Autopilot por cliente)",
};

// triggerType "client_followup_sequence" pair — ver TRIGGER_LABELS arriba para
// los ya existentes; este no se añade ahí porque no es seleccionable en el
// picker genérico de automations.tsx, se crea solo vía POST /autopilot/clients/:id/enable.
export const CLIENT_FOLLOWUP_TRIGGER_TYPE = "client_followup_sequence";
export const CLIENT_FOLLOWUP_ACTION_TYPE  = "client_followup";

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
export async function shouldRunTask(task: AutopilotTask): Promise<boolean> {
  const now = new Date();
  const trigCfg = (task.triggerConfig ?? {}) as Record<string, unknown>;

  // ── client_followup_sequence: per-client Autopilot ───────────────────────
  if (task.triggerType === CLIENT_FOLLOWUP_TRIGGER_TYPE) {
    if (task.pausedReason) return false; // pausado (por respuesta o manual)
    const cfg = task.triggerConfig as Partial<FollowupTriggerConfig> | null;
    const intervals = cfg?.intervalsDays ?? [3, 4, 7];
    if (task.currentStep >= intervals.length) return false; // secuencia completada
    if (!task.nextRunAt) return true;
    return now >= task.nextRunAt;
  }

  // ── condition-based triggers ─────────────────────────────────────────────
  if (task.triggerType === "inactive_clients_30d" || task.triggerType === "quotes_expiring_7d") {
    if (task.lastRunAt) {
      const hoursAgo = (now.getTime() - task.lastRunAt.getTime()) / 3_600_000;
      if (hoursAgo < 23) return false;
    }
    if (task.triggerType === "inactive_clients_30d") {
      const days = Number(trigCfg["days"] ?? 30);
      return hasInactiveClients(task.orgId, days);
    }
    if (task.triggerType === "quotes_expiring_7d") {
      const days = Number(trigCfg["days"] ?? 7);
      return hasExpiringQuotes(task.orgId, days);
    }
  }

  // ── time-based triggers ───────────────────────────────────────────────────
  if (!task.nextRunAt) return true;
  return now >= task.nextRunAt;
}

// ── calcNextRunAt — compute the next scheduled timestamp ─────────────────────
// Takes the (possibly freshly-refetched) task so client_followup_sequence can
// use its current currentStep + triggerConfig.intervalsDays. Returns null when
// a client follow-up sequence has run out of configured steps (no more runs).
export function calcNextRunAt(task: AutopilotTask): Date | null {
  if (task.triggerType === CLIENT_FOLLOWUP_TRIGGER_TYPE) {
    const cfg = task.triggerConfig as Partial<FollowupTriggerConfig> | null;
    const intervals = cfg?.intervalsDays ?? [3, 4, 7];
    if (task.currentStep >= intervals.length) return null;
    const days = intervals[task.currentStep] ?? 3;
    return new Date(Date.now() + days * 86_400_000);
  }
  const now = new Date();
  switch (task.triggerType) {
    case "daily":   return new Date(now.getTime() + 24      * 3_600_000);
    case "weekly":  return new Date(now.getTime() + 7 * 24  * 3_600_000);
    case "monthly": return new Date(now.getTime() + 30 * 24 * 3_600_000);
    default:        return new Date(now.getTime() + 23      * 3_600_000);
  }
}

// ── executeAction — dispatch to the correct action handler ────────────────────
async function executeAction(task: AutopilotTask, orgId: number): Promise<string> {
  const cfg     = (task.actionConfig  ?? {}) as Record<string, unknown>;
  const trigCfg = (task.triggerConfig ?? {}) as Record<string, unknown>;
  const now = new Date();

  switch (task.actionType) {

    // ── strategic_brief: AI brief → NotificationService ──────────────────────
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

      // Notify via NotificationService — respects workspace integrations
      const recipient = (cfg["recipient"] as string | undefined) ?? (cfg["owner_phone"] as string | undefined) ?? "";
      const channels  = parseChannels(cfg["channels"]);
      if (recipient) {
        const results = await NotificationService.send({ orgId, channels, to: recipient, message: summary });
        return `${summary} | ${NotificationService.summarize(results)}`;
      }

      return summary;
    }

    // ── notify_owner: context-aware alert → NotificationService ───────────────
    case "notify_owner": {
      const recipient = (cfg["recipient"] as string | undefined) ?? (cfg["owner_phone"] as string | undefined) ?? "";
      const channels  = parseChannels(cfg["channels"]);
      const baseMsg   = (cfg["message"] as string | undefined) ?? "Notificación de Ava Autopilot";

      let contextMsg = baseMsg;
      if (task.triggerType === "inactive_clients_30d") {
        const days   = Number(trigCfg["days"] ?? 30);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const rows   = await db.select({ name: clientsTable.name })
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
        const rows   = await db.select({ title: quotesTable.title, validUntil: quotesTable.validUntil })
          .from(quotesTable)
          .where(and(eq(quotesTable.orgId, orgId), eq(quotesTable.status, "sent"), lte(quotesTable.validUntil, cutoff), gte(quotesTable.validUntil, now)))
          .orderBy(quotesTable.validUntil)
          .limit(5);
        if (rows.length > 0) {
          contextMsg = `📋 Presupuestos por vencer en ${days} días: ${rows.map(r => `${r.title} (${r.validUntil?.toLocaleDateString("es-ES")})`).join("; ")}`;
        }
      }

      await db.insert(activityTable).values({ orgId, type: "autopilot_notify", description: contextMsg, clientName: null });

      if (recipient) {
        const results = await NotificationService.send({ orgId, channels, to: recipient, message: contextMsg });
        return `${contextMsg.slice(0, 120)} | ${NotificationService.summarize(results)}`;
      }
      return `Notificación registrada: ${contextMsg}`;
    }

    // ── send_notification: universal multi-channel dispatch ───────────────────
    case "send_notification":
    // Legacy alias — FIX-AE migrates DB rows but handle in-flight ones defensively
    case "send_whatsapp": {
      const recipient = (cfg["recipient"] as string | undefined) ?? (cfg["phone"] as string | undefined) ?? "";
      const message   = (cfg["message"] as string | undefined) ?? "Mensaje automático de Ava";
      const channels  = parseChannels(cfg["channels"] ?? (task.actionType === "send_whatsapp" ? ["whatsapp"] : ["auto"]));

      if (!recipient) return "Error: falta el destinatario en la configuración.";

      const results = await NotificationService.send({ orgId, channels, to: recipient, message });
      const summary = NotificationService.summarize(results);

      await db.insert(activityTable).values({ orgId, type: "autopilot_notification", description: summary, clientName: null });
      return summary;
    }

    // ── create_task: follow-up activities for stale clients ───────────────────
    case "create_task": {
      const days   = Number(trigCfg["days"] ?? 30);
      const note   = (cfg["note"] as string | undefined) ?? "Seguimiento automático por Ava Autopilot";
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

    // ── update_client_status: bulk-update stale clients ───────────────────────
    case "update_client_status": {
      const days       = Number(trigCfg["days"]      ?? 30);
      const fromStatus = (cfg["from_status"] as string | undefined) ?? "lead";
      const toStatus   = (cfg["to_status"]   as string | undefined) ?? "inactive";
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

    // ── client_followup: seguimiento comercial por cliente (Client Autopilot) ─
    case CLIENT_FOLLOWUP_ACTION_TYPE: {
      if (!task.clientId) return "Error: tarea de seguimiento sin clientId.";

      const [client] = await db
        .select()
        .from(clientsTable)
        .where(and(eq(clientsTable.id, task.clientId), eq(clientsTable.orgId, orgId)));
      if (!client) {
        await db.update(autopilotTasksTable)
          .set({ enabled: false, pausedReason: "manual", updatedAt: now })
          .where(eq(autopilotTasksTable.id, task.id));
        return "Cliente ya no existe — Autopilot desactivado.";
      }

      // ── Capa de seguridad redundante: re-verifica respuesta justo antes de
      // generar/enviar, por si la pausa event-driven (webhooks) no llegó a
      // ejecutarse todavía (p. ej. condición de carrera entre el tick y el
      // webhook entrante). Nunca se envía nada sin pasar por esta comprobación.
      const [lastOutbound] = await db
        .select({ createdAt: messagesTable.createdAt })
        .from(messagesTable)
        .where(and(eq(messagesTable.autopilotTaskId, task.id), eq(messagesTable.direction, "outbound")))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);
      const sinceDate = lastOutbound?.createdAt ?? task.createdAt;
      const [reply] = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(and(
          eq(messagesTable.clientId, client.id),
          eq(messagesTable.direction, "inbound"),
          gt(messagesTable.createdAt, sinceDate),
        ))
        .limit(1);
      if (reply) {
        await pauseAutopilotOnReply(orgId, client.id);
        return "Pausado: se detectó una respuesta del cliente antes de enviar (capa de seguridad).";
      }

      const cfg = (task.triggerConfig ?? {}) as Partial<FollowupTriggerConfig>;
      const intervals = cfg.intervalsDays ?? [3, 4, 7];
      const mode      = cfg.mode ?? "approval";
      const step      = task.currentStep + 1;

      if (step > intervals.length) {
        await db.update(autopilotTasksTable)
          .set({ enabled: false, pausedReason: null, updatedAt: now })
          .where(eq(autopilotTasksTable.id, task.id));
        return "Secuencia completada — Autopilot detenido tras el último seguimiento.";
      }

      // ── Idempotencia por paso: si ya existe un mensaje para este
      // (taskId, step), no se genera/envía de nuevo aunque el tick se
      // repita o corra dos veces en paralelo.
      const [existing] = await db
        .select({ id: messagesTable.id, status: messagesTable.status })
        .from(messagesTable)
        .where(and(eq(messagesTable.autopilotTaskId, task.id), eq(messagesTable.autopilotStep, step)))
        .limit(1);
      if (existing) {
        return `Paso ${step} ya generado (mensaje #${existing.id}, estado "${existing.status}") — no se duplica.`;
      }

      const channel = (cfg.preferredChannel ?? client.preferredChannel ?? "whatsapp") as string;
      const content = await generateFollowupMessage(client, task, step);

      if (mode === "approval") {
        const [msg] = await db.insert(messagesTable).values({
          orgId,
          clientId: client.id,
          content,
          direction: "outbound",
          channel,
          isAi: true,
          status: "pending_approval",
          autopilotTaskId: task.id,
          autopilotStep: step,
        }).returning();

        await db.insert(activityTable).values({
          orgId,
          clientId: client.id,
          type: "autopilot_message_drafted",
          description: `🤖 Autopilot generó un borrador de seguimiento ${step} (pendiente de aprobación).`,
          clientName: client.name,
        });
        await logAuditSystem({
          actorClerkId: `system:autopilot:${orgId}`,
          action: "autopilot_message_drafted",
          resource: "message",
          resourceId: msg!.id,
          orgId,
          details: { clientId: client.id, step },
          severity: "info",
        });

        return `Borrador de seguimiento ${step} generado (pendiente de aprobación) para ${client.name}.`;
      }

      // ── mode === "autopilot": genera y envía de inmediato ────────────────
      const to = channel === "email"
        ? (client.companyEmail ?? client.email)
        : (client.phone ?? client.companyPhone ?? "");
      if (!to) {
        return `Error: sin destino de contacto para el canal "${channel}" de ${client.name}.`;
      }

      const results = await NotificationService.send({
        orgId, channels: [channel as NotifChannel], to, message: content,
        context: { subject: `Seguimiento — ${client.name}` },
      });
      const success  = results.some(r => r.success);

      const [msg] = await db.insert(messagesTable).values({
        orgId,
        clientId: client.id,
        content,
        direction: "outbound",
        channel,
        isAi: true,
        status: success ? "sent" : "failed",
        autopilotTaskId: task.id,
        autopilotStep: step,
      }).returning();

      const isLastStep = step >= intervals.length;
      await db.update(autopilotTasksTable)
        .set({
          currentStep: step,
          ...(isLastStep ? { enabled: false, pausedReason: null } : {}),
          updatedAt: now,
        })
        .where(eq(autopilotTasksTable.id, task.id));

      const followupColumn: Partial<Record<"followup1At" | "followup2At" | "followup3At", Date>> = {};
      if (step === 1) followupColumn.followup1At = now;
      else if (step === 2) followupColumn.followup2At = now;
      else if (step === 3) followupColumn.followup3At = now;

      await db.update(clientsTable)
        .set({
          ...followupColumn,
          lastContactAt: now,
          attemptCount: sql`${clientsTable.attemptCount} + 1`,
          nextFollowupAt: isLastStep ? null : calcNextRunAt({ ...task, currentStep: step }),
        })
        .where(eq(clientsTable.id, client.id));

      await db.insert(activityTable).values({
        orgId,
        clientId: client.id,
        type: "autopilot_message_sent",
        description: `📤 Seguimiento ${step} enviado por ${channel}.`,
        clientName: client.name,
      });
      await logAuditSystem({
        actorClerkId: `system:autopilot:${orgId}`,
        action: "autopilot_message_sent",
        resource: "message",
        resourceId: msg!.id,
        orgId,
        details: { clientId: client.id, step, channel, success },
        severity: "info",
      });

      return `Seguimiento ${step} enviado a ${client.name} por ${channel}. ${NotificationService.summarize(results)}`;
    }

    default:
      return `Acción no reconocida: ${task.actionType}`;
  }
}

// ── parseChannels — normalise actionConfig.channels to NotifChannel[] ─────────
function parseChannels(raw: unknown): NotifChannel[] {
  if (Array.isArray(raw) && raw.length > 0) return raw as NotifChannel[];
  if (typeof raw === "string" && raw) return [raw as NotifChannel];
  return ["auto"];
}

// ── runAutopilotTask — idempotent execution with in-flight guard ──────────────
export async function runAutopilotTask(task: AutopilotTask): Promise<void> {
  const inflight = await db
    .select({ id: autopilotRunsTable.id })
    .from(autopilotRunsTable)
    .where(and(eq(autopilotRunsTable.taskId, task.id), eq(autopilotRunsTable.status, "running")))
    .limit(1);
  if (inflight.length > 0) return;

  const [run] = await db
    .insert(autopilotRunsTable)
    .values({ taskId: task.id, orgId: task.orgId, status: "running" })
    .returning();
  const runId = run!.id;

  try {
    const result = await executeAction(task, task.orgId);
    // Re-fetch — executeAction (client_followup) may have already updated
    // currentStep/enabled/pausedReason directly, which calcNextRunAt needs.
    const [freshTask] = await db.select().from(autopilotTasksTable).where(eq(autopilotTasksTable.id, task.id));
    const nextRunAt = freshTask ? calcNextRunAt(freshTask) : null;
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
    await db.update(autopilotRunsTable)
      .set({ status: "error", completedAt: new Date(), errorMessage: msg.slice(0, 500) })
      .where(eq(autopilotRunsTable.id, runId));
    throw err;
  }
}
