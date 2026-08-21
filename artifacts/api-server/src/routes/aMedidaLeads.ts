import { Router } from "express";
import { db, leadsTable } from "@workspace/db";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";

// ── Panel interno del módulo "A Medida" ─────────────────────────────────────────
// Lee/gestiona la tabla `leads` (captación pública — ver
// lib/db/src/schema/leadCapture.ts y routes/publicLeadCapture.ts). Esa tabla
// no tiene org_id: las solicitudes del formulario público no están atadas a
// ningún workspace, así que este router no filtra por organización — solo
// exige que quien lo use tenga el módulo "a_medida" habilitado y el permiso
// correspondiente. Módulo independiente de OmniLeads (routes/leads.ts) a
// propósito: dominios de datos distintos, sin relación entre ambos.
export const aMedidaLeadsRouter = Router();

const VALID_STATUSES = new Set(["open", "contacted", "closed"]);

// ── GET / — lista de solicitudes, con filtros opcionales ────────────────────────
aMedidaLeadsRouter.get("/", requirePermission("a_medida.read"), async (req, res) => {
  const status   = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const category = typeof req.query["category"] === "string" ? req.query["category"] : undefined;
  const search   = typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;
  const limit    = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);
  const offset   = Math.max(Number(req.query["offset"] ?? 0) || 0, 0);

  const conditions = [];
  if (status && VALID_STATUSES.has(status)) conditions.push(eq(leadsTable.status, status));
  if (category) conditions.push(eq(leadsTable.category, category));
  if (search) {
    conditions.push(
      or(
        ilike(leadsTable.description, `%${search}%`),
        ilike(leadsTable.zone, `%${search}%`),
        ilike(leadsTable.contactPhone, `%${search}%`),
      ),
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(leadsTable).where(where);
  const leads = await db
    .select()
    .from(leadsTable)
    .where(where)
    .orderBy(desc(leadsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ leads, total: Number(total), limit, offset });
});

// ── PATCH /:id — cambia el estado de una solicitud ──────────────────────────────
aMedidaLeadsRouter.patch("/:id", requirePermission("a_medida.write"), async (req, res) => {
  const id = String(req.params["id"]);
  const { status } = req.body as { status?: string };

  if (!status || !VALID_STATUSES.has(status)) {
    res.status(400).json({
      error: "invalid_status",
      message: `status debe ser uno de: ${Array.from(VALID_STATUSES).join(", ")}`,
    });
    return;
  }

  const [updated] = await db
    .update(leadsTable)
    .set({ status })
    .where(eq(leadsTable.id, id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", message: "Solicitud no encontrada." });
    return;
  }

  await logAudit({
    actorClerkId: req.clerkUserId!,
    action: "a_medida_lead_status_changed",
    resource: "a_medida_lead",
    resourceId: id,
    details: { status },
    req,
  });

  res.json(updated);
});

// ── DELETE /:id — borra una solicitud definitivamente ───────────────────────────
aMedidaLeadsRouter.delete("/:id", requirePermission("a_medida.write"), async (req, res) => {
  const id = String(req.params["id"]);

  const [deleted] = await db.delete(leadsTable).where(eq(leadsTable.id, id)).returning();

  if (!deleted) {
    res.status(404).json({ error: "not_found", message: "Solicitud no encontrada." });
    return;
  }

  await logAudit({
    actorClerkId: req.clerkUserId!,
    action: "a_medida_lead_deleted",
    resource: "a_medida_lead",
    resourceId: id,
    details: { category: deleted.category, zone: deleted.zone },
    req,
  });

  res.json({ id, deleted: true });
});
