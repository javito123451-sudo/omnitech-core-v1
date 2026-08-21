import { Router } from "express";
import { db, autopilotTasksTable, autopilotRunsTable, clientsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, gte, lte, isNotNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { getActiveChannels, NotificationService } from "../services/notificationService";
import type { NotifChannel } from "../services/notificationService";
import { CLIENT_FOLLOWUP_TRIGGER_TYPE, CLIENT_FOLLOWUP_ACTION_TYPE, calcNextRunAt } from "../utils/autopilotEngine";
import { generateFollowupMessage, type FollowupTriggerConfig } from "../utils/autopilotMessages";
import { logAudit } from "../utils/auditLogger";

type AuthReq = Request & { orgId?: number; userId?: number; clerkUserId?: string };

export const autopilotRouter = Router();

import { requirePermission } from "../middlewares/permissions";

// ── GET /api/autopilot/channels — active integration slugs for this workspace ─
autopilotRouter.get("/channels", requirePermission("automations.read"), async (req: AuthReq, res: Response) => {
  const orgId = req.orgId!;
  try {
    const slugs = await getActiveChannels(orgId);
    // Map slugs to human labels; only expose messaging-capable channels
    const CHANNEL_META: Record<string, { label: string; icon: string }> = {
      telegram:  { label: "Telegram",             icon: "Send"     },
      whatsapp:  { label: "WhatsApp",              icon: "MessageCircle" },
      email:     { label: "Email",                 icon: "Mail"     },
      slack:     { label: "Slack",                 icon: "Hash"     },
      teams:     { label: "Microsoft Teams",       icon: "Users"    },
    };
    const channels = [
      // Always include the special modes first
      { slug: "auto",     label: "Automático (mejor canal disponible)", icon: "Zap"     },
      { slug: "internal", label: "Notificación interna",                icon: "Bell"    },
      // Then the workspace's active integrations
      ...slugs
        .filter(s => s in CHANNEL_META)
        .map(s => ({ slug: s, ...(CHANNEL_META[s]!) })),
      // "Todos" at the end
      { slug: "all",      label: "Todos los disponibles",              icon: "Globe"   },
    ];
    res.json({ channels, active: slugs });
  } catch (err) {
    console.error("[autopilot] GET /channels error:", err);
    res.status(500).json({ error: "Error al obtener canales disponibles" });
  }
});

// ── GET /api/autopilot/tasks ─────────────────────────────────────────────────
autopilotRouter.get("/tasks", requirePermission("automations.read"), async (req: AuthReq, res: Response) => {
  const orgId = req.orgId!;
  try {
    const tasks = await db
      .select()
      .from(autopilotTasksTable)
      .where(eq(autopilotTasksTable.orgId, orgId))
      .orderBy(desc(autopilotTasksTable.createdAt));
    res.json(tasks);
  } catch (err) {
    console.error("[autopilot] GET /tasks error:", err);
    res.status(500).json({ error: "Error al obtener tareas" });
  }
});

// ── POST /api/autopilot/tasks ────────────────────────────────────────────────
autopilotRouter.post("/tasks", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId = req.orgId!;
  const { name, triggerType, triggerConfig, actionType, actionConfig } = req.body as {
    name: string;
    triggerType: string;
    triggerConfig?: Record<string, unknown>;
    actionType: string;
    actionConfig?: Record<string, unknown>;
  };

  if (!name?.trim() || !triggerType || !actionType) {
    res.status(400).json({ error: "name, triggerType y actionType son requeridos" });
    return;
  }

  try {
    const [task] = await db
      .insert(autopilotTasksTable)
      .values({
        orgId,
        name:          name.trim(),
        triggerType,
        triggerConfig: triggerConfig ?? {},
        actionType,
        actionConfig:  actionConfig ?? {},
        enabled:       true,
      })
      .returning();
    res.status(201).json(task);
  } catch (err) {
    console.error("[autopilot] POST /tasks error:", err);
    res.status(500).json({ error: "Error al crear tarea" });
  }
});

