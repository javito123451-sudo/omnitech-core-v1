import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { platformRolesTable, moduleConfigsTable, licensePlansTable, auditLogsTable } from "@workspace/db";
import { organizationsTable, usersTable, orgMembersTable, clientsTable, messagesTable, quotesTable } from "@workspace/db";
import { eq, desc, count, and, sql } from "drizzle-orm";
import { requireSuperAdmin, hasPlatformRole, clearRoleCache } from "../middlewares/superAdmin";
import { aiCenterRouter } from "./ai-center-routes";

export const controlCenterRouter = Router();

// Mount AI Center sub-router
controlCenterRouter.use("/ai-center", aiCenterRouter);

// ── Helper: log audit event ───────────────────────────────────────────────────
async function logAudit(params: {
  actorClerkId: string;
  actorEmail?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  orgId?: number;
  details?: Record<string, unknown>;
  severity?: string;
  req: import("express").Request;
}) {
  await db.insert(auditLogsTable).values({
    actorClerkId: params.actorClerkId,
    actorEmail:   params.actorEmail ?? null,
    action:       params.action,
    resource:     params.resource ?? null,
    resourceId:   params.resourceId ? String(params.resourceId) : null,
    orgId:        params.orgId ?? null,
    ipAddress:    params.req.ip ?? null,
    userAgent:    params.req.headers["user-agent"] ?? null,
    details:      params.details ?? null,
    severity:     params.severity ?? "info",
  }).catch(() => {});
}

// ── GET /check — public (no super admin required, just auth) ──────────────────
controlCenterRouter.get("/check", async (req, res) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) { res.json({ isSuperAdmin: false, role: null }); return; }
  const role = await hasPlatformRole(clerkUserId);
  res.json({
    isSuperAdmin: role === "SUPER_ADMIN",
    role,
  });
});

// All routes below require SUPER_ADMIN or STAFF_OMNITECH
controlCenterRouter.use(requireSuperAdmin);

// ── GET /metrics — global platform metrics ─────────────────────────────────────
controlCenterRouter.get("/metrics", async (req, res) => {
  const [orgs]     = await db.select({ count: count() }).from(organizationsTable);
  const [users]    = await db.select({ count: count() }).from(usersTable);
  const [clients]  = await db.select({ count: count() }).from(clientsTable);
  const [messages] = await db.select({ count: count() }).from(messagesTable);
  const [quotes]   = await db.select({ count: count() }).from(quotesTable);
  const [admins]   = await db.select({ count: count() }).from(platformRolesTable).where(eq(platformRolesTable.isActive, true));

  res.json({
    workspaces:     Number(orgs?.count    ?? 0),
    users:          Number(users?.count   ?? 0),
    clients:        Number(clients?.count ?? 0),
    messages:       Number(messages?.count ?? 0),
    quotes:         Number(quotes?.count  ?? 0),
    superAdmins:    Number(admins?.count  ?? 0),
    // Simulated metrics (for future modules)
    aiAgents:       3,
    automations:    12,
    storageUsedMb:  Math.round(Number(messages?.count ?? 0) * 0.5 + Number(clients?.count ?? 0) * 0.2),
    systemStatus:   "operational",
  });
});

// ── GET /workspaces — list all workspaces ─────────────────────────────────────
controlCenterRouter.get("/workspaces", async (req, res) => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt));

  const enriched = await Promise.all(orgs.map(async (org) => {
    const [userCount]   = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, org.id));
    const [clientCount] = await db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, org.id));
    const [license]     = await db.select().from(licensePlansTable).where(eq(licensePlansTable.orgId, org.id));
    return {
      id:          org.id,
      name:        org.name,
      slug:        org.slug,
      plan:        license?.plan ?? org.plan ?? "starter",
      status:      "active",
      users:       Number(userCount?.count ?? 0),
      clients:     Number(clientCount?.count ?? 0),
      createdAt:   org.createdAt,
    };
  }));

  res.json(enriched);
});

// ── POST /workspaces — create workspace ───────────────────────────────────────
controlCenterRouter.post("/workspaces", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  const [org] = await db.insert(organizationsTable).values({ name: name.trim(), slug }).returning();
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_created", resource: "workspace", resourceId: String(org.id), details: { name }, req });
  res.json(org);
});

// ── PATCH /workspaces/:id — update workspace ──────────────────────────────────
controlCenterRouter.patch("/workspaces/:id", async (req, res) => {
  const id   = Number(req.params.id);
  const { name, status } = req.body as { name?: string; status?: string };
  const updates: Record<string, unknown> = {};
  if (name)   updates.name = name;
  await db.update(organizationsTable).set(updates).where(eq(organizationsTable.id, id));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_updated", resource: "workspace", resourceId: String(id), details: { name, status }, req });
  res.json({ ok: true });
});

