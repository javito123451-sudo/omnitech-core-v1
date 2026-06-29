import { Router } from "express";
import { db, clientsTable, quotesTable, appointmentsTable, organizationsTable, orgMembersTable, usersTable, supportTicketsTable, pipelineStagesTable, dealsTable } from "@workspace/db";
import { eq, and, desc, count, sql, gte } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";

export const dashboardRouter = Router();

// ── GET /api/dashboard/role ── KPIs filtrados según el rol efectivo ────────────────

dashboardRouter.get("/role", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const role = req.effectiveRole ?? req.orgRole ?? "member";
    const userId = req.userId!;

    // ── Base counts (all roles need some of these) ─────────────────────
    const totalClientsQ = db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, orgId));
    const activeClientsQ = db.select({ count: count() }).from(clientsTable).where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, "active")));
    const leadsCountQ = db.select({ count: count() }).from(clientsTable).where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, "lead")));
    const todayAppointmentsQ = db.select({ count: count() }).from(appointmentsTable).where(
      and(eq(appointmentsTable.orgId, orgId), gte(appointmentsTable.date, new Date().toISOString().slice(0, 10)))
    );

    const [
      totalClientsR,
      activeClientsR,
      leadsCountR,
      todayAppointmentsR,
    ] = await Promise.all([
      totalClientsQ,
      activeClientsQ,
      leadsCountQ,
      todayAppointmentsQ,
    ]);

    const totalClients = Number(totalClientsR[0]?.count ?? 0);
    const activeClients = Number(activeClientsR[0]?.count ?? 0);
    const leadsCount = Number(leadsCountR[0]?.count ?? 0);
    const todayAppointments = Number(todayAppointmentsR[0]?.count ?? 0);

    // ── Quotes / Pipeline value ─────────────────────────────────────────
    const quotesRows = await db.select({ total: quotesTable.total, status: quotesTable.status })
      .from(quotesTable).where(eq(quotesTable.orgId, orgId));

    const pipelineValue = quotesRows.filter(q => q.status === "draft" || q.status === "sent").reduce((s, q) => s + (q.total ?? 0), 0);
    const confirmedValue = quotesRows.filter(q => q.status === "accepted").reduce((s, q) => s + (q.total ?? 0), 0);

    // ── Commission (10% on accepted quotes) ──────────────────────────
    const myQuotes = await db.select({ total: quotesTable.total })
      .from(quotesTable)
      .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
      .where(and(
        eq(quotesTable.orgId, orgId),
        eq(quotesTable.status, "accepted"),
        eq(clientsTable.assignedSellerId, userId),
      ));
    const myCommission = myQuotes.reduce((s, q) => s + (q.total ?? 0) * 0.10, 0);

    // ── Conversion rate ───────────────────────────────────────────
    const conversionRate = totalClients > 0 ? Math.round((activeClients / totalClients) * 100) : 0;

    // ── Pipeline stages summary ─────────────────────────────────
    const stages = await db.select().from(pipelineStagesTable).where(eq(pipelineStagesTable.orgId, orgId)).orderBy(pipelineStagesTable.orderIndex);
    const deals = await db.select().from(dealsTable).where(eq(dealsTable.orgId, orgId));
    const pipelineSummary = stages.map(s => ({
      stageId: s.id,
      name: s.name,
      color: s.color,
      count: deals.filter(d => d.stageId === s.id).length,
      value: deals.filter(d => d.stageId === s.id).reduce((sum, d) => sum + (d.value ?? 0), 0),
    }));

    // ── Support tickets count ─────────────────────────────────
    const openTicketsR = await db.select({ count: count() }).from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.orgId, orgId), eq(supportTicketsTable.status, "open")));
    const openTickets = Number(openTicketsR[0]?.count ?? 0);

    // ── Build role-specific response ────────────────────────────
    const base = {
      role,
      orgId,
      totalClients,
      activeClients,
      leadsCount,
      todayAppointments,
      pipelineValue,
      confirmedValue,
      conversionRate,
      openTickets,
      pipelineSummary,
    };

    if (role === "owner" || role === "admin") {
      const memberCountR = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, orgId));
      const memberCount = Number(memberCountR[0]?.count ?? 0);

      const totalCommission = quotesRows.filter(q => q.status === "accepted").reduce((s, q) => s + (q.total ?? 0) * 0.10, 0);

      res.json({
        ...base,
        memberCount,
        totalCommission,
        isAdmin: true,
      });
      return;
    }

    if (role === "vendedor") {
      const myLeadsCountR = await db.select({ count: count() }).from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, "lead"), eq(clientsTable.assignedSellerId, userId)));
      const myCustomersCountR = await db.select({ count: count() }).from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.status, "active"), eq(clientsTable.assignedSellerId, userId)));

      const myPipeline = pipelineSummary.map(s => ({
        ...s,
        count: deals.filter(d => d.stageId === s.id && d.assignedToUserId === userId).length,
        value: deals.filter(d => d.stageId === s.id && d.assignedToUserId === userId).reduce((sum, d) => sum + (d.value ?? 0), 0),
      }));

      res.json({
        ...base,
        myLeads: Number(myLeadsCountR[0]?.count ?? 0),
        myCustomers: Number(myCustomersCountR[0]?.count ?? 0),
        myCommission,
        myPipeline,
        isSeller: true,
      });
      return;
    }

    // Default (member / read_only / cliente)
    res.json(base);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
