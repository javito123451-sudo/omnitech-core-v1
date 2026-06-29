import { Router } from "express";
import { db, clientsTable, appointmentsTable, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export const statsRouter = Router();

function calcGrowth(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

import { requirePermission } from "../middlewares/permissions";

statsRouter.get("/dashboard", requirePermission("analytics.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const now = new Date();
    const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const allClients = await db
      .select({ value: clientsTable.value, status: clientsTable.status, createdAt: clientsTable.createdAt })
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId));

    const totalClients = allClients.length;
    const activeClients = allClients.filter((c) => c.status === "active").length;
    const totalRevenue = allClients.reduce((sum, c) => sum + (c.value ?? 0), 0);
    const leadsThisMonth = allClients.filter((c) => c.status === "lead").length;
    const converted = allClients.filter((c) => c.status === "active").length;
    const conversionRate = totalClients > 0 ? Math.round((converted / totalClients) * 100) / 100 : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const allAppts = await db
      .select({ startTime: appointmentsTable.startTime })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.orgId, orgId));

    const appointmentsToday = allAppts.filter(
      (a) => a.startTime >= today && a.startTime < tomorrow
    ).length;

    const revenueThisMonth = allClients
      .filter((c) => new Date(c.createdAt) >= firstDayThisMonth)
      .reduce((sum, c) => sum + (c.value ?? 0), 0);

    const revenueLastMonth = allClients
      .filter((c) => {
        const d = new Date(c.createdAt);
        return d >= firstDayLastMonth && d <= lastDayLastMonth;
      })
      .reduce((sum, c) => sum + (c.value ?? 0), 0);

    const clientsThisMonth = allClients.filter(
      (c) => new Date(c.createdAt) >= firstDayThisMonth
    ).length;

    const clientsLastMonth = allClients.filter((c) => {
      const d = new Date(c.createdAt);
      return d >= firstDayLastMonth && d <= lastDayLastMonth;
    }).length;

    res.json({
      totalClients,
      activeClients,
      totalRevenue,
      appointmentsToday,
      leadsThisMonth,
      conversionRate,
      revenueGrowth: calcGrowth(revenueThisMonth, revenueLastMonth),
      clientGrowth: calcGrowth(clientsThisMonth, clientsLastMonth),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

statsRouter.get("/revenue", requirePermission("analytics.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const allClients = await db
      .select({ value: clientsTable.value, createdAt: clientsTable.createdAt })
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId));

    const data = months.slice(0, currentMonth + 1).map((month, i) => {
      const monthRevenue = allClients
        .filter((c) => {
          const d = new Date(c.createdAt);
          return d.getMonth() === i && d.getFullYear() === currentYear;
        })
        .reduce((sum, c) => sum + (c.value ?? 0), 0);

      return { month, revenue: monthRevenue };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

statsRouter.get("/clients", requirePermission("analytics.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const allClients = await db
      .select({ status: clientsTable.status, createdAt: clientsTable.createdAt })
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId));

    const data = months.slice(0, currentMonth + 1).map((month, i) => {
      const monthClients = allClients.filter((c) => {
        const d = new Date(c.createdAt);
        return d.getMonth() === i && d.getFullYear() === currentYear;
      });
      return {
        month,
        leads: monthClients.filter((c) => c.status === "lead").length,
        converted: monthClients.filter((c) => c.status === "active").length,
      };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

statsRouter.get("/activity", requirePermission("analytics.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db
      .select()
      .from(activityTable)
      .where(eq(activityTable.orgId, orgId))
      .orderBy(desc(activityTable.createdAt))
      .limit(20);

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
