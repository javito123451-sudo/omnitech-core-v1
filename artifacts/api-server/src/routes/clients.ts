import { Router } from "express";
import { db, clientsTable, activityTable, organizationsTable, autopilotTasksTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  ListClientsQueryParams,
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
} from "@workspace/api-zod";
import { logAudit } from "../utils/auditLogger";
import { requirePermission } from "../middlewares/permissions";

export const clientsRouter = Router();

// ── Ficha comercial ampliada ──────────────────────────────────────────────
// Estos campos ya están documentados en lib/api-spec/openapi.yaml (Client/
// ClientInput/ClientUpdate) pero el codegen de orval (lib/api-zod) no se ha
// podido regenerar en este entorno (sin Node/pnpm disponible aquí). En vez de
// usar `.extend()` con la librería `zod` (que este paquete NO tiene como
// dependencia directa — solo vía @workspace/api-zod, y esbuild no la resuelve
// en el build de Render), se parsean estos campos a mano. Cuando se corra
// `pnpm --filter @workspace/api-spec run codegen` en un entorno con Node,
// este bloque deja de ser necesario y CreateClientBody/UpdateClientBody ya
// traerán estos campos de fábrica.
const PRIORITY_VALUES = new Set(["low", "medium", "high", "urgent"]);

interface CommercialFields {
  commercialStatus?: string;
  sector?: string;
  contactPerson?: string;
  companyPhone?: string;
  companyEmail?: string;
  instagram?: string;
  website?: string;
  location?: string;
  firstContactAt?: string;
  dolorPrincipal?: string;
  recursoEnviado?: string;
  fuenteLead?: string;
  followup1At?: string;
  followup2At?: string;
  followup3At?: string;
  nextFollowupAt?: string;
  lastContactAt?: string;
  attemptCount?: number;
  preferredChannel?: string;
  resultado?: string;
  nextAction?: string;
  priority?: string;
  observaciones?: string;
}

function parseCommercialFields(body: unknown): CommercialFields {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const priority = str(b["priority"]);
  return {
    commercialStatus: str(b["commercialStatus"]),
    sector: str(b["sector"]),
    contactPerson: str(b["contactPerson"]),
    companyPhone: str(b["companyPhone"]),
    companyEmail: str(b["companyEmail"]),
    instagram: str(b["instagram"]),
    website: str(b["website"]),
    location: str(b["location"]),
    firstContactAt: str(b["firstContactAt"]),
    dolorPrincipal: str(b["dolorPrincipal"]),
    recursoEnviado: str(b["recursoEnviado"]),
    fuenteLead: str(b["fuenteLead"]),
    followup1At: str(b["followup1At"]),
    followup2At: str(b["followup2At"]),
    followup3At: str(b["followup3At"]),
    nextFollowupAt: str(b["nextFollowupAt"]),
    lastContactAt: str(b["lastContactAt"]),
    attemptCount: num(b["attemptCount"]),
    preferredChannel: str(b["preferredChannel"]),
    resultado: str(b["resultado"]),
    nextAction: str(b["nextAction"]),
    priority: priority && PRIORITY_VALUES.has(priority) ? priority : undefined,
    observaciones: str(b["observaciones"]),
  };
}

interface CommercialListFilters {
  commercialStatus?: string;
  sector?: string;
  priority?: string;
  autopilotActive?: boolean;
  hasFollowupPending?: boolean;
}

