import { Router } from "express";
import { db, pipelineStagesTable, dealsTable, clientsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";

export const pipelineRouter = Router();

// ── GET /api/pipeline/stages ── listar etapas del pipeline ────────────────────

pipelineRouter.get("/stages", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.select().from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.orgId, orgId))
      .orderBy(pipelineStagesTable.orderIndex);
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/pipeline/deals ── listar deals/oportunidades ────────────────────

pipelineRouter.get("/deals", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.select({
      id: dealsTable.id,
      clientId: dealsTable.clientId,
      stageId: dealsTable.stageId,
      value: dealsTable.value,
      currency: dealsTable.currency,
      assignedToUserId: dealsTable.assignedToUserId,
      expectedCloseDate: dealsTable.expectedCloseDate,
      status: dealsTable.status,
      notes: dealsTable.notes,
      createdAt: dealsTable.createdAt,
      updatedAt: dealsTable.updatedAt,
      clientName: clientsTable.name,
      clientCompany: clientsTable.company,
      assignedName: usersTable.name,
    })
      .from(dealsTable)
      .leftJoin(clientsTable, eq(dealsTable.clientId, clientsTable.id))
      .leftJoin(usersTable, eq(dealsTable.assignedToUserId, usersTable.id))
      .where(eq(dealsTable.orgId, orgId))
      .orderBy(desc(dealsTable.updatedAt));

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      expectedCloseDate: r.expectedCloseDate?.toISOString() ?? null,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/pipeline/deals ── crear deal ────────────────────────────

pipelineRouter.post("/deals", requirePermission("crm.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { clientId, stageId, value, currency = "EUR", expectedCloseDate, notes } = req.body as {
      clientId: number; stageId: number; value?: number; currency?: string; expectedCloseDate?: string; notes?: string;
    };

    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    const [stage] = await db.select().from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.id, stageId), eq(pipelineStagesTable.orgId, orgId)));
    if (!stage) { res.status(404).json({ error: "Etapa no encontrada" }); return; }

    const [deal] = await db.insert(dealsTable).values({
      orgId,
      clientId,
      stageId,
      value: value ?? 0,
      currency,
      assignedToUserId: client.assignedSellerId ?? req.userId ?? null,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes: notes ?? null,
    }).returning();

    res.status(201).json({ ...deal, createdAt: deal.createdAt.toISOString(), updatedAt: deal.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/pipeline/deals/:id/stage ── mover deal de etapa ─────────────

pipelineRouter.patch("/deals/:id/stage", requirePermission("crm.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const dealId = parseInt(req.params.id);
    const { stageId, status } = req.body as { stageId?: number; status?: string };

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (stageId !== undefined) updateData.stageId = stageId;
    if (status !== undefined) updateData.status = status;

    const [deal] = await db.update(dealsTable).set(updateData)
      .where(and(eq(dealsTable.id, dealId), eq(dealsTable.orgId, orgId)))
      .returning();

    if (!deal) { res.status(404).json({ error: "Deal no encontrado" }); return; }

    res.json({ ...deal, createdAt: deal.createdAt.toISOString(), updatedAt: deal.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/pipeline/stages ── crear etapa (admin) ─────────────────────

pipelineRouter.post("/stages", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { name, color, orderIndex, winProbability } = req.body as {
      name: string; color?: string; orderIndex?: number; winProbability?: number;
    };

    const [stage] = await db.insert(pipelineStagesTable).values({
      orgId,
      name,
      color: color ?? "#3b82f6",
      orderIndex: orderIndex ?? 0,
      winProbability: winProbability ?? 0,
    }).returning();

    res.status(201).json({ ...stage, createdAt: stage.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
