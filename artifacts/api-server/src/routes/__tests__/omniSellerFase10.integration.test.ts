// OmniSeller Fase 10 — Auditoría + Hardening operativo.
//
// Este archivo NO añade funcionalidad nueva. Cubre, con tests de
// concurrencia real (Promise.all, no simulados en serie), los dos hallazgos
// de tipo C (concurrencia/idempotencia demostrada) encontrados durante la
// auditoría de Fase 10 y corregidos en este mismo cierre:
//
//  1. outreach/webhooks/eventProcessor.ts — dos entregas SIMULTÁNEAS del
//     mismo evento de webhook (mismo provider+external_event_id) ya no
//     pueden procesarse ambas en paralelo. Antes del arreglo, ambas podían
//     pasar el chequeo "todavía no está processed" (la fila se insertaba
//     como "received" y el conflicto se resolvía con un SELECT posterior),
//     duplicando efectos no idempotentes por sí mismos: audit log
//     (outreach.bounce_detected) y sobre todo ensureSuppression (que hace su
//     propio SELECT-then-INSERT sin constraint único). Arreglo: reclamación
//     atómica (INSERT directo con status "processing"; en conflicto, UPDATE
//     condicional WHERE status IN ["received","error"] — misma primitiva que
//     followupEngine.claimFollowup, Fase 6/9).
//
//  2. contactFinder/contactFinderService.ts — dos llamadas casi simultáneas
//     a "buscar contactos" para el MISMO lead_result+proveedor+
//     provider_contact_id ya no pueden lanzar una excepción sin capturar al
//     chocar contra lead_contacts_org_provider_contact_uidx. Antes del
//     arreglo, la segunda llamada en ganar la carrera de INSERT propagaba la
//     violación de unicidad fuera de persistContacts()/findContactsForLead(),
//     dejando el hold de OmniCredits ya reservado sin liberar (nunca se
//     llegaba a settleCredits/releaseHold — solo se auto-expiraba tras el
//     TTL del hold) y devolviendo un 500 crudo a quien llamó. Arreglo: mismo
//     idioma onConflictDoNothing ya usado en el resto del repo (Fase 5/6/8),
//     con re-lectura de la fila ganadora en vez de duplicar o fallar.
//
// Ninguno de los dos arreglos añade tabla, índice ni migración: ambos
// operan sobre restricciones únicas que ya existían
// (outreach_events_provider_external_id_uidx, lead_contacts_org_provider_
// contact_uidx).
//
// Requiere una base de datos real desechable en DATABASE_URL (mismo
// criterio que el resto de archivos omniSellerFaseN.integration.test.ts).
// Se omite limpiamente sin DB real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  missionsTable,
  leadSearchesTable,
  leadResultsTable,
  leadContactsTable,
  orgIntegrationsTable,
  outreachEventsTable,
  outreachSuppressionsTable,
  auditLogsTable,
  creditHoldsTable,
  appointmentsTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { CONTACT_FINDER_MOCK_SLUG } from "../../contactFinder/adapters/mockAdapter";
import { findContactsForLead } from "../../contactFinder/contactFinderService";
import { processOutreachEvent } from "../../outreach/webhooks/eventProcessor";

