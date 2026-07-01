import { Router } from "express";
import { db, organizationsTable, usersTable, orgMembersTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";

export const marketingRouter = Router();

// ── GET /api/marketing/summary ──────────────────────────────────────────────
// Dashboard summary for Marketing Hub
marketingRouter.get("/summary", requirePermission("workspace.manage"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));

    // Count users as proxy "contacts"
    const memberCount = await db.select({ count: count() }).from(orgMembersTable)
      .where(eq(orgMembersTable.orgId, orgId));

    res.json({
      ok: true,
      orgId,
      orgName: org?.name ?? null,
      contacts: Number(memberCount[0]?.count ?? 0),
      campaigns: { active: 1, draft: 2, total: 3 },
      messages: { sent: 4440, opened: 2326, clicked: 922 },
      recentActivity: [
        { type: "campaign_sent", name: "Bienvenida nuevos leads", date: "2026-06-15T10:00:00Z" },
        { type: "campaign_created", name: "Promoción verano 2026", date: "2026-06-28T14:30:00Z" },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/campaigns ────────────────────────────────────────────
marketingRouter.get("/campaigns", requirePermission("workspace.manage"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    // Placeholder campaigns — will be replaced with real DB queries when campaigns table exists
    res.json({
      ok: true,
      orgId,
      campaigns: [
        { id: 1, name: "Bienvenida nuevos leads", status: "active", channel: "Email", sent: 1240, opened: 876, clicked: 342, createdAt: "2026-06-15" },
        { id: 2, name: "Promoción verano 2026", status: "draft", channel: "Email + WhatsApp", sent: 0, opened: 0, clicked: 0, createdAt: "2026-06-28" },
        { id: 3, name: "Reactivación clientes", status: "paused", channel: "Email", sent: 3200, opened: 1450, clicked: 580, createdAt: "2026-05-10" },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/audience ─────────────────────────────────────────────
marketingRouter.get("/audience", requirePermission("workspace.manage"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const members = await db.select({
      userId: orgMembersTable.userId,
      role: orgMembersTable.role,
      joinedAt: orgMembersTable.joinedAt,
    }).from(orgMembersTable).where(eq(orgMembersTable.orgId, orgId));

    const enriched = await Promise.all(members.map(async m => {
      const [u] = await db.select({ name: usersTable.name, email: usersTable.email, status: usersTable.status })
        .from(usersTable).where(eq(usersTable.id, m.userId));
      return { id: m.userId, name: u?.name ?? null, email: u?.email ?? null, role: m.role, status: u?.status ?? "active", joinedAt: m.joinedAt };
    }));

    res.json({
      ok: true,
      orgId,
      contacts: enriched,
      segments: [
        { id: 1, name: "Todos los contactos", count: enriched.length, filter: "all" },
        { id: 2, name: "Clientes activos", count: enriched.filter(c => c.status === "active").length, filter: "active" },
        { id: 3, name: "Administradores", count: enriched.filter(c => ["owner", "admin"].includes(c.role)).length, filter: "admin" },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/analytics ────────────────────────────────────────────
marketingRouter.get("/analytics", requirePermission("workspace.manage"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    res.json({
      ok: true,
      orgId,
      overview: {
        totalSent: 4440,
        totalOpened: 2326,
        totalClicked: 922,
        openRate: 52.4,
        clickRate: 20.8,
        conversionRate: 2.8,
        roi: 3.2,
      },
      byChannel: {
        email:   { sent: 4440, opened: 2326, clicked: 922, openRate: 52.4, clickRate: 20.8 },
        whatsapp: { sent: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
      },
      monthly: [
        { month: "2026-03", sent: 1200, opened: 580, clicked: 180 },
        { month: "2026-04", sent: 1500, opened: 720, clicked: 240 },
        { month: "2026-05", sent: 3200, opened: 1450, clicked: 580 },
        { month: "2026-06", sent: 4440, opened: 2326, clicked: 922 },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
