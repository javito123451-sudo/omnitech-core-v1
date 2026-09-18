// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Skills del taller (Omni Taller)
//  Reutiliza clients/appointments/quotes tal cual; repair_orders solo añade
//  el vehículo y la fase de la reparación. Ver lib/db/src/schema/taller.ts.
// ═══════════════════════════════════════════════════════════════════════════

import {
  db, clientsTable, repairOrdersTable, activityTable, REPAIR_STAGES, SERVICE_TYPES,
} from "@workspace/db";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

const STAGE_LABEL: Record<string, string> = {
  received: "recibido", diagnosing: "en diagnóstico", quote_sent: "presupuesto enviado",
  approved: "presupuesto aprobado", in_repair: "en reparación", waiting_parts: "esperando piezas",
  ready: "listo para recoger", delivered: "entregado", cancelled: "cancelado",
};

// ── get_repair_status (customer-facing) ──────────────────────────────────────

async function getRepairStatus(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const plate = params["vehicle_plate"] ? String(params["vehicle_plate"]).trim().toUpperCase() : "";

  const conditions = [eq(repairOrdersTable.orgId, orgId)];
  if (context.client) {
    // Identidad confiable del canal — si además dio matrícula, la usamos para
    // acotar entre varios vehículos del mismo cliente, no como filtro único.
    conditions.push(eq(repairOrdersTable.clientId, context.client.id));
    if (plate) conditions.push(ilike(repairOrdersTable.vehiclePlate, `%${plate}%`));
  } else if (plate) {
    conditions.push(ilike(repairOrdersTable.vehiclePlate, plate));
  } else {
    return JSON.stringify({ error: "Necesito la matrícula del vehículo, o que me escribas desde el número/cliente registrado." });
  }

  const rows = await db.select().from(repairOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(repairOrdersTable.createdAt))
    .limit(5);

  if (rows.length === 0) {
    return JSON.stringify({ found: false, message: "No encuentro ninguna reparación activa con esos datos." });
  }

  return JSON.stringify({
    found: true,
    orders: rows.map(r => ({
      id: r.id,
      vehiclePlate: r.vehiclePlate,
      vehicleModel: r.vehicleModel,
      serviceType: r.serviceType,
      stage: r.stage,
      stageLabel: STAGE_LABEL[r.stage] ?? r.stage,
      notes: r.notes,
      updatedAt: r.updatedAt.toLocaleDateString("es-ES"),
    })),
  });
}

// ── create_repair_order (interno) ────────────────────────────────────────────

async function createRepairOrder(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const clientName = String(params["client_name"] ?? "");
  const plate = params["vehicle_plate"] ? String(params["vehicle_plate"]).trim().toUpperCase() : null;
  const model = params["vehicle_model"] ? String(params["vehicle_model"]) : null;
  const mileage = params["vehicle_mileage_km"] ? Number(params["vehicle_mileage_km"]) : null;
  const serviceType = SERVICE_TYPES.includes(params["service_type"] as typeof SERVICE_TYPES[number])
    ? String(params["service_type"])
    : "reparacion";
  const notes = params["notes"] ? String(params["notes"]) : null;

  let client: typeof clientsTable.$inferSelect | undefined = context.client
    ? (await db.select().from(clientsTable)
        .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, context.client.id))))[0]
    : undefined;

  if (!client && clientName) {
    const matched = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
      .limit(5);
    if (matched.length > 0) client = matched[0]!;
  }

  if (!client) {
    return JSON.stringify({ error: `No encontré ningún cliente que coincida con "${clientName}". Crea primero el cliente en el CRM.` });
  }

  const [order] = await db.insert(repairOrdersTable).values({
    orgId, clientId: client.id,
    vehiclePlate: plate, vehicleModel: model, vehicleMileageKm: mileage,
    serviceType, stage: "received", notes,
  }).returning();

  if (!order) return JSON.stringify({ error: "Error al crear la orden de reparación." });

  await db.insert(activityTable).values({
    orgId, type: "repair_order_created",
    description: `Orden de taller abierta para ${client.name}${plate ? ` (${plate})` : ""} — ${serviceType}`,
    clientName: client.name,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success: true, dbVerified: true, repairOrderId: order.id,
    clientName: client.name, vehiclePlate: plate, serviceType, stage: "received",
    message: `Orden de taller #${order.id} abierta para ${client.name}.`,
  });
}

