/**
 * Permission Registry & Granular RBAC Middleware
 *
 * Provides fine-grained permission checking on top of the existing
 * role-based middleware. Permissions are scoped per-workspace (orgId).
 *
 * Usage:
 *   router.post("/", requireAuth, resolveOrg, requirePermission("crm.write"), handler);
 *   router.get("/", requireAuth, resolveOrg, requirePermission("crm.read"), handler);
 *
 * Role-to-permission mapping (additive):
 *   - owner:       all permissions
 *   - admin:       all except super_admin actions
 *   - member:      read + limited write on assigned modules
 *   - read_only:   read only on assigned modules
 *   - vendedor:    crm.read, crm.write (own clients), quotes.*
 *   - cliente:     portal.read only
 *
 * Support Mode:
 *   - When req.supportSession is set (SuperAdmin in client workspace),
 *     permissions are derived from the session's assignedRole.
 */

import { type Request, type Response, type NextFunction } from "express";

// ── Permission definitions ───────────────────────────────────────────────────

export type Permission =
  // Workspace
  | "workspace.view"
  | "workspace.edit"
  | "workspace.manage"
  | "workspace.delete"
  // CRM
  | "crm.read"
  | "crm.write"
  | "crm.delete"
  | "crm.assign"
  // Quotes / Presupuestos
  | "quotes.read"
  | "quotes.write"
  | "quotes.delete"
  | "quotes.approve"
  // Accounting
  | "accounting.read"
  | "accounting.write"
  | "accounting.delete"
  | "accounting.approve"
  // Tax / OmniTax
  | "tax.read"
  | "tax.write"
  | "tax.delete"
  | "tax.gestoria"
  | "tax.admin"
  // Calendar / Appointments
  | "calendar.read"
  | "calendar.write"
  | "calendar.delete"
  // Communications
  | "messages.read"
  | "messages.write"
  | "whatsapp.read"
  | "whatsapp.write"
  | "telegram.read"
  | "telegram.write"
  // AI / Memory
  | "ai.read"
  | "ai.write"
  | "memory.read"
  | "memory.write"
  // Automations / Autopilot
  | "automations.read"
  | "automations.write"
  // Integrations
  | "integrations.read"
  | "integrations.write"
  // Analytics / Executive / Diagnostics
  | "analytics.read"
  | "executive.read"
  | "diagnostics.read"
  // Settings
  | "settings.read"
  | "settings.write"
  // Users / Members
  | "users.read"
  | "users.write"
  | "users.invite"
  | "users.manage_roles"
  // Portal
  | "portal.read"
  | "portal.write"
  // Super Admin actions
  | "super_admin.view"
  | "super_admin.manage"
  | "support.enter_workspace";

// ── Role-to-permissions mapping (workspace-scoped) ───────────────────────────

const PERMISSIONS_BY_ROLE: Record<string, Permission[]> = {
  owner: [
    "workspace.view", "workspace.edit", "workspace.manage", "workspace.delete",
    "crm.read", "crm.write", "crm.delete", "crm.assign",
    "quotes.read", "quotes.write", "quotes.delete", "quotes.approve",
    "accounting.read", "accounting.write", "accounting.delete", "accounting.approve",
    "tax.read", "tax.write", "tax.delete", "tax.gestoria", "tax.admin",
    "calendar.read", "calendar.write", "calendar.delete",
    "messages.read", "messages.write",
    "whatsapp.read", "whatsapp.write",
    "telegram.read", "telegram.write",
    "ai.read", "ai.write", "memory.read", "memory.write",
    "automations.read", "automations.write",
    "integrations.read", "integrations.write",
    "analytics.read", "executive.read", "diagnostics.read",
    "settings.read", "settings.write",
    "users.read", "users.write", "users.invite", "users.manage_roles",
    "portal.read", "portal.write",
  ],
  admin: [
    "workspace.view", "workspace.edit", "workspace.manage",
    "crm.read", "crm.write", "crm.delete", "crm.assign",
    "quotes.read", "quotes.write", "quotes.delete", "quotes.approve",
    "accounting.read", "accounting.write", "accounting.delete",
    "calendar.read", "calendar.write", "calendar.delete",
    "messages.read", "messages.write",
    "whatsapp.read", "whatsapp.write",
    "telegram.read", "telegram.write",
    "ai.read", "ai.write", "memory.read", "memory.write",
    "automations.read", "automations.write",
    "integrations.read", "integrations.write",
    "analytics.read", "executive.read", "diagnostics.read",
    "settings.read", "settings.write",
    "users.read", "users.write", "users.invite", "users.manage_roles",
    "portal.read", "portal.write",
  ],
  // MANAGER: like admin but cannot invite users or delete accounting records
  manager: [
    "workspace.view", "workspace.edit", "workspace.manage",
    "crm.read", "crm.write", "crm.delete", "crm.assign",
    "quotes.read", "quotes.write", "quotes.delete", "quotes.approve",
    "accounting.read", "accounting.write",
    "calendar.read", "calendar.write", "calendar.delete",
    "messages.read", "messages.write",
    "whatsapp.read", "whatsapp.write",
    "telegram.read", "telegram.write",
    "ai.read", "ai.write", "memory.read", "memory.write",
    "automations.read", "automations.write",
    "integrations.read",
    "analytics.read", "executive.read",
    "settings.read",
    "users.read",
    "portal.read",
  ],
  member: [
    "workspace.view",
    "crm.read", "crm.write",
    "quotes.read", "quotes.write",
    "accounting.read",
    "calendar.read", "calendar.write",
    "messages.read", "messages.write",
    "whatsapp.read", "whatsapp.write",
    "telegram.read", "telegram.write",
    "ai.read", "ai.write", "memory.read", "memory.write",
    "automations.read", "automations.write",
    "integrations.read",
    "analytics.read",
    "settings.read",
    "users.read",
    "portal.read", "portal.write",
  ],
  vendedor: [
    "workspace.view",
    "crm.read", "crm.write",
    "quotes.read", "quotes.write", "quotes.delete",
    "calendar.read", "calendar.write",
    "messages.read", "messages.write",
    "whatsapp.read", "whatsapp.write",
    "telegram.read", "telegram.write",
    "ai.read", "memory.read",
    "automations.read",
    "analytics.read",
    "settings.read",
    "portal.read",
  ],
  read_only: [
    "workspace.view",
    "crm.read",
    "quotes.read",
    "accounting.read",
    "calendar.read",
    "messages.read",
    "whatsapp.read",
    "telegram.read",
    "ai.read", "memory.read",
    "automations.read",
    "integrations.read",
    "analytics.read",
    "settings.read",
    "users.read",
    "portal.read",
  ],
  cliente: [
    "portal.read",
  ],
  // CLIENT: client portal read access only
  client: [
    "portal.read",
  ],
  // GUEST: workspace view only
  guest: [
    "workspace.view",
  ],
};

