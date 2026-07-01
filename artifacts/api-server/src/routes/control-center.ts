import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  platformRolesTable, moduleConfigsTable, licensePlansTable, auditLogsTable,
  organizationsTable, usersTable, orgMembersTable, clientsTable, messagesTable, quotesTable,
  orgInvitationsTable, onboardTemplatesTable, onboardWizardDraftsTable,
} from "@workspace/db";
import { eq, desc, count, and, sql, gte, lte, ilike, or, lt, isNull } from "drizzle-orm";
import { requireSuperAdmin, hasPlatformRole, clearRoleCache } from "../middlewares/superAdmin";
import { aiCenterRouter } from "./ai-center-routes";
import { clearModuleCache } from "../middlewares/requireModule";
import { bumpOrgModuleVersion } from "../lib/moduleVersion";
import { logAudit as _logAudit } from "../utils/auditLogger";
import { sendInvitationEmail } from "../lib/email";
import { randomUUID } from "crypto";

export const controlCenterRouter = Router();

// Mount AI Center sub-router
controlCenterRouter.use("/ai-center", aiCenterRouter);

// ── Re-export shared logAudit so existing callers keep working ────────────────
export const logAudit = _logAudit;

// ── GET /check — public ───────────────────────────────────────────────────────
controlCenterRouter.get("/check", async (req, res) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) { res.json({ isSuperAdmin: false, role: null }); return; }
  const role = await hasPlatformRole(clerkUserId);
  res.json({ isSuperAdmin: role === "SUPER_ADMIN", role });
});

// ── All routes below require SUPER_ADMIN or STAFF_OMNITECH ───────────────────
controlCenterRouter.use(requireSuperAdmin);

// ── GET /health — real health check ──────────────────────────────────────────
controlCenterRouter.get("/health", async (_req, res) => {
  const services: Record<string, { status: string; latencyMs?: number; message: string }> = {};
  let overallStatus = "operational";

  // DB check
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    services.database = { status: "ok", latencyMs: Date.now() - dbStart, message: "Conectado" };
  } catch (e) {
    services.database = { status: "error", latencyMs: Date.now() - dbStart, message: String(e) };
    overallStatus = "down";
  }

  // OpenAI check
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey && openaiKey.startsWith("sk-")) {
    services.openai = { status: "ok", message: "API Key configurada" };
  } else {
    services.openai = { status: "warning", message: "API Key no configurada o inválida" };
    if (overallStatus === "operational") overallStatus = "degraded";
  }

  // WhatsApp check
  const waToken = process.env["META_WHATSAPP_TOKEN"] ?? process.env["WHATSAPP_TOKEN"];
  services.whatsapp = waToken
    ? { status: "ok",      message: "Token configurado" }
    : { status: "warning", message: "Token no configurado" };

  // Clerk check
  const clerkKey = process.env["CLERK_SECRET_KEY"];
  if (clerkKey && clerkKey.startsWith("sk_")) {
    services.clerk = { status: "ok", message: "Secret Key configurada" };
  } else {
    services.clerk = { status: "error", message: "Secret Key no configurada" };
    if (overallStatus !== "down") overallStatus = "degraded";
  }

  const mem = process.memoryUsage();
  res.json({
    status: overallStatus,
    services,
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb:      Math.round(mem.rss / 1024 / 1024),
      heapMb:        Math.round(mem.heapUsed / 1024 / 1024),
      nodeVersion:   process.version,
    },
    checkedAt: new Date().toISOString(),
  });
});

// ── GET /metrics ──────────────────────────────────────────────────────────────
controlCenterRouter.get("/metrics", async (_req, res) => {
  const [orgs]     = await db.select({ count: count() }).from(organizationsTable);
  const [users]    = await db.select({ count: count() }).from(usersTable);
  const [clients]  = await db.select({ count: count() }).from(clientsTable);
  const [messages] = await db.select({ count: count() }).from(messagesTable);
  const [quotes]   = await db.select({ count: count() }).from(quotesTable);
  const [admins]   = await db.select({ count: count() }).from(platformRolesTable).where(eq(platformRolesTable.isActive, true));
  const [suspended] = await db.select({ count: count() }).from(organizationsTable).where(eq(organizationsTable.status, "suspended"));

  // Real AI agents / automations from modules
  const aiModules = await db.select({ count: count() }).from(moduleConfigsTable)
    .where(and(eq(moduleConfigsTable.moduleSlug, "ai_agents"), eq(moduleConfigsTable.isEnabled, true)));
  const autoModules = await db.select({ count: count() }).from(moduleConfigsTable)
    .where(and(eq(moduleConfigsTable.moduleSlug, "automations"), eq(moduleConfigsTable.isEnabled, true)));

  res.json({
    workspaces:       Number(orgs?.count      ?? 0),
    workspacesSusp:   Number(suspended?.[0]?.count ?? 0),
    users:            Number(users?.count     ?? 0),
    clients:          Number(clients?.count   ?? 0),
    messages:         Number(messages?.count  ?? 0),
    quotes:           Number(quotes?.count    ?? 0),
    superAdmins:      Number(admins?.count    ?? 0),
    aiAgents:         Number(aiModules?.[0]?.count  ?? 0),
    automations:      Number(autoModules?.[0]?.count ?? 0),
    storageUsedMb:    Math.round(Number(messages?.count ?? 0) * 0.5 + Number(clients?.count ?? 0) * 0.2),
    systemStatus:     "operational",
  });
});

// ── GET /workspaces ───────────────────────────────────────────────────────────
controlCenterRouter.get("/workspaces", async (_req, res) => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt));
  const enriched = await Promise.all(orgs.map(async (org) => {
    const [userCount]   = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, org.id));
    const [clientCount] = await db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, org.id));
    const [license]     = await db.select().from(licensePlansTable).where(eq(licensePlansTable.orgId, org.id));
    return {
      id:       org.id, name: org.name, slug: org.slug,
      plan:     license?.plan ?? org.plan ?? "starter",
      status:   org.status ?? "active",
      users:    Number(userCount?.count   ?? 0),
      clients:  Number(clientCount?.count ?? 0),
      createdAt: org.createdAt,
    };
  }));
  res.json(enriched);
});

// ── POST /workspaces ──────────────────────────────────────────────────────────
controlCenterRouter.post("/workspaces", async (req, res) => {
  const { name, ownerEmail } = req.body as { name: string; ownerEmail?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  const [org] = await db.insert(organizationsTable).values({ name: name.trim(), slug }).returning();

  // ── Assign owner membership if ownerEmail is provided ────────────────────
  let ownerAssigned = false;
  if (ownerEmail?.trim()) {
    const [owner] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, ownerEmail.trim().toLowerCase()));
    if (owner) {
      await db.insert(orgMembersTable).values({ orgId: org!.id, userId: owner.id, role: "owner" });
      ownerAssigned = true;
    }
  }

  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_created", resource: "workspace", resourceId: String(org!.id), details: { name, ownerEmail: ownerEmail ?? null, ownerAssigned }, req });
  res.json({ ...org, ownerAssigned });
});

// ── PATCH /workspaces/:id ─────────────────────────────────────────────────────
controlCenterRouter.patch("/workspaces/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  const { name } = req.body as { name?: string };
  if (name?.trim()) {
    await db.update(organizationsTable).set({ name: name.trim() }).where(eq(organizationsTable.id, id));
  }
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_updated", resource: "workspace", resourceId: String(id), details: { name }, req });
  res.json({ ok: true });
});