// ── PATCH /api/autopilot/tasks/:id ──────────────────────────────────────────
autopilotRouter.patch("/tasks/:id", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId  = req.orgId!;
  const taskId = Number(req.params["id"]);

  if (!taskId) { res.status(400).json({ error: "ID inválido" }); return; }

  const existing = await db
    .select()
    .from(autopilotTasksTable)
    .where(and(eq(autopilotTasksTable.id, taskId), eq(autopilotTasksTable.orgId, orgId)))
    .limit(1);

  if (existing.length === 0) { res.status(404).json({ error: "Tarea no encontrada" }); return; }

  const { name, enabled, triggerType, triggerConfig, actionType, actionConfig } =
    req.body as Partial<{
      name: string;
      enabled: boolean;
      triggerType: string;
      triggerConfig: Record<string, unknown>;
      actionType: string;
      actionConfig: Record<string, unknown>;
    }>;

  try {
    const updates: Partial<typeof autopilotTasksTable.$inferInsert> = { updatedAt: new Date() };
    if (name         !== undefined) updates.name          = name.trim();
    if (enabled      !== undefined) updates.enabled       = enabled;
    if (triggerType  !== undefined) updates.triggerType   = triggerType;
    if (triggerConfig !== undefined) updates.triggerConfig = triggerConfig;
    if (actionType   !== undefined) updates.actionType    = actionType;
    if (actionConfig !== undefined) updates.actionConfig  = actionConfig;
    // Reactivación manual (incluye la de Client Autopilot tras "reply") — al
    // reactivar siempre se limpia el motivo de pausa.
    if (enabled === true) updates.pausedReason = null;

    const [updated] = await db
      .update(autopilotTasksTable)
      .set(updates)
      .where(and(eq(autopilotTasksTable.id, taskId), eq(autopilotTasksTable.orgId, orgId)))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("[autopilot] PATCH /tasks/:id error:", err);
    res.status(500).json({ error: "Error al actualizar tarea" });
  }
});

// ── DELETE /api/autopilot/tasks/:id ─────────────────────────────────────────
autopilotRouter.delete("/tasks/:id", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId  = req.orgId!;
  const taskId = Number(req.params["id"]);

  if (!taskId) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const deleted = await db
      .delete(autopilotTasksTable)
      .where(and(eq(autopilotTasksTable.id, taskId), eq(autopilotTasksTable.orgId, orgId)))
      .returning();

    if (deleted.length === 0) { res.status(404).json({ error: "Tarea no encontrada" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[autopilot] DELETE /tasks/:id error:", err);
    res.status(500).json({ error: "Error al eliminar tarea" });
  }
});

// ── GET /api/autopilot/tasks/:id/runs ───────────────────────────────────────
autopilotRouter.get("/tasks/:id/runs", requirePermission("automations.read"), async (req: AuthReq, res: Response) => {
  const orgId  = req.orgId!;
  const taskId = Number(req.params["id"]);

  if (!taskId) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const runs = await db
      .select()
      .from(autopilotRunsTable)
      .where(and(eq(autopilotRunsTable.taskId, taskId), eq(autopilotRunsTable.orgId, orgId)))
      .orderBy(desc(autopilotRunsTable.startedAt))
      .limit(20);
    res.json(runs);
  } catch (err) {
    console.error("[autopilot] GET /tasks/:id/runs error:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Client Autopilot — seguimiento comercial por cliente (triggerType
// "client_followup_sequence"). Endpoints propios, bajo el mismo router y el
// mismo requireModule("automations") que el resto de Autopilot — ver
// routes/index.ts. No se registran en openapi.yaml, siguiendo el mismo
// precedente raw-fetch que ya usa el resto de este router.
// ═══════════════════════════════════════════════════════════════════════════

async function findClientFollowupTask(orgId: number, clientId: number) {
  const [task] = await db
    .select()
    .from(autopilotTasksTable)
    .where(and(
      eq(autopilotTasksTable.orgId, orgId),
      eq(autopilotTasksTable.clientId, clientId),
      eq(autopilotTasksTable.triggerType, CLIENT_FOLLOWUP_TRIGGER_TYPE),
    ));
  return task ?? null;
}

// ── POST /api/autopilot/clients/:clientId/enable ────────────────────────────
autopilotRouter.post("/clients/:clientId/enable", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const clientId = Number(req.params["clientId"]);
  if (!clientId) { res.status(400).json({ error: "clientId inválido" }); return; }

  const { intervalsDays, mode, preferredChannel } = req.body as Partial<FollowupTriggerConfig>;
  if (intervalsDays !== undefined && (!Array.isArray(intervalsDays) || intervalsDays.some(d => typeof d !== "number" || d <= 0))) {
    res.status(400).json({ error: "intervalsDays debe ser un array de números positivos" });
    return;
  }
  if (mode !== undefined && mode !== "approval" && mode !== "autopilot") {
    res.status(400).json({ error: 'mode debe ser "approval" o "autopilot"' });
    return;
  }

  try {
    const [client] = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    const triggerConfig: FollowupTriggerConfig = {
      intervalsDays: intervalsDays ?? [3, 4, 7],
      mode: mode ?? "approval",
      ...(preferredChannel ? { preferredChannel } : {}),
    };

    const existing = await findClientFollowupTask(orgId, clientId);
    let task;
    if (existing) {
      [task] = await db.update(autopilotTasksTable)
        .set({ enabled: true, pausedReason: null, triggerConfig, nextRunAt: null, updatedAt: new Date() })
        .where(eq(autopilotTasksTable.id, existing.id))
        .returning();
    } else {
      [task] = await db.insert(autopilotTasksTable)
        .values({
          orgId,
          clientId,
          name: `Seguimiento — ${client.name}`,
          enabled: true,
          triggerType: CLIENT_FOLLOWUP_TRIGGER_TYPE,
          triggerConfig,
          actionType: CLIENT_FOLLOWUP_ACTION_TYPE,
          actionConfig: {},
          currentStep: 0,
        })
        .returning();
    }

    logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: existing ? "autopilot_reactivated" : "autopilot_enabled",
      resource: "autopilot_task",
      resourceId: task!.id,
      orgId,
      details: { clientId, triggerConfig },
      req,
    });

    res.status(existing ? 200 : 201).json(task);
  } catch (err) {
    console.error("[autopilot] POST /clients/:clientId/enable error:", err);
    res.status(500).json({ error: "Error al activar Autopilot" });
  }
});

// ── POST /api/autopilot/clients/:clientId/disable ───────────────────────────
autopilotRouter.post("/clients/:clientId/disable", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const clientId = Number(req.params["clientId"]);
  if (!clientId) { res.status(400).json({ error: "clientId inválido" }); return; }

  try {
    const task = await findClientFollowupTask(orgId, clientId);
    if (!task) { res.status(404).json({ error: "Este cliente no tiene Autopilot configurado" }); return; }

    const [updated] = await db.update(autopilotTasksTable)
      .set({ enabled: false, pausedReason: "manual", updatedAt: new Date() })
      .where(eq(autopilotTasksTable.id, task.id))
      .returning();

    logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "autopilot_disabled_manual",
      resource: "autopilot_task",
      resourceId: task.id,
      orgId,
      details: { clientId },
      req,
    });

    res.json(updated);
  } catch (err) {
    console.error("[autopilot] POST /clients/:clientId/disable error:", err);
    res.status(500).json({ error: "Error al pausar Autopilot" });
  }
});

