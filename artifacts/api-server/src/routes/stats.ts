import { Router } from "express";
import { db, clientsTable, appointmentsTable, activityTable } from "@workspace/db";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

export const statsRouter = Router();

statsRouter.get("/dashboard", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const allClients = await db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId));
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
      .select()
      .from(appointmentsTable)
      .where(eq(appointmentsTable.orgId, orgId));
    const appointmentsToday = allAppts.filter(
      (a) => a.startTime >= today && a.startTime < tomorrow
    ).length;

    res.json({
      totalClients,
      activeClients,
      totalRevenue,
      appointmentsToday,
      leadsThisMonth,
      conversionRate,
      revenueGrowth: 12.5,
      clientGrowth: 8.3,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

statsRouter.get("/revenue", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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

      const target = 12000 + i * 500;
      return { month, revenue: monthRevenue, target };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

statsRouter.get("/clients", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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

statsRouter.get("/activity", async (req, res) => {
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