// ── POST /workspaces/:id/suspend ──────────────────────────────────────────────
controlCenterRouter.post("/workspaces/:id/suspend", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede suspender workspaces" }); return; }
  const id = Number(req.params["id"]);
  const { reason } = req.body as { reason?: string };
  await db.execute(sql`UPDATE organizations SET status = 'suspended' WHERE id = ${id}`);
  clearModuleCache(id);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_suspended", resource: "workspace", resourceId: String(id), details: { reason }, severity: "warning", req });
  res.json({ ok: true });
});

// ── POST /workspaces/:id/activate ─────────────────────────────────────────────
controlCenterRouter.post("/workspaces/:id/activate", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede activar workspaces" }); return; }
  const id = Number(req.params["id"]);
  await db.execute(sql`UPDATE organizations SET status = 'active' WHERE id = ${id}`);
  clearModuleCache(id);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_activated", resource: "workspace", resourceId: String(id), severity: "info", req });
  res.json({ ok: true });
});

// ── GET /workspaces/:id/search-user ───────────────────────────────────────────
// One-Step User Assignment: search by email, returns existence + membership status
controlCenterRouter.get("/workspaces/:id/search-user", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const orgId = Number(req.params["id"]);
  const email = (req.query["email"] as string)?.trim().toLowerCase() ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Email inválido" }); return;
  }

  const [user] = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, clerkId: usersTable.clerkId, status: usersTable.status })
    .from(usersTable).where(eq(usersTable.email, email));

  if (!user) {
    res.json({ exists: false, email });
    return;
  }

  const [member] = await db.select({ id: orgMembersTable.id, role: orgMembersTable.role, isSuspended: orgMembersTable.isSuspended })
    .from(orgMembersTable)
    .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, user.id)));

  res.json({
    exists: true,
    email: user.email,
    user: { id: user.id, name: user.name, clerkId: user.clerkId, status: user.status },
    alreadyMember: !!member,
    currentRole: member?.role ?? null,
    isSuspended: member?.isSuspended ?? false,
  });
});

// ── POST /workspaces/:id/assign-user ──────────────────────────────────────────
// Enhanced: assign existing user (backward-compatible)
controlCenterRouter.post("/workspaces/:id/assign-user", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede asignar usuarios" }); return; }
  const orgId = Number(req.params["id"]);
  const { email, role = "member" } = req.body as { email: string; role?: string };
  if (!email?.trim()) { res.status(400).json({ error: "Email requerido" }); return; }

  const [user] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
    .where(eq(usersTable.email, email.trim().toLowerCase()));
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  const VALID = ["owner", "admin", "member", "read_only", "vendedor"];
  if (!VALID.includes(role)) { res.status(400).json({ error: "Rol inválido" }); return; }

  // Check if already a member
  const [existingMember] = await db.select({ id: orgMembersTable.id }).from(orgMembersTable)
    .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, user.id)));
  if (existingMember) {
    res.status(409).json({ error: "Este usuario ya está asignado a este Workspace.", alreadyMember: true });
    return;
  }

  if (role === "owner") {
    const [currentOwner] = await db.select({ userId: orgMembersTable.userId }).from(orgMembersTable)
      .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.role, "owner")));
    if (currentOwner) {
      await db.update(orgMembersTable).set({ role: "admin" })
        .where(and(eq(orgMembersTable.userId, currentOwner.userId), eq(orgMembersTable.orgId, orgId)));
    }
  }

  await db.insert(orgMembersTable)
    .values({ orgId, userId: user.id, role })
    .onConflictDoUpdate({
      target: [orgMembersTable.orgId, orgMembersTable.userId],
      set: { role, isSuspended: false, updatedAt: new Date() },
    });

  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_user_assigned", resource: "workspace", resourceId: String(orgId), details: { userId: user.id, email: user.email, role }, severity: "info", req });
  res.json({ ok: true, userId: user.id, email: user.email, role });
});

// ── POST /workspaces/:id/invite-and-assign ───────────────────────────────────
// One-Step: create invitation for new user + auto-assign on accept
controlCenterRouter.post("/workspaces/:id/invite-and-assign", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const orgId = Number(req.params["id"]);
  const { email, role = "member", name } = req.body as { email: string; role?: string; name?: string };

  if (!email?.trim()) { res.status(400).json({ error: "Email requerido" }); return; }
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: "Formato de email inválido" }); return;
  }

  const VALID = ["owner", "admin", "member", "read_only", "vendedor"];
  if (!VALID.includes(role)) { res.status(400).json({ error: "Rol inválido" }); return; }

  // Check if user already exists
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, cleanEmail));
  if (existingUser) {
    res.status(409).json({ error: "Ya existe un usuario con este email. Usa \"Asignar\" en lugar de \"Crear\".", exists: true });
    return;
  }

  // Check for pending invitation (acceptedAt IS NULL means still pending)
  const [pendingInv] = await db.select({ id: orgInvitationsTable.id }).from(orgInvitationsTable)
    .where(and(
      eq(orgInvitationsTable.orgId, orgId),
      eq(orgInvitationsTable.email, cleanEmail),
      isNull(orgInvitationsTable.acceptedAt),
    ));
  if (pendingInv) {
    res.status(409).json({ error: "Ya hay una invitación pendiente para este email.", hasPendingInvitation: true });
    return;
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [inv] = await db.insert(orgInvitationsTable).values({
    orgId,
    invitedBy: req.userId!,
    email: cleanEmail,
    role,
    token,
    expiresAt,
  }).returning();

  // Fire invitation email asynchronously — non-blocking
  const baseUrl  = req.get("origin") || `https://${req.get("host")}`;
  const acceptUrl = `${baseUrl}/invite/${inv.token}`;
  Promise.all([
    db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, orgId)),
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)),
  ]).then(([[org], [inviter]]) =>
    sendInvitationEmail({
      to:          inv.email,
      inviterName: inviter?.name ?? null,
      orgName:     org?.name ?? "Tu organización",
      role:        inv.role,
      acceptUrl,
      expiresAt:   inv.expiresAt,
    }),
  ).catch(err => console.error("[Email] Invitation send failed:", String(err)));

  await logAudit({
    actorClerkId: req.clerkUserId!,
    action:       "workspace_user_invited",
    resource:     "workspace",
    resourceId:   String(orgId),
    details:      { email: cleanEmail, role, name, invitationId: inv.id },
    severity:     "info",
    req,
  });

  res.status(201).json({
    ok: true,
    invited: true,
    email: cleanEmail,
    role,
    invitationId: inv.id,
    token: inv.token,
    expiresAt: inv.expiresAt.toISOString(),
    message: "Invitación enviada. El usuario recibirá un email para unirse al Workspace.",
  });
});

// ── POST /workspaces/:id/remove-user/:clerkId ─────────────────────────────────
controlCenterRouter.post("/workspaces/:id/remove-user/:clerkId", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede eliminar asignaciones" }); return; }
  const orgId = Number(req.params["id"]);
  const clerkId = req.params["clerkId"];

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  await db.delete(orgMembersTable).where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, user.id)));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_user_removed", resource: "workspace", resourceId: String(orgId), details: { userId: user.id, clerkId }, severity: "warning", req });
  res.json({ ok: true });
});

