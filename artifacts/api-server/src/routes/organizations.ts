import { Router } from "express";
import { db, organizationsTable, orgMembersTable, usersTable, orgInvitationsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export const organizationsRouter = Router();

organizationsRouter.get("/me", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
    res.json({ id: org.id, name: org.name, slug: org.slug, plan: org.plan, logoUrl: org.logoUrl, createdAt: org.createdAt.toISOString() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.patch("/me", async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (req.orgRole !== "owner" && req.orgRole !== "admin") {
      res.status(403).json({ error: "Solo owners y admins pueden actualizar la organización." }); return;
    }
    const { name } = req.body as { name?: string };
    if (!name?.trim()) { res.status(400).json({ error: "name es requerido" }); return; }
    const [org] = await db.update(organizationsTable).set({ name: name.trim() }).where(eq(organizationsTable.id, orgId)).returning();
    res.json({ id: org.id, name: org.name, slug: org.slug, plan: org.plan, logoUrl: org.logoUrl, createdAt: org.createdAt.toISOString() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.get("/members", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const members = await db
      .select({ userId: orgMembersTable.userId, role: orgMembersTable.role, joinedAt: orgMembersTable.joinedAt, email: usersTable.email, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(orgMembersTable)
      .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
      .where(eq(orgMembersTable.orgId, orgId));
    res.json(members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.patch("/members/:userId", async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (req.orgRole !== "owner") { res.status(403).json({ error: "Solo el owner puede cambiar roles." }); return; }
    const targetUserId = Number(req.params.userId);
    const { role } = req.body as { role?: string };
    if (!role || !["admin", "member"].includes(role)) { res.status(400).json({ error: "role debe ser admin o member" }); return; }
    if (targetUserId === req.userId) { res.status(400).json({ error: "No puedes cambiar tu propio rol." }); return; }
    const [updated] = await db.update(orgMembersTable).set({ role }).where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, targetUserId))).returning();
    if (!updated) { res.status(404).json({ error: "Miembro no encontrado" }); return; }
    res.json({ userId: updated.userId, role: updated.role });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.delete("/members/:userId", async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (req.orgRole !== "owner" && req.orgRole !== "admin") { res.status(403).json({ error: "Sin permisos." }); return; }
    const targetUserId = Number(req.params.userId);
    if (targetUserId === req.userId) { res.status(400).json({ error: "No puedes eliminarte a ti mismo." }); return; }
    const [target] = await db.select({ role: orgMembersTable.role }).from(orgMembersTable).where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, targetUserId)));
    if (!target) { res.status(404).json({ error: "Miembro no encontrado" }); return; }
    if (target.role === "owner") { res.status(400).json({ error: "No se puede eliminar al owner." }); return; }
    await db.delete(orgMembersTable).where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, targetUserId)));
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.get("/invitations", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db
      .select({ id: orgInvitationsTable.id, email: orgInvitationsTable.email, role: orgInvitationsTable.role, token: orgInvitationsTable.token, expiresAt: orgInvitationsTable.expiresAt, createdAt: orgInvitationsTable.createdAt, inviterName: usersTable.name, inviterEmail: usersTable.email })
      .from(orgInvitationsTable)
      .innerJoin(usersTable, eq(orgInvitationsTable.invitedBy, usersTable.id))
      .where(and(eq(orgInvitationsTable.orgId, orgId), isNull(orgInvitationsTable.acceptedAt)));
    const now = new Date();
    res.json(rows.filter((r) => r.expiresAt > now).map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString() })));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.post("/invitations", async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (req.orgRole !== "owner" && req.orgRole !== "admin") { res.status(403).json({ error: "Solo owners y admins pueden invitar miembros." }); return; }
    const { email, role = "member" } = req.body as { email?: string; role?: string };
    if (!email?.trim()) { res.status(400).json({ error: "email es requerido" }); return; }
    if (!["admin", "member"].includes(role)) { res.status(400).json({ error: "role debe ser admin o member" }); return; }

    const existing = await db.select({ id: orgInvitationsTable.id, expiresAt: orgInvitationsTable.expiresAt }).from(orgInvitationsTable)
      .where(and(eq(orgInvitationsTable.orgId, orgId), eq(orgInvitationsTable.email, email.trim().toLowerCase()), isNull(orgInvitationsTable.acceptedAt)));
    if (existing.length > 0 && existing[0].expiresAt > new Date()) {
      res.status(409).json({ error: "Ya hay una invitación pendiente para este email." }); return;
    }

    const existingMember = await db.select({ id: usersTable.id }).from(usersTable)
      .innerJoin(orgMembersTable, and(eq(orgMembersTable.userId, usersTable.id), eq(orgMembersTable.orgId, orgId)))
      .where(eq(usersTable.email, email.trim().toLowerCase()));
    if (existingMember.length > 0) { res.status(409).json({ error: "Este usuario ya es miembro de la organización." }); return; }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [inv] = await db.insert(orgInvitationsTable).values({ orgId, invitedBy: req.userId!, email: email.trim().toLowerCase(), role, token, expiresAt }).returning();
    res.status(201).json({ id: inv.id, email: inv.email, role: inv.role, token: inv.token, expiresAt: inv.expiresAt.toISOString(), createdAt: inv.createdAt.toISOString() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

organizationsRouter.delete("/invitations/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (req.orgRole !== "owner" && req.orgRole !== "admin") { res.status(403).json({ error: "Sin permisos." }); return; }
    const id = Number(req.params.id);
    await db.delete(orgInvitationsTable).where(and(eq(orgInvitationsTable.id, id), eq(orgInvitationsTable.orgId, orgId)));
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
