/**
 * Omni Taller — panel interno de órdenes de reparación.
 * Citas y presupuestos se gestionan con los endpoints genéricos ya
 * existentes (/appointments, /quotes) — esto solo cubre lo que es propio
 * del taller: el vehículo y la fase de la reparación.
 */
import { Router } from "express";
import {
  db, repairOrdersTable, clientsTable, REPAIR_STAGES, SERVICE_TYPES,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";

export const tallerRouter = Router();

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

tallerRouter.get("/orders", requirePermission("taller.read"), async (req, res) => {
  const orgId = req.orgId!;
  const stage = typeof req.query["stage"] === "string" ? req.query["stage"] : undefined;

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
    .where(stage ? and(eq(repairOrdersTable.orgId, orgId), eq(repairOrdersTable.stage, stage)) : eq(repairOrdersTable.orgId, orgId))
    .orderBy(desc(repairOrdersTable.createdAt));

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
  const [client] = await db.select().from(clientsTable).where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  if (!client) { res.status(404).json({ error: "client_not_found" }); return; }

  const [row] = await db.insert(repairOrdersTable).values({
    orgId, clientId,
    appointmentId: appointmentId ?? null, quoteId: quoteId ?? null,
    vehiclePlate: vehiclePlate ?? null, vehicleModel: vehicleModel ?? null,
    vehicleMileageKm: vehicleMileageKm ?? null,
    serviceType: serviceType && (SERVICE_TYPES as readonly string[]).includes(serviceType) ? serviceType : "reparacion",
    notes: notes ?? null,
  }).returning();

  await logAudit({
    actorClerkId: req.clerkUserId!, action: "repair_order_created", resource: "repair_order",
    resourceId: String(row!.id), details: { vehiclePlate }, req,
  });

  res.status(201).json(row);
});

tallerRouter.patch("/orders/:id", requirePermission("taller.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const { stage, vehicleMileageKm, notes } = req.body as { stage?: string; vehicleMileageKm?: number; notes?: string };

  if (stage && !(REPAIR_STAGES as readonly string[]).includes(stage)) {
    res.status(400).json({ error: "invalid_stage", stages: REPAIR_STAGES });
    return;
  }

  const [row] = await db.update(repairOrdersTable)
    .set({
      ...(stage ? { stage } : {}),
      ...(stage === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(typeof vehicleMileageKm === "number" ? { vehicleMileageKm } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(repairOrdersTable.id, id), eq(repairOrdersTable.orgId, req.orgId!)))
    .returning();

  if (!row) { res.status(404).json({ error: "not_found" }); return; }

  if (stage) {
    await logAudit({
      actorClerkId: req.clerkUserId!, action: "repair_order_stage_changed", resource: "repair_order",
      resourceId: String(id), details: { stage }, req,
    });
  }

  res.json(row);
});