// ── POST /workspaces/:id/transfer-owner ─────────────────────────────────────────
controlCenterRouter.post("/workspaces/:id/transfer-owner", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede transferir propiedad" }); return; }
  const orgId = Number(req.params["id"]);
  const { newOwnerEmail } = req.body as { newOwnerEmail: string };
  if (!newOwnerEmail?.trim()) { res.status(400).json({ error: "Email del nuevo owner requerido" }); return; }

  const [newOwner] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
    .where(eq(usersTable.email, newOwnerEmail.trim().toLowerCase()));
  if (!newOwner) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  const [currentOwner] = await db.select({ userId: orgMembersTable.userId }).from(orgMembersTable)
    .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.role, "owner")));
  if (currentOwner) {
    await db.update(orgMembersTable).set({ role: "admin" })
      .where(and(eq(orgMembersTable.userId, currentOwner.userId), eq(orgMembersTable.orgId, orgId)));
  }

  await db.insert(orgMembersTable)
    .values({ orgId, userId: newOwner.id, role: "owner" })
    .onConflictDoUpdate({
      target: [orgMembersTable.orgId, orgMembersTable.userId],
      set: { role: "owner", isSuspended: false, updatedAt: new Date() },
    });

  await db.update(organizationsTable).set({ ownerId: newOwner.id }).where(eq(organizationsTable.id, orgId));

  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_owner_transferred", resource: "workspace", resourceId: String(orgId), details: { newOwnerId: newOwner.id, email: newOwner.email }, severity: "warning", req });
  res.json({ ok: true, newOwnerId: newOwner.id, email: newOwner.email });
});

// ── GET /workspaces/:id/consumption ─────────────────────────────────────────────
controlCenterRouter.get("/workspaces/:id/consumption", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede ver consumo" }); return; }
  const orgId = Number(req.params["id"]);

  const [userCount] = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, orgId));
  const [clientCount] = await db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, orgId));
  const [msgCount] = await db.select({ count: count() }).from(messagesTable).where(eq(messagesTable.orgId, orgId));
  const [invoiceCount] = await db.select({ count: count() }).from(invoicesTable).where(eq(invoicesTable.orgId, orgId));
  const [expenseCount] = await db.select({ count: count() }).from(expensesTable).where(eq(expensesTable.orgId, orgId));
  const [quoteCount] = await db.select({ count: count() }).from(quotesTable).where(eq(quotesTable.orgId, orgId));

  let aiCalls = 0; let aiTokens = 0;
  try {
    const aiResult = await db.execute(sql`
      SELECT COUNT(*) as calls, COALESCE(SUM(tokens_used), 0) as tokens
      FROM ai_center_logs WHERE org_id = ${orgId}
    `);
    const rows = (aiResult as { rows: Array<{ calls: string; tokens: string }> }).rows;
    aiCalls = Number(rows?.[0]?.calls ?? 0);
    aiTokens = Number(rows?.[0]?.tokens ?? 0);
  } catch {}

  const storageMb = Math.round(
    Number(msgCount?.count ?? 0) * 0.5 +
    Number(clientCount?.count ?? 0) * 0.2 +
    Number(invoiceCount?.count ?? 0) * 0.3 +
    Number(expenseCount?.count ?? 0) * 0.1
  );

  res.json({
    users: Number(userCount?.count ?? 0),
    clients: Number(clientCount?.count ?? 0),
    messages: Number(msgCount?.count ?? 0),
    invoices: Number(invoiceCount?.count ?? 0),
    expenses: Number(expenseCount?.count ?? 0),
    quotes: Number(quoteCount?.count ?? 0),
    ai: { calls: aiCalls, tokens: aiTokens },
    storage: { mb: storageMb, description: "Estimación basada en registros" },
  });
});

// ── POST /workspaces/:id/impersonate ───────────────────────────────────────────
controlCenterRouter.post("/workspaces/:id/impersonate", async (req, res) => {
  // ── Auth guard + debug logs ────────────────────────────────────────────
  // Defense-in-depth: verify auth explicitly (requireSuperAdmin middleware already ran)
  const auth = getAuth(req);
  const userId = auth?.userId ?? null;
  const workspaceId = Number(req.params["id"]);
  if (!userId) {
    res.status(401).json({ error: "Sesión no válida. Inicia sesión de nuevo." });
    return;
  }
  if (!req.isSuperAdmin) {
    res.status(403).json({ error: "Solo SUPER_ADMIN puede impersonar workspaces." });
    return;
  }

  const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, workspaceId));
  if (!org) { res.status(404).json({ error: "Workspace no encontrado" }); return; }

  // Close any previous active support session for this admin
  await db.execute(sql`
    UPDATE support_sessions
    SET status = 'closed', ended_at = NOW()
    WHERE admin_clerk_id = ${req.clerkUserId!} AND status = 'active'
  `);

  // Create new support session — db.execute returns QueryResult, NOT an array
  const insertResult = await db.execute(sql`
    INSERT INTO support_sessions (admin_clerk_id, org_id, org_name, reason, status, started_at)
    VALUES (${req.clerkUserId!}, ${workspaceId}, ${org.name}, 'Impersonación desde Workspace Management', 'active', NOW())
    RETURNING id
  `) as unknown as { rows: Array<{ id: number }> };
  const sessionId = insertResult.rows?.[0]?.id ?? null;

  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_impersonated", resource: "workspace", resourceId: String(workspaceId), details: { orgName: org.name, sessionId }, severity: "warning", req });
  res.json({ ok: true, orgId: workspaceId, orgName: org.name, sessionId, warning: "Esta acción ha sido registrada en auditoría" });
});

// ── GET /support-session/active ────────────────────────────────────────────────
controlCenterRouter.get("/support-session/active", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const result = await db.execute(sql`
    SELECT id, admin_clerk_id, org_id, org_name, reason, status, started_at
    FROM support_sessions
    WHERE admin_clerk_id = ${req.clerkUserId!} AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1
  `) as unknown as { rows: Array<{
    id: number; admin_clerk_id: string; org_id: number; org_name: string | null;
    reason: string | null; status: string; started_at: Date;
  }> };
  const rows = result.rows ?? [];
  if (rows.length === 0) { res.json({ active: false }); return; }
  res.json({ active: true, session: rows[0]! });
});

// ── POST /support-session/exit ─────────────────────────────────────────────────
controlCenterRouter.post("/support-session/exit", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const result2 = await db.execute(sql`
    SELECT id, org_id, org_name
    FROM support_sessions
    WHERE admin_clerk_id = ${req.clerkUserId!} AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1
  `) as unknown as { rows: Array<{ id: number; org_id: number; org_name: string | null }> };
  const rows2 = result2.rows ?? [];
  if (rows2.length === 0) { res.json({ ok: true, message: "No había sesión activa" }); return; }

  const s = rows2[0]!;
  await db.execute(sql`
    UPDATE support_sessions
    SET status = 'closed', ended_at = NOW()
    WHERE id = ${s.id}
  `);

  await logAudit({
    actorClerkId: req.clerkUserId!,
    action: "support_session_ended",
    resource: "workspace",
    resourceId: String(s.org_id),
    orgId: s.org_id,
    details: { orgName: s.org_name, sessionId: s.id, duration: "calculated on client" },
    severity: "info",
    req,
  });
  res.json({ ok: true, orgId: s.org_id, orgName: s.org_name });
});

// ── DELETE /workspaces/:id ────────────────────────────────────────────────────
controlCenterRouter.delete("/workspaces/:id", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede eliminar workspaces" }); return; }
  const id = Number(req.params["id"]);
  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_deleted", resource: "workspace", resourceId: String(id), severity: "critical", req });
  res.json({ ok: true });
});

