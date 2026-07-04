import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, usersTable, orgMembersTable, organizationsTable, moduleConfigsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { hasPlatformRole, clearRoleCache } from "../middlewares/superAdmin";
import { logAudit, shouldLogLogin } from "../utils/auditLogger";
import { getOrgModuleVersion } from "../lib/moduleVersion";

// ── Blocklist check — returns true if the Clerk ID is permanently blocked ─────
async function isBlockedClerkId(clerkUserId: string): Promise<boolean> {
  try {
    const rows = await db.execute(
      sql`SELECT 1 FROM blocked_clerk_ids WHERE clerk_id = ${clerkUserId} LIMIT 1`
    );
    return (rows as { rows: unknown[] }).rows.length > 0;
  } catch {
    return false;
  }
}

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
  // Never cache — org membership can change at any moment
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const clerkUserId = req.clerkUserId!;

  try {
    // ── BLOCKLIST: permanently blocked Clerk IDs cannot re-provision ──────────
    if (await isBlockedClerkId(clerkUserId)) {
      console.warn(`[Auth/me] Blocked Clerk ID attempted login: ${clerkUserId}`);
      res.status(403).json({
        error:   "account_blocked",
        message: "Esta cuenta ha sido bloqueada. Contacta con el administrador.",
      });
      return;
    }

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

    // ── Fetch ALL memberships (multi-workspace support) ────────────────────
    const memberships = await db
      .select({
        orgId:       orgMembersTable.orgId,
        role:        orgMembersTable.role,
        isSuspended: orgMembersTable.isSuspended,
        orgName:     organizationsTable.name,
        orgSlug:     organizationsTable.slug,
        orgPlan:     organizationsTable.plan,
        orgLogoUrl:  organizationsTable.logoUrl,
        orgStatus:   organizationsTable.status,
      })
      .from(orgMembersTable)
      .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
      .where(eq(orgMembersTable.userId, user.id));

    const primaryMembership = memberships.find(m => !m.isSuspended) ?? memberships[0] ?? null;

    // ── Module config for primary org ──────────────────────────────────────
    let modules: Record<string, boolean> = {};
    if (primaryMembership) {
      const configs = await db
        .select({ moduleSlug: moduleConfigsTable.moduleSlug, isEnabled: moduleConfigsTable.isEnabled })
        .from(moduleConfigsTable)
        .where(eq(moduleConfigsTable.orgId, primaryMembership.orgId));
      for (const cfg of configs) {
        modules[cfg.moduleSlug] = cfg.isEnabled ?? true;
      }
    }
    // crm is the core module — always enabled, cannot be disabled
    modules.crm = true;

    // ── Plan-based module gating ───────────────────────────────────────────
    // Starter: crm only
    // Growth: crm + ai_agents + analytics + integrations + automations
    // Scale: all modules
    const planModules: Record<string, string[]> = {
      starter: ["crm"],
      growth:  ["crm", "ai_agents", "analytics", "integrations", "automations", "omni_marketing"],
      scale:   ["crm", "ai_agents", "analytics", "integrations", "automations", "omni_accounting", "omni_import_ai", "whatsapp", "omni_tax", "omni_marketing"],
      free:    ["crm"],
    };
    const plan = primaryMembership?.orgPlan ?? "starter";
    const allowedModules = planModules[plan] ?? planModules.starter;
    for (const key of Object.keys(modules)) {
      if (!allowedModules.includes(key)) modules[key] = false;
    }

    // ── Permission set for primary role ───────────────────────────────────
    const { getPermissionsForRole } = await import("../middlewares/permissions");
    const permissions = primaryMembership
      ? getPermissionsForRole(primaryMembership.role)
      : new Set<string>();

    // ── Resolve pending platform role grants by email ─────────────────────
    // A SUPER_ADMIN can be pre-granted before the user ever logs in. In that
    // case the row has clerk_user_id = 'pending:<email>'. On their first (or
    // any subsequent) login we detect it and link the real clerk_user_id so
    // hasPlatformRole() starts returning the correct role immediately.
    const userEmail = user.email ?? clerkProfile?.email ?? null;
    if (userEmail) {
      try {
        const pendingKey = `pending:${userEmail}`;
        const pendingRows = await db.execute(
          sql`SELECT id FROM platform_roles WHERE clerk_user_id = ${pendingKey} AND is_active = true LIMIT 1`
        );
        const rows = (pendingRows as { rows: { id: number }[] }).rows;
        if (rows.length > 0) {
          await db.execute(
            sql`UPDATE platform_roles SET clerk_user_id = ${clerkUserId}, updated_at = now() WHERE clerk_user_id = ${pendingKey}`
          );
          clearRoleCache(clerkUserId); // ensure no stale cache entry for real ID
          console.info(`[Auth] Linked pending SUPER_ADMIN grant for ${userEmail} → ${clerkUserId}`);
        }
      } catch (err) {
        console.error("[Auth] Failed to resolve pending platform role:", err);
      }
    }

    // ── Resolve platform role — always read from platform_roles table (authoritative) ──
    // users.platform_role is a denormalized cache; it can be stale if the user
    // was inserted (first login) before FIX-O ran for their row, or if a role
    // was granted after the last server restart. We always read the live value
    // from platform_roles and sync users.platform_role back when it drifts.
    const liveRole = await hasPlatformRole(clerkUserId);
    const resolvedPlatformRole = liveRole ?? "NONE";
    if (resolvedPlatformRole !== (user.platformRole ?? "NONE")) {
      // Sync the denormalized column so FIX-O has less work on next restart
      await db.execute(
        sql`UPDATE users SET platform_role = ${resolvedPlatformRole} WHERE clerk_id = ${clerkUserId}`
      );
    }

    const responsePayload = {
      user: {
        id:           user.id,
        clerkId:      user.clerkId,
        email:        user.email,
        name:         user.name,
        avatarUrl:    user.avatarUrl,
        platformRole: resolvedPlatformRole,
      },
      platformRole: resolvedPlatformRole,
      organization: primaryMembership
        ? {
            id:      primaryMembership.orgId,
            name:    primaryMembership.orgName,
            slug:    primaryMembership.orgSlug,
            plan:    primaryMembership.orgPlan,
            logoUrl: primaryMembership.orgLogoUrl,
            role:    primaryMembership.role,
          }
        : null,
      organizations: memberships.map(m => ({
        id:          m.orgId,
        name:        m.orgName,
        slug:        m.orgSlug,
        plan:        m.orgPlan,
        logoUrl:     m.orgLogoUrl,
        role:        m.role,
        status:      m.orgStatus,
        isSuspended: m.isSuspended,
      })),
      modules,
      modulesVersion: primaryMembership ? getOrgModuleVersion(primaryMembership.orgId) : 0,
      permissions: Array.from(permissions),
    };

    shouldLogLogin(clerkUserId).then((should) => {
      if (should) {
        logAudit({
          actorClerkId: clerkUserId,
          actorEmail:   user.email ?? undefined,
          action:       "user_login",
          resource:     "session",
          orgId:        primaryMembership?.orgId ?? undefined,
          details: {
            userName:   user.name,
            orgName:    primaryMembership?.orgName ?? null,
            orgRole:    primaryMembership?.role    ?? null,
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
    // ── GUARD: solo SUPER_ADMIN puede crear organizaciones ─────────────────
    const platformRole = await hasPlatformRole(clerkUserId);
    if (platformRole !== "SUPER_ADMIN") {
      res.status(403).json({
        error: "setup_not_allowed",
        message: "No tienes un workspace asignado. Contacta con tu administrador para recibir una invitación.",
      });
      return;
    }

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
