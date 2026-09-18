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
import { db, orgIntegrationsTable, integrationEventsTable } from "@workspace/db";
import {
  fleetDriversTable, fleetVehiclesTable, fleetRoutesTable, fleetDeliveriesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { DeliveryProviderRegistry } from "../hub/deliveryProviderRegistry";
import type { DeliveryStatusUpdate } from "../hub/deliveryStatusTypes";

export const fleetRouter = Router();
export const fleetWebhookRouter = Router();

const INTEGRATION_SLUG = "fleet-delivery-status";

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

  const [row] = await db.insert(fleetDriversTable).values({
    orgId: req.orgId!, name: name.trim(), phone: phone ?? null,
    licenseNumber: licenseNumber ?? null, status: status ?? "available",
  }).returning();
  res.status(201).json(row);
});

fleetRouter.patch("/drivers/:id", requirePermission("fleet.write"), async (req, res) => {
  const id = Number(req.params["id"]);
  const { name, phone, licenseNumber, status, notes } = req.body as Record<string, unknown>;

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

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK — público, recibe actualizaciones de estado desde la app de reparto
// ═══════════════════════════════════════════════════════════════════════════

export async function applyDeliveryUpdate(orgId: number, update: DeliveryStatusUpdate): Promise<boolean> {
  const [delivery] = await db.select().from(fleetDeliveriesTable)
    .where(and(eq(fleetDeliveriesTable.orgId, orgId), eq(fleetDeliveriesTable.externalDeliveryId, update.externalDeliveryId)));

  if (!delivery) return false;

  const previousStatus = delivery.status;
  await db.update(fleetDeliveriesTable)
    .set({
      status: update.status,
      statusUpdatedAt: update.occurredAt ? new Date(update.occurredAt) : new Date(),
      lastStatusNote: update.note ?? delivery.lastStatusNote,
      updatedAt: new Date(),
    })
    .where(eq(fleetDeliveriesTable.id, delivery.id));

  // Reajusta los agregados de la ruta solo si el estado realmente cambió,
  // para no contar dos veces si el proveedor reenvía el mismo evento.
  if (previousStatus !== update.status) {
    const [route] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, delivery.routeId));
    if (route) {
      const wasDelivered = previousStatus === "delivered";
      const wasIncident  = previousStatus === "failed" || previousStatus === "incident";
      const isDelivered  = update.status === "delivered";
      const isIncident   = update.status === "failed" || update.status === "incident";

      await db.update(fleetRoutesTable).set({
        completedStops: route.completedStops + (isDelivered ? 1 : 0) - (wasDelivered ? 1 : 0),
        incidentStops:  route.incidentStops + (isIncident ? 1 : 0) - (wasIncident ? 1 : 0),
        updatedAt: new Date(),
      }).where(eq(fleetRoutesTable.id, route.id));
    }
  }

  return true;
}

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