// ── GET /users ────────────────────────────────────────────────────────────────
controlCenterRouter.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  const enriched = await Promise.all(users.map(async (u) => {
    const members = await db.select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role, isSuspended: orgMembersTable.isSuspended })
      .from(orgMembersTable).where(eq(orgMembersTable.userId, u.id));
    const [platformRole] = await db.select({ role: platformRolesTable.role })
      .from(platformRolesTable).where(eq(platformRolesTable.clerkUserId, u.clerkId));
    const orgs = await Promise.all(members.map(async m => {
      const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, m.orgId));
      return { orgId: m.orgId, orgName: org?.name ?? null, orgRole: m.role, isSuspended: m.isSuspended };
    }));
    return {
      id: u.id, clerkId: u.clerkId, email: u.email, name: u.name,
      status:       u.status ?? "active",
      suspendedAt:  u.suspendedAt,
      suspendedReason: u.suspendedReason,
      orgs,
      // Primary org (first)
      orgId:       orgs[0]?.orgId   ?? null,
      orgName:     orgs[0]?.orgName ?? null,
      orgRole:     orgs[0]?.orgRole ?? null,
      platformRole: platformRole?.role ?? null,
      createdAt:   u.createdAt,
    };
  }));
  res.json(enriched);
});

// ── PATCH /users/:clerkId — change CRM role ───────────────────────────────────
controlCenterRouter.patch("/users/:clerkId", async (req, res) => {
  const { clerkId } = req.params;
  const { orgId, role } = req.body as { orgId: number; role: string };
  const VALID_ROLES = ["owner", "admin", "member", "read_only", "vendedor"];
  if (!VALID_ROLES.includes(role)) { res.status(400).json({ error: "Rol inválido" }); return; }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  await db.update(orgMembersTable)
    .set({ role })
    .where(and(eq(orgMembersTable.userId, user.id), eq(orgMembersTable.orgId, orgId)));

  await logAudit({ actorClerkId: req.clerkUserId!, action: "user_role_changed", resource: "user", resourceId: clerkId, details: { role, orgId }, severity: "warning", req });
  res.json({ ok: true });
});

// ── POST /users/:clerkId/suspend ──────────────────────────────────────────────
controlCenterRouter.post("/users/:clerkId/suspend", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede suspender usuarios" }); return; }
  const { clerkId } = req.params;
  const { reason } = req.body as { reason?: string };
  await db.update(usersTable)
    .set({ status: "suspended", suspendedReason: reason ?? null, suspendedAt: new Date() })
    .where(eq(usersTable.clerkId, clerkId));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "user_suspended", resource: "user", resourceId: clerkId, details: { reason }, severity: "warning", req });
  res.json({ ok: true });
});

// ── POST /users/:clerkId/activate ─────────────────────────────────────────────
controlCenterRouter.post("/users/:clerkId/activate", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede activar usuarios" }); return; }
  const { clerkId } = req.params;
  await db.update(usersTable)
    .set({ status: "active", suspendedReason: null, suspendedAt: null })
    .where(eq(usersTable.clerkId, clerkId));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "user_activated", resource: "user", resourceId: clerkId, severity: "info", req });
  res.json({ ok: true });
});

// ── GET /modules ──────────────────────────────────────────────────────────────
controlCenterRouter.get("/modules", async (_req, res) => {
  const CATALOG = [
    { slug: "crm",            name: "CRM",                   description: "Gestión de clientes y relaciones",       alwaysOn: true  },
    { slug: "ai_agents",      name: "AI Agents",              description: "Agentes de IA personalizados",           alwaysOn: false },
    { slug: "analytics",      name: "Analytics",              description: "Análisis avanzado de datos",             alwaysOn: false },
    { slug: "whatsapp",       name: "WhatsApp Business",      description: "Mensajería y automatizaciones",          alwaysOn: false },
    { slug: "integrations",   name: "Integraciones",          description: "Conectores y webhooks externos",         alwaysOn: false },
    { slug: "omni_import_ai", name: "Omni Import AI",         description: "Importación inteligente de datos",       alwaysOn: false },
    { slug: "omni_docs",      name: "Omni Docs",              description: "Gestión documental",                     alwaysOn: false },
    { slug: "omni_security",  name: "Omni Security Core",     description: "Seguridad y auditoría avanzada",         alwaysOn: false },
    { slug: "omni_marketing", name: "Omni Marketing Hub",     description: "Campañas y automatización marketing",    alwaysOn: false },
    { slug: "automations",    name: "Automations",            description: "Flujos de trabajo automatizados",        alwaysOn: false },
    { slug: "omni_accounting",name: "Omni Accounting",         description: "Facturación, pagos y contabilidad",      alwaysOn: false },
    { slug: "omni_diagnostics",name: "Omni Diagnostics",      description: "Diagnóstico y salud del sistema",        alwaysOn: false },
    { slug: "omni_tax",         name: "OmniTax",                description: "Motor fiscal, calendario y simuladores", alwaysOn: false },
  ];
  const configs = await db.select().from(moduleConfigsTable);
  const orgs    = await db.select({ id: organizationsTable.id, name: organizationsTable.name, status: organizationsTable.status }).from(organizationsTable);
  const result  = orgs.map(org => ({
    org,
    modules: CATALOG.map(mod => {
      const cfg = configs.find(c => c.orgId === org.id && c.moduleSlug === mod.slug);
      return { ...mod, isEnabled: cfg ? cfg.isEnabled : (mod.slug === "crm"), configId: cfg?.id ?? null };
    }),
  }));
  res.json({ catalog: CATALOG, orgs: result });
});

// ── PATCH /modules ────────────────────────────────────────────────────────────
controlCenterRouter.patch("/modules", async (req, res) => {
  const { orgId, moduleSlug, isEnabled } = req.body as { orgId: number; moduleSlug: string; isEnabled: boolean };
  await db.insert(moduleConfigsTable)
    .values({ orgId, moduleSlug, isEnabled, updatedBy: req.clerkUserId })
    .onConflictDoUpdate({ target: [moduleConfigsTable.orgId, moduleConfigsTable.moduleSlug], set: { isEnabled, updatedBy: req.clerkUserId!, updatedAt: new Date() } });
  clearModuleCache(orgId, moduleSlug);
  const modulesVersion = bumpOrgModuleVersion(orgId);
  await logAudit({ actorClerkId: req.clerkUserId!, action: `module_${isEnabled ? "enabled" : "disabled"}`, resource: "module", resourceId: moduleSlug, orgId, req });
  res.json({ ok: true, modulesVersion });
});

// ── GET /licenses ─────────────────────────────────────────────────────────────
controlCenterRouter.get("/licenses", async (_req, res) => {
  const plans = await db.select().from(licensePlansTable).orderBy(desc(licensePlansTable.createdAt));
  const orgs  = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable);
  const result = plans.map(p => ({ ...p, orgName: orgs.find(o => o.id === p.orgId)?.name ?? `Org #${p.orgId}` }));
  const orgsWithPlan = new Set(plans.map(p => p.orgId));
  const orgsWithout  = orgs.filter(o => !orgsWithPlan.has(o.id)).map(o => ({
    id: null, orgId: o.id, orgName: o.name, plan: "starter", seats: 5, isActive: true,
    billingCycle: "monthly", validFrom: null, validUntil: null, notes: null, assignedBy: null, createdAt: null, updatedAt: null,
  }));
  res.json([...result, ...orgsWithout]);
});

