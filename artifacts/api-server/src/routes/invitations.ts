import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, orgInvitationsTable, organizationsTable, usersTable, orgMembersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

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
