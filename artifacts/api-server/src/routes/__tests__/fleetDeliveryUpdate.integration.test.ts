// End-to-end check of the delivery-status rollup: a status update coming
// through the pluggable adapter must update the delivery AND keep the
// parent route's aggregate counters (completedStops/incidentStops) correct
// — including when a delivery's status changes more than once (must not
// double-count) and when the same update is replayed (idempotent).
//
// Requires a real disposable database in DATABASE_URL — same ci-test branch
// used by guestAppointments.integration.test.ts. Skips cleanly otherwise.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  db, organizationsTable, fleetRoutesTable, fleetDeliveriesTable,
} from "@workspace/db";
import { applyDeliveryUpdate } from "../fleet";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const cleanupRouteIds: number[] = [];

describe.skipIf(!hasRealDb)("fleet delivery status rollup — end to end", () => {
  afterAll(async () => {
    for (const id of cleanupRouteIds) {
      await db.delete(fleetDeliveriesTable).where(eq(fleetDeliveriesTable.routeId, id));
      await db.delete(fleetRoutesTable).where(eq(fleetRoutesTable.id, id));
    }
  });

  async function firstOrgId(): Promise<number> {
    const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
    if (!org) throw new Error("Test database has no organizations — seed one before running this test.");
    return org.id;
  }

  it("applies a status update and keeps route aggregates correct across transitions", async () => {
    const orgId = await firstOrgId();
    const externalId = `smoke-${Date.now()}`;

    const [route] = await db.insert(fleetRoutesTable).values({
      orgId, name: "Ruta de prueba (smoke test)", date: new Date().toISOString().slice(0, 10), totalStops: 1,
    }).returning();
    cleanupRouteIds.push(route!.id);

    await db.insert(fleetDeliveriesTable).values({
      orgId, routeId: route!.id, externalDeliveryId: externalId,
    });

    // pending -> en_route: no aggregate change (neither delivered nor incident)
    expect(await applyDeliveryUpdate(orgId, { externalDeliveryId: externalId, status: "en_route" })).toBe(true);
    let [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route!.id));
    expect(r?.completedStops).toBe(0);
    expect(r?.incidentStops).toBe(0);

    // en_route -> delivered: completedStops +1
    await applyDeliveryUpdate(orgId, { externalDeliveryId: externalId, status: "delivered", note: "entregado" });
    [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route!.id));
    expect(r?.completedStops).toBe(1);
    expect(r?.incidentStops).toBe(0);

    // Replaying the SAME update again must not double-count (status unchanged).
    await applyDeliveryUpdate(orgId, { externalDeliveryId: externalId, status: "delivered" });
    [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route!.id));
    expect(r?.completedStops).toBe(1);

    // delivered -> incident (e.g. recipient disputes it): completedStops -1, incidentStops +1
    await applyDeliveryUpdate(orgId, { externalDeliveryId: externalId, status: "incident", note: "reclamación" });
    [r] = await db.select().from(fleetRoutesTable).where(eq(fleetRoutesTable.id, route!.id));
    expect(r?.completedStops).toBe(0);
    expect(r?.incidentStops).toBe(1);

    const [delivery] = await db.select().from(fleetDeliveriesTable)
      .where(eq(fleetDeliveriesTable.externalDeliveryId, externalId));
    expect(delivery?.status).toBe("incident");
    expect(delivery?.lastStatusNote).toBe("reclamación");
  });

  it("returns false for an unknown externalDeliveryId instead of throwing", async () => {
    const orgId = await firstOrgId();
    const applied = await applyDeliveryUpdate(orgId, { externalDeliveryId: "does-not-exist", status: "delivered" });
    expect(applied).toBe(false);
  });
});
