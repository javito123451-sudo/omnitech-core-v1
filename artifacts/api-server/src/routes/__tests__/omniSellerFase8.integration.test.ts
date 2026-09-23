// OmniSeller Fase 8 — Booking desde OmniSeller (Calendar/Booking).
//
// Cubre los 20 puntos mínimos del mandato (punto 13). Regresión de F1-F7 se
// verifica ejecutando este archivo JUNTO a
// omniSellerFase{1,2,3,4,5,6}.integration.test.ts (Fase 7 fue solo
// auditoría, sin código propio que regresionar). Postgres real desechable,
// mismo patrón que Fases 1-6.
//
// NO se prueba disponibilidad/conflicto de horario — no existe ese motor en
// todo el repo (auditoría Fase 7, §5/§18) y el mandato de Fase 8 (punto 14)
// prohíbe explícitamente fingir una comprobación que no existe. Los tests
// reflejan la realidad: se acepta el startTime/endTime que se pase, sin más.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable,
  appointmentsTable, auditLogsTable,
} from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { grantCredits, getBalance } from "../../credits/creditService";
import { executeSkill } from "../../skills";

const { outreachBookingsRouter } = await import("../outreachBookings");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 8 — Booking desde OmniSeller", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupAppointmentIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f8");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f8-user" });
      next();
    });
    app.use("/api/outreach/bookings", outreachBookingsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupAppointmentIds) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id)).catch(() => {});
    for (const id of cleanupResultIds) {
      await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
      await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    }
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.action, "appointment.booked_from_omniseller"));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  /** Mission → search → result → lead_contact, tal como lo dejan las Fases 1-3 reales. */
  async function seedLead(orgId: number, opts: { name?: string; phone?: string; email?: string } = {}) {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F8 ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({ orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done" }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({ orgId, searchId: search!.id, name: `Empresa F8 ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id,
      name: opts.name ?? "Contacto F8", provider: "contact_finder_mock",
      phone: opts.phone ?? "600999888", email: opts.email ?? null,
      status: "encontrado",
    }).returning();
    return { missionId: mission!.id, resultId: result!.id, contactId: contact!.id };
  }

  function tomorrow(): string {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function book(orgId: number, body: Record<string, unknown>) {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/outreach/bookings`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await resp.json() as Record<string, unknown>;
    if (typeof json["id"] === "number") cleanupAppointmentIds.push(json["id"] as number);
    return { status: resp.status, body: json };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1/2/4/5/6 — crear cita de invitado desde OmniSeller, vinculada a lead_contact + mission
  // ═══════════════════════════════════════════════════════════════════════
  it("1/2/4/5/6/7/8 — OmniSeller crea una cita de invitado vinculada a lead_contact y mission, con datos resueltos y sin sobreescribir identidad explícita", async () => {
    const { missionId, contactId } = await seedLead(orgAId, { name: "María Pérez", phone: "600111222", email: "maria@empresa-f8.invalid" });

    const res = await book(orgAId, {
      leadContactId: contactId, missionId, date: tomorrow(), startTime: "11:00",
    });
    expect(res.status).toBe(201);
    const appt = res.body as Record<string, unknown>;
    expect(appt["clientId"]).toBeNull();                 // 4: guest booking, clientId NULL
    expect(appt["leadContactId"]).toBe(contactId);        // 2: vinculada al lead_contact correcto
    expect(appt["missionId"]).toBe(missionId);            // 3: vinculada a la mission correcta
    expect(appt["guestName"]).toBe("María Pérez");        // 5: nombre resuelto desde lead_contact
    expect(appt["guestPhone"]).toBe("600111222");         // 6: teléfono resuelto desde lead_contact
    expect(appt["guestEmail"]).toBe("maria@empresa-f8.invalid"); // 7: email resuelto desde lead_contact

    // 8: la identidad explícita pasada por el caller tiene prioridad sobre la del lead_contact.
    const { contactId: contactId2 } = await seedLead(orgAId, { name: "Otro Nombre", phone: "600000000" });
    const res2 = await book(orgAId, {
      leadContactId: contactId2, date: tomorrow(), startTime: "12:00",
      guestName: "Nombre Explícito", guestPhone: "699111222",
    });
    expect(res2.status).toBe(201);
    expect((res2.body as Record<string, unknown>)["guestName"]).toBe("Nombre Explícito");
    expect((res2.body as Record<string, unknown>)["guestPhone"]).toBe("699111222");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Fase 15 — auditoría end-to-end: la ruta nunca lee `clientId` del body
  // (confirmado leyendo routes/outreachBookings.ts), pero no había ningún
  // test que lo demostrara enviando un valor explícito — solo se comprobaba
  // que el resultado fuera null en el camino feliz normal. Cubre la
  // prioridad 5 de la Parte 13 del mandato de Fase 15 ("Booking sin clientId").
  // ═══════════════════════════════════════════════════════════════════════
  it("Fase 15 — un clientId enviado en el body se ignora; la cita sigue siendo guest booking (clientId null)", async () => {
    const { missionId, contactId } = await seedLead(orgAId, { name: "Invitado F15", phone: "600222333" });
    const res = await book(orgAId, {
      leadContactId: contactId, missionId, date: tomorrow(), startTime: "13:00",
      clientId: 999999, // intento explícito de forzar un client del CRM — debe ignorarse
    });
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>)["clientId"]).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9/10 — multi-tenancy: Org A no puede usar lead_contact / mission de Org B
  // ═══════════════════════════════════════════════════════════════════════
  it("9 — Org A no puede crear una cita usando un lead_contact de Org B", async () => {
    const { contactId } = await seedLead(orgBId, { name: "Cliente de Org B" });
    const res = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "10:00" });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>)["error"]).toBe("lead_contact_not_found");
  });

  it("10 — Org A no puede crear una cita usando una mission de Org B", async () => {
    const { missionId } = await seedLead(orgBId);
    const { contactId } = await seedLead(orgAId, { name: "Cliente de Org A" });
    const res = await book(orgAId, { leadContactId: contactId, missionId, date: tomorrow(), startTime: "10:00" });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>)["error"]).toBe("mission_not_found");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11/12/13/14/15 — regresión del sistema de citas tradicional (no tocado)
  // ═══════════════════════════════════════════════════════════════════════
  it("11 — una cita tradicional del CRM (con client_name) sigue funcionando exactamente igual, sin datos de OmniSeller", async () => {
    // Sin cliente real en el CRM en este test aislado: usamos guest_name como
    // hace guestAppointments.integration.test.ts — lo relevante es que
    // leadContactId/missionId queden NULL cuando no se pasan, y que el flujo
    // conversacional (createAppointment) siga devolviendo la misma forma de
    // respuesta que antes del refactor de Fase 8.
    const raw = await executeSkill(
      "create_appointment",
      { guest_name: "Cliente Tradicional F8", date: tomorrow(), start_time: "09:00" },
      orgAId,
      {},
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    expect(parsed.success).toBe(true);
    cleanupAppointmentIds.push(parsed.appointmentId);

    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.appointmentId));
    expect(row?.leadContactId).toBeNull();
    expect(row?.missionId).toBeNull();
  });

  it("12 — una cita de invitado existente (flujo WhatsApp/Telegram) sigue funcionando igual", async () => {
    const guestIdentity = `smoke-f8-${Date.now()}`;
    const raw = await executeSkill(
      "create_appointment",
      { guest_name: "Invitado F8", date: tomorrow(), start_time: "13:00" },
      orgAId,
      { channel: "whatsapp", guestIdentity },
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    cleanupAppointmentIds.push(parsed.appointmentId);

    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.appointmentId));
    expect(row?.clientId).toBeNull();
    expect(row?.guestPhone).toBe(guestIdentity);
    expect(row?.leadContactId).toBeNull();
  });

  it("13 — reschedule existente sigue funcionando para una cita creada por el bridge de OmniSeller", async () => {
    const { contactId } = await seedLead(orgAId, { name: "Para Reprogramar" });
    const created = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "14:00" });
    const apptId = (created.body as Record<string, unknown>)["id"] as number;

    const raw = await executeSkill(
      "reschedule_appointment",
      { appointment_id: apptId, new_date: tomorrow(), new_start_time: "16:00" },
      orgAId,
      {},
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    expect(parsed.success).toBe(true);
    cleanupAppointmentIds.push(parsed.newAppointmentId);

    const [oldRow] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptId));
    expect(oldRow?.status).toBe("rescheduled");
  });

  it("14 — cancel existente sigue funcionando para una cita creada por el bridge de OmniSeller", async () => {
    const { contactId } = await seedLead(orgAId, { name: "Para Cancelar" });
    const created = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "17:00" });
    const apptId = (created.body as Record<string, unknown>)["id"] as number;

    const raw = await executeSkill("cancel_appointment", { appointment_id: apptId }, orgAId, {});
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    expect(parsed.status).toBe("cancelled");
  });

  it("15 — getAppointments mantiene el aislamiento existente (un invitado de OmniSeller no ve citas de otro)", async () => {
    const { contactId } = await seedLead(orgAId, { name: "Invitado Aislado", phone: "600555444" });
    const created = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "18:00" });
    expect(created.status).toBe(201);

    const raw = await executeSkill("get_appointments", {}, orgAId, { channel: "whatsapp", guestIdentity: "otro-numero-cualquiera" });
    const parsed = JSON.parse(raw.result);
    expect(parsed.appointments).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 16/17 — sin créditos, sin Human Confirmation de Outreach
  // ═══════════════════════════════════════════════════════════════════════
  it("16 — crear una cita desde OmniSeller no consume OmniCredits", async () => {
    await grantCredits(orgAId, 500, { reference: `f8-grant-${Date.now()}` });
    const before = await getBalance(orgAId);

    const { contactId } = await seedLead(orgAId, { name: "Sin Créditos" });
    const res = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "19:00" });
    expect(res.status).toBe(201);

    const after = await getBalance(orgAId);
    expect(after).toBe(before);
  });

  it("17 — crear una cita desde OmniSeller no usa el mecanismo de Human Confirmation de Outreach (no requiere confirmToken)", async () => {
    // La propia ausencia de cualquier parámetro de confirmación en el body,
    // y el hecho de que la petición se resuelva en un único POST síncrono
    // (201 inmediato, sin un estado intermedio "pending_confirmation"), es
    // la prueba: el booking de OmniSeller nunca pasa por
    // outreach_confirmations/confirmationStore.
    const { contactId } = await seedLead(orgAId, { name: "Sin Confirmación Humana" });
    const res = await book(orgAId, { leadContactId: contactId, date: tomorrow(), startTime: "20:00" });
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>)["status"]).toBe("pending"); // estado normal de appointments, no un estado de confirmación de Outreach
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 18 — trazabilidad esperada (auditoría específica de OmniSeller)
  // ═══════════════════════════════════════════════════════════════════════
  it("18 — se genera la trazabilidad esperada: columnas FK + audit log appointment.booked_from_omniseller", async () => {
    const { missionId, contactId } = await seedLead(orgAId, { name: "Con Trazabilidad" });
    const res = await book(orgAId, { leadContactId: contactId, missionId, date: tomorrow(), startTime: "21:00" });
    expect(res.status).toBe(201);
    const apptId = (res.body as Record<string, unknown>)["id"] as number;

    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptId));
    expect(row?.leadContactId).toBe(contactId);
    expect(row?.missionId).toBe(missionId);

    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.action, "appointment.booked_from_omniseller"),
      eq(auditLogsTable.resourceId, String(apptId)),
    ));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 19 — validaciones básicas (fecha inválida, sin nombre resoluble)
  // ═══════════════════════════════════════════════════════════════════════
  it("19 — falla con claridad si la fecha es inválida o si no hay ningún nombre resoluble", async () => {
    const { contactId } = await seedLead(orgAId, { name: "" });
    const badDate = await book(orgAId, { leadContactId: contactId, date: "no-es-una-fecha", startTime: "10:00" });
    expect(badDate.status).toBe(400);
    expect((badDate.body as Record<string, unknown>)["error"]).toBe("invalid_date");

    const { contactId: emptyNameContact } = await seedLead(orgAId, { name: "" });
    await db.update(leadContactsTable).set({ name: null }).where(eq(leadContactsTable.id, emptyNameContact));
    const noName = await book(orgAId, { leadContactId: emptyNameContact, date: tomorrow(), startTime: "10:00" });
    expect(noName.status).toBe(400);
    expect((noName.body as Record<string, unknown>)["error"]).toBe("missing_guest_name");
  });
});