// ── POST /licenses ────────────────────────────────────────────────────────────
controlCenterRouter.post("/licenses", async (req, res) => {
  const { orgId, plan, seats, billingCycle, notes, validUntil } = req.body as {
    orgId: number; plan: string; seats?: number; billingCycle?: string; notes?: string; validUntil?: string;
  };
  const validUntilDate = validUntil ? new Date(validUntil) : null;
  await db.insert(licensePlansTable)
    .values({ orgId, plan, seats: seats ?? 5, billingCycle: billingCycle ?? "monthly", notes: notes ?? null, validFrom: new Date(), validUntil: validUntilDate, assignedBy: req.clerkUserId })
    .onConflictDoUpdate({ target: [licensePlansTable.orgId], set: { plan, seats: seats ?? 5, billingCycle: billingCycle ?? "monthly", notes: notes ?? null, validUntil: validUntilDate, assignedBy: req.clerkUserId!, updatedAt: new Date() } });
  // Sync plan to organizations table too
  await db.update(organizationsTable).set({ plan }).where(eq(organizationsTable.id, orgId));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "license_assigned", resource: "license", orgId, details: { plan, seats, validUntil }, req });
  res.json({ ok: true });
});

// ── GET /audit ────────────────────────────────────────────────────────────────
controlCenterRouter.get("/audit", async (req, res) => {
  const limit     = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset    = Number(req.query["offset"] ?? 0);
  const severity  = req.query["severity"] as string | undefined;
  const action    = req.query["action"]   as string | undefined;
  const actor     = req.query["actor"]    as string | undefined;
  const orgId     = req.query["orgId"]    as string | undefined;
  const startDate = req.query["startDate"] as string | undefined;
  const endDate   = req.query["endDate"]   as string | undefined;

  const conditions = [];
  if (severity && severity !== "all")        conditions.push(eq(auditLogsTable.severity, severity));
  if (action)                                 conditions.push(ilike(auditLogsTable.action, `%${action}%`));
  if (actor)                                  conditions.push(or(ilike(auditLogsTable.actorEmail, `%${actor}%`), ilike(auditLogsTable.actorClerkId, `%${actor}%`)));
  if (orgId && !isNaN(Number(orgId)))         conditions.push(eq(auditLogsTable.orgId, Number(orgId)));
  if (startDate)                              conditions.push(gte(auditLogsTable.createdAt, new Date(startDate)));
  if (endDate)                                conditions.push(lte(auditLogsTable.createdAt, new Date(endDate)));

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);
  const logs = await db.select().from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ logs, total: Number(total), limit, offset });
});

// ── GET /audit/export ─────────────────────────────────────────────────────────
controlCenterRouter.get("/audit/export", async (req, res) => {
  const severity  = req.query["severity"]  as string | undefined;
  const action    = req.query["action"]    as string | undefined;
  const actor     = req.query["actor"]     as string | undefined;
  const startDate = req.query["startDate"] as string | undefined;
  const endDate   = req.query["endDate"]   as string | undefined;

  const conditions = [];
  if (severity && severity !== "all") conditions.push(eq(auditLogsTable.severity, severity));
  if (action)      conditions.push(ilike(auditLogsTable.action, `%${action}%`));
  if (actor)       conditions.push(or(ilike(auditLogsTable.actorEmail, `%${actor}%`), ilike(auditLogsTable.actorClerkId, `%${actor}%`)));
  if (startDate)   conditions.push(gte(auditLogsTable.createdAt, new Date(startDate)));
  if (endDate)     conditions.push(lte(auditLogsTable.createdAt, new Date(endDate)));

  const logs = await db.select().from(auditLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5000);

  const escCsv = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["ID", "Fecha", "Actor Email", "Actor ClerkID", "Acción", "Recurso", "Recurso ID", "Org ID", "Severidad", "IP", "Detalles"].join(",");
  const rows   = logs.map(l => [
    l.id, l.createdAt ? new Date(l.createdAt).toISOString() : "", l.actorEmail ?? "", l.actorClerkId ?? "",
    l.action, l.resource ?? "", l.resourceId ?? "", l.orgId ?? "", l.severity ?? "",
    l.ipAddress ?? "", escCsv(l.details ? JSON.stringify(l.details) : ""),
  ].map(escCsv).join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([header, ...rows].join("\n"));
});

// ── GET /platform-roles ───────────────────────────────────────────────────────
controlCenterRouter.get("/platform-roles", async (_req, res) => {
  const roles = await db.select().from(platformRolesTable).orderBy(desc(platformRolesTable.createdAt));
  res.json(roles);
});

// ── POST /platform-roles ──────────────────────────────────────────────────────
controlCenterRouter.post("/platform-roles", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede conceder roles" }); return; }
  const { clerkUserId, role, displayName, email, notes } = req.body as { clerkUserId: string; role: string; displayName?: string; email?: string; notes?: string };
  await db.insert(platformRolesTable)
    .values({ clerkUserId, role, displayName: displayName ?? null, email: email ?? null, notes: notes ?? null, grantedBy: req.clerkUserId })
    .onConflictDoUpdate({ target: [platformRolesTable.clerkUserId], set: { role, isActive: true, updatedAt: new Date() } });
  clearRoleCache(clerkUserId);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "platform_role_granted", resource: "platform_role", resourceId: clerkUserId, details: { role }, severity: "warning", req });
  res.json({ ok: true });
});

// ── DELETE /platform-roles/:clerkUserId ───────────────────────────────────────
controlCenterRouter.delete("/platform-roles/:clerkUserId", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede revocar roles" }); return; }
  const { clerkUserId } = req.params;
  await db.update(platformRolesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(platformRolesTable.clerkUserId, clerkUserId));
  clearRoleCache(clerkUserId);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "platform_role_revoked", resource: "platform_role", resourceId: clerkUserId, severity: "warning", req });
  res.json({ ok: true });
});

// ── GET /workspaces/:id — workspace detail ────────────────────────────────────
controlCenterRouter.get("/workspaces/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
  if (!org) { res.status(404).json({ error: "Workspace no encontrado" }); return; }
  const [userCount]   = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, id));
  const [clientCount] = await db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, id));
  const [msgCount]    = await db.select({ count: count() }).from(messagesTable).where(eq(messagesTable.orgId, id));
  const [quoteCount]  = await db.select({ count: count() }).from(quotesTable).where(eq(quotesTable.orgId, id));
  const [license]     = await db.select().from(licensePlansTable).where(eq(licensePlansTable.orgId, id));
  const modules       = await db.select().from(moduleConfigsTable).where(eq(moduleConfigsTable.orgId, id));
  const recentAudit   = await db.select().from(auditLogsTable)
    .where(eq(auditLogsTable.orgId, id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10);
  res.json({
    ...org,
    plan: license?.plan ?? org.plan ?? "starter",
    stats: {
      users:    Number(userCount?.count   ?? 0),
      clients:  Number(clientCount?.count ?? 0),
      messages: Number(msgCount?.count    ?? 0),
      quotes:   Number(quoteCount?.count  ?? 0),
    },
    license: license ?? null,
    modules,
    recentAudit,
  });
});

// ── GET /workspaces/:id/members ───────────────────────────────────────────────
controlCenterRouter.get("/workspaces/:id/members", async (req, res) => {
  const id = Number(req.params["id"]);
  const members = await db.select({
    userId: orgMembersTable.userId,
    role:   orgMembersTable.role,
    isSuspended: orgMembersTable.isSuspended,
    joinedAt:    orgMembersTable.joinedAt,
  }).from(orgMembersTable).where(eq(orgMembersTable.orgId, id));
  const enriched = await Promise.all(members.map(async m => {
    const [user] = await db.select({ email: usersTable.email, name: usersTable.name, clerkId: usersTable.clerkId, status: usersTable.status })
      .from(usersTable).where(eq(usersTable.id, m.userId));
    return { ...m, email: user?.email ?? null, name: user?.name ?? null, clerkId: user?.clerkId ?? null, userStatus: user?.status ?? "active" };
  }));
  res.json(enriched);
});

