// OmniSeller Fase 5 — Webhooks, delivery events, bounces, quejas e inbound.
//
// Cubre los 29 puntos del plan ejecutable de Paso 20. Regresión de F1-F4
// (puntos 26-29) se verifica ejecutando este archivo JUNTO a
// omniSellerFase{1,2,3,4}.integration.test.ts (mismo criterio que Fase 4
// usó para F1-F3) — no se duplican aquí sus propias suites.
//
// Estrategia de cobertura para WhatsApp/Telegram (puntos 13-17): el código
// de Fase 5 que procesa estos eventos es exactamente `processOutreachEvent`
// y `correlateInboundContact` — provider-agnostic, sin ninguna rama
// específica de proveedor salvo el `provider`/`eventType` que ya normalizó
// la ruta. Las ramas aditivas en routes/whatsapp.ts y routes/telegram.ts
// SOLO llaman a estas dos funciones tras verificar la firma/secreto
// PRE-EXISTENTE de cada proveedor (infraestructura de Autopilot, no tocada
// en esta fase salvo el flag `signatureVerified` de WhatsApp — ver Paso 13).
// Probar esas dos funciones con provider="whatsapp"/"telegram" ejerce el
// mismo código, con los mismos argumentos, que ejecutaría la ruta HTTP real
// — sin necesitar credenciales cifradas de org_integrations ni reimplementar
// aquí la firma HMAC de Meta. El único proveedor con endpoint HTTP público
// NUEVO en esta fase (Resend) sí se prueba de extremo a extremo por HTTP.
//
// Externos mockeados (nunca se llama a un proveedor real ni se usan
// credenciales reales):
//  - paquete `resend` completo (Resend.webhooks.verify / Resend.emails.send).
//  - logAuditSystem: mock de PASO (pass-through a la implementación real)
//    que permite, en UN test puntual (punto 23), forzar que la siguiente
//    llamada falle — así se simula un fallo de proceso a mitad de camino
//    sin tener que romper la base de datos real.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db, leadResultsTable, leadContactsTable, leadMessagesTable, outreachEventsTable,
  outreachSuppressionsTable, moduleConfigsTable, auditLogsTable,
} from "@workspace/db";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { clearModuleCache } from "../../middlewares/requireModule";
import { OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG } from "../../outreach/webhooks/eventProcessor";

// ── Mocks ────────────────────────────────────────────────────────────────
const resendVerifyMock     = vi.hoisted(() => vi.fn());
const resendEmailsSendMock = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  // IMPORTANTE: el código real hace `new Resend(apiKey)` — la implementación
  // del mock debe ser una función normal (constructible), NUNCA una arrow
  // function: `new (() => {})()` lanza "is not a constructor".
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return {
      webhooks: { verify: resendVerifyMock },
      emails:   { send: resendEmailsSendMock },
    };
  }),
}));

// Pass-through por defecto — deja pasar todas las llamadas reales a la
// implementación real de logAuditSystem, salvo cuando `auditControl.throwNext`
// está armado, en cuyo caso la SIGUIENTE llamada (y solo esa) rechaza.
const auditControl = vi.hoisted(() => ({ throwNext: false }));
vi.mock("../../utils/auditLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/auditLogger")>();
  return {
    ...actual,
    logAuditSystem: (...args: Parameters<typeof actual.logAuditSystem>) => {
      if (auditControl.throwNext) {
        auditControl.throwNext = false;
        return Promise.reject(new Error("Simulated DB/processing failure (test — punto 23)"));
      }
      return actual.logAuditSystem(...args);
    },
  };
});

