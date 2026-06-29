import crypto from "crypto";
import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, orgInvitationsTable, organizationsTable, usersTable, orgMembersTable } from "@workspace/db";
import { eq, and, isNull, count } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";

export const invitationsRouter = Router();

invitationsRouter.get("/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const [inv] = await db
      .select({ id: orgInvitationsTable.id, email: orgInvitationsTable.email, role: orgInvitationsTable.role, expiresAt: orgInvitationsTable.expiresAt, acceptedAt: orgInvitationsTable.acceptedAt, orgName: organizationsTable.name, orgSlug: organizationsTable.slug, inviterName: usersTable.name, inviterEmail: usersTable.email })
      .from(orgInvitationsTable)
      .innerJoin(organizationsTable, eq(orgInvitationsTable.orgId, organizationsTable.id))
      .innerJoin(usersTable, eq(orgInvitationsTable.invitedBy, usersTable.id))
      .where(eq(orgInvitationsTable.token, token));

    if (!inv) { res.status(404).json({ error: "Invitación no encontrada." }); return; }
    if (inv.acceptedAt) { res.status(410).json({ error: "Esta invitación ya fue aceptada." }); return; }
    if (inv.expiresAt < new Date()) { res.status(410).json({ error: "Esta invitación ha expirado." }); return; }

    res.json({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt.toISOString(), orgName: inv.orgName, orgSlug: inv.orgSlug, inviterName: inv.inviterName, inviterEmail: inv.inviterEmail });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── POST /api/invitations — create invitation by role type ───────────
// Types: admin, vendedor, cliente, usuario_cliente, member
invitationsRouter.post("/", requirePermission("workspace.manage"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const inviterId = req.userId!;
    const { email, role = "member", expiresInDays = 7 } = req.body as { email: string; role?: string; expiresInDays?: number };

    if (!email?.trim()) { res.status(400).json({ error: "Email requerido" }); return; }

    const validRoles = ["admin", "vendedor", "cliente", "usuario_cliente", "member", "owner"];
    if (!validRoles.includes(role)) { res.status(400).json({ error: `Rol inválido: ${role}` }); return; }

    // Check plan limits for member count
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    const memberCount = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, orgId));
    const planLimits: Record<string, number> = { starter: 3, growth: 10, scale: 50, free: 2 };
    const limit = planLimits[org?.plan ?? "starter"];
    if (Number(memberCount[0]?.count ?? 0) >= limit) {
      res.status(403).json({ error: `Límite de usuarios alcanzado para plan ${org?.plan}. Máximo: ${limit}.` }); return;
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.min(expiresInDays, 30));

    const [inv] = await db.insert(orgInvitationsTable).values({
      orgId, email: email.trim().toLowerCase(), role, token, invitedBy: inviterId, expiresAt,
    }).returning();

    res.status(201).json({ id: inv.id, email: inv.email, role: inv.role, token: inv.token, expiresAt: inv.expiresAt.toISOString() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

invitationsRouter.post("/:token/accept", requireAuth, async (req, res) => {
  try {
    const { token } = req.params;
    const clerkUserId = req.clerkUserId!;

    const [inv] = await db
      .select()
      .from(orgInvitationsTable)
      .where(and(eq(orgInvitationsTable.token, token), isNull(orgInvitationsTable.acceptedAt)));

    if (!inv) { res.status(404).json({ error: "Invitación no encontrada o ya aceptada." }); return; }
    if (inv.expiresAt < new Date()) { res.status(410).json({ error: "Esta invitación ha expirado." }); return; }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
    if (!user) {
      // @clerk/express v2: clerkClient is a pre-instantiated object, not a factory function
      let email: string | null = null;
      let name: string | null = null;
      let avatarUrl: string | null = null;
      try {
        const clerkUser = await clerkClient.users.getUser(clerkUserId);
        email     = clerkUser.emailAddresses[0]?.emailAddress ?? null;
        name      = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
        avatarUrl = clerkUser.imageUrl ?? null;
      } catch (err) {
        console.warn("[Clerk] getUser failed during invitation accept:", String(err));
      }
      [user] = await db.insert(usersTable).values({ clerkId: clerkUserId, email, name, avatarUrl }).returning();
    } else if (!user.email) {
      // Existing user with missing email — attempt to fill it in
      try {
        const clerkUser = await clerkClient.users.getUser(clerkUserId);
        const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
        if (email) {
          [user] = await db.update(usersTable).set({ email }).where(eq(usersTable.clerkId, clerkUserId)).returning();
        }
      } catch { /* non-fatal */ }
    }

    const existing = await db.select({ id: orgMembersTable.id }).from(orgMembersTable).where(eq(orgMembersTable.userId, user.id));
    if (existing.length > 0) {
      res.status(409).json({ error: "Ya perteneces a una organización. Para unirte a este equipo, necesitas una cuenta nueva." }); return;
    }

    await db.insert(orgMembersTable).values({ orgId: inv.orgId, userId: user.id, role: inv.role });
    await db.update(orgInvitationsTable).set({ acceptedAt: new Date() }).where(eq(orgInvitationsTable.id, inv.id));

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, inv.orgId));
    res.json({ success: true, organization: { id: org.id, name: org.name, slug: org.slug, plan: org.plan, role: inv.role } });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