const { outreachBookingsRouter } = await import("../outreachBookings");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 10 — Hardening de concurrencia (webhooks + contact finder)", () => {
  let orgAId: number;
  let orgBId: number;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f10");
  });

  afterAll(async () => {
    for (const id of cleanupResultIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(orgIntegrationsTable).where(eq(orgIntegrationsTable.integrationSlug, CONTACT_FINDER_MOCK_SLUG));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  async function seedMissionWithLead(orgId: number) {
    const [mission] = await db.insert(missionsTable).values({
      orgId, name: `Mission fase10 test ${Date.now()}`,
    }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "test", city: "Madrid", status: "done", totalFound: 1,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId, searchId: search!.id, name: `Empresa Fase10 Test ${Date.now()}`, website: null, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);
    return { missionId: mission!.id, searchId: search!.id, leadResultId: result!.id };
  }

  async function connectMockProvider(orgId: number, config: Record<string, unknown> = {}) {
    await db.delete(orgIntegrationsTable).where(and(
      eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, CONTACT_FINDER_MOCK_SLUG),
    ));
    await db.insert(orgIntegrationsTable).values({
      orgId, integrationSlug: CONTACT_FINDER_MOCK_SLUG, status: "connected", config: JSON.stringify(config),
    });
  }

  const refPrefix = (leadResultId: number) => `missions:contacts:${leadResultId}:${CONTACT_FINDER_MOCK_SLUG}:`;

  // ── 1. Webhook: dos entregas simultáneas del MISMO evento no se procesan dos veces ──
  it("1 — dos llamadas concurrentes a processOutreachEvent con el mismo evento producen exactamente 1 'processed' + 1 'duplicate', sin duplicar audit ni suppression", async () => {
    const { leadResultId } = await seedMissionWithLead(orgAId);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId: orgAId, leadResultId, provider: "email", email: `f10-${Date.now()}@example-test.invalid`, status: "encontrado",
    }).returning();

    const externalEventId = `f10-race-${Date.now()}-${Math.random()}`;
    const evt = {
      provider: "email" as const,
      externalEventId,
      eventType: "bounced",
      rawPayload: { note: "fase10 concurrency test" },
      correlate: { by: "resolved" as const, orgId: orgAId, contactId: contact!.id },
    };

    // 15 llamadas concurrentes (no solo 2) para forzar con alta probabilidad
    // una colisión REAL a nivel de Postgres en el índice único
    // outreach_events_provider_external_id_uidx, en vez de depender de que
    // el intercalado de Node.js reproduzca la ventana de carrera por pura
    // casualidad (con solo 2 llamadas, en una DB local rápida, ambas pueden
    // terminar sin llegar a solaparse nunca).
    const results = await Promise.all(Array.from({ length: 15 }, () => processOutreachEvent(evt)));
    const processedCount = results.filter((r) => r.outcome === "processed").length;
    const duplicateCount = results.filter((r) => r.outcome === "duplicate").length;
    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(14);

    const eventRows = await db.select().from(outreachEventsTable).where(and(
      eq(outreachEventsTable.provider, "email"), eq(outreachEventsTable.externalEventId, externalEventId),
    ));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.status).toBe("processed");

    const auditRows = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "outreach.bounce_detected"), eq(auditLogsTable.resourceId, String(contact!.id)), eq(auditLogsTable.orgId, orgAId),
    ));
    expect(auditRows).toHaveLength(1);

    const suppressionRows = await db.select().from(outreachSuppressionsTable).where(and(
      eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.email, contact!.email!), eq(outreachSuppressionsTable.reason, "bounced"),
    ));
    expect(suppressionRows).toHaveLength(1);
  });

  // ── 2. Contact Finder: dos búsquedas casi simultáneas para el mismo lead_result+provider_contact_id no crashean ni duplican ──
  it("2 — dos llamadas concurrentes a findContactsForLead con el mismo provider_contact_id no lanzan, no duplican la fila y no dejan holds abiertos", async () => {
    await connectMockProvider(orgAId); // sin config explícita → externalId determinista: `mock-${companyName}`
    await grantCredits(orgAId, 30, { reference: `f10-grant-${Date.now()}` });
    const before = await getBalance(orgAId);
    const { missionId, leadResultId, searchId } = await seedMissionWithLead(orgAId);
    const [leadResult] = await db.select().from(leadResultsTable).where(eq(leadResultsTable.id, leadResultId));
    void searchId;

    const callOpts = {
      orgId: orgAId,
      userClerkId: null,
      missionId,
      leadResult: { id: leadResult!.id, name: leadResult!.name, website: leadResult!.website, sector: leadResult!.sector },
      missionProviderConfig: null,
    };

    // 15 llamadas concurrentes por la misma razón que en el test 1 — forzar
    // con alta probabilidad una colisión real en
    // lead_contacts_org_provider_contact_uidx en vez de depender de que 2
    // llamadas se solapen por pura casualidad en una DB local rápida.
    const results = await Promise.all(Array.from({ length: 15 }, () => findContactsForLead(callOpts)));
    for (const r of results) expect(r.status).toBe("ok"); // ninguna llamada lanza ni devuelve un error por la carrera

    const externalId = `mock-${leadResult!.name}`;
    const rows = await db.select().from(leadContactsTable).where(and(
      eq(leadContactsTable.orgId, orgAId), eq(leadContactsTable.provider, CONTACT_FINDER_MOCK_SLUG), eq(leadContactsTable.providerContactId, externalId),
    ));
    expect(rows).toHaveLength(1); // ninguna fila duplicada aunque las 15 llamadas "compitieron" por el mismo INSERT

    const holds = await db.select().from(creditHoldsTable).where(like(creditHoldsTable.reference, `${refPrefix(leadResultId)}%`));
    expect(holds.filter((h) => h.status === "open")).toHaveLength(0); // los 15 holds fueron liquidados (settle), ninguno quedó huérfano

    const after = await getBalance(orgAId);
    expect(after).toBe(before - 15); // cada llamada reservó y liquidó su propio coste (1 crédito × 15 llamadas) — la fila fue reutilizada, el gasto no
  });

  // ── 3. Aislamiento: el arreglo de dedup no rompe el aislamiento multi-tenant existente ──
  it("3 — el mismo provider_contact_id en otra organización sigue sin colisionar tras el arreglo de concurrencia", async () => {
    await connectMockProvider(orgBId);
    await grantCredits(orgBId, 5, { reference: `f10-grant-${Date.now()}-b` });
    const { missionId, leadResultId } = await seedMissionWithLead(orgBId);
    const [leadResult] = await db.select().from(leadResultsTable).where(eq(leadResultsTable.id, leadResultId));

    const result = await findContactsForLead({
      orgId: orgBId,
      userClerkId: null,
      missionId,
      leadResult: { id: leadResult!.id, name: leadResult!.name, website: leadResult!.website, sector: leadResult!.sector },
      missionProviderConfig: null,
    });
    expect(result.status).toBe("ok");

    const rows = await db.select().from(leadContactsTable).where(eq(leadContactsTable.orgId, orgBId));
    expect(rows.length).toBeGreaterThan(0);
    const crossOrgRows = await db.select().from(leadContactsTable).where(and(
      eq(leadContactsTable.orgId, orgAId), eq(leadContactsTable.leadResultId, leadResultId),
    ));
    expect(crossOrgRows).toHaveLength(0);
  });
});