// ── DELETE /workspaces/:id — delete workspace ─────────────────────────────────
controlCenterRouter.delete("/workspaces/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "workspace_deleted", resource: "workspace", resourceId: String(id), severity: "warning", req });
  res.json({ ok: true });
});

// ── GET /users — list all platform users ──────────────────────────────────────
controlCenterRouter.get("/users", async (req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  const enriched = await Promise.all(users.map(async (u) => {
    const [mem] = await db.select({ orgId: orgMembersTable.orgId, role: orgMembersTable.role })
      .from(orgMembersTable).where(eq(orgMembersTable.userId, u.id));
    const [platformRole] = await db.select({ role: platformRolesTable.role })
      .from(platformRolesTable).where(eq(platformRolesTable.clerkUserId, u.clerkId));
    let orgName: string | null = null;
    if (mem?.orgId) {
      const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, mem.orgId));
      orgName = org?.name ?? null;
    }
    return {
      id:           u.id,
      clerkId:      u.clerkId,
      email:        u.email,
      orgId:        mem?.orgId ?? null,
      orgName,
      orgRole:      mem?.role ?? null,
      platformRole: platformRole?.role ?? null,
      status:       "active",
      createdAt:    u.createdAt,
    };
  }));
  res.json(enriched);
});

// ── GET /modules — list module configs ───────────────────────────────────────
controlCenterRouter.get("/modules", async (req, res) => {
  const CATALOG = [
    { slug: "crm",                 name: "CRM",                   description: "Gestión de clientes y relaciones" },
    { slug: "whatsapp",            name: "WhatsApp Business",      description: "Mensajería y automatizaciones" },
    { slug: "omni_import_ai",      name: "Omni Import AI",         description: "Importación inteligente de datos" },
    { slug: "omni_docs",           name: "Omni Docs",              description: "Gestión documental" },
    { slug: "omni_security",       name: "Omni Security Core",     description: "Seguridad y auditoría avanzada" },
    { slug: "omni_marketing",      name: "Omni Marketing Hub",     description: "Campañas y automatización marketing" },
    { slug: "analytics",           name: "Analytics",              description: "Análisis avanzado de datos" },
    { slug: "automations",         name: "Automations",            description: "Flujos de trabajo automatizados" },
    { slug: "ai_agents",           name: "AI Agents",              description: "Agentes de IA personalizados" },
  ];

  const configs = await db.select().from(moduleConfigsTable);

  const orgs = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable);

  const result = orgs.map(org => ({
    org,
    modules: CATALOG.map(mod => {
      const cfg = configs.find(c => c.orgId === org.id && c.moduleSlug === mod.slug);
      return { ...mod, isEnabled: cfg ? cfg.isEnabled : (mod.slug === "crm"), configId: cfg?.id ?? null };
    }),
  }));

  res.json({ catalog: CATALOG, orgs: result });
});

// ── PATCH /modules — toggle module for org ────────────────────────────────────
controlCenterRouter.patch("/modules", async (req, res) => {
  const { orgId, moduleSlug, isEnabled } = req.body as { orgId: number; moduleSlug: string; isEnabled: boolean };
  await db.insert(moduleConfigsTable)
    .values({ orgId, moduleSlug, isEnabled, updatedBy: req.clerkUserId })
    .onConflictDoUpdate({ target: [moduleConfigsTable.orgId, moduleConfigsTable.moduleSlug], set: { isEnabled, updatedBy: req.clerkUserId!, updatedAt: new Date() } });
  await logAudit({ actorClerkId: req.clerkUserId!, action: `module_${isEnabled ? "enabled" : "disabled"}`, resource: "module", resourceId: moduleSlug, orgId, req });
  res.json({ ok: true });
});

// ── GET /licenses — list all license plans ────────────────────────────────────
controlCenterRouter.get("/licenses", async (req, res) => {
  const plans = await db.select().from(licensePlansTable).orderBy(desc(licensePlansTable.createdAt));
  const orgs  = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable);
  const result = plans.map(p => ({
    ...p,
    orgName: orgs.find(o => o.id === p.orgId)?.name ?? `Org #${p.orgId}`,
  }));
  // Add orgs without a license plan
  const orgsWithPlan = new Set(plans.map(p => p.orgId));
  const orgsWithout = orgs.filter(o => !orgsWithPlan.has(o.id)).map(o => ({
    id: null, orgId: o.id, orgName: o.name, plan: "starter", seats: 5, isActive: true,
    billingCycle: "monthly", validFrom: null, validUntil: null, notes: null, assignedBy: null, createdAt: null,
  }));
  res.json([...result, ...orgsWithout]);
});