function parseCommercialListFilters(query: unknown): CommercialListFilters {
  const q = (query ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  // NOTA: no usar coerción tipo Boolean(str) — "false" es truthy en JS.
  const bool = (v: unknown): boolean | undefined =>
    v === "true" ? true : v === "false" ? false : undefined;
  return {
    commercialStatus: str(q["commercialStatus"]),
    sector: str(q["sector"]),
    priority: str(q["priority"]),
    autopilotActive: bool(q["autopilotActive"]),
    hasFollowupPending: bool(q["hasFollowupPending"]),
  };
}

function toDateOrUndefined(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

clientsRouter.get("/", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const query = ListClientsQueryParams.parse(req.query);
    const filters = parseCommercialListFilters(req.query);
    let rows = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId))
      .orderBy(desc(clientsTable.createdAt));

    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(s) ||
          r.email.toLowerCase().includes(s) ||
          (r.company ?? "").toLowerCase().includes(s)
      );
    }
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }
    if (filters.commercialStatus) {
      rows = rows.filter((r) => r.commercialStatus === filters.commercialStatus);
    }
    if (filters.sector) {
      rows = rows.filter((r) => (r.sector ?? "").toLowerCase() === filters.sector!.toLowerCase());
    }
    if (filters.priority) {
      rows = rows.filter((r) => r.priority === filters.priority);
    }
    if (filters.hasFollowupPending) {
      const now = new Date();
      rows = rows.filter((r) => r.nextFollowupAt != null && r.nextFollowupAt <= now);
    }
    if (filters.autopilotActive !== undefined) {
      const activeClientIds = new Set(
        (
          await db
            .select({ clientId: autopilotTasksTable.clientId })
            .from(autopilotTasksTable)
            .where(and(
              eq(autopilotTasksTable.orgId, orgId),
              eq(autopilotTasksTable.enabled, true),
              isNull(autopilotTasksTable.pausedReason),
            ))
        ).map((t) => t.clientId),
      );
      rows = rows.filter((r) => activeClientIds.has(r.id) === filters.autopilotActive);
    }

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.post("/", requirePermission("crm.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const body = CreateClientBody.parse(req.body);
    const commercial = parseCommercialFields(req.body);
    const [client] = await db
      .insert(clientsTable)
      .values({
        orgId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        company: body.company ?? null,
        status: body.status ?? "lead",
        tags: body.tags ?? null,
        notes: body.notes ?? null,
        value: body.value ?? null,
        commercialStatus: commercial.commercialStatus ?? null,
        sector: commercial.sector ?? null,
        contactPerson: commercial.contactPerson ?? null,
        companyPhone: commercial.companyPhone ?? null,
        companyEmail: commercial.companyEmail ?? null,
        instagram: commercial.instagram ?? null,
        website: commercial.website ?? null,
        location: commercial.location ?? null,
        firstContactAt: toDateOrUndefined(commercial.firstContactAt) ?? null,
        dolorPrincipal: commercial.dolorPrincipal ?? null,
        recursoEnviado: commercial.recursoEnviado ?? null,
        fuenteLead: commercial.fuenteLead ?? null,
        preferredChannel: commercial.preferredChannel ?? null,
        resultado: commercial.resultado ?? null,
        nextAction: commercial.nextAction ?? null,
        priority: commercial.priority ?? "medium",
        observaciones: commercial.observaciones ?? null,
      })
      .returning();

    await db.insert(activityTable).values({
      orgId,
      type: "client_added",
      description: `New client ${client.name} was added`,
      clientName: client.name,
      userId: req.userId,
    });

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:    "client_created",
      resource:  "client",
      resourceId: String(client.id),
      orgId,
      details: { name: client.name, email: client.email, company: client.company, status: client.status },
      severity: "info",
      result:   "success",
      req,
    });

    res.status(201).json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.get("/:id", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = GetClientParams.parse({ id: Number(req.params.id) });
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));
    if (!client) return res.status(404).json({ error: "Not found" });
    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// GET /:id/activity — feed de actividad de este cliente (incluye eventos de