// ── Fase 10, Parte 8 — validación de entrada del booking OmniSeller ─────────
//
// Hallazgo (clasificación A — bug real, corregido en este mismo cierre):
// POST /api/outreach/bookings no validaba `durationMinutes` en absoluto.
// Un valor negativo producía una cita con endTime ANTES que startTime, sin
// que nada lo rechazara; un valor no numérico o cero tampoco se rechazaban.
// Tampoco se comprobaba que `missionId` fuera numérico antes de pasarlo a la
// consulta (a diferencia de `leadContactId`, que sí lo hacía). Arreglo:
// outreach/booking/omniSellerBooking.ts rechaza cualquier duración que no
// sea finita y > 0 (reason "invalid_duration", 400); routes/outreachBookings.ts
// rechaza un missionId no numérico con 400 antes de tocar la base de datos.
describe.skipIf(!hasRealDb)("OmniSeller Fase 10 — Parte 8: validación de entrada del booking", () => {
  let orgId: number;
  let server: Server;
  let base = "";

  const cleanupMissionIds: number[] = [];
  const cleanupResultIds: number[] = [];
  const cleanupAppointmentIds: number[] = [];

  beforeAll(async () => {
    [orgId] = await createTempOrgs(1, "omniseller-f10-booking");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f10-booking-user" });
      next();
    });
    app.use("/api/outreach/bookings", outreachBookingsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupAppointmentIds) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id)).catch(() => {});
    for (const id of cleanupResultIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.action, "appointment.booked_from_omniseller"));
    await deleteTempOrgs([orgId]);
  });

  async function seedLead() {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F10 booking ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({ orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done" }).returning();
    const [result] = await db.insert(leadResultsTable).values({ orgId, searchId: search!.id, name: `Empresa F10 booking ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id, name: "Contacto F10 Booking", provider: "contact_finder_mock", phone: "600123456", status: "encontrado",
    }).returning();
    return { missionId: mission!.id, contactId: contact!.id };
  }

  function tomorrow(): string {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function book(body: Record<string, unknown>) {
    const resp = await fetch(`${base}/api/outreach/bookings`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await resp.json() as Record<string, unknown>;
    if (typeof json["id"] === "number") cleanupAppointmentIds.push(json["id"] as number);
    return { status: resp.status, body: json };
  }

  it("una duración negativa se rechaza (400 invalid_duration) y no crea ninguna cita", async () => {
    const { contactId } = await seedLead();
    const res = await book({ leadContactId: contactId, date: tomorrow(), startTime: "11:00", durationMinutes: -30 });
    expect(res.status).toBe(400);
    expect(res.body["error"]).toBe("invalid_duration");

    const rows = await db.select().from(appointmentsTable).where(eq(appointmentsTable.leadContactId, contactId));
    expect(rows).toHaveLength(0);
  });

  it("una duración de cero minutos se rechaza (400 invalid_duration)", async () => {
    const { contactId } = await seedLead();
    const res = await book({ leadContactId: contactId, date: tomorrow(), startTime: "11:00", durationMinutes: 0 });
    expect(res.status).toBe(400);
    expect(res.body["error"]).toBe("invalid_duration");
  });

  it("una duración no numérica se rechaza (400 invalid_duration) en vez de crear un endTime inválido", async () => {
    const { contactId } = await seedLead();
    const res = await book({ leadContactId: contactId, date: tomorrow(), startTime: "11:00", durationMinutes: "no-es-un-numero" });
    expect(res.status).toBe(400);
    expect(res.body["error"]).toBe("invalid_duration");
  });

  it("un missionId no numérico se rechaza (400) antes de tocar la base de datos", async () => {
    const { contactId } = await seedLead();
    const res = await book({ leadContactId: contactId, missionId: "abc", date: tomorrow(), startTime: "11:00" });
    expect(res.status).toBe(400);

    const rows = await db.select().from(appointmentsTable).where(eq(appointmentsTable.leadContactId, contactId));
    expect(rows).toHaveLength(0);
  });

  it("una duración positiva normal sigue funcionando (regresión: el arreglo no rompe el camino feliz)", async () => {
    const { missionId, contactId } = await seedLead();
    const res = await book({ leadContactId: contactId, missionId, date: tomorrow(), startTime: "11:00", durationMinutes: 45 });
    expect(res.status).toBe(201);
    const start = new Date(res.body["startTime"] as string);
    const end = new Date(res.body["endTime"] as string);
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
  });
});
