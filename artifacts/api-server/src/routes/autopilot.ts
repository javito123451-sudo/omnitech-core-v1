import { Router } from "express";
import { db, autopilotTasksTable, autopilotRunsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { Request, Response } from "express";

type AuthReq = Request & { orgId?: number; userId?: number };

export const autopilotRouter = Router();

import { requirePermission } from "../middlewares/permissions";

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
