// OmniSeller Fase 6 — Follow-up Engine (secuencias automáticas de leads).
//
// Cubre los 30 puntos del plan ejecutable del mandato. Regresión de F1-F5
// (puntos 26-30) se verifica ejecutando este archivo JUNTO a
// omniSellerFase{1,2,3,4,5}.integration.test.ts (mismo criterio que Fase 5
// usó para F1-F4) — no se duplican aquí sus propias suites.
//
// IntegrationManager.send() (Hub) está mockeado — mismo motivo que Fase 4:
// sin credenciales reales de Resend/WhatsApp/Telegram en este sandbox, y
// así se puede forzar cada rama (éxito, provider_error) determinísticamente.
// La cadencia real es en DÍAS — los tests nunca esperan días: manipulan
// directamente `sentAt` del mensaje ancla (pasado, para que next_run_at ya
// haya vencido al programar) y/o `next_run_at` de la propia fila
// outreach_followups tras crearla, exactamente igual que Fase 5 manipuló
// `receivedAt` de eventos para probar ventanas de tiempo.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable, leadMessagesTable,
  outreachFollowupsTable, outreachSuppressionsTable, outreachEventsTable, moduleConfigsTable, auditLogsTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { clearModuleCache } from "../../middlewares/requireModule";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../../hub", () => ({ IntegrationManager: { send: sendMock } }));