// Autopilot). Filas escritas antes de que existiera activity.client_id
// (ver FIX-AX) no aparecen aquí — solo en el feed org-wide de /stats/activity.
clientsRouter.get("/:id/activity", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = GetClientParams.parse({ id: Number(req.params.id) });

    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));
    if (!client) return res.status(404).json({ error: "Not found" });

    const rows = await db
      .select({
        id: activityTable.id,
        type: activityTable.type,
        description: activityTable.description,
        createdAt: activityTable.createdAt,
      })
      .from(activityTable)
      .where(and(eq(activityTable.clientId, id), eq(activityTable.orgId, orgId)))
      .orderBy(desc(activityTable.createdAt))
      .limit(50);

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.patch("/:id", requirePermission("crm.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = UpdateClientParams.parse({ id: Number(req.params.id) });
    const body = UpdateClientBody.parse(req.body);
    const commercial = parseCommercialFields(req.body);
    const [client] = await db
      .update(clientsTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.company !== undefined && { company: body.company }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.value !== undefined && { value: body.value }),
        ...(commercial.commercialStatus !== undefined && { commercialStatus: commercial.commercialStatus }),
        ...(commercial.sector !== undefined && { sector: commercial.sector }),
        ...(commercial.contactPerson !== undefined && { contactPerson: commercial.contactPerson }),
        ...(commercial.companyPhone !== undefined && { companyPhone: commercial.companyPhone }),
        ...(commercial.companyEmail !== undefined && { companyEmail: commercial.companyEmail }),
        ...(commercial.instagram !== undefined && { instagram: commercial.instagram }),
        ...(commercial.website !== undefined && { website: commercial.website }),
        ...(commercial.location !== undefined && { location: commercial.location }),
        ...(commercial.firstContactAt !== undefined && { firstContactAt: toDateOrUndefined(commercial.firstContactAt) }),
        ...(commercial.dolorPrincipal !== undefined && { dolorPrincipal: commercial.dolorPrincipal }),
        ...(commercial.recursoEnviado !== undefined && { recursoEnviado: commercial.recursoEnviado }),
        ...(commercial.fuenteLead !== undefined && { fuenteLead: commercial.fuenteLead }),
        ...(commercial.followup1At !== undefined && { followup1At: toDateOrUndefined(commercial.followup1At) }),
        ...(commercial.followup2At !== undefined && { followup2At: toDateOrUndefined(commercial.followup2At) }),
        ...(commercial.followup3At !== undefined && { followup3At: toDateOrUndefined(commercial.followup3At) }),
        ...(commercial.nextFollowupAt !== undefined && { nextFollowupAt: toDateOrUndefined(commercial.nextFollowupAt) }),
        ...(commercial.lastContactAt !== undefined && { lastContactAt: toDateOrUndefined(commercial.lastContactAt) }),
        ...(commercial.attemptCount !== undefined && { attemptCount: commercial.attemptCount }),
        ...(commercial.preferredChannel !== undefined && { preferredChannel: commercial.preferredChannel }),
        ...(commercial.resultado !== undefined && { resultado: commercial.resultado }),
        ...(commercial.nextAction !== undefined && { nextAction: commercial.nextAction }),
        ...(commercial.priority !== undefined && { priority: commercial.priority }),
        ...(commercial.observaciones !== undefined && { observaciones: commercial.observaciones }),
      })
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)))
      .returning();

    if (!client) return res.status(404).json({ error: "Not found" });

    await db.insert(activityTable).values({
      orgId,
      type: "client_updated",
      description: `Client ${client.name} was updated`,
      clientName: client.name,
      userId: req.userId,
    });

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:    "client_updated",
      resource:  "client",
      resourceId: String(id),
      orgId,
      details: { name: client.name, changes: Object.keys(body) },
      severity: "info",
      result:   "success",
      req,
    });

    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.delete("/:id", requirePermission("crm.delete"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { id } = DeleteClientParams.parse({ id: Number(req.params.id) });

    const [client] = await db
      .select({ name: clientsTable.name, email: clientsTable.email, company: clientsTable.company })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));

    await db
      .delete(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.orgId, orgId)));

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:    "client_deleted",
      resource:  "client",
      resourceId: String(id),
      orgId,
      details: { clientId: id, name: client?.name, email: client?.email, company: client?.company },
      severity: "warning",
      result:   "success",
      req,
    });

    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── P2: Mis Clientes (admin) ─────────────────────────────────────────────
// GET /api/clients/my-clients — solo clientes donde assigned_admin_id = user.id actual
clientsRouter.get("/my-clients", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId  = req.orgId!;
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.assignedAdminId, userId)))
      .orderBy(desc(clientsTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── P3: Vendedor — Mis Prospectos & Mis Clientes ────────────────────
// GET /api/clients/my-leads — solo leads donde assigned_seller_id = user.id
clientsRouter.get("/my-leads", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId  = req.orgId!;
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(clientsTable)
      .where(and(
        eq(clientsTable.orgId, orgId),
        eq(clientsTable.assignedSellerId, userId),
        eq(clientsTable.status, "lead"),
      ))
      .orderBy(desc(clientsTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/clients/my-customers — solo clientes activos donde assigned_seller_id = user.id
clientsRouter.get("/my-customers", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId  = req.orgId!;
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(clientsTable)
      .where(and(
        eq(clientsTable.orgId, orgId),
        eq(clientsTable.assignedSellerId, userId),
        eq(clientsTable.status, "active"),
      ))
      .orderBy(desc(clientsTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── P4: Soporte — POST /api/support/enter (con motivo) ──────────────────
// Este endpoint se maneja en auth.ts junto con x-ws-override