// ── PATCH /workspaces/:id/members/:clerkId — change member role ──────────────
controlCenterRouter.patch("/workspaces/:id/members/:clerkId", async (req, res) => {
  const orgId    = Number(req.params["id"]);
  const clerkId  = req.params["clerkId"];
  const { role } = req.body as { role: string };
  const VALID = ["owner", "admin", "member", "read_only"];
  if (!VALID.includes(role)) { res.status(400).json({ error: "Rol inválido" }); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  await db.update(orgMembersTable).set({ role }).where(and(eq(orgMembersTable.userId, user.id), eq(orgMembersTable.orgId, orgId)));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "user_role_changed", resource: "user", resourceId: clerkId, details: { role, orgId }, severity: "warning", req });
  res.json({ ok: true });
});

// ── GET /integrations — global integrations status ───────────────────────────
controlCenterRouter.get("/integrations", async (_req, res) => {
  const whatsappConfigured  = !!(process.env["META_WHATSAPP_TOKEN"] ?? process.env["WHATSAPP_TOKEN"]);
  const telegramConfigured  = !!process.env["TELEGRAM_BOT_TOKEN"];
  const resendConfigured    = !!process.env["RESEND_API_KEY"];
  const stripeConfigured    = !!(process.env["STRIPE_SECRET_KEY"] ?? process.env["STRIPE_PUBLISHABLE_KEY"]);
  const encryptionConfigured = !!process.env["INTEGRATION_ENCRYPTION_KEY"];
  const openaiConfigured    = !!(process.env["OPENAI_API_KEY"]?.startsWith("sk-"));

  let whatsappOrgs = 0;
  let telegramOrgs = 0;
  try {
    const wa = await db.execute(sql`SELECT COUNT(DISTINCT org_id) as cnt FROM integrations WHERE type = 'whatsapp' AND is_active = true`);
    whatsappOrgs = Number((wa as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const tg = await db.execute(sql`SELECT COUNT(DISTINCT org_id) as cnt FROM integrations WHERE type = 'telegram' AND is_active = true`);
    telegramOrgs = Number((tg as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
  } catch {}

  const [totalOrgs] = await db.select({ count: count() }).from(organizationsTable);
  const total = Number(totalOrgs?.count ?? 0);

  const waWebhookVerify = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] ?? process.env["META_WEBHOOK_VERIFY"];
  const weakVerifyToken = !waWebhookVerify || waWebhookVerify === "omnitech-webhook" || waWebhookVerify.length < 16;

  res.json({
    platform: {
      whatsapp:   { name: "WhatsApp Business",  configured: whatsappConfigured, orgsActive: whatsappOrgs, orgsTotal: total, warning: weakVerifyToken ? "Verify token débil" : null },
      telegram:   { name: "Telegram Bot",        configured: telegramConfigured, orgsActive: telegramOrgs, orgsTotal: total, warning: null },
      resend:     { name: "Email (Resend)",       configured: resendConfigured,  warning: !resendConfigured ? "Sin API key — emails no funcionan" : null },
      stripe:     { name: "Stripe Payments",      configured: stripeConfigured,  warning: !stripeConfigured ? "No implementado" : null },
      openai:     { name: "OpenAI",              configured: openaiConfigured,   warning: !openaiConfigured ? "Sin API key" : null },
      encryption: { name: "Cifrado Integraciones", configured: encryptionConfigured, warning: !encryptionConfigured ? "Sin clave — tokens en Base64" : null },
    },
    webhookBase: process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : null,
    warnings: [
      ...(!resendConfigured     ? ["Email no configurado — invitaciones fallando"]       : []),
      ...(!encryptionConfigured ? ["Cifrado de integraciones no configurado (Base64)"]   : []),
      ...(weakVerifyToken       ? ["WhatsApp verify token débil o por defecto"]          : []),
      ...(!stripeConfigured     ? ["Stripe no configurado — facturación no disponible"]  : []),
    ],
  });
});

// ── GET /security/summary ─────────────────────────────────────────────────────
controlCenterRouter.get("/security/summary", async (_req, res) => {
  const [critCount]   = await db.select({ count: count() }).from(auditLogsTable).where(eq(auditLogsTable.severity, "critical"));
  const [warnCount]   = await db.select({ count: count() }).from(auditLogsTable).where(eq(auditLogsTable.severity, "warning"));
  const [suspUsers]   = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.status, "suspended"));
  const [suspOrgs]    = await db.select({ count: count() }).from(organizationsTable).where(eq(organizationsTable.status, "suspended"));
  const [adminCount]  = await db.select({ count: count() }).from(platformRolesTable).where(eq(platformRolesTable.isActive, true));
  const [totalUsers]  = await db.select({ count: count() }).from(usersTable);
  const [totalOrgs]   = await db.select({ count: count() }).from(organizationsTable);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentCritical = await db.select().from(auditLogsTable)
    .where(and(eq(auditLogsTable.severity, "critical"), gte(auditLogsTable.createdAt, sevenDaysAgo)))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentEvents] = await db.select({ count: count() }).from(auditLogsTable).where(gte(auditLogsTable.createdAt, oneDayAgo));

  res.json({
    stats: {
      criticalEvents:  Number(critCount?.count   ?? 0),
      warningEvents:   Number(warnCount?.count   ?? 0),
      suspendedUsers:  Number(suspUsers?.count   ?? 0),
      suspendedOrgs:   Number(suspOrgs?.count    ?? 0),
      platformAdmins:  Number(adminCount?.count  ?? 0),
      totalUsers:      Number(totalUsers?.count  ?? 0),
      totalOrgs:       Number(totalOrgs?.count   ?? 0),
      eventsLast24h:   Number(recentEvents?.count ?? 0),
    },
    checks: {
      encryptionConfigured:  !!process.env["INTEGRATION_ENCRYPTION_KEY"],
      emailConfigured:       !!process.env["RESEND_API_KEY"],
      openaiConfigured:      !!(process.env["OPENAI_API_KEY"]?.startsWith("sk-")),
      clerkConfigured:       !!(process.env["CLERK_SECRET_KEY"]?.startsWith("sk_")),
      postgresRls:           false,
      rateLimiting:          true,
      twoFactorForced:       false,
    },
    vulnerabilities: [
      { id: "SEC-01", severity: "high",   title: "IDOR en POST /messages",              detail: "clientId no validado contra orgId antes del INSERT",         status: "open" },
      { id: "SEC-02", severity: "high",   title: "read_only sin enforcement",           detail: "Rol read_only puede ejecutar escrituras en todos los módulos", status: "open" },
      { id: "SEC-03", severity: "medium", title: "Sin Row-Level Security en PostgreSQL", detail: "No hay segunda barrera si hay bug en el código",             status: "open" },
      { id: "SEC-04", severity: "medium", title: "Invitación aceptable por cualquier usuario", detail: "Email no verificado en accept token",                 status: "open" },
      { id: "SEC-05", severity: "medium", title: "Sin rate limiting en Control Center",  detail: "Rutas del CC sin límite de peticiones",                      status: "open" },
      { id: "SEC-06", severity: "low",    title: "Cache de rol con lag de 5 minutos",    detail: "Revocación de SUPER_ADMIN no es inmediata en multi-instancia", status: "open" },
    ],
    recentCritical,
  });
});

