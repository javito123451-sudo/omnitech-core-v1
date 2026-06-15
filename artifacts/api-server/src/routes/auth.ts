import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, usersTable, orgMembersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logAudit, shouldLogLogin } from "../utils/auditLogger";

export const authRouter = Router();

// ── Helper: fetch real Clerk profile (v2 SDK — clerkClient is an instance, not a factory) ──
async function fetchClerkProfile(clerkUserId: string): Promise<{
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} | null> {
  try {
    // @clerk/express v2: clerkClient is already a pre-instantiated object
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
    const name  = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
    const avatarUrl = clerkUser.imageUrl ?? null;
    return { email, name, avatarUrl };
  } catch (err) {
    console.warn("[Clerk] getUser failed — keeping existing profile:", String(err));
    return null;
  }
}

// ── GET /me — provision user on first login, refresh Clerk profile ────────────
authRouter.get("/me", requireAuth, async (req, res) => {
  const clerkUserId = req.clerkUserId!;

  try {
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));

    // Fetch Clerk profile — only trust result if the API succeeded
    const clerkProfile = await fetchClerkProfile(clerkUserId);

    if (!user) {
      // First-ever login: insert with whatever Clerk returned (null if unavailable)
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId:   clerkUserId,
          email:     clerkProfile?.email     ?? null,
          name:      clerkProfile?.name      ?? null,
          avatarUrl: clerkProfile?.avatarUrl ?? null,
        })
        .returning();
    } else {
      // Returning user: only overwrite DB fields if Clerk returned real data.
      // NEVER overwrite a real email with null or a placeholder.
      if (clerkProfile) {
        const updates: Partial<typeof user> = {};
        if (clerkProfile.email     && clerkProfile.email !== user.email)         updates.email     = clerkProfile.email;
        if (clerkProfile.name      !== undefined && clerkProfile.name !== user.name) updates.name  = clerkProfile.name;
        if (clerkProfile.avatarUrl !== undefined)                                 updates.avatarUrl = clerkProfile.avatarUrl;

        if (Object.keys(updates).length > 0) {
          [user] = await db
            .update(usersTable)
            .set(updates)
            .where(eq(usersTable.clerkId, clerkUserId))
            .returning();
        }
      }
    }

    const [membership] = await db
      .select({
        orgId:      orgMembersTable.orgId,
        role:       orgMembersTable.role,
        orgName:    organizationsTable.name,
        orgSlug:    organizationsTable.slug,
        orgPlan:    organizationsTable.plan,
        orgLogoUrl: organizationsTable.logoUrl,
      })
      .from(orgMembersTable)
      .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
      .where(eq(orgMembersTable.userId, user.id));

    const responsePayload = {
      user: {
        id:        user.id,
        clerkId:   user.clerkId,
        email:     user.email,
        name:      user.name,
        avatarUrl: user.avatarUrl,
      },
      organization: membership
        ? {
            id:      membership.orgId,
            name:    membership.orgName,
            slug:    membership.orgSlug,
            plan:    membership.orgPlan,
            logoUrl: membership.orgLogoUrl,
            role:    membership.role,
          }
        : null,
    };

    shouldLogLogin(clerkUserId).then((should) => {
      if (should) {
        logAudit({
          actorClerkId: clerkUserId,
          actorEmail:   user.email ?? undefined,
          action:       "user_login",
          resource:     "session",
          orgId:        membership?.orgId ?? undefined,
          details: {
            userName:   user.name,
            orgName:    membership?.orgName ?? null,
            orgRole:    membership?.role    ?? null,
            result:     "success",
          },
          severity: "info",
          result:   "success",
          req,
        });
      }
    }).catch(() => {});

    res.json(responsePayload);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /logout-event — log user logout ──────────────────────────────────────
authRouter.post("/logout-event", requireAuth, async (req, res) => {
  const clerkUserId = req.clerkUserId!;
  try {
    const [user] = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
    logAudit({
      actorClerkId: clerkUserId,
      actorEmail:   user?.email ?? undefined,
      action:       "user_logout",
      resource:     "session",
      orgId:        req.orgId ?? undefined,
      details: { userName: user?.name ?? null, result: "success" },
      severity: "info",
      result:   "success",
      req,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /setup-org — create the user's first organization ───────────────────
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
      orgId:  org.id,
      userId: user.id,
      role:   "owner",
    });

    res.status(201).json({
      organization: {
        id:      org.id,
        name:    org.name,
        slug:    org.slug,
        plan:    org.plan,
        logoUrl: org.logoUrl,
        role:    "owner",
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
