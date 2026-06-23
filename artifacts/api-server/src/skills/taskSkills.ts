// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Task Skills
// ═══════════════════════════════════════════════════════════════════════════

import { db, tasksTable, clientsTable, activityTable } from "@workspace/db";
import { eq, and, desc, ilike } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

async function createTask(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const title       = String(params["title"]       ?? "");
  const description = params["description"] ? String(params["description"]) : null;
  const priority    = String(params["priority"]    ?? "medium");
  const dueDateStr  = params["due_date"]  ? String(params["due_date"])  : null;
  const clientName  = params["client_name"] ? String(params["client_name"]) : null;
  const assignedTo  = params["assigned_to"] ? String(params["assigned_to"]) : null;

  if (!title) {
    return JSON.stringify({ error: "Se requiere el título de la tarea." });
  }

  // Resolve client if provided
  let clientId: number | null = null;
  let clientNameResolved: string | null = null;
  if (clientName) {
    const matched = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
      .limit(1);
    if (matched.length > 0) {
      clientId = matched[0]!.id;
      clientNameResolved = matched[0]!.name;
    }
  }

  const [task] = await db.insert(tasksTable).values({
    orgId,
    title,
    description,
    status:     "pending",
    priority:   priority as any,
    dueDate:    dueDateStr ? new Date(dueDateStr) : null,
    clientId:   clientId,
    assignedTo,
  }).returning();

  if (!task) {
    return JSON.stringify({ error: "Error al crear la tarea en la base de datos." });
  }

  await db.insert(activityTable).values({
    orgId,
    type:        "task_created",
    description: `Tarea "${title}" creada${clientNameResolved ? ` para ${clientNameResolved}` : ""}`,
    clientName:  clientNameResolved,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:    true,
    dbVerified: true,
    taskId:     task.id,
    title,
    status:     "pending",
    priority,
    dueDate:    dueDateStr ?? null,
    clientName: clientNameResolved,
    assignedTo,
    message:    `Tarea #${task.id} "${title}" creada correctamente.`,
  });
}

async function getTasks(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const status   = String(params["status"]   ?? "all");
  const priority = String(params["priority"] ?? "all");
  const limit    = Math.min(Number(params["limit"] ?? 20), 50);

  const conditions = [eq(tasksTable.orgId, orgId)];
  if (status !== "all") {
    conditions.push(eq(tasksTable.status, status));
  }
  if (priority !== "all") {
    conditions.push(eq(tasksTable.priority, priority));
  }

  const rows = await db
    .select({
      id:         tasksTable.id,
      title:      tasksTable.title,
      status:     tasksTable.status,
      priority:   tasksTable.priority,
      dueDate:    tasksTable.dueDate,
      clientName: clientsTable.name,
    })
    .from(tasksTable)
    .leftJoin(clientsTable, eq(tasksTable.clientId, clientsTable.id))
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions as Parameters<typeof and>))
    .orderBy(desc(tasksTable.createdAt))
    .limit(limit);

  return JSON.stringify({
    total: rows.length,
    tasks: rows.map(r => ({
      id:         r.id,
      title:      r.title,
      status:     r.status,
      priority:   r.priority,
      dueDate:    r.dueDate?.toLocaleDateString("es-ES") ?? null,
      clientName: r.clientName ?? null,
    })),
  });
}

export const createTaskSkill: SkillDefinition = {
  id: "create_task",
  name: "Crear Tarea",
  description: "Crea una tarea en el CRM con título, prioridad, fecha límite y cliente asociado.",
  params: [
    { name: "title",       type: "string", description: "Título de la tarea", required: true },
    { name: "description", type: "string", description: "Descripción", required: false },
    { name: "priority",    type: "string", description: "low, medium, high", default: "medium" },
    { name: "due_date",    type: "date",   description: "Fecha límite (YYYY-MM-DD)", required: false },
    { name: "client_name", type: "string", description: "Nombre del cliente asociado", required: false },
    { name: "assigned_to", type: "string", description: "Usuario asignado", required: false },
  ],
  execute: createTask,
};

export const getTasksSkill: SkillDefinition = {
  id: "list_tasks",
  name: "Listar Tareas",
  description: "Lista tareas del CRM con filtros.",
  params: [
    { name: "status",   type: "string", description: "pending, in_progress, completed, all", default: "all" },
    { name: "priority", type: "string", description: "low, medium, high, all", default: "all" },
    { name: "limit",    type: "number", description: "Máximo de resultados", default: 20 },
  ],
  execute: getTasks,
};
