import { Router } from "express";
import { db, clientsTable, appointmentsTable, activityTable } from "@workspace/db";
import { eq, gte, sql, desc } from "drizzle-orm";

export const statsRouter = Router();

statsRouter.get("/dashboard", async (req, res) => {
  try {
    const allClients = await db.select().from(clientsTable);
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

    const allAppts = await db.select().from(appointmentsTable);
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
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonth = new Date().getMonth();
  const data = months.slice(0, currentMonth + 1).map((month, i) => ({
    month,
    revenue: Math.round(8000 + Math.random() * 12000 + i * 800),
    target: Math.round(12000 + i * 500),
  }));
  res.json(data);
});

statsRouter.get("/clients", async (req, res) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonth = new Date().getMonth();
  const data = months.slice(0, currentMonth + 1).map((month, i) => ({
    month,
    leads: Math.round(10 + Math.random() * 20 + i),
    converted: Math.round(4 + Math.random() * 10 + i * 0.5),
  }));
  res.json(data);
});

statsRouter.get("/activity", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(activityTable)
      .orderBy(desc(activityTable.createdAt))
      .limit(20);

    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
