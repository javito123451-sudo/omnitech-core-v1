import { Router } from "express";
import { db, organizationsTable, orgMembersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export const organizationsRouter = Router();

organizationsRouter.get("/me", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId));

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      logoUrl: org.logoUrl,
      createdAt: org.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

organizationsRouter.patch("/me", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const role = req.orgRole;

    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "Only owners and admins can update the organization." });
      return;
    }

    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const [org] = await db
      .update(organizationsTable)
      .set({ name: name.trim() })
      .where(eq(organizationsTable.id, orgId))
      .returning();

    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      logoUrl: org.logoUrl,
      createdAt: org.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

organizationsRouter.get("/members", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const members = await db
      .select({
        userId: orgMembersTable.userId,
        role: orgMembersTable.role,
        joinedAt: orgMembersTable.joinedAt,
        email: usersTable.email,
        name: usersTable.name,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(orgMembersTable)
      .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
      .where(eq(orgMembersTable.orgId, orgId));

    res.json(
      members.map((m) => ({
        ...m,
        joinedAt: m.joinedAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