// ── POST /licenses — assign license ──────────────────────────────────────────
controlCenterRouter.post("/licenses", async (req, res) => {
  const { orgId, plan, seats, billingCycle, notes } = req.body as { orgId: number; plan: string; seats?: number; billingCycle?: string; notes?: string };
  await db.insert(licensePlansTable)
    .values({ orgId, plan, seats: seats ?? 5, billingCycle: billingCycle ?? "monthly", notes: notes ?? null, assignedBy: req.clerkUserId })
    .onConflictDoUpdate({ target: [licensePlansTable.orgId], set: { plan, seats: seats ?? 5, billingCycle: billingCycle ?? "monthly", notes: notes ?? null, assignedBy: req.clerkUserId!, updatedAt: new Date() } });
  await logAudit({ actorClerkId: req.clerkUserId!, action: "license_assigned", resource: "license", orgId, details: { plan, seats }, req });
  res.json({ ok: true });
});

// ── GET /audit — audit logs ───────────────────────────────────────────────────
controlCenterRouter.get("/audit", async (req, res) => {
  const logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(200);
  res.json(logs);
});

// ── GET /platform-roles — list super admins ───────────────────────────────────
controlCenterRouter.get("/platform-roles", async (req, res) => {
  const roles = await db.select().from(platformRolesTable).orderBy(desc(platformRolesTable.createdAt));
  res.json(roles);
});

// ── POST /platform-roles — grant role ────────────────────────────────────────
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

// ── DELETE /platform-roles/:clerkUserId — revoke role ────────────────────────
controlCenterRouter.delete("/platform-roles/:clerkUserId", async (req, res) => {
  if (!req.isSuperAdmin) { res.status(403).json({ error: "Solo SUPER_ADMIN puede revocar roles" }); return; }
  const { clerkUserId } = req.params;
  await db.update(platformRolesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(platformRolesTable.clerkUserId, clerkUserId));
  clearRoleCache(clerkUserId);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "platform_role_revoked", resource: "platform_role", resourceId: clerkUserId, severity: "warning", req });
  res.json({ ok: true });
});

// ── GET /diagnostics — full role system audit ─────────────────────────────────
controlCenterRouter.get("/diagnostics", async (req, res) => {
  // All users with their CRM role and platform role
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
    return {
      id: u.id, email: u.email, clerkId: u.clerkId,
      crmRole: mem?.role ?? null, orgName,
      platformRole: pr?.role ?? null,
      createdAt: u.createdAt,
    };
  }));

  // Organizations with member counts
  const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.id);
  const enrichedOrgs = await Promise.all(orgs.map(async o => {
    const [mc] = await db.select({ count: count() }).from(orgMembersTable).where(eq(orgMembersTable.orgId, o.id));
    return { id: o.id, name: o.name, slug: o.slug, plan: o.plan ?? "free", memberCount: Number(mc?.count ?? 0) };
  }));

  // Role catalog from DB
  let roleCatalog: Array<{ role: string; scope: string; description: string; priority: number }> = [];
  try {
    const rc = await db.execute(sql`SELECT role, scope, description, priority FROM role_catalog ORDER BY priority DESC`);
    roleCatalog = (rc as { rows: typeof roleCatalog }).rows;
  } catch {
    // Fallback if table doesn't exist yet
    roleCatalog = [
      { role: "SUPER_ADMIN",   scope: "platform", description: "Acceso total a la plataforma OmniTech", priority: 100 },
      { role: "STAFF_OMNITECH",scope: "platform", description: "Personal interno de OmniTech",          priority: 90  },
      { role: "owner",         scope: "org",      description: "Propietario de la organización",        priority: 80  },
      { role: "admin",         scope: "org",      description: "Administrador de la organización",      priority: 70  },
      { role: "member",        scope: "org",      description: "Miembro estándar",                      priority: 60  },
      { role: "read_only",     scope: "org",      description: "Acceso de solo lectura",                priority: 50  },
      { role: "CLIENT",        scope: "client",   description: "Cliente externo (sin acceso CRM)",      priority: 10  },
    ];
  }

  // Distinct roles in use
  const crmRolesResult = await db.selectDistinct({ role: orgMembersTable.role }).from(orgMembersTable);
  const platRolesResult = await db.selectDistinct({ role: platformRolesTable.role })
    .from(platformRolesTable).where(eq(platformRolesTable.isActive, true));

  const crmRolesInUse      = crmRolesResult.map(r => r.role);
  const platformRolesInUse = platRolesResult.map(r => r.role);

  const controlCenterEnabled = platformRolesInUse.includes("SUPER_ADMIN") || platformRolesInUse.includes("STAFF_OMNITECH");

  res.json({
    users: enrichedUsers,
    orgs: enrichedOrgs,
    roleCatalog,
    crmRolesInUse,
    platformRolesInUse,
    controlCenterEnabled,
    routesEnabled: controlCenterEnabled ? [
      "/control-center",
      "/control-center/workspaces",
      "/control-center/users",
      "/control-center/modules",
      "/control-center/security",
      "/control-center/licenses",
      "/control-center/diagnostics",
    ] : [],
  });
});
