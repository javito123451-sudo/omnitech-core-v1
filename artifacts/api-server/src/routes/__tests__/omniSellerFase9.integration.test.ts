// OmniSeller Fase 9 — Cierre del ciclo Booking + Follow-up + Scheduler.
//
// Cubre los 16 puntos mínimos del mandato (parte 7). Regresión de F1-F8 se
// verifica ejecutando este archivo JUNTO a
// omniSellerFase{1,2,3,4,5,6,8}.integration.test.ts y
// guestAppointments.integration.test.ts (Fase 7 fue solo auditoría).
// Postgres real desechable, mismo patrón que Fases 1-6/8.
//
// Semántica de "booking realizado" (documentada en followupEngine.ts y en el
// informe de Fase 9, §3): "pending"/"confirmed"/"completed" cuentan como
// reserva activa/realizada → el follow-up se detiene. "cancelled" (y el
// "rescheduled" superseded, que nunca cuenta porque la fila que lo sustituye
// ya está en "pending") NO cuenta → el follow-up puede continuar.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable, leadMessagesTable,
  outreachFollowupsTable, appointmentsTable, moduleConfigsTable, auditLogsTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { clearModuleCache } from "../../middlewares/requireModule";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../../hub", () => ({ IntegrationManager: { send: sendMock } }));

const cronScheduleMock = vi.hoisted(() => vi.fn());
vi.mock("node-cron", () => ({ default: { schedule: cronScheduleMock } }));