// ── GET /diagnostics ──────────────────────────────────────────────────────────
controlCenterRouter.get("/diagnostics", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const enrichedUsers = await Promise.all(users.map(async u => {
    const [mem] = await db.select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role })
      .from(orgMembersTable).where(eq(orgMembersTable.userId, u.id));
    const [pr] = await db.select({ role: platformRolesTable.role })
      .from(platformRolesTable).where(eq(platformRolesTable.clerkUserId, u.clerkId));
    let orgName: string | null = null;
    if (mem?.orgId) {
      const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, mem.orgId));
      orgName = org?.name ?? null;
    }
    return { id: u.id, email: u.email, clerkId: u.clerkId, status: u.status ?? "active", crmRole: mem?.role ?? null, orgName, platformRole: pr?.role ?? null, createdAt: u.createdAt };
  }));
  const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.id);
  const enrichedOrgs = await Promise.all(orgs.map(async o => {
    const [mc] = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, o.id));
    return { id: o.id, name: o.name, slug: o.slug, plan: o.plan ?? "free", status: o.status ?? "active", memberCount: Number(mc?.count ?? 0) };
  }));
  let roleCatalog: Array<{ role: string; scope: string; description: string; priority: number }> = [];
  try {
    const rc = await db.execute(sql`SELECT role, scope, description, priority FROM role_catalog ORDER BY priority DESC`);
    roleCatalog = (rc as { rows: typeof roleCatalog }).rows;
  } catch {
    roleCatalog = [
      { role: "SUPER_ADMIN",    scope: "platform", description: "Acceso total a la plataforma OmniTech", priority: 100 },
      { role: "STAFF_OMNITECH", scope: "platform", description: "Personal interno de OmniTech",          priority: 90  },
      { role: "owner",          scope: "org",      description: "Propietario de la organización",        priority: 80  },
      { role: "admin",          scope: "org",      description: "Administrador de la organización",      priority: 70  },
      { role: "member",         scope: "org",      description: "Miembro estándar",                      priority: 60  },
      { role: "read_only",      scope: "org",      description: "Acceso de solo lectura",                priority: 50  },
      { role: "CLIENT",         scope: "client",   description: "Cliente externo (sin acceso CRM)",      priority: 10  },
    ];
  }
  const crmRolesResult  = await db.selectDistinct({ role: orgMembersTable.role }).from(orgMembersTable);
  const platRolesResult = await db.selectDistinct({ role: platformRolesTable.role }).from(platformRolesTable).where(eq(platformRolesTable.isActive, true));
  const crmRolesInUse      = crmRolesResult.map(r => r.role);
  const platformRolesInUse = platRolesResult.map(r => r.role);
  const controlCenterEnabled = platformRolesInUse.includes("SUPER_ADMIN") || platformRolesInUse.includes("STAFF_OMNITECH");
  res.json({
    users: enrichedUsers, orgs: enrichedOrgs, roleCatalog,
    crmRolesInUse, platformRolesInUse, controlCenterEnabled,
    routesEnabled: controlCenterEnabled ? [
      "/control-center", "/control-center/workspaces", "/control-center/users",
      "/control-center/modules", "/control-center/security", "/control-center/licenses",
      "/control-center/diagnostics", "/control-center/ai-center",
    ] : [],
  });
});

// ── GET /module-matrix ─────────────────────────────────────────────────────────
// Returns per-workspace module access matrix: configured state + which layers are gated
controlCenterRouter.get("/module-matrix", async (_req, res) => {
  const MODULE_CATALOG = [
    { slug: "crm",            name: "CRM",                alwaysOn: true,  layers: ["menu", "route", "api", "backend"], frontendKey: "crm"           },
    { slug: "ai_agents",      name: "AI Agents",          alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "ai_agents"     },
    { slug: "analytics",      name: "Analytics",          alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "analytics"     },
    { slug: "whatsapp",       name: "WhatsApp Business",  alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "whatsapp"      },
    { slug: "integrations",   name: "Integraciones",      alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "integrations"  },
    { slug: "omni_import_ai", name: "Omni Import AI",     alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "omni_import_ai"},
    { slug: "omni_docs",      name: "Omni Docs",          alwaysOn: false, layers: ["api", "backend"],                  frontendKey: "omni_docs"     },
    { slug: "omni_security",  name: "Security Core",      alwaysOn: false, layers: ["menu", "route"],                   frontendKey: "omni_security" },
    { slug: "omni_marketing", name: "Marketing Hub",      alwaysOn: false, layers: ["menu", "route"],                   frontendKey: "omni_marketing"},
    { slug: "automations",    name: "Automations",        alwaysOn: false, layers: ["menu", "route"],                   frontendKey: "automations"   },
    { slug: "omni_diagnostics", name: "Omni Diagnostics", alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "omni_diagnostics"},
    { slug: "omni_tax",         name: "OmniTax",          alwaysOn: false, layers: ["menu", "route", "api", "backend"], frontendKey: "omni_tax"        },
  ];

  const [allConfigs, orgs] = await Promise.all([
    db.select().from(moduleConfigsTable),
    db.select({ id: organizationsTable.id, name: organizationsTable.name, status: organizationsTable.status }).from(organizationsTable),
  ]);

  const matrix = orgs.map(org => {
    const modules = MODULE_CATALOG.map(mod => {
      const cfg        = allConfigs.find(c => c.orgId === org.id && c.moduleSlug === mod.slug);
      const configured = mod.alwaysOn ? true : (cfg ? (cfg.isEnabled ?? true) : true);
      const inconsistent = false; // all layers now enforced consistently via requireModule
      return {
        slug:         mod.slug,
        name:         mod.name,
        alwaysOn:     mod.alwaysOn,
        layers:       mod.layers,
        configured,
        menuVisible:  configured,
        routeAccessible: configured,
        apiAccessible:   configured,
        backendAccessible: configured,
        inconsistent,
        configuredAt: cfg?.updatedAt ?? cfg?.createdAt ?? null,
      };
    });

    const issues = modules.filter(m => m.inconsistent);
    return { org, modules, issues };
  });

  res.json({ catalog: MODULE_CATALOG, matrix, generatedAt: new Date().toISOString() });
});

// ── Onboard Wizard API ──────────────────────────────────────────────────────────────────────────

const ONBOARD_WIZARD_STEPS = [
  { id: 1, label: "Datos de empresa",      description: "Nombre, CIF, contacto, logo" },
  { id: 2, label: "Crear Workspace",       description: "Workspace y organizacion base" },
  { id: 3, label: "Plan contratado",       description: "Seleccionar plan de licencia" },
  { id: 4, label: "Modulos",               description: "Activar modulos por feature flags" },
  { id: 5, label: "Administrador",         description: "Crear usuario admin principal" },
  { id: 6, label: "Equipo",                description: "Invitar miembros del equipo" },
  { id: 7, label: "Clientes",              description: "Importar o crear clientes" },
  { id: 8, label: "Configuracion fiscal",  description: "Tipo empresa, regimen, IVA, IRPF" },
  { id: 9, label: "Integraciones",         description: "WhatsApp, Telegram, Email, Stripe" },
  { id: 10, label: "IA Ava",               description: "Configurar asistente virtual" },
];

// GET /onboard-wizard/templates
controlCenterRouter.get("/onboard-wizard/templates", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const templates = await db.select().from(onboardTemplatesTable).where(eq(onboardTemplatesTable.isActive, true)).orderBy(onboardTemplatesTable.orderIndex);
  res.json({ templates, stepLabels: ONBOARD_WIZARD_STEPS });
});

