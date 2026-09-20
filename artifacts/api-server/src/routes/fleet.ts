/**
 * Omni Fleet — Flota, conductores, rutas y estado de entregas.
 *
 * Dos routers:
 *   fleetRouter        — autenticado, gateado por el módulo "omni_fleet".
 *   fleetWebhookRouter — público (montado antes del middleware de auth, como
 *                        /telegram y /whatsapp): recibe actualizaciones de
 *                        estado de entrega/ruta desde la app de reparto que
 *                        ya usan los conductores del cliente. No construimos
 *                        tracking GPS propio — solo recibimos y normalizamos
 *                        lo que esa app ya empuja, vía un DeliveryStatusProvider
 *                        pluggable (ver hub/deliveryProviderRegistry.ts).
 *
 * Reutiliza org_integrations (integrationSlug = "fleet-delivery-status") para
 * guardar qué proveedor eligió cada organización y el secreto del webhook —
 * mismo patrón que usa Telegram, en vez de crear una tabla nueva solo para eso.
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import { db, orgIntegrationsTable, integrationEventsTable, clientsTable } from "@workspace/db";
import {
  fleetDriversTable, fleetVehiclesTable, fleetRoutesTable, fleetDeliveriesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { DeliveryProviderRegistry } from "../hub/deliveryProviderRegistry";
import type { DeliveryStatusUpdate } from "../hub/deliveryStatusTypes";

export const fleetRouter = Router();
export const fleetWebhookRouter = Router();

const INTEGRATION_SLUG = "fleet-delivery-status";

// Estados válidos por entidad (la columna es text libre: se validan aquí).
export const DRIVER_STATUSES   = ["available", "on_route", "leave", "inactive"] as const;
export const VEHICLE_STATUSES  = ["available", "on_route", "maintenance", "inactive"] as const;
export const ROUTE_STATUSES    = ["pending", "in_progress", "completed", "cancelled"] as const;
export const DELIVERY_STATUSES = ["pending", "en_route", "delivered", "failed", "incident"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isOneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * Las referencias (conductor, vehículo, cliente) deben ser de ESTE workspace: sin esto un usuario podría enlazar una ruta
 * con el conductor o el cliente de otro workspace. null/undefined = sin referencia (válido).
 */
async function badRef(orgId: number, refs: { driverId?: unknown; vehicleId?: unknown; clientId?: unknown }): Promise<string | null> {
  const check = async (id: unknown, table: typeof fleetDriversTable | typeof fleetVehiclesTable | typeof clientsTable, code: string) => {
    if (id === null || id === undefined) return null;
    if (typeof id !== "number" || !Number.isInteger(id)) return code;
    const t = table as typeof fleetDriversTable;
    const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.orgId, orgId)));
    return row ? null : code;
  };
  return (await check(refs.driverId, fleetDriversTable, "driver_not_found"))
    ?? (await check(refs.vehicleId, fleetVehiclesTable, "vehicle_not_found"))
    ?? (await check(refs.clientId, clientsTable, "client_not_found"));
}

