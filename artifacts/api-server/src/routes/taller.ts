/**
 * Omni Taller — panel interno de órdenes de reparación.
 * Citas y presupuestos se gestionan con los endpoints genéricos ya
 * existentes (/appointments, /quotes) — esto solo cubre lo que es propio
 * del taller: el vehículo y la fase de la reparación.
 */
import { Router } from "express";
import {
  db, repairOrdersTable, clientsTable, appointmentsTable, quotesTable, REPAIR_STAGES, SERVICE_TYPES,
} from "@workspace/db";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";

export const tallerRouter = Router();

const isOneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);
const isKm = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5_000_000;
const normPlate = (v: string) => v.trim().toUpperCase();
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Cita y presupuesto enlazados deben ser de ESTE workspace (antes se aceptaba cualquier id). */
async function badLink(orgId: number, links: { appointmentId?: unknown; quoteId?: unknown }): Promise<string | null> {
  for (const [id, table, code] of [
    [links.appointmentId, appointmentsTable, "appointment_not_found"],
    [links.quoteId, quotesTable, "quote_not_found"],
  ] as const) {
    if (id === null || id === undefined) continue;
    if (typeof id !== "number" || !Number.isInteger(id)) return code;
    const t = table as typeof appointmentsTable;
    const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.orgId, orgId)));
    if (!row) return code;
  }
  return null;
}

tallerRouter.get("/dashboard", requirePermission("taller.read"), async (req, res) => {
  const orgId = req.orgId!;
  const rows = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.orgId, orgId));

  const byStage: Record<string, number> = {};
  for (const stage of REPAIR_STAGES) byStage[stage] = 0;
  for (const r of rows) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;

  const active = rows.filter((r) => r.stage !== "delivered" && r.stage !== "cancelled");

  res.json({
    totalActive: active.length,
    readyForPickup: byStage["ready"] ?? 0,
    inRepair: byStage["in_repair"] ?? 0,
    waitingParts: byStage["waiting_parts"] ?? 0,
    byStage,
  });
});

// Buscador de clientes para el alta de una orden (solo id, nombre y contacto; no exige permisos de CRM).
tallerRouter.get("/clients", requirePermission("taller.write"), async (req, res) => {
  const orgId = req.orgId!;
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const like = `%${escapeLike(q)}%`;
  const where = q
    ? and(eq(clientsTable.orgId, orgId), or(ilike(clientsTable.name, like), ilike(clientsTable.phone, like), ilike(clientsTable.email, like)))
    : eq(clientsTable.orgId, orgId);
  const rows = await db
    .select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, email: clientsTable.email })
    .from(clientsTable).where(where).orderBy(clientsTable.name).limit(20);
  res.json(rows);
});

tallerRouter.get("/orders", requirePermission("taller.read"), async (req, res) => {
  const orgId = req.orgId!;
  const stage = typeof req.query["stage"] === "string" && req.query["stage"] ? req.query["stage"] : undefined;
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (stage && !isOneOf(REPAIR_STAGES, stage)) { res.status(400).json({ error: "invalid_stage", stages: REPAIR_STAGES }); return; }

  const conditions = [eq(repairOrdersTable.orgId, orgId)];
  if (stage) conditions.push(eq(repairOrdersTable.stage, stage));
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conditions.push(or(ilike(repairOrdersTable.vehiclePlate, like), ilike(repairOrdersTable.vehicleModel, like), ilike(clientsTable.name, like))!);
  }

  const rows = await db
    .select({
      id: repairOrdersTable.id,
      clientId: repairOrdersTable.clientId,
      clientName: clientsTable.name,
      clientPhone: clientsTable.phone,
      appointmentId: repairOrdersTable.appointmentId,
      quoteId: repairOrdersTable.quoteId,
      vehiclePlate: repairOrdersTable.vehiclePlate,
      vehicleModel: repairOrdersTable.vehicleModel,
      vehicleMileageKm: repairOrdersTable.vehicleMileageKm,
      serviceType: repairOrdersTable.serviceType,
      stage: repairOrdersTable.stage,
      notes: repairOrdersTable.notes,
      deliveredAt: repairOrdersTable.deliveredAt,
      createdAt: repairOrdersTable.createdAt,
      updatedAt: repairOrdersTable.updatedAt,
    })
    .from(repairOrdersTable)
    .leftJoin(clientsTable, eq(repairOrdersTable.clientId, clientsTable.id))
    .where(and(...conditions))
    .orderBy(desc(repairOrdersTable.createdAt))
    .limit(500);

  res.json(rows);
});