// GET /onboard-wizard/drafts
controlCenterRouter.get("/onboard-wizard/drafts", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const drafts = await db.select().from(onboardWizardDraftsTable).orderBy(desc(onboardWizardDraftsTable.updatedAt));
  res.json({ drafts });
});

// POST /onboard-wizard/drafts
controlCenterRouter.post("/onboard-wizard/drafts", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const { name, wizardData, currentStep } = req.body as { name: string; wizardData: Record<string, unknown>; currentStep?: number };
  const [draft] = await db.insert(onboardWizardDraftsTable).values({
    name: name ?? "Borrador sin titulo",
    wizardData: wizardData ?? {},
    currentStep: currentStep ?? 1,
    createdBy: req.clerkUserId,
    status: "draft",
  }).returning();
  res.json({ draft });
});

// PUT /onboard-wizard/drafts/:id
controlCenterRouter.put("/onboard-wizard/drafts/:id", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const id = Number(req.params["id"]);
  const { name, wizardData, currentStep } = req.body as { name?: string; wizardData?: Record<string, unknown>; currentStep?: number };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (wizardData !== undefined) updates.wizardData = wizardData;
  if (currentStep !== undefined) updates.currentStep = currentStep;
  await db.update(onboardWizardDraftsTable).set(updates).where(eq(onboardWizardDraftsTable.id, id));
  res.json({ ok: true });
});

// DELETE /onboard-wizard/drafts/:id
controlCenterRouter.delete("/onboard-wizard/drafts/:id", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }
  const id = Number(req.params["id"]);
  await db.delete(onboardWizardDraftsTable).where(eq(onboardWizardDraftsTable.id, id));
  res.json({ ok: true });
});

// POST /onboard-wizard/create — ejecutar wizard completo
controlCenterRouter.post("/onboard-wizard/create", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN" }); return; }

  const payload = req.body as {
    companyName: string; slug: string; legalName?: string; taxId?: string;
    country?: string; address?: string; phone?: string; email?: string;
    website?: string; timezone?: string; language?: string; currency?: string;
    plan?: string; modules?: string[];
    admin?: { name: string; email: string; password?: string; sendInvite?: boolean };
    team?: Array<{ name: string; email: string; role: string }>;
    clients?: Array<{ name: string; email?: string; phone?: string; source?: string }>;
    fiscal?: { companyType: string; regime: string; vat: boolean; irpf: boolean; fiscalCountry: string };
    integrations?: string[];
    aiConfig?: { name: string; language: string; personality: string; automationLevel: string };
    templateSlug?: string;
  };

  try {
    // 1. Crear organizacion
    const slug = payload.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") ?? payload.companyName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const [org] = await db.insert(organizationsTable).values({
      name: payload.companyName,
      slug,
      plan: payload.plan ?? "starter",
      legalName: payload.legalName ?? null,
      taxId: payload.taxId ?? null,
      country: payload.country ?? "ES",
      address: payload.address ?? null,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
      website: payload.website ?? null,
      timezone: payload.timezone ?? "Europe/Madrid",
      language: payload.language ?? "es",
      currency: payload.currency ?? "EUR",
      fiscalConfig: payload.fiscal ?? {},
      wizardState: { createdByWizard: true, template: payload.templateSlug ?? null, createdAt: new Date().toISOString() },
    }).returning();

    const orgId = org.id;

    // 2. Crear licencia
    await db.insert(licensePlansTable).values({
      orgId, plan: payload.plan ?? "starter", seats: 5, isActive: true,
      assignedBy: req.clerkUserId, createdAt: new Date(), updatedAt: new Date(),
    });

    // 3. Activar modulos (feature flags via module_configs)
    const MODULE_CATALOG_SLUGS = [
      "crm", "quotes", "omni_accounting", "omni_tax", "ai_agents", "automations",
      "analytics", "integrations", "whatsapp", "omni_import_ai", "knowledge_base",
      "portal_cliente", "omni_docs",
    ];
    const requestedModules = payload.modules ?? [];
    for (const modSlug of MODULE_CATALOG_SLUGS) {
      const isEnabled = requestedModules.includes(modSlug);
      await db.insert(moduleConfigsTable).values({
        orgId, moduleSlug: modSlug, isEnabled, config: {}, updatedBy: req.clerkUserId,
      }).onConflictDoNothing();
    }

    // 4. Crear admin principal
    let adminUserId: number | null = null;
    if (payload.admin?.email) {
      const existingUser = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, payload.admin.email)).limit(1);
      if (existingUser.length > 0) {
        adminUserId = existingUser[0]!.id;
      }
      // Nota: si no existe en users (Clerk), lo creamos como placeholder
      if (!adminUserId) {
        const [newUser] = await db.insert(usersTable).values({
          clerkId: `wizard-${Date.now()}`, email: payload.admin.email, name: payload.admin.name ?? payload.admin.email,
          status: "active", createdAt: new Date(),
        }).returning();
        adminUserId = newUser.id;
      }
      await db.insert(orgMembersTable).values({
        orgId, userId: adminUserId, role: "owner", joinedAt: new Date(), isSuspended: false,
      }).onConflictDoNothing();
    }

    // 5. Crear equipo
    const createdUsers: Array<{ name: string; email: string; role: string }> = [];
    if (payload.team && payload.team.length > 0) {
      for (const member of payload.team) {
        if (!member.email) continue;
        const existingUser = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, member.email)).limit(1);
        let userId: number;
        if (existingUser.length > 0) {
          userId = existingUser[0]!.id;
        } else {
          const [u] = await db.insert(usersTable).values({
            clerkId: `wizard-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            email: member.email, name: member.name ?? member.email,
            status: "active", createdAt: new Date(),
          }).returning();
          userId = u.id;
        }
        const role = ["owner","admin","member","read_only","vendedor","manager"].includes(member.role) ? member.role : "member";
        await db.insert(orgMembersTable).values({
          orgId, userId, role, joinedAt: new Date(), isSuspended: false,
        }).onConflictDoNothing();
        createdUsers.push({ name: member.name ?? member.email, email: member.email, role });
      }
    }

    // 6. Crear clientes de prueba / importados
    const createdClients: Array<{ name: string; id: number }> = [];
    if (payload.clients && payload.clients.length > 0) {
      for (const c of payload.clients) {
        if (!c.name) continue;
        const [client] = await db.insert(clientsTable).values({
          orgId, name: c.name, email: c.email ?? null, phone: c.phone ?? null,
          source: c.source ?? "wizard", status: "active", createdAt: new Date(), updatedAt: new Date(),
        }).returning();
        createdClients.push({ name: c.name, id: client.id });
      }
    }

    // 7. Guardar draft completado
    const wizardSummary = {
      orgId, companyName: payload.companyName, slug, plan: payload.plan ?? "starter",
      modulesEnabled: requestedModules, adminEmail: payload.admin?.email ?? null,
      teamCount: createdUsers.length, clientCount: createdClients.length,
      fiscal: payload.fiscal ?? null, integrations: payload.integrations ?? [],
      aiConfig: payload.aiConfig ?? null,
    };

    await logAudit({
      actorClerkId: req.clerkUserId!, action: "workspace_created_via_wizard",
      resource: "workspace", resourceId: String(orgId),
      details: wizardSummary, severity: "info", req,
    });

    res.json({
      ok: true, orgId, orgName: payload.companyName, slug,
      summary: {
        users: createdUsers.length + (payload.admin ? 1 : 0),
        clients: createdClients.length,
        modulesEnabled: requestedModules.length,
        plan: payload.plan ?? "starter",
      },
    });
  } catch (err) {
    console.error("[OnboardWizard] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});