// Importados DESPUÉS del mock — mismo requisito que Fase 2/4/5.
const { outreachFollowupRouter } = await import("../outreachFollowup");
const { runFollowupTick } = await import("../../outreach/followup/followupEngine");
const {
  scheduleFollowupSequence, FOLLOWUP_KILL_SWITCH_SLUG, FOLLOWUP_CADENCE_DAYS, FOLLOWUP_MAX_ATTEMPTS,
} = await import("../../outreach/followup/followupService");
const { OUTREACH_KILL_SWITCH_SLUG } = await import("../../outreach/outreachService");
const { OUTREACH_MAX_ATTEMPTS } = await import("../../outreach/outreachGuard");
const { processOutreachEvent } = await import("../../outreach/webhooks/eventProcessor");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 6 — Follow-up Engine", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f6");
    await grantCredits(orgAId, 1000, { reference: `f6-grant-${Date.now()}` });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f6-user" });
      next();
    });
    app.use("/api/outreach/followups", outreachFollowupRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
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
    await db.delete(outreachEventsTable).where(eq(outreachEventsTable.orgId, orgAId));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgAId));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgBId));
    await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.moduleSlug, FOLLOWUP_KILL_SWITCH_SLUG));
    await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.moduleSlug, OUTREACH_KILL_SWITCH_SLUG));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  beforeEach(() => { sendMock.mockClear(); sendMock.mockReset(); sendMock.mockResolvedValue({ success: true, providerId: "prov-1" }); });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  /** Mission→search→result→contact, y el lead_message ANCLA ya "sent" — como lo deja Fase 4 real (confirmAndSendMessage). `sentDaysAgo` permite fabricar un next_run_at ya vencido sin esperar días reales. */
  async function seedSentAnchor(orgId: number, opts: { channel?: "email" | "whatsapp" | "telegram"; email?: string; phone?: string; sentDaysAgo?: number } = {}) {
    const channel = opts.channel ?? "email";
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission F6 ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({ orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done" }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({ orgId, searchId: search!.id, name: `Empresa F6 ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id, name: "Contacto F6", provider: "contact_finder_mock",
      email: opts.email ?? (channel === "email" ? `dest-${Date.now()}@empresa-f6.invalid` : null),
      phone: opts.phone ?? (channel !== "email" ? "600111222" : null),
      status: "encontrado",
    }).returning();
    const sentAt = new Date(Date.now() - (opts.sentDaysAgo ?? 0) * 24 * 60 * 60 * 1000);
    const [anchor] = await db.insert(leadMessagesTable).values({
      orgId, resultId: result!.id, contactId: contact!.id, channel, provider: channel,
      content: "Mensaje original de OmniSeller — Fase 4.", status: "sent", sentAt,
      // updatedAt se fija también en el pasado — si no, defaultNow() dejaría
      // el ancla con actividad "reciente" y el cooldown de Outreach (5 min,
      // outreachGuard.isCooldownActive) se activaría contra su PROPIO envío
      // original en cada test, aunque sentAt esté fabricado en el pasado.
      updatedAt: sentAt,
      approvedBy: 1, approvedAt: sentAt, sendAttempts: 0,
    }).returning();
    return { missionId: mission!.id, resultId: result!.id, contactId: contact!.id, anchorId: anchor!.id, sentAt };
  }

  async function activate(orgId: number, leadMessageId: number) {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/outreach/followups`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadMessageId }),
    });
    const body = await resp.json() as Record<string, unknown>;
    return { status: resp.status, body };
  }

  async function getSequence(orgId: number, leadMessageId: number) {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/outreach/followups/message/${leadMessageId}`);
    return await resp.json() as { sequence: Array<Record<string, unknown>> };
  }

  async function rowsFor(anchorId: number) {
    return db.select().from(outreachFollowupsTable).where(eq(outreachFollowupsTable.leadMessageId, anchorId)).orderBy(outreachFollowupsTable.attempt);
  }

  async function forceDue(id: number, daysAgo = 1) {
    await db.update(outreachFollowupsTable).set({ nextRunAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) }).where(eq(outreachFollowupsTable.id, id));
  }

  async function setKillSwitch(orgId: number, slug: string, enabled: boolean) {
    await db.delete(moduleConfigsTable).where(and(eq(moduleConfigsTable.orgId, orgId), eq(moduleConfigsTable.moduleSlug, slug)));
    await db.insert(moduleConfigsTable).values({ orgId, moduleSlug: slug, isEnabled: enabled });
    clearModuleCache(orgId, slug);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1/6 — programación de follow-up + secuencia aprobada (auditada)
  // ═══════════════════════════════════════════════════════════════════════
  it("1/6 — activar la secuencia crea el intento 1 y audita approved + scheduled", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { sentDaysAgo: 0 });
    const act = await activate(orgAId, anchorId);
    expect(act.status).toBe(201);
    expect((act.body as { attempt?: number }).attempt).toBe(1);
    expect((act.body as { status?: string }).status).toBe("scheduled");

    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.resourceId, String(anchorId)),
    ));
    expect(audits.some((a) => a.action === "outreach.followup_approved")).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2/3 — next_run_at futuro / follow-up NO vencido — el tick no lo toca
  // ═══════════════════════════════════════════════════════════════════════
  it("2/3 — un follow-up con next_run_at futuro no es procesado por el tick", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { sentDaysAgo: 0 }); // sentAt=ahora → next_run_at ~3 días en el futuro
    await activate(orgAId, anchorId);
    const before = (await rowsFor(anchorId))[0]!;
    expect(before.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await runFollowupTick();
    const after = (await rowsFor(anchorId))[0]!;
    expect(after.status).toBe("scheduled");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4/5/7 — follow-up VENCIDO: el tick lo reclama, crea un NUEVO lead_message
  // y lo envía automáticamente (sin ninguna confirmación humana por mensaje)
  // ═══════════════════════════════════════════════════════════════════════
  it("4/5/7 — un follow-up vencido se envía automáticamente creando un nuevo lead_message", async () => {
    const { anchorId, contactId } = await seedSentAnchor(orgAId, { sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());

    await runFollowupTick();
    const after = (await rowsFor(anchorId))[0]!;
    expect(after.status).toBe("sent");
    expect(after.generatedLeadMessageId).not.toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [generated] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, after.generatedLeadMessageId!));
    expect(generated!.id).not.toBe(anchorId); // mensaje NUEVO, no reutiliza el ancla
    expect(generated!.contactId).toBe(contactId);
    expect(generated!.status).toBe("sent");
    expect(generated!.content).toBe("Mensaje original de OmniSeller — Fase 4."); // trazabilidad: copia del contenido ancla

    // Encadena el siguiente intento (2) para el mismo ancla.
    const seq = await rowsFor(anchorId);
    expect(seq.length).toBe(2);
    expect(seq[1]!.attempt).toBe(2);
    expect(seq[1]!.status).toBe("scheduled");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8 — idempotencia de la activación (UNIQUE(lead_message_id, attempt))
  // ═══════════════════════════════════════════════════════════════════════
  it("8 — activar dos veces la misma secuencia no duplica el intento 1", async () => {
    const { anchorId } = await seedSentAnchor(orgAId);
    const first = await activate(orgAId, anchorId);
    expect(first.status).toBe(201);
    const second = await activate(orgAId, anchorId);
    expect(second.status).toBe(409);
    expect((second.body as { error?: string }).error).toBe("already_scheduled");

    const rows = await rowsFor(anchorId);
    expect(rows.length).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9/10 — dos ticks simultáneos sobre el MISMO follow-up vencido → una sola ejecución
  // ═══════════════════════════════════════════════════════════════════════
  it("9/10 — dos ticks concurrentes sobre el mismo follow-up solo ejecutan un envío", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);

    await Promise.all([runFollowupTick(), runFollowupTick()]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const rows = await rowsFor(anchorId);
    expect(rows.filter((r) => r.status === "sent").length).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11 — inbound WhatsApp cancela la secuencia (prioridad sobre el reloj)
  // ═══════════════════════════════════════════════════════════════════════
  it("11 — un inbound de WhatsApp posterior al mensaje ancla cancela el follow-up pendiente", async () => {
    const { anchorId, contactId } = await seedSentAnchor(orgAId, { channel: "whatsapp", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);

    // Fase 5 ya deja este envío ancla como el "sent" más reciente — el
    // inbound se correlaciona contra él (mismo mecanismo de
    // correlateInboundContact, aquí insertado directamente para no
    // depender de la firma HMAC de Meta).
    await processOutreachEvent({
      provider: "whatsapp", externalEventId: `wa-inbound-${Date.now()}`, eventType: "whatsapp_inbound",
      rawPayload: { text: "hola, gracias" }, correlate: { by: "resolved", orgId: orgAId, contactId, leadMessageId: anchorId },
    });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled");
    expect(row.reason).toBe("contact_replied");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12 — inbound Telegram cancela la secuencia (mismo mecanismo, otro canal)
  // ═══════════════════════════════════════════════════════════════════════
  it("12 — un inbound de Telegram posterior cancela el follow-up pendiente", async () => {
    const { anchorId, contactId } = await seedSentAnchor(orgAId, { channel: "telegram", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);

    await processOutreachEvent({
      provider: "telegram", externalEventId: `tg-inbound-${Date.now()}`, eventType: "telegram_inbound",
      rawPayload: { text: "ok" }, correlate: { by: "resolved", orgId: orgAId, contactId, leadMessageId: anchorId },
    });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled");
    expect(row.reason).toBe("contact_replied");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13/15 — bounce (vía suppression escrita por Fase 5) bloquea el follow-up
  // ═══════════════════════════════════════════════════════════════════════
  it("13/15 — una suppression por bounce cancela la secuencia y no envía", async () => {
    const email = `bounced-${Date.now()}@empresa-f6.invalid`;
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", email, sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    await db.insert(outreachSuppressionsTable).values({ orgId: orgAId, email, channel: "email", reason: "bounced", source: "provider_webhook" });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled");
    expect(row.reason).toBe("suppressed");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14 — complaint (suppression) bloquea igual que bounce
  // ═══════════════════════════════════════════════════════════════════════
  it("14 — una suppression por complaint cancela la secuencia", async () => {
    const email = `complaint-${Date.now()}@empresa-f6.invalid`;
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", email, sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    await db.insert(outreachSuppressionsTable).values({ orgId: orgAId, email, channel: "email", reason: "complaint", source: "provider_webhook" });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 16/17 — cooldown activo (envío/manual reciente al mismo contacto+canal) impide duplicar
  // ═══════════════════════════════════════════════════════════════════════
  it("16/17 — cooldown activo (mensaje reciente al mismo contacto+canal) reprograma sin consumir el intento", async () => {
    const { anchorId, resultId, contactId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    // Un mensaje manual "sent" hace 1 minuto al MISMO contacto+canal — dentro de OUTREACH_COOLDOWN_MS (5 min).
    await db.insert(leadMessagesTable).values({
      orgId: orgAId, resultId, contactId, channel: "email", provider: "email", content: "manual reciente",
      status: "sent", updatedAt: new Date(Date.now() - 60_000),
    });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("skipped");
    expect(row.reason).toBe("cooldown_active");
    expect(row.attempt).toBe(1); // sigue siendo el intento 1 — no se creó un intento 2
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 18 — créditos insuficientes bloquea el intento sin reintentar
  // ═══════════════════════════════════════════════════════════════════════
  it("18 — créditos insuficientes bloquea el follow-up sin crear el siguiente intento", async () => {
    const { anchorId } = await seedSentAnchor(orgBId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 }); // orgB nunca recibió grantCredits
    await activate(orgBId, anchorId);

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("blocked");
    expect(row.reason).toBe("insufficient_credits");
    expect(sendMock).not.toHaveBeenCalled();
    expect((await rowsFor(anchorId)).length).toBe(1); // no se creó intento 2
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 19/20 — provider_error reprograma un retry (sin agotar) y libera el hold de créditos
  // ═══════════════════════════════════════════════════════════════════════
  it("19/20 — un error del proveedor reprograma el mismo intento y libera los créditos reservados", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    const balanceBefore = await getBalance(orgAId);
    sendMock.mockResolvedValueOnce({ success: false, error: "SMTP temporalmente caído" });

    await runFollowupTick();
    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("scheduled"); // reintento, NO terminal
    expect(row.reason).toMatch(/^provider_error_retry/);
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect((await rowsFor(anchorId)).length).toBe(1); // no crea un intento 2 — mismo mensaje, mismo intento

    const balanceAfter = await getBalance(orgAId);
    expect(balanceAfter).toBe(balanceBefore); // reserve + releaseHold — neto cero
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 21/22 — retry limitado hasta max_attempts y cierre definitivo (failed)
  // ═══════════════════════════════════════════════════════════════════════
  it("21 — tras agotar OUTREACH_MAX_ATTEMPTS de provider_error, el intento queda failed definitivo", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    sendMock.mockResolvedValue({ success: false, error: "fallo persistente" });

    for (let i = 0; i < OUTREACH_MAX_ATTEMPTS; i++) {
      await forceDue((await rowsFor(anchorId))[0]!.id);
      await runFollowupTick();
    }

    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("failed");
    expect((await rowsFor(anchorId)).length).toBe(1); // nunca se creó una cadena de follow-up nueva por los reintentos
    expect(sendMock).toHaveBeenCalledTimes(OUTREACH_MAX_ATTEMPTS);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 22 (max attempts de la SECUENCIA) — tras el 3er envío exitoso no se crea un 4º intento
  // ═══════════════════════════════════════════════════════════════════════
  it("22 — la secuencia se cierra tras FOLLOWUP_MAX_ATTEMPTS envíos exitosos, sin crear un intento adicional", async () => {
    const { anchorId, contactId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);

    for (let n = 1; n <= FOLLOWUP_MAX_ATTEMPTS; n++) {
      const rows = await rowsFor(anchorId);
      const pending = rows.find((r) => r.attempt === n)!;
      await forceDue(pending.id);
      await runFollowupTick();
      // En producción la cadencia real son DÍAS entre intentos — el
      // cooldown de Outreach (5 min) nunca colisionaría con el intento
      // siguiente. Aquí se simulan días reales entre ticks retrasando el
      // `updatedAt` del mensaje que ACABA de enviarse, para no disparar un
      // falso cooldown puramente por comprimir la cadencia en milisegundos.
      await db.update(leadMessagesTable).set({ updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(leadMessagesTable.contactId, contactId));
    }

    const rows = await rowsFor(anchorId);
    expect(rows.length).toBe(FOLLOWUP_MAX_ATTEMPTS);
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(FOLLOWUP_MAX_ATTEMPTS);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 23 — kill switch de Follow-up (fail-closed): no crea/ejecuta, no altera lo ya almacenado
  // ═══════════════════════════════════════════════════════════════════════
  it("23 — con el kill switch de Follow-up desactivado, el tick no toca la fila vencida", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    const before = (await rowsFor(anchorId))[0]!;
    await setKillSwitch(orgAId, FOLLOWUP_KILL_SWITCH_SLUG, false);

    await runFollowupTick();

    const after = (await rowsFor(anchorId))[0]!;
    expect(after.status).toBe("scheduled"); // sin alterar
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(sendMock).not.toHaveBeenCalled();

    await setKillSwitch(orgAId, FOLLOWUP_KILL_SWITCH_SLUG, true); // reactivar — no debe afectar a otros tests
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 24 — multi-tenancy: Org B no puede activar/ver/cancelar sobre un lead_message de Org A
  // ═══════════════════════════════════════════════════════════════════════
  it("24 — Org B no puede programar ni consultar un follow-up sobre un lead_message de Org A", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email" });
    const crossActivate = await activate(orgBId, anchorId);
    expect(crossActivate.status).toBe(404);

    await activate(orgAId, anchorId);
    const rowsA = await rowsFor(anchorId);
    const followupId = rowsA[0]!.id;

    asOrg(orgBId);
    const getResp = await fetch(`${base}/api/outreach/followups/${followupId}`);
    expect(getResp.status).toBe(404);

    const cancelResp = await fetch(`${base}/api/outreach/followups/${followupId}/cancel`, { method: "POST" });
    expect(cancelResp.status).toBe(404);

    // La fila de Org A permanece intacta.
    const stillThere = (await rowsFor(anchorId))[0]!;
    expect(stillThere.status).toBe("scheduled");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 25 — audit: activación, vencimiento, envío y cancelación quedan todos auditados
  // ═══════════════════════════════════════════════════════════════════════
  it("25 — el ciclo completo (activar → vencer → enviar) deja audit_logs coherentes", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    await runFollowupTick();

    const followupId = (await rowsFor(anchorId))[0]!.id;
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.resource, "outreach_followup"), eq(auditLogsTable.resourceId, String(followupId)),
    ));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("outreach.followup_scheduled");
    expect(actions).toContain("outreach.followup_due");
    expect(actions).toContain("outreach.followup_sent");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 19 — desactivación manual (endpoint /cancel) cancela toda la secuencia pendiente
  // ═══════════════════════════════════════════════════════════════════════
  it("19b — desactivar la secuencia manualmente cancela el intento pendiente y lo audita", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email" });
    await activate(orgAId, anchorId);
    const followupId = (await rowsFor(anchorId))[0]!.id;

    asOrg(orgAId);
    const resp = await fetch(`${base}/api/outreach/followups/${followupId}/cancel`, { method: "POST" });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { cancelledCount?: number };
    expect(body.cancelledCount).toBe(1);

    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled");
    expect(row.reason).toBe("cancelled_by_user");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Fase 15 — auditoría end-to-end de estados terminales (Parte 6 y Parte 13,
  // prioridad 6, del mandato de Fase 15): cancelFollowupSequence solo toca
  // filas scheduled/skipped (ver comentario de cabecera en
  // followupService.ts) — no había ningún test que llamara a /cancel DOS
  // veces sobre la misma secuencia para demostrar que la segunda llamada es
  // inofensiva (no falla, no revive la fila, no la vuelve a "cancelar").
  // ═══════════════════════════════════════════════════════════════════════
  it("Fase 15 — cancelar una secuencia ya cancelada es idempotente (no falla, cancelledCount=0 la segunda vez)", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email" });
    await activate(orgAId, anchorId);
    const followupId = (await rowsFor(anchorId))[0]!.id;

    asOrg(orgAId);
    const first = await fetch(`${base}/api/outreach/followups/${followupId}/cancel`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { cancelledCount?: number }).cancelledCount).toBe(1);

    const second = await fetch(`${base}/api/outreach/followups/${followupId}/cancel`, { method: "POST" });
    expect(second.status).toBe(200); // nunca un error — el followup existe, solo que ya no hay nada pendiente que cancelar
    expect(((await second.json()) as { cancelledCount?: number }).cancelledCount).toBe(0);

    const row = (await rowsFor(anchorId))[0]!;
    expect(row.status).toBe("cancelled"); // sigue cancelado, no se "revivió" ni se duplicó el efecto
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /message/:leadMessageId — lectura de la secuencia completa (usada arriba, verificada explícitamente)
  // ═══════════════════════════════════════════════════════════════════════
  it("lectura — GET /message/:leadMessageId devuelve la secuencia ordenada por intento", async () => {
    const { anchorId } = await seedSentAnchor(orgAId, { channel: "email", sentDaysAgo: FOLLOWUP_CADENCE_DAYS[0]! + 1 });
    await activate(orgAId, anchorId);
    await runFollowupTick(); // genera el intento 2

    const { sequence } = await getSequence(orgAId, anchorId);
    expect(sequence.length).toBe(2);
    expect(sequence[0]!.attempt).toBe(1);
    expect(sequence[1]!.attempt).toBe(2);
  });
});