// ── update_repair_stage (interno) ────────────────────────────────────────────

async function updateRepairStage(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const orderId = Number(params["repair_order_id"] ?? 0);
  const plate = params["vehicle_plate"] ? String(params["vehicle_plate"]).trim().toUpperCase() : "";
  const stage = String(params["stage"] ?? "");
  const notes = params["notes"] ? String(params["notes"]) : undefined;

  if (!REPAIR_STAGES.includes(stage as typeof REPAIR_STAGES[number])) {
    return JSON.stringify({ error: `Fase inválida. Usa una de: ${REPAIR_STAGES.join(", ")}` });
  }

  const where = orderId
    ? and(eq(repairOrdersTable.orgId, orgId), eq(repairOrdersTable.id, orderId))
    : and(eq(repairOrdersTable.orgId, orgId), ilike(repairOrdersTable.vehiclePlate, plate));

  if (!orderId && !plate) {
    return JSON.stringify({ error: "Necesito el ID de la orden o la matrícula del vehículo." });
  }

  const [row] = await db.update(repairOrdersTable)
    .set({
      stage,
      ...(notes !== undefined ? { notes } : {}),
      ...(stage === "delivered" ? { deliveredAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(where)
    .returning();

  if (!row) return JSON.stringify({ error: "No encontré esa orden de reparación." });

  return JSON.stringify({
    success: true, repairOrderId: row.id, stage: row.stage, stageLabel: STAGE_LABEL[row.stage] ?? row.stage,
    message: `Orden #${row.id} actualizada a "${STAGE_LABEL[row.stage] ?? row.stage}".`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill definitions
// ═══════════════════════════════════════════════════════════════════════════

export const getRepairStatusSkill: SkillDefinition = {
  id: "get_repair_status",
  name: "Consultar Estado de Reparación",
  description: "Consulta en qué fase está la reparación de un vehículo. Úsalo cuando el cliente pregunte por el estado de su coche.",
  params: [
    { name: "vehicle_plate", type: "string", description: "Matrícula del vehículo (si el cliente no está identificado por el canal)", required: false },
  ],
  execute: getRepairStatus,
};

export const createRepairOrderSkill: SkillDefinition = {
  id: "create_repair_order",
  name: "Abrir Orden de Taller",
  description: "Abre una orden de taller para un vehículo cuando llega al taller. Requiere un cliente ya existente en el CRM.",
  params: [
    { name: "client_name", type: "string", description: "Nombre del cliente (o usar contexto del canal)", required: false },
    { name: "vehicle_plate", type: "string", description: "Matrícula del vehículo", required: false },
    { name: "vehicle_model", type: "string", description: "Modelo del vehículo", required: false },
    { name: "vehicle_mileage_km", type: "number", description: "Kilometraje actual", required: false },
    { name: "service_type", type: "string", description: `Uno de: ${SERVICE_TYPES.join(", ")}`, default: "reparacion" },
    { name: "notes", type: "string", description: "Notas del motivo de la visita", required: false },
  ],
  execute: createRepairOrder,
};

export const updateRepairStageSkill: SkillDefinition = {
  id: "update_repair_stage",
  name: "Actualizar Fase de Reparación",
  description: "Cambia la fase de una orden de taller (diagnóstico, presupuestado, en reparación, esperando piezas, listo, entregado).",
  params: [
    { name: "repair_order_id", type: "number", description: "ID de la orden (o usar vehicle_plate)", required: false },
    { name: "vehicle_plate", type: "string", description: "Matrícula del vehículo (si no se sabe el ID)", required: false },
    { name: "stage", type: "string", description: `Uno de: ${REPAIR_STAGES.join(", ")}`, required: true },
    { name: "notes", type: "string", description: "Nota sobre el cambio de fase", required: false },
  ],
  execute: updateRepairStage,
};