// Importados DESPUÉS de los mocks — mismo requisito que en Fases 2/4.
const { outreachWebhooksRouter } = await import("../outreachWebhooks");
const { processOutreachEvent }   = await import("../../outreach/webhooks/eventProcessor");
const { correlateInboundContact } = await import("../../outreach/webhooks/inboundCorrelation");
const { sendEmail } = await import("../../lib/email");
const EmailAdapterModule = await import("../../hub/adapters/emailAdapter");
void EmailAdapterModule; // se registra en el IntegrationRegistry por su solo side-effect de import

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 5 — Webhooks / Delivery Events", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";

  const cleanupResultIds: number[] = [];
  let svixCounter = 0;
  const nextSvixId = () => `svix-test-${Date.now()}-${++svixCounter}`;

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f5");
    process.env.RESEND_API_KEY      = "test-resend-api-key";
    process.env.RESEND_WEBHOOK_SECRET = "test-resend-webhook-secret";

    const app = express();
    app.use(express.json({ verify: (_req, _res, buf) => { (_req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
    app.use("/outreach/webhooks", outreachWebhooksRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) {
      await db.delete(leadMessagesTable).where(eq(leadMessagesTable.resultId, id));
      await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
      await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    }
    await db.delete(outreachEventsTable).where(eq(outreachEventsTable.orgId, orgAId));
    await db.delete(outreachEventsTable).where(eq(outreachEventsTable.orgId, orgBId));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgAId));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgBId));
    await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.moduleSlug, OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  // ── Helpers de seed ────────────────────────────────────────────────────
  async function seedContact(orgId: number, opts: { email?: string; phone?: string } = {}) {
    const [result] = await db.insert(leadResultsTable).values({ orgId, name: `Empresa F5 ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contact] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id, name: "Contacto F5", provider: "contact_finder_mock",
      email: opts.email ?? null, phone: opts.phone ?? null, status: "encontrado",
    }).returning();
    return { resultId: result!.id, contactId: contact!.id };
  }

  /** Un lead_message ya "sent" (como lo deja Fase 4), listo para correlacionar un webhook de delivery. */
  async function seedSentMessage(orgId: number, opts: { channel: "email" | "whatsapp" | "telegram"; externalMessageId: string; email?: string; phone?: string }) {
    const { resultId, contactId } = await seedContact(orgId, opts);
    const [msg] = await db.insert(leadMessagesTable).values({
      orgId, resultId, contactId, channel: opts.channel, provider: opts.channel, content: "Mensaje de prueba Fase 5",
      status: "sent", sentAt: new Date(), externalMessageId: opts.externalMessageId,
    }).returning();
    return { resultId, contactId, messageId: msg!.id };
  }

  function resendPayload(type: string, emailId: string) {
    return { type, created_at: new Date().toISOString(), data: { email_id: emailId, from: "a@b.invalid", to: ["c@d.invalid"], subject: "test", created_at: new Date().toISOString() } };
  }

  async function postResendWebhook(body: unknown, headers: Record<string, string> | null = { "svix-id": nextSvixId(), "svix-timestamp": String(Date.now()), "svix-signature": "v1,mock" }) {
    const resp = await fetch(`${base}/outreach/webhooks/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
    });
    let respBody: Record<string, unknown> = {};
    try { respBody = await resp.json() as Record<string, unknown>; } catch { /* body vacío en algunos 4xx/5xx */ }
    return { status: resp.status, body: respBody };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1 — Resend válido
  // ═══════════════════════════════════════════════════════════════════════
  it("1 — evento Resend válido y firmado se procesa correctamente", async () => {
    const emailId = `email-valid-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.delivered", emailId));
    const res = await postResendWebhook(resendPayload("email.delivered", emailId));
    expect(res.status).toBe(200);
    expect(res.body["processed"]).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2 — firma Resend inválida
  // ═══════════════════════════════════════════════════════════════════════
  it("2 — firma Resend inválida se rechaza (400) y nunca se procesa el payload", async () => {
    resendVerifyMock.mockImplementationOnce(() => { throw new Error("Invalid signature"); });
    const res = await postResendWebhook(resendPayload("email.delivered", "email-bad-sig"));
    expect(res.status).toBe(400);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3 — payload/headers Resend inválidos
  // ═══════════════════════════════════════════════════════════════════════
  it("3 — faltan los headers de firma Svix → 400, nunca se llama a verify()", async () => {
    resendVerifyMock.mockClear();
    const res = await postResendWebhook(resendPayload("email.delivered", "email-no-headers"), {});
    expect(res.status).toBe(400);
    expect(resendVerifyMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4 — evento desconocido / fuera del alcance mínimo
  // ═══════════════════════════════════════════════════════════════════════
  it("4 — un evento real de Resend pero no implementado (email.sent) se acepta sin aplicar efectos", async () => {
    const emailId = `email-sent-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.sent", emailId));
    const res = await postResendWebhook(resendPayload("email.sent", emailId));
    expect(res.status).toBe(200);
    expect(res.body["processed"]).toBe(false);
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
    expect(row!.deliveryStatus).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5 y 22 — evento duplicado / replay
  // ═══════════════════════════════════════════════════════════════════════
  it("5 y 22 — el mismo svix-id reenviado (duplicado/replay) no reprocesa ni duplica efectos", async () => {
    const emailId = `email-dup-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    const svixId = nextSvixId();
    const payload = resendPayload("email.opened", emailId);
    resendVerifyMock.mockReturnValue(payload);

    const headers = { "svix-id": svixId, "svix-timestamp": String(Date.now()), "svix-signature": "v1,mock" };
    const first  = await postResendWebhook(payload, headers);
    const second = await postResendWebhook(payload, headers); // mismo svix-id — simula un reintento/replay del proveedor
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body["outcome"]).toBe("duplicate");

    const events = await db.select().from(outreachEventsTable).where(and(eq(outreachEventsTable.provider, "email"), eq(outreachEventsTable.externalEventId, svixId)));
    expect(events).toHaveLength(1); // UNIQUE(provider, external_event_id) — una sola fila, nunca dos
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6 — delivered
  // ═══════════════════════════════════════════════════════════════════════
  it("6 — email.delivered actualiza delivery_status y delivered_at", async () => {
    const emailId = `email-delivered-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.delivered", emailId));
    await postResendWebhook(resendPayload("email.delivered", emailId));
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
    expect(row!.deliveryStatus).toBe("delivered");
    expect(row!.deliveredAt).not.toBeNull();
    expect(row!.lastEventAt).not.toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7 y 11 — bounced + suppression automática
  // ═══════════════════════════════════════════════════════════════════════
  it("7 y 11 — email.bounced actualiza bounced_at y crea suppression automáticamente", async () => {
    const email = `bounce-${Date.now()}@test.invalid`;
    const emailId = `email-bounced-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId, email });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.bounced", emailId));
    await postResendWebhook(resendPayload("email.bounced", emailId));

    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
    expect(row!.deliveryStatus).toBe("bounced");
    expect(row!.bouncedAt).not.toBeNull();

    const supp = await db.select().from(outreachSuppressionsTable).where(and(
      eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.email, email), eq(outreachSuppressionsTable.reason, "bounced"),
    ));
    expect(supp).toHaveLength(1);
    expect(supp[0]!.source).toBe("provider_webhook");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8 — complaint
  // ═══════════════════════════════════════════════════════════════════════
  it("8 — email.complained crea suppression por queja", async () => {
    const email = `complaint-${Date.now()}@test.invalid`;
    const emailId = `email-complained-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId, email });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.complained", emailId));
    await postResendWebhook(resendPayload("email.complained", emailId));

    const supp = await db.select().from(outreachSuppressionsTable).where(and(
      eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.email, email), eq(outreachSuppressionsTable.reason, "complaint"),
    ));
    expect(supp).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9 — opened
  // ═══════════════════════════════════════════════════════════════════════
  it("9 — email.opened actualiza opened_at", async () => {
    const emailId = `email-opened-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.opened", emailId));
    await postResendWebhook(resendPayload("email.opened", emailId));
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
    expect(row!.openedAt).not.toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10 — clicked
  // ═══════════════════════════════════════════════════════════════════════
  it("10 — email.clicked actualiza clicked_at", async () => {
    const emailId = `email-clicked-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.clicked", emailId));
    await postResendWebhook(resendPayload("email.clicked", emailId));
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
    expect(row!.clickedAt).not.toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12 — suppression ya existente (idempotencia de EFECTOS, no solo del evento)
  // ═══════════════════════════════════════════════════════════════════════
  it("12 — un segundo bounce (evento DISTINTO) para el mismo destino no duplica la suppression", async () => {
    const email = `bounce-twice-${Date.now()}@test.invalid`;
    const emailId1 = `email-bounced-a-${Date.now()}`;
    const emailId2 = `email-bounced-b-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId1, email });
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId2, email });

    resendVerifyMock.mockReturnValueOnce(resendPayload("email.bounced", emailId1));
    await postResendWebhook(resendPayload("email.bounced", emailId1));
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.bounced", emailId2));
    await postResendWebhook(resendPayload("email.bounced", emailId2)); // evento distinto (external_event_id distinto), MISMO destino

    const supp = await db.select().from(outreachSuppressionsTable).where(and(
      eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.email, email), eq(outreachSuppressionsTable.reason, "bounced"),
    ));
    expect(supp).toHaveLength(1); // ya existía — ensureSuppression() no crea una segunda fila
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13/14/15 — WhatsApp delivered / read / failed (misma processOutreachEvent que usa routes/whatsapp.ts)
  // ═══════════════════════════════════════════════════════════════════════
  it("13 — WhatsApp 'delivered' actualiza delivery_status (texto crudo) y last_event_at", async () => {
    const wamid = `wamid.delivered.${Date.now()}`;
    const { messageId } = await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: wamid, phone: "+34600111111" });
    const result = await processOutreachEvent({
      provider: "whatsapp", externalEventId: `${wamid}:delivered:1`, eventType: "whatsapp_status_delivered",
      rawPayload: { id: wamid, status: "delivered" }, correlate: { by: "external_message_id", externalMessageId: wamid },
    });
    expect(result.outcome).toBe("processed");
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, messageId));
    expect(row!.deliveryStatus).toBe("whatsapp_status_delivered");
    expect(row!.lastEventAt).not.toBeNull();
    // NOTA (documentado también en el informe final): delivered_at/bounced_at
    // son la semántica de Resend (Paso 8); WhatsApp usa su propio vocabulario
    // de estados y NO se inventa aquí una equivalencia 1:1 no pedida — el
    // tracking de WhatsApp vive en delivery_status + last_event_at.
    expect(row!.deliveredAt).toBeNull();
  });

  it("14 — WhatsApp 'read' se procesa igual que cualquier otro status confirmado por Meta", async () => {
    const wamid = `wamid.read.${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: wamid, phone: "+34600111112" });
    const result = await processOutreachEvent({
      provider: "whatsapp", externalEventId: `${wamid}:read:1`, eventType: "whatsapp_status_read",
      rawPayload: { id: wamid, status: "read" }, correlate: { by: "external_message_id", externalMessageId: wamid },
    });
    expect(result.outcome).toBe("processed");
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, wamid));
    expect(row!.deliveryStatus).toBe("whatsapp_status_read");
  });

  it("15 — WhatsApp 'failed' se registra como tracking, sin crear suppression (no es un bounce/complaint confirmado)", async () => {
    const wamid = `wamid.failed.${Date.now()}`;
    const { contactId } = await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: wamid, phone: "+34600111113" });
    const result = await processOutreachEvent({
      provider: "whatsapp", externalEventId: `${wamid}:failed:1`, eventType: "whatsapp_status_failed",
      rawPayload: { id: wamid, status: "failed" }, correlate: { by: "external_message_id", externalMessageId: wamid },
    });
    expect(result.outcome).toBe("processed");
    const [contact] = await db.select().from(leadContactsTable).where(eq(leadContactsTable.id, contactId));
    const supp = await db.select().from(outreachSuppressionsTable).where(and(eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.phone, contact!.phone!)));
    expect(supp).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 16/17 — Inbound WhatsApp / Telegram correlacionado con OmniSeller
  // ═══════════════════════════════════════════════════════════════════════
  it("16 — un mensaje entrante de WhatsApp correlacionado registra outreach_event de tipo inbound", async () => {
    const phone = `+3460099${Date.now() % 10000}`;
    const { contactId } = await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: `wamid.inbound.${Date.now()}`, phone });
    const correlation = await correlateInboundContact(orgAId, "whatsapp", phone);
    expect(correlation).not.toBeNull();
    expect(correlation!.contactId).toBe(contactId);

    const eventId = `whatsapp_inbound:${orgAId}:${contactId}:${Date.now()}`;
    const result = await processOutreachEvent({
      provider: "whatsapp", externalEventId: eventId, eventType: "whatsapp_inbound",
      rawPayload: { fromPhone: phone, text: "Hola" },
      correlate: { by: "resolved", orgId: orgAId, contactId, leadMessageId: correlation!.mostRecentLeadMessageId ?? undefined },
    });
    expect(result.outcome).toBe("processed");
    const logs = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.action, "outreach.inbound_received")));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("17 — un mensaje entrante de Telegram correlacionado (chat_id exacto) registra inbound", async () => {
    const chatId = `${900000000 + (Date.now() % 100000)}`;
    const { resultId, contactId } = await seedContact(orgAId, {});
    await db.update(leadContactsTable).set({ phone: chatId }).where(eq(leadContactsTable.id, contactId));
    await db.insert(leadMessagesTable).values({
      orgId: orgAId, resultId, contactId, channel: "telegram", provider: "telegram",
      content: "test", status: "sent", sentAt: new Date(),
    });

    const correlation = await correlateInboundContact(orgAId, "telegram", chatId, true);
    expect(correlation).not.toBeNull();

    const result = await processOutreachEvent({
      provider: "telegram", externalEventId: `telegram_inbound:${orgAId}:${contactId}:${Date.now()}`, eventType: "telegram_inbound",
      rawPayload: { chatId, text: "Hola" },
      correlate: { by: "resolved", orgId: orgAId, contactId, leadMessageId: correlation!.mostRecentLeadMessageId ?? undefined },
    });
    expect(result.outcome).toBe("processed");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 18 — cross-org: un evento de Org A nunca puede afectar a Org B
  // ═══════════════════════════════════════════════════════════════════════
  it("18 — correlateInboundContact nunca encuentra un contacto de otra organización", async () => {
    const phone = `+3460088${Date.now() % 10000}`;
    await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: `wamid.crossorg.${Date.now()}`, phone });
    const correlationFromOrgB = await correlateInboundContact(orgBId, "whatsapp", phone);
    expect(correlationFromOrgB).toBeNull(); // el contacto existe, pero pertenece a Org A
  });

  it("18b — resolveTarget revalida org+contacto incluso si 'resolved' llega con un contactId que no es de esa org", async () => {
    const { contactId: contactOfOrgA } = await seedSentMessage(orgAId, { channel: "whatsapp", externalMessageId: `wamid.crossorg2.${Date.now()}`, phone: "+34611111111" });
    // Un evento que afirma pertenecer a Org B pero apunta al contactId de Org A — defensa en profundidad (Paso 17).
    const result = await processOutreachEvent({
      provider: "whatsapp", externalEventId: `whatsapp_inbound:crossorg:${Date.now()}`, eventType: "whatsapp_inbound",
      rawPayload: {}, correlate: { by: "resolved", orgId: orgBId, contactId: contactOfOrgA },
    });
    expect(result.outcome).toBe("ignored");
    if (result.outcome === "ignored") expect(result.reason).toBe("no_correlation");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 19 — mensaje inexistente
  // ═══════════════════════════════════════════════════════════════════════
  it("19 — un external_message_id que no corresponde a ningún lead_message se ignora sin modificar nada", async () => {
    const externalEventId = `nonexistent-${Date.now()}`;
    const result = await processOutreachEvent({
      provider: "email", externalEventId, eventType: "delivered",
      rawPayload: {}, correlate: { by: "external_message_id", externalMessageId: "no-existe-este-id" },
    });
    expect(result.outcome).toBe("ignored");
    const [row] = await db.select().from(outreachEventsTable).where(eq(outreachEventsTable.externalEventId, externalEventId));
    expect(row!.orgId).toBeNull();
    expect(row!.status).toBe("ignored");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 20 — "provider"/evento desconocido a nivel del webhook de Resend
  // ═══════════════════════════════════════════════════════════════════════
  it("20 — un tipo de evento de Resend no documentado/reconocido se acepta sin inventar un tratamiento", async () => {
    const emailId = `email-unknown-type-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
    resendVerifyMock.mockReturnValueOnce(resendPayload("email.some_future_event_not_yet_documented", emailId));
    const res = await postResendWebhook(resendPayload("email.some_future_event_not_yet_documented", emailId));
    expect(res.status).toBe(200);
    expect(res.body["processed"]).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 21 — kill switch
  // ═══════════════════════════════════════════════════════════════════════
  it("21 — con omni_seller_webhooks desactivado, el evento se acepta pero no se aplican efectos", async () => {
    await db.insert(moduleConfigsTable).values({ orgId: orgAId, moduleSlug: OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG, isEnabled: false, updatedBy: "test" })
      .onConflictDoUpdate({ target: [moduleConfigsTable.orgId, moduleConfigsTable.moduleSlug], set: { isEnabled: false } });
    clearModuleCache(orgAId, OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG);

    try {
      const emailId = `email-killswitch-${Date.now()}`;
      await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId });
      resendVerifyMock.mockReturnValueOnce(resendPayload("email.delivered", emailId));
      await postResendWebhook(resendPayload("email.delivered", emailId));

      const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.externalMessageId, emailId));
      expect(row!.deliveryStatus).toBeNull(); // el evento se aceptó (200) pero no tocó tracking

      const logs = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.action, "outreach.webhook_blocked")));
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      // Reactivar SIEMPRE (incluso si una aserción falla arriba) — para no
      // contaminar los tests siguientes de este archivo, que asumen el kill
      // switch en su estado por defecto (habilitado).
      await db.update(moduleConfigsTable).set({ isEnabled: true })
        .where(and(eq(moduleConfigsTable.orgId, orgAId), eq(moduleConfigsTable.moduleSlug, OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG)));
      clearModuleCache(orgAId, OUTREACH_WEBHOOKS_KILL_SWITCH_SLUG);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 23 — DB / error de procesamiento a mitad de camino → reintento seguro
  // ═══════════════════════════════════════════════════════════════════════
  it("23 — un fallo a mitad del procesamiento deja el evento en 'error' y un reintento posterior lo completa sin duplicar efectos", async () => {
    const email = `dberror-${Date.now()}@test.invalid`;
    const emailId = `email-dberror-${Date.now()}`;
    await seedSentMessage(orgAId, { channel: "email", externalMessageId: emailId, email });
    const externalEventId = `dberror-event-${Date.now()}`;

    auditControl.throwNext = true;
    const failed = await processOutreachEvent({
      provider: "email", externalEventId, eventType: "bounced",
      rawPayload: {}, correlate: { by: "external_message_id", externalMessageId: emailId },
    });
    expect(failed.outcome).toBe("error");

    const [rowAfterFailure] = await db.select().from(outreachEventsTable).where(eq(outreachEventsTable.externalEventId, externalEventId));
    expect(rowAfterFailure!.status).toBe("error");

    // Reintento del proveedor con el MISMO external_event_id — debe completar sobre la misma fila.
    const retried = await processOutreachEvent({
      provider: "email", externalEventId, eventType: "bounced",
      rawPayload: {}, correlate: { by: "external_message_id", externalMessageId: emailId },
    });
    expect(retried.outcome).toBe("processed");

    const [rowAfterRetry] = await db.select().from(outreachEventsTable).where(eq(outreachEventsTable.externalEventId, externalEventId));
    expect(rowAfterRetry!.id).toBe(rowAfterFailure!.id); // misma fila reutilizada, no una segunda
    expect(rowAfterRetry!.status).toBe("processed");

    // La suppression, aunque el tracking ya se aplicó en el intento fallido, no se duplicó en el reintento.
    const supp = await db.select().from(outreachSuppressionsTable).where(and(eq(outreachSuppressionsTable.orgId, orgAId), eq(outreachSuppressionsTable.email, email)));
    expect(supp).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 24 y 25 — providerId de Resend correctamente propagado y capturado (regresión Paso 1)
  // ═══════════════════════════════════════════════════════════════════════
  it("24 y 25 — sendEmail()/EmailAdapter propagan el id real de Resend sin romper el contrato existente", async () => {
    // 25a — sin RESEND_API_KEY, sigue devolviendo ok:false sin lanzar (comportamiento previo preservado).
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const withoutKey = await sendEmail("dest@test.invalid", "Asunto", "<p>hola</p>");
    expect(withoutKey.ok).toBe(false);
    process.env.RESEND_API_KEY = prevKey;

    // 24 — con la API key configurada (mock de Resend), el id devuelto por
    // resend.emails.send() se propaga tal cual, exactamente el mismo id que
    // luego usaría un webhook real en data.email_id para correlacionar.
    resendEmailsSendMock.mockResolvedValueOnce({ data: { id: "resend-real-id-42" }, error: null });
    const withKey = await sendEmail("dest2@test.invalid", "Asunto", "<p>hola</p>");
    expect(withKey.ok).toBe(true);
    expect(withKey.id).toBe("resend-real-id-42");

    const { IntegrationRegistry } = await import("../../hub/integrationRegistry");
    const emailAdapter = IntegrationRegistry.get("email");
    expect(emailAdapter).toBeDefined();
    resendEmailsSendMock.mockResolvedValueOnce({ data: { id: "resend-real-id-43" }, error: null });
    const adapterResult = await emailAdapter!.send({ orgId: orgAId, credentials: {}, config: {} }, { to: "dest3@test.invalid", message: "hola" });
    expect(adapterResult.success).toBe(true);
    expect(adapterResult.providerId).toBe("resend-real-id-43");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 26-29 — Regresión F1/F2/F3/F4: ver nota de cabecera — se verifican
  // ejecutando este archivo JUNTO a omniSellerFase{1,2,3,4}.integration.test.ts.
  // ═══════════════════════════════════════════════════════════════════════
});