tallerRouter.post("/orders", requirePermission("taller.write"), async (req, res) => {
  const orgId = req.orgId!;
  const {
    clientId, appointmentId, quoteId, vehiclePlate, vehicleModel, vehicleMileageKm, serviceType, notes,
  } = req.body as {
    clientId?: number; appointmentId?: number; quoteId?: number;
    vehiclePlate?: string; vehicleModel?: string; vehicleMileageKm?: number;
    serviceType?: string; notes?: string;
  };

  if (!clientId) { res.status(400).json({ error: "client_id_required" }); return; }
  if (serviceType !== undefined && !isOneOf(SERVICE_TYPES, serviceType)) { res.status(400).json({ error: "invalid_service_type", serviceTypes: SERVICE_TYPES }); return; }
  if (vehicleMileageKm !== undefined && vehicleMileageKm !== null && !isKm(vehicleMileageKm)) { res.status(400).json({ error: "invalid_mileage" }); return; }
  const [client] = await db.select().from(clientsTable).where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  if (!client) { res.status(404).json({ error: "client_not_found" }); return; }
  const linkError = await badLink(orgId, { appointmentId, quoteId });
  if (linkError) { res.status(400).json({ error: linkError }); return; }

  const plate = typeof vehiclePlate === "string" && vehiclePlate.trim() ? normPlate(vehiclePlate) : null;
  const [row] = await db.insert(repairOrdersTable).values({
    orgId, clientId,
    appointmentId: appointmentId ?? null, quoteId: quoteId ?? null,
    vehiclePlate: plate, vehicleModel: vehicleModel?.trim() || null,
    vehicleMileageKm: vehicleMileageKm ?? null,
    serviceType: serviceType ?? "reparacion",
    notes: notes?.trim() || null,
  }).returning();

  await logAudit({
    actorClerkId: req.clerkUserId!, action: "repair_order_created", resource: "repair_order",
    resourceId: String(row!.id), details: { vehiclePlate: plate }, req,
  });

  res.status(201).json(row);
});

tallerRouter.patch("/orders/:id", requirePermission("taller.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const orgId = req.orgId!;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const { stage, vehicleMileageKm, notes, vehiclePlate, vehicleModel, serviceType, appointmentId, quoteId } = req.body as {
    stage?: string; vehicleMileageKm?: number; notes?: string; vehiclePlate?: string; vehicleModel?: string;
    serviceType?: string; appointmentId?: number | null; quoteId?: number | null;
  };

  if (stage !== undefined && !isOneOf(REPAIR_STAGES, stage)) { res.status(400).json({ error: "invalid_stage", stages: REPAIR_STAGES }); return; }
  if (serviceType !== undefined && !isOneOf(SERVICE_TYPES, serviceType)) { res.status(400).json({ error: "invalid_service_type", serviceTypes: SERVICE_TYPES }); return; }
  if (vehicleMileageKm !== undefined && !isKm(vehicleMileageKm)) { res.status(400).json({ error: "invalid_mileage" }); return; }
  const linkError = await badLink(orgId, { appointmentId, quoteId });
  if (linkError) { res.status(400).json({ error: linkError }); return; }

  const [previous] = stage
    ? await db.select({ stage: repairOrdersTable.stage }).from(repairOrdersTable).where(and(eq(repairOrdersTable.id, id), eq(repairOrdersTable.orgId, orgId)))
    : [undefined];

  const [row] = await db.update(repairOrdersTable)
    .set({
      ...(stage ? { stage } : {}),
      // Entregar fija la fecha de entrega; pasar a cualquier otra fase (reabrir) la borra.
      ...(stage === "delivered" ? { deliveredAt: new Date() } : stage ? { deliveredAt: null } : {}),
      ...(vehicleMileageKm !== undefined ? { vehicleMileageKm } : {}),
      ...(typeof notes === "string" ? { notes: notes.trim() || null } : {}),
      ...(typeof vehiclePlate === "string" ? { vehiclePlate: vehiclePlate.trim() ? normPlate(vehiclePlate) : null } : {}),
      ...(typeof vehicleModel === "string" ? { vehicleModel: vehicleModel.trim() || null } : {}),
      ...(serviceType !== undefined ? { serviceType } : {}),
      ...(appointmentId === null || typeof appointmentId === "number" ? { appointmentId } : {}),
      ...(quoteId === null || typeof quoteId === "number" ? { quoteId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(repairOrdersTable.id, id), eq(repairOrdersTable.orgId, orgId)))
    .returning();

  if (!row) { res.status(404).json({ error: "not_found" }); return; }

  if (stage && previous?.stage !== stage) {
    await logAudit({
      actorClerkId: req.clerkUserId!, action: "repair_order_stage_changed", resource: "repair_order",
      resourceId: String(id), details: { from: previous?.stage ?? null, stage }, req,
    });
  }

  res.json(row);
});