// ── Extend Express Request type ──────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      /** Current effective workspace role used for permission checks */
      effectiveRole?: string;
      /** True when this request is a support session (SuperAdmin in client workspace) */
      supportSession?: {
        /** The admin who initiated the support session */
        adminClerkId: string;
        /** The workspace being supervised */
        orgId: number;
        /** Role assigned within the workspace for this session */
        assignedRole: string;
        /** ISO timestamp of when the session started */
        startedAt: string;
      };
      /** Set of permissions for the current request */
      permissions?: Set<Permission>;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getPermissionsForRole(role: string): Set<Permission> {
  const perms = PERMISSIONS_BY_ROLE[role] ?? [];
  return new Set(perms);
}

/**
 * Check if the request's effective role has the given permission.
 * SuperAdmin always has all permissions (except when explicitly denied).
 */
export function hasPermission(req: Request, perm: Permission): boolean {
  // Support mode: derive permissions from the assigned role for this session
  if (req.supportSession) {
    const supportPerms = getPermissionsForRole(req.supportSession.assignedRole);
    return supportPerms.has(perm);
  }

  // SuperAdmin bypass (full access)
  if (req.isSuperAdmin) return true;

  // Normal workspace role
  const role = req.effectiveRole ?? req.orgRole;
  if (!role) return false;

  const perms = getPermissionsForRole(role);
  return perms.has(perm);
}

// ── Middleware factory ───────────────────────────────────────────────────────

export function requirePermission(...required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Must have org context first
    if (!req.orgId && !req.supportSession) {
      const ctx = {
        user:     req.clerkUserId ?? "unknown",
        role:     req.effectiveRole ?? req.orgRole ?? "none",
        orgId:    null,
        endpoint: `${req.method} ${req.originalUrl}`,
        reason:   "No hay contexto de organización (x-active-workspace no enviado o membresía no encontrada)",
      };
      console.warn(`[Permission] DENIED — no_org_context | ${JSON.stringify(ctx)}`);
      res.status(403).json({ error: "no_org_context", ...ctx });
      return;
    }

    const role = req.effectiveRole ?? req.orgRole ?? "none";

    for (const perm of required) {
      if (!hasPermission(req, perm)) {
        const ctx = {
          user:       req.clerkUserId ?? "unknown",
          role,
          orgId:      req.orgId ?? null,
          endpoint:   `${req.method} ${req.originalUrl}`,
          permission: perm,
          reason:     `El rol "${role}" no tiene el permiso "${perm}"`,
        };
        console.warn(`[Permission] DENIED — permission_denied | ${JSON.stringify(ctx)}`);
        res.status(403).json({
          error:   "permission_denied",
          message: `No tienes permiso para realizar esta acción (${perm}). Contacta con tu administrador.`,
          ...ctx,
        });
        return;
      }
    }

    next();
  };
}

// ── Optional permission check (doesn't block, sets req.permissions) ─────────

export function resolvePermissions(req: Request, _res: Response, next: NextFunction) {
  const role = req.effectiveRole ?? req.orgRole;
  if (role) {
    req.permissions = getPermissionsForRole(role);
  }
  next();
}

// ── Support mode helpers ───────────────────────────────────────────────────────

/**
 * Mark the request as a support session. Call this AFTER resolveOrg
 * when a SuperAdmin uses x-ws-override or enters a client workspace
 * via the support mode endpoint.
 */
export function enterSupportMode(
  req: Request,
  adminClerkId: string,
  orgId: number,
  assignedRole: string = "admin",
) {
  req.supportSession = {
    adminClerkId,
    orgId,
    assignedRole,
    startedAt: new Date().toISOString(),
  };
  req.effectiveRole = assignedRole;
}

/**
 * Log support mode entry into the audit system (called by routes that
 * enable support mode).
 */
export function getSupportSessionInfo(req: Request): {
  isSupport: boolean;
  adminClerkId?: string;
  assignedRole?: string;
  startedAt?: string;
} {
  const s = req.supportSession;
  if (!s) return { isSupport: false };
  return {
    isSupport: true,
    adminClerkId: s.adminClerkId,
    assignedRole: s.assignedRole,
    startedAt: s.startedAt,
  };
}