// ── GET /api/autopilot/clients/:clientId — estado + borrador pendiente ──────
autopilotRouter.get("/clients/:clientId", requirePermission("automations.read"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const clientId = Number(req.params["clientId"]);
  if (!clientId) { res.status(400).json({ error: "clientId inválido" }); return; }

  try {
    const task = await findClientFollowupTask(orgId, clientId);
    let pendingMessage = null;
    if (task) {
      [pendingMessage] = await db
        .select()
        .from(messagesTable)
        .where(and(eq(messagesTable.autopilotTaskId, task.id), eq(messagesTable.status, "pending_approval")))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);
      pendingMessage = pendingMessage ?? null;
    }
    res.json({ task, pendingMessage });
  } catch (err) {
    console.error("[autopilot] GET /clients/:clientId error:", err);
    res.status(500).json({ error: "Error al obtener estado de Autopilot" });
  }
});

// ── Acciones sobre un mensaje "pending_approval" ─────────────────────────────
async function loadPendingMessage(orgId: number, messageId: number) {
  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.orgId, orgId), eq(messagesTable.status, "pending_approval")));
  return message ?? null;
}

// ── POST /api/autopilot/messages/:id/approve — aprueba y envía ──────────────
autopilotRouter.post("/messages/:id/approve", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const messageId = Number(req.params["id"]);
  if (!messageId) { res.status(400).json({ error: "id inválido" }); return; }

  try {
    const message = await loadPendingMessage(orgId, messageId);
    if (!message) { res.status(404).json({ error: "Mensaje pendiente no encontrado" }); return; }
    if (!message.clientId) { res.status(400).json({ error: "Mensaje sin cliente asociado" }); return; }

    const [client] = await db.select().from(clientsTable).where(and(eq(clientsTable.id, message.clientId), eq(clientsTable.orgId, orgId)));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    // Permite editar el texto justo antes de aprobar (botón "Editar" en la UI) —
    // si se manda `content`, se persiste como el contenido final del mensaje.
    const { content: editedContent } = req.body as { content?: string };
    const finalContent = typeof editedContent === "string" && editedContent.trim() ? editedContent.trim() : message.content;
    if (finalContent !== message.content) {
      await db.update(messagesTable).set({ content: finalContent }).where(eq(messagesTable.id, messageId));
    }

    const channel = message.channel ?? "whatsapp";
    const to = channel === "email" ? (client.companyEmail ?? client.email) : (client.phone ?? client.companyPhone ?? "");
    if (!to) { res.status(400).json({ error: `Sin destino de contacto para el canal "${channel}"` }); return; }

    const results = await NotificationService.send({
      orgId, channels: [channel as NotifChannel], to, message: finalContent,
      context: { subject: `Seguimiento — ${client.name}` },
    });
    const success  = results.some(r => r.success);
    const now = new Date();

    const [updatedMessage] = await db.update(messagesTable)
      .set({ status: success ? "sent" : "failed" })
      .where(eq(messagesTable.id, messageId))
      .returning();

    let updatedTask = null;
    if (message.autopilotTaskId && message.autopilotStep && success) {
      const step = message.autopilotStep;
      const [task] = await db.select().from(autopilotTasksTable).where(eq(autopilotTasksTable.id, message.autopilotTaskId));
      if (task) {
        const cfg = (task.triggerConfig ?? {}) as Partial<FollowupTriggerConfig>;
        const intervals = cfg.intervalsDays ?? [3, 4, 7];
        const isLastStep = step >= intervals.length;
        [updatedTask] = await db.update(autopilotTasksTable)
          .set({
            currentStep: step,
            ...(isLastStep ? { enabled: false, pausedReason: null } : {}),
            updatedAt: now,
          })
          .where(eq(autopilotTasksTable.id, task.id))
          .returning();

        const followupColumn: Partial<Record<"followup1At" | "followup2At" | "followup3At", Date>> = {};
        if (step === 1) followupColumn.followup1At = now;
        else if (step === 2) followupColumn.followup2At = now;
        else if (step === 3) followupColumn.followup3At = now;

        await db.update(clientsTable)
          .set({
            ...followupColumn,
            lastContactAt: now,
            nextFollowupAt: isLastStep ? null : calcNextRunAt({ ...task, currentStep: step }),
          })
          .where(eq(clientsTable.id, client.id));
      }
    }

    logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "autopilot_message_approved",
      resource: "message",
      resourceId: messageId,
      orgId,
      details: { clientId: client.id, channel, success },
      req,
    });

    res.json({ message: updatedMessage, task: updatedTask });
  } catch (err) {
    console.error("[autopilot] POST /messages/:id/approve error:", err);
    res.status(500).json({ error: "Error al aprobar mensaje" });
  }
});

