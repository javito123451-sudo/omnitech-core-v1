import { Router } from "express";
import { db, supportTicketsTable, ticketCommentsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";

export const supportRouter = Router();

const VALID_STATUSES = ["open", "in_progress", "resolved", "closed"];
const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
const VALID_CATEGORIES = ["general", "billing", "technical", "feature_request", "bug", "onboarding"];

// ── GET /api/support/tickets ── listar incidencias del workspace ────────────

supportRouter.get("/tickets", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { status } = req.query as { status?: string };

    let query = db.select({
      id: supportTicketsTable.id,
      title: supportTicketsTable.title,
      description: supportTicketsTable.description,
      category: supportTicketsTable.category,
      priority: supportTicketsTable.priority,
      status: supportTicketsTable.status,
      resolution: supportTicketsTable.resolution,
      creatorUserId: supportTicketsTable.creatorUserId,
      creatorEmail: supportTicketsTable.creatorEmail,
      assignedToUserId: supportTicketsTable.assignedToUserId,
      createdAt: supportTicketsTable.createdAt,
      updatedAt: supportTicketsTable.updatedAt,
      resolvedAt: supportTicketsTable.resolvedAt,
      creatorName: usersTable.name,
    })
      .from(supportTicketsTable)
      .leftJoin(usersTable, eq(supportTicketsTable.creatorUserId, usersTable.id))
      .where(eq(supportTicketsTable.orgId, orgId))
      .orderBy(desc(supportTicketsTable.updatedAt));

    const rows = await query;

    // Filter by status if provided
    const filtered = status ? rows.filter(r => r.status === status) : rows;

    res.json(filtered.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/support/tickets/:id ── detalle de incidencia ───────────────

supportRouter.get("/tickets/:id", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const ticketId = parseInt(req.params.id);

    const [ticket] = await db.select().from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.id, ticketId), eq(supportTicketsTable.orgId, orgId)));
    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }

    const comments = await db.select({
      id: ticketCommentsTable.id,
      userId: ticketCommentsTable.userId,
      authorName: ticketCommentsTable.authorName,
      isInternal: ticketCommentsTable.isInternal,
      body: ticketCommentsTable.body,
      createdAt: ticketCommentsTable.createdAt,
    })
      .from(ticketCommentsTable)
      .where(eq(ticketCommentsTable.ticketId, ticketId))
      .orderBy(ticketCommentsTable.createdAt);

    res.json({
      ...ticket,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      comments: comments.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/support/tickets ── crear incidencia ────────────────────────

supportRouter.post("/tickets", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { title, description, category = "general", priority = "medium" } = req.body as {
      title: string; description: string; category?: string; priority?: string;
    };

    if (!title?.trim()) { res.status(400).json({ error: "Título requerido" }); return; }
    if (!description?.trim()) { res.status(400).json({ error: "Descripción requerida" }); return; }
    if (!VALID_CATEGORIES.includes(category)) { res.status(400).json({ error: "Categoría inválida" }); return; }
    if (!VALID_PRIORITIES.includes(priority)) { res.status(400).json({ error: "Prioridad inválida" }); return; }

    const [ticket] = await db.insert(supportTicketsTable).values({
      orgId,
      creatorUserId: userId,
      title: title.trim(),
      description: description.trim(),
      category,
      priority,
      status: "open",
    }).returning();

    logAudit({
      actorClerkId: req.clerkUserId!,
      action: "support_ticket_created",
      resource: "support_ticket",
      resourceId: String(ticket.id),
      orgId,
      details: { title, category, priority },
      severity: "info",
      result: "success",
      req,
    });

    res.status(201).json({
      ...ticket,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/support/tickets/:id ── actualizar estado/assignment ──────────

supportRouter.patch("/tickets/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const ticketId = parseInt(req.params.id);
    const { status, assignedToUserId, resolution } = req.body as {
      status?: string; assignedToUserId?: number | null; resolution?: string;
    };

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) { res.status(400).json({ error: "Estado inválido" }); return; }
      updateData.status = status;
      if (status === "resolved" || status === "closed") {
        updateData.resolvedAt = new Date();
      }
    }
    if (assignedToUserId !== undefined) updateData.assignedToUserId = assignedToUserId;
    if (resolution !== undefined) updateData.resolution = resolution;

    const [ticket] = await db.update(supportTicketsTable).set(updateData)
      .where(and(eq(supportTicketsTable.id, ticketId), eq(supportTicketsTable.orgId, orgId)))
      .returning();

    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }

    logAudit({
      actorClerkId: req.clerkUserId!,
      action: "support_ticket_updated",
      resource: "support_ticket",
      resourceId: String(ticket.id),
      orgId,
      details: { status, assignedToUserId, resolution },
      severity: "info",
      result: "success",
      req,
    });

    res.json({
      ...ticket,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/support/tickets/:id/comments ── añadir comentario ──────────

supportRouter.post("/tickets/:id/comments", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const ticketId = parseInt(req.params.id);
    const { body, isInternal = false } = req.body as { body: string; isInternal?: boolean };

    if (!body?.trim()) { res.status(400).json({ error: "Comentario requerido" }); return; }

    const [ticket] = await db.select().from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.id, ticketId), eq(supportTicketsTable.orgId, orgId)));
    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }

    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

    const [comment] = await db.insert(ticketCommentsTable).values({
      ticketId,
      userId,
      authorName: user?.name ?? null,
      isInternal,
      body: body.trim(),
    }).returning();

    res.status(201).json({
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
