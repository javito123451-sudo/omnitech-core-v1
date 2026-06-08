import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, usersTable, orgMembersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

export const authRouter = Router();

authRouter.get("/me", requireAuth, async (req, res) => {
  const clerkUserId = req.clerkUserId!;

  try {
    // Fetch Clerk profile — non-fatal if Clerk API is unavailable
    let clerkEmail = "unknown@example.com";
    let clerkName: string | null = null;
    let clerkAvatar: string | null = null;
    try {
      const clerkUser = await clerkClient().users.getUser(clerkUserId);
      clerkEmail = clerkUser.emailAddresses[0]?.emailAddress ?? clerkEmail;
      clerkName  = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
      clerkAvatar = clerkUser.imageUrl ?? null;
    } catch (clerkErr) {
      // Proceed with fallback values so provisioning never blocks on Clerk API errors
      console.warn("Clerk API unavailable — provisioning with fallback profile:", String(clerkErr));
    }

    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));

    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({ clerkId: clerkUserId, email: clerkEmail, name: clerkName, avatarUrl: clerkAvatar })
        .returning();
    } else {
      [user] = await db
        .update(usersTable)
        .set({ email: clerkEmail, name: clerkName, avatarUrl: clerkAvatar })
        .where(eq(usersTable.clerkId, clerkUserId))
        .returning();
    }

    const [membership] = await db
      .select({
        orgId: orgMembersTable.orgId,
        role: orgMembersTable.role,
        orgName: organizationsTable.name,
        orgSlug: organizationsTable.slug,
        orgPlan: organizationsTable.plan,
        orgLogoUrl: organizationsTable.logoUrl,
      })
      .from(orgMembersTable)
      .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
      .where(eq(orgMembersTable.userId, user.id));

    res.json({
      user: {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      organization: membership
        ? {
            id: membership.orgId,
            name: membership.orgName,
            slug: membership.orgSlug,
            plan: membership.orgPlan,
            logoUrl: membership.orgLogoUrl,
            role: membership.role,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/setup-org", requireAuth, async (req, res) => {
  const clerkUserId = req.clerkUserId!;
  const { orgName } = req.body as { orgName?: string };

  if (!orgName?.trim()) {
    res.status(400).json({ error: "orgName is required" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));

    if (!user) {
      res.status(400).json({ error: "User not provisioned. Call /api/auth/me first." });
      return;
    }

    const existing = await db
      .select({ orgId: orgMembersTable.orgId })
      .from(orgMembersTable)
      .where(eq(orgMembersTable.userId, user.id));

    if (existing.length > 0) {
      res.status(409).json({ error: "User already has an organization." });
      return;
    }

    const slug =
      orgName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) +
      "-" +
      Math.random().toString(36).slice(2, 7);

    const [org] = await db
      .insert(organizationsTable)
      .values({ name: orgName.trim(), slug, plan: "free" })
      .returning();

    await db.insert(orgMembersTable).values({
      orgId: org.id,
      userId: user.id,
      role: "owner",
    });

    res.status(201).json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        logoUrl: org.logoUrl,
        role: "owner",
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