// ── POST /api/autopilot/messages/:id/reject ──────────────────────────────────
autopilotRouter.post("/messages/:id/reject", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const messageId = Number(req.params["id"]);
  if (!messageId) { res.status(400).json({ error: "id inválido" }); return; }

  try {
    const message = await loadPendingMessage(orgId, messageId);
    if (!message) { res.status(404).json({ error: "Mensaje pendiente no encontrado" }); return; }

    // Rechazar NO avanza currentStep — la tarea sigue activa en el mismo paso,
    // sin reintento automático (decisión de producto: el humano decide qué
    // hacer a continuación, manualmente).
    const [updated] = await db.update(messagesTable)
      .set({ status: "rejected" })
      .where(eq(messagesTable.id, messageId))
      .returning();

    logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "autopilot_message_rejected",
      resource: "message",
      resourceId: messageId,
      orgId,
      details: { clientId: message.clientId },
      req,
    });

    res.json(updated);
  } catch (err) {
    console.error("[autopilot] POST /messages/:id/reject error:", err);
    res.status(500).json({ error: "Error al rechazar mensaje" });
  }
});

// ── POST /api/autopilot/messages/:id/regenerate ──────────────────────────────
autopilotRouter.post("/messages/:id/regenerate", requirePermission("automations.write"), async (req: AuthReq, res: Response) => {
  const orgId    = req.orgId!;
  const messageId = Number(req.params["id"]);
  if (!messageId) { res.status(400).json({ error: "id inválido" }); return; }

  try {
    const message = await loadPendingMessage(orgId, messageId);
    if (!message) { res.status(404).json({ error: "Mensaje pendiente no encontrado" }); return; }
    if (!message.clientId || !message.autopilotTaskId || !message.autopilotStep) {
      res.status(400).json({ error: "Mensaje sin contexto de Autopilot suficiente para regenerar" });
      return;
    }

    const [client] = await db.select().from(clientsTable).where(and(eq(clientsTable.id, message.clientId), eq(clientsTable.orgId, orgId)));
    const [task]   = await db.select().from(autopilotTasksTable).where(eq(autopilotTasksTable.id, message.autopilotTaskId));
    if (!client || !task) { res.status(404).json({ error: "Cliente o tarea no encontrados" }); return; }

    const content = await generateFollowupMessage(client, task, message.autopilotStep);
    const [updated] = await db.update(messagesTable)
      .set({ content })
      .where(eq(messagesTable.id, messageId))
      .returning();

    logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "autopilot_message_regenerated",
      resource: "message",
      resourceId: messageId,
      orgId,
      details: { clientId: client.id, step: message.autopilotStep },
      req,
    });

    res.json(updated);
  } catch (err) {
    console.error("[autopilot] POST /messages/:id/regenerate error:", err);
    res.status(500).json({ error: "Error al regenerar mensaje" });
  }
});

