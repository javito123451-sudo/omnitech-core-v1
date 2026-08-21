import { Router } from "express";
import { db, clientsTable, activityTable, organizationsTable, autopilotTasksTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { z } from "zod";
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
// podido regenerar en este entorno (sin Node/pnpm disponible aquí) — se
// extienden aquí los schemas ya generados con `.extend()` en vez de tocar
// los archivos generados a mano. Cuando se corra `pnpm --filter
// @workspace/api-spec run codegen` en un entorno con Node, este bloque deja
// de ser necesario y CreateClientBody/UpdateClientBody ya traerán estos
// campos de fábrica — momento en el que este `.extend()` puede eliminarse.
const commercialFieldsSchema = {
  commercialStatus: z.string().optional(),
  sector: z.string().optional(),
  contactPerson: z.string().optional(),
  companyPhone: z.string().optional(),
  companyEmail: z.string().optional(),
  instagram: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  firstContactAt: z.string().optional(),
  dolorPrincipal: z.string().optional(),
  recursoEnviado: z.string().optional(),
  fuenteLead: z.string().optional(),
  followup1At: z.string().optional(),
  followup2At: z.string().optional(),
  followup3At: z.string().optional(),
  nextFollowupAt: z.string().optional(),
  lastContactAt: z.string().optional(),
  attemptCount: z.number().optional(),
  preferredChannel: z.string().optional(),
  resultado: z.string().optional(),
  nextAction: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  observaciones: z.string().optional(),
};
const CreateClientBodyExt = CreateClientBody.extend(commercialFieldsSchema);
const UpdateClientBodyExt = UpdateClientBody.extend(commercialFieldsSchema);
const ListClientsQueryParamsExt = ListClientsQueryParams.extend({
  commercialStatus: z.coerce.string().optional(),
  sector: z.coerce.string().optional(),
  priority: z.coerce.string().optional(),
  // NOTA: z.coerce.boolean() trataría la cadena "false" como truthy — se usa
  // un enum + transform en su lugar para interpretar correctamente
  // ?autopilotActive=false desde query params.
  autopilotActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  hasFollowupPending: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

function toDateOrUndefined(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

clientsRouter.get("/", requirePermission("crm.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const query = ListClientsQueryParamsExt.parse(req.query);
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
    if (query.commercialStatus) {
      rows = rows.filter((r) => r.commercialStatus === query.commercialStatus);
    }
    if (query.sector) {
      rows = rows.filter((r) => (r.sector ?? "").toLowerCase() === query.sector!.toLowerCase());
    }
    if (query.priority) {
      rows = rows.filter((r) => r.priority === query.priority);
    }
    if (query.hasFollowupPending) {
      const now = new Date();
      rows = rows.filter((r) => r.nextFollowupAt != null && r.nextFollowupAt <= now);
    }
    if (query.autopilotActive !== undefined) {
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
      rows = rows.filter((r) => activeClientIds.has(r.id) === query.autopilotActive);
    }

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

clientsRouter.post("/", requirePermission("crm.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const body = CreateClientBodyExt.parse(req.body);
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
        commercialStatus: body.commercialStatus ?? null,
        sector: body.sector ?? null,
        contactPerson: body.contactPerson ?? null,
        companyPhone: body.companyPhone ?? null,
        companyEmail: body.companyEmail ?? null,
        instagram: body.instagram ?? null,
        website: body.website ?? null,
        location: body.location ?? null,
        firstContactAt: toDateOrUndefined(body.firstContactAt) ?? null,
        dolorPrincipal: body.dolorPrincipal ?? null,
        recursoEnviado: body.recursoEnviado ?? null,
        fuenteLead: body.fuenteLead ?? null,
        preferredChannel: body.preferredChannel ?? null,
        resultado: body.resultado ?? null,
        nextAction: body.nextAction ?? null,
        priority: body.priority ?? "medium",
        observaciones: body.observaciones ?? null,
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
    const body = UpdateClientBodyExt.parse(req.body);
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
        ...(body.commercialStatus !== undefined && { commercialStatus: body.commercialStatus }),
        ...(body.sector !== undefined && { sector: body.sector }),
        ...(body.contactPerson !== undefined && { contactPerson: body.contactPerson }),
        ...(body.companyPhone !== undefined && { companyPhone: body.companyPhone }),
        ...(body.companyEmail !== undefined && { companyEmail: body.companyEmail }),
        ...(body.instagram !== undefined && { instagram: body.instagram }),
        ...(body.website !== undefined && { website: body.website }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.firstContactAt !== undefined && { firstContactAt: toDateOrUndefined(body.firstContactAt) }),
        ...(body.dolorPrincipal !== undefined && { dolorPrincipal: body.dolorPrincipal }),
        ...(body.recursoEnviado !== undefined && { recursoEnviado: body.recursoEnviado }),
        ...(body.fuenteLead !== undefined && { fuenteLead: body.fuenteLead }),
        ...(body.followup1At !== undefined && { followup1At: toDateOrUndefined(body.followup1At) }),
        ...(body.followup2At !== undefined && { followup2At: toDateOrUndefined(body.followup2At) }),
        ...(body.followup3At !== undefined && { followup3At: toDateOrUndefined(body.followup3At) }),
        ...(body.nextFollowupAt !== undefined && { nextFollowupAt: toDateOrUndefined(body.nextFollowupAt) }),
        ...(body.lastContactAt !== undefined && { lastContactAt: toDateOrUndefined(body.lastContactAt) }),
        ...(body.attemptCount !== undefined && { attemptCount: body.attemptCount }),
        ...(body.preferredChannel !== undefined && { preferredChannel: body.preferredChannel }),
        ...(body.resultado !== undefined && { resultado: body.resultado }),
        ...(body.nextAction !== undefined && { nextAction: body.nextAction }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.observaciones !== undefined && { observaciones: body.observaciones }),
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
