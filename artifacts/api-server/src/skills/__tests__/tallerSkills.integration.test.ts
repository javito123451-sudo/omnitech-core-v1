// End-to-end check of the taller (workshop) flow: opening a repair order for
// a real client, a customer checking status via the customer-facing skill
// (must see only their own vehicle, never someone else's), and staff
// updating the repair stage via the internal-only skill.
//
// Requires a real disposable database in DATABASE_URL — same ci-test branch
// used by the other integration tests. Skips cleanly otherwise.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, clientsTable, repairOrdersTable, organizationsTable } from "@workspace/db";
import { executeSkill } from "../index";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const cleanupClientIds: number[] = [];
const cleanupOrderIds: number[] = [];

describe.skipIf(!hasRealDb)("taller flow — end to end", () => {
  afterAll(async () => {
    for (const id of cleanupOrderIds) await db.delete(repairOrdersTable).where(eq(repairOrdersTable.id, id));
    for (const id of cleanupClientIds) await db.delete(clientsTable).where(eq(clientsTable.id, id));
  });

  async function firstOrgId(): Promise<number> {
    const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
    if (!org) throw new Error("Test database has no organizations — seed one before running this test.");
    return org.id;
  }

  async function makeClient(orgId: number, name: string): Promise<number> {
    const [client] = await db.insert(clientsTable).values({
      orgId, name, email: `smoke-taller-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    }).returning();
    cleanupClientIds.push(client!.id);
    return client!.id;
  }

  it("opens a repair order and lets that client (and only that client) see its status", async () => {
    const orgId = await firstOrgId();
    const clientAId = await makeClient(orgId, "Cliente Taller A (smoke test)");
    const clientBId = await makeClient(orgId, "Cliente Taller B (smoke test)");
    const plate = `SMK${Date.now() % 100000}`;

    const created = await executeSkill(
      "create_repair_order",
      { vehicle_plate: plate, vehicle_model: "Seat León", service_type: "reparacion", notes: "Ruido en el motor" },
      orgId,
      { client: { id: clientAId, name: "Cliente Taller A (smoke test)" } },
    );
    const parsed = JSON.parse(created.result);
    expect(created.success).toBe(true);
    expect(parsed.repairOrderId).toBeTypeOf("number");
    cleanupOrderIds.push(parsed.repairOrderId);

    // El propio cliente (identidad de canal confiable) ve su reparación.
    const asOwner = await executeSkill("get_repair_status", {}, orgId, { client: { id: clientAId, name: "A" } });
    const ownerResult = JSON.parse(asOwner.result);
    expect(ownerResult.found).toBe(true);
    expect(ownerResult.orders[0].vehiclePlate).toBe(plate);
    expect(ownerResult.orders[0].stage).toBe("received");

    // Otro cliente no ve la reparación de A, aunque pregunte sin matrícula.
    const asOther = await executeSkill("get_repair_status", {}, orgId, { client: { id: clientBId, name: "B" } });
    expect(JSON.parse(asOther.result).found).toBe(false);
  });

  it("lets staff move a repair order through its stages", async () => {
    const orgId = await firstOrgId();
    const clientId = await makeClient(orgId, "Cliente Taller C (smoke test)");
    const plate = `SMK${Date.now() % 100000}`;

    const created = await executeSkill(
      "create_repair_order",
      { vehicle_plate: plate, service_type: "itv" },
      orgId,
      { client: { id: clientId, name: "C" } },
    );
    const orderId = JSON.parse(created.result).repairOrderId as number;
    cleanupOrderIds.push(orderId);

    const updated = await executeSkill(
      "update_repair_stage",
      { repair_order_id: orderId, stage: "in_repair", notes: "Pieza pedida al proveedor" },
      orgId,
      {},
    );
    const updatedParsed = JSON.parse(updated.result);
    expect(updatedParsed.success).toBe(true);
    expect(updatedParsed.stage).toBe("in_repair");

    const [row] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, orderId));
    expect(row?.stage).toBe("in_repair");
    expect(row?.notes).toBe("Pieza pedida al proveedor");
  });

  it("rejects an invalid stage instead of writing garbage to the database", async () => {
    const orgId = await firstOrgId();
    const clientId = await makeClient(orgId, "Cliente Taller D (smoke test)");
    const created = await executeSkill("create_repair_order", { vehicle_plate: "ZZZ0000" }, orgId, { client: { id: clientId, name: "D" } });
    const orderId = JSON.parse(created.result).repairOrderId as number;
    cleanupOrderIds.push(orderId);

    const result = await executeSkill("update_repair_stage", { repair_order_id: orderId, stage: "orbiting_mars" }, orgId, {});
    expect(JSON.parse(result.result).error).toBeDefined();

    const [row] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, orderId));
    expect(row?.stage).toBe("received");
  });
});