// ── GET /api/autopilot/summary — widget del Dashboard ────────────────────────
autopilotRouter.get("/summary", requirePermission("automations.read"), async (req: AuthReq, res: Response) => {
  const orgId = req.orgId!;
  try {
    const clientTasks = await db
      .select({
        id: autopilotTasksTable.id,
        clientId: autopilotTasksTable.clientId,
        enabled: autopilotTasksTable.enabled,
        pausedReason: autopilotTasksTable.pausedReason,
        currentStep: autopilotTasksTable.currentStep,
        nextRunAt: autopilotTasksTable.nextRunAt,
        clientName: clientsTable.name,
      })
      .from(autopilotTasksTable)
      .leftJoin(clientsTable, eq(clientsTable.id, autopilotTasksTable.clientId))
      .where(and(eq(autopilotTasksTable.orgId, orgId), eq(autopilotTasksTable.triggerType, CLIENT_FOLLOWUP_TRIGGER_TYPE)));

    const active        = clientTasks.filter(t => t.enabled && !t.pausedReason).length;
    const pausedReply    = clientTasks.filter(t => t.pausedReason === "reply").length;
    const pausedManual   = clientTasks.filter(t => !t.enabled && t.pausedReason === "manual").length;

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const todayActions = clientTasks
      .filter(t => t.enabled && !t.pausedReason && t.nextRunAt && t.nextRunAt >= todayStart && t.nextRunAt <= todayEnd)
      .map(t => ({ clientId: t.clientId, clientName: t.clientName, step: t.currentStep + 1, nextRunAt: t.nextRunAt }))
      .sort((a, b) => (a.nextRunAt?.getTime() ?? 0) - (b.nextRunAt?.getTime() ?? 0));

    // "Respuestas recibidas hoy" — cualquier inbound del día (no solo de
    // clientes con Autopilot activo, pero es la señal más simple y honesta).
    const repliesReceived = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.orgId, orgId),
        eq(messagesTable.direction, "inbound"),
        gte(messagesTable.createdAt, todayStart),
        lte(messagesTable.createdAt, todayEnd),
      ));

    // "Mensajes enviados hoy" — solo los que salieron del propio Client
    // Autopilot (isAi + autopilotTaskId set), no cualquier mensaje IA del CRM.
    const messagesSentToday = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.orgId, orgId),
        eq(messagesTable.status, "sent"),
        eq(messagesTable.isAi, true),
        isNotNull(messagesTable.autopilotTaskId),
        gte(messagesTable.createdAt, todayStart),
        lte(messagesTable.createdAt, todayEnd),
      ));

    res.json({
      autopilotsActivos: active,
      seguimientosParaHoy: todayActions.length,
      respuestasRecibidas: repliesReceived.length,
      mensajesEnviados: messagesSentToday.length,
      autopilotsPausados: pausedReply + pausedManual,
      oportunidadesActivas: active,
      accionesDeHoy: todayActions,
    });
  } catch (err) {
    console.error("[autopilot] GET /summary error:", err);
    res.status(500).json({ error: "Error al obtener resumen de Autopilot" });
  }
});