function publicBaseUrl(): string {
  return process.env.PUBLIC_URL || "https://www.omnitech-core.com";
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

fleetRouter.get("/dashboard", requirePermission("fleet.read"), async (req, res) => {
  const orgId = req.orgId!;
  const today = new Date().toISOString().slice(0, 10);

  const [drivers, vehicles, todaysRoutes] = await Promise.all([
    db.select().from(fleetDriversTable).where(eq(fleetDriversTable.orgId, orgId)),
    db.select().from(fleetVehiclesTable).where(eq(fleetVehiclesTable.orgId, orgId)),
    db.select().from(fleetRoutesTable).where(and(eq(fleetRoutesTable.orgId, orgId), eq(fleetRoutesTable.date, today))),
  ]);

  const deliveriesToday = todaysRoutes.reduce(
    (acc, r) => ({
      assigned:  acc.assigned + r.totalStops,
      delivered: acc.delivered + r.completedStops,
      incidents: acc.incidents + r.incidentStops,
    }),
    { assigned: 0, delivered: 0, incidents: 0 },
  );

  res.json({
    activeDrivers:   drivers.filter((d) => d.status === "on_route" || d.status === "available").length,
    driversOnRoute:  drivers.filter((d) => d.status === "on_route").length,
    activeVehicles:  vehicles.filter((v) => v.status !== "inactive").length,
    vehiclesOnRoute: vehicles.filter((v) => v.status === "on_route").length,
    routesInProgress: todaysRoutes.filter((r) => r.status === "in_progress").length,
    routesToday:      todaysRoutes.length,
    deliveriesToday,
    routes: todaysRoutes.map((r) => ({
      id: r.id, name: r.name, status: r.status,
      driverId: r.driverId, vehicleId: r.vehicleId,
      totalStops: r.totalStops, completedStops: r.completedStops, incidentStops: r.incidentStops,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DRIVERS
// ═══════════════════════════════════════════════════════════════════════════

fleetRouter.get("/drivers", requirePermission("fleet.read"), async (req, res) => {
  const rows = await db.select().from(fleetDriversTable)
    .where(eq(fleetDriversTable.orgId, req.orgId!))
    .orderBy(fleetDriversTable.name);
  res.json(rows);
});

fleetRouter.post("/drivers", requirePermission("fleet.write"), async (req, res) => {
  const { name, phone, licenseNumber, status } = req.body as {
    name?: string; phone?: string; licenseNumber?: string; status?: string;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name_required" }); return; }
  if (status !== undefined && !isOneOf(DRIVER_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: DRIVER_STATUSES }); return; }

  const [row] = await db.insert(fleetDriversTable).values({
    orgId: req.orgId!, name: name.trim(), phone: phone ?? null,
    licenseNumber: licenseNumber ?? null, status: status ?? "available",
  }).returning();
  res.status(201).json(row);
});

fleetRouter.patch("/drivers/:id", requirePermission("fleet.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const { name, phone, licenseNumber, status, notes } = req.body as Record<string, unknown>;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  if (status !== undefined && !isOneOf(DRIVER_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: DRIVER_STATUSES }); return; }
  if (typeof name === "string" && !name.trim()) { res.status(400).json({ error: "name_required" }); return; }

  const [row] = await db.update(fleetDriversTable)
    .set({
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof phone === "string" ? { phone } : {}),
      ...(typeof licenseNumber === "string" ? { licenseNumber } : {}),
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(fleetDriversTable.id, id), eq(fleetDriversTable.orgId, req.orgId!)))
    .returning();

  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  res.json(row);
});

// ═══════════════════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════════════════

fleetRouter.get("/vehicles", requirePermission("fleet.read"), async (req, res) => {
  const rows = await db.select().from(fleetVehiclesTable)
    .where(eq(fleetVehiclesTable.orgId, req.orgId!))
    .orderBy(fleetVehiclesTable.plate);
  res.json(rows);
});

fleetRouter.post("/vehicles", requirePermission("fleet.write"), async (req, res) => {
  const { plate, model, driverId, odometerKm, itvExpiresAt, insuranceExpiresAt, status } = req.body as {
    plate?: string; model?: string; driverId?: number; odometerKm?: number;
    itvExpiresAt?: string; insuranceExpiresAt?: string; status?: string;
  };
  if (!plate?.trim()) { res.status(400).json({ error: "plate_required" }); return; }
  if (status !== undefined && !isOneOf(VEHICLE_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: VEHICLE_STATUSES }); return; }
  const refError = await badRef(req.orgId!, { driverId });
  if (refError) { res.status(400).json({ error: refError }); return; }

  try {
    const [row] = await db.insert(fleetVehiclesTable).values({
      orgId: req.orgId!, plate: plate.trim(), model: model ?? null,
      driverId: driverId ?? null, odometerKm: odometerKm ?? null,
      itvExpiresAt: itvExpiresAt ?? null, insuranceExpiresAt: insuranceExpiresAt ?? null,
      status: status ?? "available",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    if (String(err).includes("fleet_vehicles_org_plate_unique")) {
      res.status(409).json({ error: "plate_already_exists" });
      return;
    }
    throw err;
  }
});

fleetRouter.patch("/vehicles/:id", requirePermission("fleet.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const { model, driverId, odometerKm, itvExpiresAt, insuranceExpiresAt, status, notes } = req.body as Record<string, unknown>;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  if (status !== undefined && !isOneOf(VEHICLE_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: VEHICLE_STATUSES }); return; }
  const refError = await badRef(req.orgId!, { driverId });
  if (refError) { res.status(400).json({ error: refError }); return; }

  const [row] = await db.update(fleetVehiclesTable)
    .set({
      ...(typeof model === "string" ? { model } : {}),
      ...(driverId === null || typeof driverId === "number" ? { driverId } : {}),
      ...(typeof odometerKm === "number" ? { odometerKm } : {}),
      ...(typeof itvExpiresAt === "string" ? { itvExpiresAt } : {}),
      ...(typeof insuranceExpiresAt === "string" ? { insuranceExpiresAt } : {}),
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(fleetVehiclesTable.id, id), eq(fleetVehiclesTable.orgId, req.orgId!)))
    .returning();

  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  res.json(row);
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES + DELIVERIES
// ═══════════════════════════════════════════════════════════════════════════

fleetRouter.get("/routes", requirePermission("fleet.read"), async (req, res) => {
  const orgId = req.orgId!;
  const date = typeof req.query["date"] === "string" ? req.query["date"] : undefined;

  const rows = await db.select().from(fleetRoutesTable)
    .where(date ? and(eq(fleetRoutesTable.orgId, orgId), eq(fleetRoutesTable.date, date)) : eq(fleetRoutesTable.orgId, orgId))
    .orderBy(desc(fleetRoutesTable.date));
  res.json(rows);
});

fleetRouter.post("/routes", requirePermission("fleet.write"), async (req, res) => {
  const { name, date, driverId, vehicleId, externalRouteId } = req.body as {
    name?: string; date?: string; driverId?: number; vehicleId?: number; externalRouteId?: string;
  };
  if (!name?.trim() || !date) { res.status(400).json({ error: "name_and_date_required" }); return; }
  if (!DATE_RE.test(date)) { res.status(400).json({ error: "invalid_date", expected: "YYYY-MM-DD" }); return; }
  const refError = await badRef(req.orgId!, { driverId, vehicleId });
  if (refError) { res.status(400).json({ error: refError }); return; }

  const [row] = await db.insert(fleetRoutesTable).values({
    orgId: req.orgId!, name: name.trim(), date,
    driverId: driverId ?? null, vehicleId: vehicleId ?? null,
    externalRouteId: externalRouteId ?? null,
  }).returning();
  res.status(201).json(row);
});

fleetRouter.patch("/routes/:id", requirePermission("fleet.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const { driverId, vehicleId, status, externalRouteId } = req.body as Record<string, unknown>;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  if (status !== undefined && !isOneOf(ROUTE_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: ROUTE_STATUSES }); return; }
  const refError = await badRef(req.orgId!, { driverId, vehicleId });
  if (refError) { res.status(400).json({ error: refError }); return; }

  const [row] = await db.update(fleetRoutesTable)
    .set({
      ...(driverId === null || typeof driverId === "number" ? { driverId } : {}),
      ...(vehicleId === null || typeof vehicleId === "number" ? { vehicleId } : {}),
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof externalRouteId === "string" ? { externalRouteId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(fleetRoutesTable.id, id), eq(fleetRoutesTable.orgId, req.orgId!)))
    .returning();

  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  res.json(row);
});

fleetRouter.get("/routes/:id/deliveries", requirePermission("fleet.read"), async (req, res) => {
  const routeId = Number(req.params["id"]);
  const rows = await db.select().from(fleetDeliveriesTable)
    .where(and(eq(fleetDeliveriesTable.routeId, routeId), eq(fleetDeliveriesTable.orgId, req.orgId!)))
    .orderBy(fleetDeliveriesTable.sequenceOrder);
  res.json(rows);
});

fleetRouter.post("/routes/:id/deliveries", requirePermission("fleet.write"), async (req, res) => {
  const routeId = Number(req.params["id"]);
  const orgId = req.orgId!;
  const {
    externalDeliveryId, address, recipientName, recipientPhone, clientId, sequenceOrder,
  } = req.body as {
    externalDeliveryId?: string; address?: string; recipientName?: string;
    recipientPhone?: string; clientId?: number; sequenceOrder?: number;
  };

  const [route] = await db.select().from(fleetRoutesTable)
    .where(and(eq(fleetRoutesTable.id, routeId), eq(fleetRoutesTable.orgId, orgId)));
  if (!route) { res.status(404).json({ error: "route_not_found" }); return; }
  if (!address?.trim() && !externalDeliveryId?.trim()) { res.status(400).json({ error: "address_or_external_id_required" }); return; }
  const refError = await badRef(orgId, { clientId });
  if (refError) { res.status(400).json({ error: refError }); return; }

  const [row] = await db.insert(fleetDeliveriesTable).values({
    orgId, routeId, clientId: clientId ?? null,
    externalDeliveryId: externalDeliveryId ?? null,
    address: address ?? null, recipientName: recipientName ?? null, recipientPhone: recipientPhone ?? null,
    sequenceOrder: sequenceOrder ?? 0,
  }).returning();

  await db.update(fleetRoutesTable)
    .set({ totalStops: route.totalStops + 1, updatedAt: new Date() })
    .where(eq(fleetRoutesTable.id, routeId));

  res.status(201).json(row);
});

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY STATUS PROVIDER — configuración por org (reutiliza org_integrations)
// ═══════════════════════════════════════════════════════════════════════════

fleetRouter.get("/providers", requirePermission("fleet.read"), async (_req, res) => {
  res.json(DeliveryProviderRegistry.list());
});

fleetRouter.get("/provider", requirePermission("fleet.read"), async (req, res) => {
  const [row] = await db.select().from(orgIntegrationsTable)
    .where(and(eq(orgIntegrationsTable.orgId, req.orgId!), eq(orgIntegrationsTable.integrationSlug, INTEGRATION_SLUG)));

  if (!row) { res.json({ connected: false }); return; }

  const config = JSON.parse(row.config ?? "{}") as { providerSlug?: string; webhookSecret?: string };
  res.json({
    connected: true,
    providerSlug: config.providerSlug ?? null,
    webhookUrl: config.webhookSecret ? `${publicBaseUrl()}/api/fleet/webhook/${config.webhookSecret}` : null,
    status: row.status,
  });
});

fleetRouter.post("/provider", requirePermission("fleet.write"), async (req, res) => {
  const { providerSlug } = req.body as { providerSlug?: string };
  if (!providerSlug || !DeliveryProviderRegistry.get(providerSlug)) {
    res.status(400).json({ error: "unknown_provider", available: DeliveryProviderRegistry.list() });
    return;
  }
  const orgId = req.orgId!;

  const [existing] = await db.select().from(orgIntegrationsTable)
    .where(and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, INTEGRATION_SLUG)));

  const webhookSecret = (existing && JSON.parse(existing.config ?? "{}").webhookSecret) || randomBytes(24).toString("hex");
  const config = JSON.stringify({ providerSlug, webhookSecret });

  if (existing) {
    await db.update(orgIntegrationsTable)
      .set({ config, status: "active", updatedAt: new Date() })
      .where(eq(orgIntegrationsTable.id, existing.id));
  } else {
    await db.insert(orgIntegrationsTable).values({
      orgId, integrationSlug: INTEGRATION_SLUG, status: "active", config,
    });
  }

  res.json({ connected: true, providerSlug, webhookUrl: `${publicBaseUrl()}/api/fleet/webhook/${webhookSecret}` });
});

type DeliveryRow = typeof fleetDeliveriesTable.$inferSelect;

/**
 * Cambia el estado de una entrega y mantiene los agregados de su ruta (completedStops / incidentStops). Solo ajusta la
 * ruta si el estado realmente cambió (un evento reenviado no cuenta dos veces) y lo hace con incrementos en SQL, no con
 * lectura-modificación-escritura, para que dos actualizaciones simultáneas no se pisen.
 */
async function setDeliveryStatus(delivery: DeliveryRow, status: string, opts: { occurredAt?: string | Date | null; note?: string | null } = {}) {
  const previousStatus = delivery.status;
  await db.update(fleetDeliveriesTable)
    .set({
      status,
      statusUpdatedAt: opts.occurredAt ? new Date(opts.occurredAt) : new Date(),
      lastStatusNote: opts.note ?? delivery.lastStatusNote,
      updatedAt: new Date(),
    })
    .where(eq(fleetDeliveriesTable.id, delivery.id));

  if (previousStatus !== status) {
    const wasDelivered = previousStatus === "delivered";
    const wasIncident  = previousStatus === "failed" || previousStatus === "incident";
    const isDelivered  = status === "delivered";
    const isIncident   = status === "failed" || status === "incident";
    const dDelivered = (isDelivered ? 1 : 0) - (wasDelivered ? 1 : 0);
    const dIncident  = (isIncident ? 1 : 0) - (wasIncident ? 1 : 0);
    if (dDelivered !== 0 || dIncident !== 0) {
      await db.update(fleetRoutesTable).set({
        completedStops: sql`${fleetRoutesTable.completedStops} + ${dDelivered}`,
        incidentStops:  sql`${fleetRoutesTable.incidentStops} + ${dIncident}`,
        updatedAt: new Date(),
      }).where(and(eq(fleetRoutesTable.id, delivery.routeId), eq(fleetRoutesTable.orgId, delivery.orgId)));
    }
  }
}

export async function applyDeliveryUpdate(orgId: number, update: DeliveryStatusUpdate): Promise<boolean> {
  const [delivery] = await db.select().from(fleetDeliveriesTable)
    .where(and(eq(fleetDeliveriesTable.orgId, orgId), eq(fleetDeliveriesTable.externalDeliveryId, update.externalDeliveryId)));
  if (!delivery) return false;
  await setDeliveryStatus(delivery, update.status, { occurredAt: update.occurredAt, note: update.note });
  return true;
}

// Cambio manual de estado / datos de una entrega (sin app de reparto conectada, o para corregir una incidencia).
fleetRouter.patch("/routes/:id/deliveries/:deliveryId", requirePermission("fleet.write"), async (req, res) => {
  const routeId = Number(req.params["id"]);
  const deliveryId = Number(req.params["deliveryId"]);
  const orgId = req.orgId!;
  if (!Number.isInteger(routeId) || !Number.isInteger(deliveryId)) { res.status(400).json({ error: "invalid_id" }); return; }
  const { status, note, address, recipientName, recipientPhone } = req.body as Record<string, unknown>;
  if (status !== undefined && !isOneOf(DELIVERY_STATUSES, status)) { res.status(400).json({ error: "invalid_status", allowed: DELIVERY_STATUSES }); return; }

  const [delivery] = await db.select().from(fleetDeliveriesTable)
    .where(and(eq(fleetDeliveriesTable.id, deliveryId), eq(fleetDeliveriesTable.routeId, routeId), eq(fleetDeliveriesTable.orgId, orgId)));
  if (!delivery) { res.status(404).json({ error: "not_found" }); return; }

  const fields = {
    ...(typeof address === "string" ? { address } : {}),
    ...(typeof recipientName === "string" ? { recipientName } : {}),
    ...(typeof recipientPhone === "string" ? { recipientPhone } : {}),
  };
  if (Object.keys(fields).length > 0) {
    await db.update(fleetDeliveriesTable).set({ ...fields, updatedAt: new Date() }).where(eq(fleetDeliveriesTable.id, delivery.id));
  }
  if (status !== undefined) await setDeliveryStatus(delivery, status, { note: typeof note === "string" ? note : null });

  const [row] = await db.select().from(fleetDeliveriesTable).where(eq(fleetDeliveriesTable.id, delivery.id));
  res.json(row);
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK — público, recibe actualizaciones de estado desde la app de reparto
// ═══════════════════════════════════════════════════════════════════════════

fleetWebhookRouter.post("/webhook/:secret", (req, res) => {
  // Respuesta inmediata — mismo contrato que /telegram/webhook: la app de
  // reparto no debe esperar a que procesemos, y un 200 rápido evita que
  // reintente agresivamente.
  res.sendStatus(200);

  const { secret } = req.params;
  const rawPayload = req.body;

  void (async () => {
    try {
      const all = await db.select().from(orgIntegrationsTable)
        .where(eq(orgIntegrationsTable.integrationSlug, INTEGRATION_SLUG));

      const conn = all.find((c) => {
        try { return (JSON.parse(c.config ?? "{}") as { webhookSecret?: string }).webhookSecret === secret; }
        catch { return false; }
      });

      if (!conn) {
        console.warn(`[Fleet Webhook] Unknown secret: ${secret.slice(0, 8)}…`);
        return;
      }

      const { providerSlug } = JSON.parse(conn.config ?? "{}") as { providerSlug?: string };
      const provider = providerSlug ? DeliveryProviderRegistry.get(providerSlug) : undefined;
      if (!provider) {
        console.warn(`[Fleet Webhook] Org ${conn.orgId}: no provider configured (slug "${providerSlug}")`);
        return;
      }

      const updates = provider.parseUpdate(rawPayload, req.headers as Record<string, string>);
      let applied = 0;
      for (const update of updates) {
        if (await applyDeliveryUpdate(conn.orgId, update)) applied++;
      }

      await db.insert(integrationEventsTable).values({
        orgId: conn.orgId,
        integrationSlug: INTEGRATION_SLUG,
        direction: "inbound",
        eventType: "delivery_status_update",
        status: updates.length === 0 ? "error" : applied === updates.length ? "processed" : "partial",
        summary: `${applied}/${updates.length} actualizaciones aplicadas (proveedor: ${providerSlug})`,
        payloadJson: JSON.stringify(rawPayload).slice(0, 10_000),
      });
    } catch (err) {
      console.error("[Fleet Webhook] error:", err);
    }
  })();
});
