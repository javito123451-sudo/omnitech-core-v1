// End-to-end check of the guest-appointment flow (client_id optional):
// a WhatsApp/Telegram user with no CRM client record can create, list and
// see only their own appointment — through the real skill code and a real
// Postgres, not mocks. This is the flow fixed by migrations FIX-AP/FIX-AU
// (guest_name/guest_phone/guest_email + messages.external_id) and by the
// SECURITY FIX in getAppointments (8e66809) that stopped leaking every
// appointment in the org to an unidentified guest.
//
// Requires a real disposable database in DATABASE_URL (see vitest.config.ts
// and docs/smoke-tests.md) — skips cleanly if only the placeholder is set.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, appointmentsTable, organizationsTable } from "@workspace/db";
import { executeSkill } from "../index";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const createdAppointmentIds: number[] = [];

describe.skipIf(!hasRealDb)("guest appointment flow — end to end", () => {
  const guestA = `smoke-test-${Date.now()}-a`;
  const guestB = `smoke-test-${Date.now()}-b`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  afterAll(async () => {
    for (const id of createdAppointmentIds) {
      await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
    }
  });

  it("creates a guest appointment with no client_id, anchored to the channel identity", async () => {
    const orgId = await firstOrgId();

    const raw = await executeSkill(
      "create_appointment",
      { guest_name: "Cliente de Prueba (smoke test)", date: tomorrow, start_time: "11:00" },
      orgId,
      { channel: "whatsapp", guestIdentity: guestA },
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    expect(parsed.appointmentId).toBeTypeOf("number");
    createdAppointmentIds.push(parsed.appointmentId);

    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.appointmentId));
    expect(row?.clientId).toBeNull();
    expect(row?.guestPhone).toBe(guestA);
  });

  it("lets that same guest see their own appointment via get_appointments", async () => {
    const orgId = await firstOrgId();
    const raw = await executeSkill("get_appointments", {}, orgId, { channel: "whatsapp", guestIdentity: guestA });
    const parsed = JSON.parse(raw.result);

    expect(parsed.appointments.length).toBeGreaterThanOrEqual(1);
    expect(parsed.appointments.every((a: { isGuest: boolean }) => a.isGuest)).toBe(true);
  });

  it("does NOT let a different, unrelated guest see guestA's appointment (isolation)", async () => {
    const orgId = await firstOrgId();
    const raw = await executeSkill("get_appointments", {}, orgId, { channel: "whatsapp", guestIdentity: guestB });
    const parsed = JSON.parse(raw.result);

    expect(parsed.appointments).toEqual([]);
  });

  it("returns nothing (not the whole org's appointments) for a customer-channel request with no identity at all", async () => {
    const orgId = await firstOrgId();
    const raw = await executeSkill("get_appointments", {}, orgId, { channel: "whatsapp" });
    const parsed = JSON.parse(raw.result);

    expect(parsed.appointments).toEqual([]);
  });
});

async function firstOrgId(): Promise<number> {
  const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
  if (!org) throw new Error("Test database has no organizations — seed one before running this test.");
  return org.id;
}