// Importados DESPUÉS de los mocks — mismo requisito que Fase 2/4/5/6.
const { runFollowupTick, startFollowupScheduler } = await import("../../outreach/followup/followupEngine");
const { scheduleFollowupSequence, FOLLOWUP_KILL_SWITCH_SLUG } = await import("../../outreach/followup/followupService");
const { internalCronRouter } = await import("../internalCron");
const { createAppointmentFromOmniSeller } = await import("../../outreach/booking/omniSellerBooking");
const { executeSkill } = await import("../../skills");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 9 — Appointment guard + Scheduler", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupAppointmentIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f9");
    await grantCredits(orgAId, 1000, { reference: `f9-grant-${Date.now()}` });

    // Ruta interna de cron — solo para el test 13 (acceso no autorizado).
    // Nunca se llama con el secreto correcto en este archivo: no queremos
    // que este server dispare un runFollowupTick() paralelo al de los tests
    // que llaman a runFollowupTick() directamente.
    process.env["CRON_SECRET"] = "f9-test-secret-not-real";
    const app = express();
    app.use(express.json());
    app.use("/internal/cron", internalCronRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupAppointmentIds) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id)).catch(() => {});
    for (const id of cleanupResultIds) {
      await db.delete(outreachFollowupsTable).where(eq(outreachFollowupsTable.leadContactId, id)).catch(() => {});
      await db.delete(leadMessagesTable).where(eq(leadMessagesTable.resultId, id));
      await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
      await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    }
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(outreachFollowupsTable).where(eq(outreachFollowupsTable.orgId, orgAId));
    await db.delete(outreachFollowupsTable).where(eq(outreachFollowupsTable.orgId, orgBId));
    await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.moduleSlug, FOLLOWUP_KILL_SWITCH_SLUG));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  /** Mismo helper que Fase 6: mission→search→result→contact + lead_message ANCLA ya "sent". */
  async function seedSentAnchor(orgId: number, opts: { channel?: "email" | "whatsapp" | "telegram"; email?: string; phone?: string } = {}) {
    const channel = opts.channel ?? "email";
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F9 ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({ orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done" }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({ orgId, searchId: search!.id, name: `Empresa F9 ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id, name: "Contacto F9", provider: "contact_finder_mock",
      email: opts.email ?? (channel === "email" ? `dest-${Date.now()}@empresa-f9.invalid` : null),
      phone: opts.phone ?? (channel !== "email" ? "600222333" : null),
      status: "encontrado",
    }).returning();
    const sentAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // ayer, para que next_run_at ya haya vencido
    const [anchor] = await db.insert(leadMessagesTable).values({
      orgId, resultId: result!.id, contactId: contact!.id, channel, provider: channel,
      content: "Mensaje original de OmniSeller — Fase 4.", status: "sent", sentAt,
      updatedAt: sentAt, // ver comentario de Fase 6: evita falso cooldown contra el propio envío ancla
      approvedBy: 1, approvedAt: sentAt, sendAttempts: 0,
    }).returning();
    return { missionId: mission!.id, resultId: result!.id, contactId: contact!.id, anchorId: anchor!.id };
  }

  async function activateAndForceDue(orgId: number, anchorId: number) {
    const result = await scheduleFollowupSequence({ orgId, leadMessageId: anchorId });
    if (!result.ok) throw new Error(`No se pudo activar la secuencia: ${result.reason}`);
    await db.update(outreachFollowupsTable)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(outreachFollowupsTable.id, result.followup.id));
    return result.followup;
  }

  async function rowById(id: number) {
    const [row] = await db.select().from(outreachFollowupsTable).where(eq(outreachFollowupsTable.id, id));
    return row;
  }

  async function seedAppointment(orgId: number, leadContactId: number, status: string) {
    const now = new Date();
    const [appt] = await db.insert(appointmentsTable).values({
      orgId, leadContactId, title: `Cita F9 (${status})`,
      startTime: now, endTime: new Date(now.getTime() + 60 * 60_000),
      guestName: "Invitado F9", status,
    }).returning();
    cleanupAppointmentIds.push(appt!.id);
    return appt!;
  }

  async function setKillSwitch(orgId: number, enabled: boolean) {
    await db.delete(moduleConfigsTable).where(and(eq(moduleConfigsTable.orgId, orgId), eq(moduleConfigsTable.moduleSlug, FOLLOWUP_KILL_SWITCH_SLUG)));
    await db.insert(moduleConfigsTable).values({ orgId, moduleSlug: FOLLOWUP_KILL_SWITCH_SLUG, isEnabled: enabled });
    clearModuleCache(orgId, FOLLOWUP_KILL_SWITCH_SLUG);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1 — sin appointment: el follow-up continúa normalmente (envía)
  // ═══════════════════════════════════════════════════════════════════════
  it("1 — lead sin appointment: el follow-up continúa normalmente y se envía", async () => {
    sendMock.mockClear(); sendMock.mockResolvedValue({ success: true, providerId: "prov-f9-1" });
    const { anchorId } = await seedSentAnchor(orgAId);
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = await rowById(followup.id);
    expect(row?.status).toBe("sent");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2 — appointment "pending": el follow-up se detiene
  // ═══════════════════════════════════════════════════════════════════════
  it("2 — lead con appointment pendiente: el follow-up se detiene (cancelled, sin envío)", async () => {
    sendMock.mockClear();
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "pending");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).not.toHaveBeenCalled();
    const row = await rowById(followup.id);
    expect(row?.status).toBe("cancelled");
    expect(row?.reason).toBe("appointment_booked");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3 — appointment "completed": semántica elegida = también detiene
  // ═══════════════════════════════════════════════════════════════════════
  it("3 — lead con appointment completada: también detiene el follow-up (semántica documentada)", async () => {
    sendMock.mockClear();
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "completed");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).not.toHaveBeenCalled();
    const row = await rowById(followup.id);
    expect(row?.status).toBe("cancelled");
    expect(row?.reason).toBe("appointment_booked");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4 — appointment "cancelled": el follow-up SÍ puede continuar
  // ═══════════════════════════════════════════════════════════════════════
  it("4 — lead con appointment cancelada: no cuenta como reserva — el follow-up continúa", async () => {
    sendMock.mockClear(); sendMock.mockResolvedValue({ success: true, providerId: "prov-f9-4" });
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "cancelled");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = await rowById(followup.id);
    expect(row?.status).toBe("sent");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5 — múltiples appointments: comportamiento determinista
  // ═══════════════════════════════════════════════════════════════════════
  it("5 — lead con múltiples appointments (una cancelada, una confirmada): se detiene de forma determinista", async () => {
    sendMock.mockClear();
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "cancelled");
    await seedAppointment(orgAId, contactId, "confirmed");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).not.toHaveBeenCalled();
    const row = await rowById(followup.id);
    expect(row?.status).toBe("cancelled");
    expect(row?.reason).toBe("appointment_booked");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6 — multi-tenancy: una cita de Org B (aunque apunte al lead_contact de
  // Org A) nunca detiene el follow-up de Org A
  // ═══════════════════════════════════════════════════════════════════════
  it("6 — una cita registrada bajo la orgId de Org B nunca detiene el follow-up de Org A, aunque comparta leadContactId", async () => {
    sendMock.mockClear(); sendMock.mockResolvedValue({ success: true, providerId: "prov-f9-6" });
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    // Fila deliberadamente inconsistente (orgId de Org B, leadContactId de
    // Org A) para probar que la consulta filtra por AMBOS campos — nunca
    // solo por leadContactId.
    await seedAppointment(orgBId, contactId, "confirmed");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = await rowById(followup.id);
    expect(row?.status).toBe("sent");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7/8 — detenido por appointment: cero créditos, cero envío
  // ═══════════════════════════════════════════════════════════════════════
  it("7/8 — un follow-up detenido por appointment no consume créditos ni ejecuta ningún envío", async () => {
    sendMock.mockClear();
    const before = await getBalance(orgAId);
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "confirmed");
    await activateAndForceDue(orgAId, anchorId);

    await runFollowupTick();

    expect(sendMock).not.toHaveBeenCalled(); // 8: cero envío
    const after = await getBalance(orgAId);
    expect(after).toBe(before); // 7: cero créditos
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9 — doble ejecución concurrente: no duplica el follow-up
  // ═══════════════════════════════════════════════════════════════════════
  it("9 — dos ticks concurrentes sobre el mismo follow-up reservado no lo procesan dos veces", async () => {
    sendMock.mockClear();
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "pending");
    const followup = await activateAndForceDue(orgAId, anchorId);

    await Promise.all([runFollowupTick(), runFollowupTick()]);

    expect(sendMock).not.toHaveBeenCalled();
    const row = await rowById(followup.id);
    expect(row?.status).toBe("cancelled");
    // Un único audit "outreach.followup_cancelled" para esta fila — la
    // reclamación atómica (claimFollowup) garantiza que solo uno de los dos
    // ticks concurrentes procesó la fila; el otro la encontró ya en
    // "processing"/"cancelled" y pasó de largo.
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.action, "outreach.followup_cancelled"),
      eq(auditLogsTable.resourceId, String(followup.id)),
    ));
    expect(audits.length).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10 — kill switch: fail-closed, incluso con una cita ya reservada
  // ═══════════════════════════════════════════════════════════════════════
  it("10 — con el kill switch de follow-up desactivado, la fila no se toca aunque el lead ya haya reservado", async () => {
    sendMock.mockClear();
    const { anchorId, contactId } = await seedSentAnchor(orgAId);
    await seedAppointment(orgAId, contactId, "pending");
    const followup = await activateAndForceDue(orgAId, anchorId);
    await setKillSwitch(orgAId, false);

    await runFollowupTick();

    expect(sendMock).not.toHaveBeenCalled();
    const row = await rowById(followup.id);
    expect(row?.status).toBe("scheduled"); // ni siquiera se reclamó — sigue como estaba
    await setKillSwitch(orgAId, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11/12 — scheduler: dispara el tick, y el guard de arranque no duplica el registro
  // ═══════════════════════════════════════════════════════════════════════
  it("11 — el scheduler residente, al disparar su callback, ejecuta un runFollowupTick real", async () => {
    cronScheduleMock.mockClear();
    startFollowupScheduler();
    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    const [, registeredCallback] = cronScheduleMock.mock.calls[0]!;

    sendMock.mockClear(); sendMock.mockResolvedValue({ success: true, providerId: "prov-f9-11" });
    const { anchorId } = await seedSentAnchor(orgAId);
    const followup = await activateAndForceDue(orgAId, anchorId);

    await registeredCallback(); // el callback registrado en cron.schedule(...) — async, propaga runFollowupTick()

    const row = await rowById(followup.id);
    expect(row?.status).toBe("sent");
  });

  it("12 — llamar dos veces a startFollowupScheduler() solo registra el cron una vez (mismo guard que autopilotScheduler.ts)", () => {
    cronScheduleMock.mockClear();
    startFollowupScheduler();
    startFollowupScheduler();
    // El guard module-level (followupSchedulerStarted) ya impidió el segundo
    // registro en la llamada del test 11 también — aquí simplemente se
    // confirma que llamar de nuevo no añade un segundo cron.schedule.
    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13 — endpoint interno: acceso no autorizado rechazado
  // ═══════════════════════════════════════════════════════════════════════
  it("13 — POST /internal/cron/omniseller-followup sin el secreto correcto se rechaza (401), y sin CRON_SECRET configurado falla cerrado (500)", async () => {
    const noAuth = await fetch(`${base}/internal/cron/omniseller-followup`, { method: "POST" });
    expect(noAuth.status).toBe(401);

    const wrongSecret = await fetch(`${base}/internal/cron/omniseller-followup`, {
      method: "POST", headers: { "x-cron-secret": "esto-no-es-el-secreto" },
    });
    expect(wrongSecret.status).toBe(401);

    const original = process.env["CRON_SECRET"];
    delete process.env["CRON_SECRET"];
    const noSecretConfigured = await fetch(`${base}/internal/cron/omniseller-followup`, { method: "POST" });
    expect(noSecretConfigured.status).toBe(500); // fail-closed: sin secreto configurado, se rechaza TODO
    process.env["CRON_SECRET"] = original;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14/15/16 — regresión: appointments tradicionales, guest booking, F8 booking
  // ═══════════════════════════════════════════════════════════════════════
  it("14 — una cita tradicional del CRM sigue funcionando exactamente igual tras el guard de Fase 9", async () => {
    const raw = await executeSkill(
      "create_appointment",
      { guest_name: "Cliente Tradicional F9", date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), start_time: "09:00" },
      orgAId, {},
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    cleanupAppointmentIds.push(parsed.appointmentId);
    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.appointmentId));
    expect(row?.leadContactId).toBeNull();
  });

  it("15 — el guest booking (WhatsApp/Telegram) sigue funcionando exactamente igual tras el guard de Fase 9", async () => {
    const guestIdentity = `smoke-f9-${Date.now()}`;
    const raw = await executeSkill(
      "create_appointment",
      { guest_name: "Invitado F9", date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), start_time: "10:00" },
      orgAId, { channel: "whatsapp", guestIdentity },
    );
    const parsed = JSON.parse(raw.result);
    expect(raw.success).toBe(true);
    cleanupAppointmentIds.push(parsed.appointmentId);
    const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parsed.appointmentId));
    expect(row?.clientId).toBeNull();
    expect(row?.guestPhone).toBe(guestIdentity);
  });

  it("16 — el booking desde OmniSeller (Fase 8) sigue funcionando exactamente igual tras el guard de Fase 9", async () => {
    const { contactId, missionId } = await seedSentAnchor(orgAId);
    const result = await createAppointmentFromOmniSeller({
      orgId: orgAId, leadContactId: contactId, missionId,
      date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), startTime: "11:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      cleanupAppointmentIds.push(result.appointment.id);
      expect(result.appointment.leadContactId).toBe(contactId);
      expect(result.appointment.missionId).toBe(missionId);
    }
  });
});
