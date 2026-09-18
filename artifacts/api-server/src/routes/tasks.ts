// ═══════════════════════════════════════════════════════════════════════════
//  Tasks — minimal REST wrapper
//
//  Tasks has had a working skill (create_task/list_tasks in skills/taskSkills.ts)
//  since the Fase 0.5 audit, but no REST surface — Ava CORE needs one so its
//  CRM tool catalog and the confirmed create_task action have a stable place
//  to call into beyond the Skill Engine's in-process API, and so the
//  dashboard can eventually list tasks like it lists clients/quotes. This is
//  deliberately thin: it wraps the existing skills, it doesn't reimplement
//  their logic.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { executeSkill } from "../skills";
import { requirePermission } from "../middlewares/permissions";

export const tasksRouter = Router();

tasksRouter.get("/", requirePermission("crm.read"), async (req, res) => {
  const { status, priority, limit } = req.query as Record<string, string | undefined>;
  const result = await executeSkill("list_tasks", {
    status: status ?? "all",
    priority: priority ?? "all",
    limit: limit ? Number(limit) : 20,
  }, req.orgId!, { channel: "internal", user: { id: req.clerkUserId!, name: req.clerkUserId! } });

  if (!result.success) { res.status(400).json({ error: result.error }); return; }
  res.json(JSON.parse(result.result));
});

tasksRouter.post("/", requirePermission("crm.write"), async (req, res) => {
  const { title, description, priority, due_date, client_name, assigned_to } = req.body as Record<string, unknown>;
  const result = await executeSkill("create_task", {
    title, description, priority, due_date, client_name, assigned_to,
  }, req.orgId!, { channel: "internal", user: { id: req.clerkUserId!, name: req.clerkUserId! } });

  if (!result.success) { res.status(400).json({ error: result.error }); return; }
  res.status(201).json(JSON.parse(result.result));
});
