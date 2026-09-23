// OmniSeller Fase 4 — Outreach controlado (draft → confirmación humana → envío).
//
// Cubre los 24 puntos del plan ejecutable de esta fase. Los puntos 21-24
// (regresión de OmniLeads/Fase1/Fase2/Contact Finder) se verifican
// ejecutando este archivo JUNTO a omniSellerFase{1,2,3}.integration.test.ts
// (todos en verde) — no se duplican aquí sus propias suites completas.
//
// IntegrationManager.send() (Hub) está mockeado en este archivo: así ningún
// test golpea Resend/WhatsApp Cloud API/Telegram reales — ver el punto 19
// del informe. El motivo NO es solo evitar red real: sin RESEND_API_KEY en
// este sandbox el adapter de email real siempre devolvería success:false,
// lo que haría imposible probar la rama de "envío correcto" (punto 14) sin
// mockear un nivel por encima.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and, like } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadContactsTable, leadMessagesTable,
  outreachConfirmationsTable, outreachSuppressionsTable, moduleConfigsTable, creditHoldsTable, creditLedgerTable,
  auditLogsTable,
} from "@workspace/db";
import { grantCredits, getBalance } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";
import { clearModuleCache } from "../../middlewares/requireModule";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../../hub", () => ({ IntegrationManager: { send: sendMock } }));

// Importado DESPUÉS del mock — mismo requisito que en Fase 2.
const { missionsRouter } = await import("../missions");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 4 — Outreach", () => {
  let orgAId: number;
  let orgBId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f4");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId: 1, clerkUserId: "omniseller-f4-user" });
      next();
    });
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadMessagesTable).where(eq(leadMessagesTable.resultId, id));
    for (const id of cleanupResultIds) await db.delete(leadContactsTable).where(eq(leadContactsTable.leadResultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgAId));
    await db.delete(outreachSuppressionsTable).where(eq(outreachSuppressionsTable.orgId, orgBId));
    await db.delete(moduleConfigsTable).where(eq(moduleConfigsTable.moduleSlug, "omni_seller_outreach"));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  beforeEach(() => { sendMock.mockClear(); sendMock.mockReset(); });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  async function seedMissionWithContact(orgId: number, contact: { email?: string; phone?: string } = { email: "destino@empresa-test.invalid" }) {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission outreach test ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({ orgId, missionId: mission!.id, sector: "t", city: "Madrid", status: "done" }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({ orgId, searchId: search!.id, name: `Empresa ${Date.now()}`, status: "new" }).returning();
    cleanupResultIds.push(result!.id);
    const [contactRow] = await db.insert(leadContactsTable).values({
      orgId, leadResultId: result!.id, name: "Contacto Test", provider: "contact_finder_mock",
      email: contact.email ?? null, phone: contact.phone ?? null, status: "encontrado",
    }).returning();
    return { missionId: mission!.id, leadResultId: result!.id, contactId: contactRow!.id };
  }

  async function createDraft(orgId: number, missionId: number, contactId: number, channel: string, content = "Hola, te escribo desde OmniSeller.") {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/missions/${missionId}/contacts/${contactId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, content }),
    });
    const body = await resp.json() as { id?: number; error?: string };
    return { status: resp.status, messageId: body.id, body };
  }

  async function requestConfirmation(orgId: number, missionId: number, messageId: number) {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/missions/${missionId}/messages/${messageId}/request-confirmation`, { method: "POST" });
    const body = await resp.json() as { confirmToken?: string; error?: string };
    return { status: resp.status, confirmToken: body.confirmToken, body };
  }

  async function confirm(orgId: number, missionId: number, messageId: number, confirmToken: string) {
    asOrg(orgId);
    const resp = await fetch(`${base}/api/missions/${missionId}/messages/${messageId}/confirm`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmToken }),
    });
    const body = await resp.json() as Record<string, unknown>;
    return { status: resp.status, body };
  }

  /** Draft + request-confirmation en un solo paso, listo para /confirm. */
  async function readyMessage(orgId: number, contact: { email?: string; phone?: string } = {}, channel = "email") {
    const { missionId, contactId } = await seedMissionWithContact(orgId, Object.keys(contact).length ? contact : { email: `dest-${Date.now()}@empresa-test.invalid` });
    const draft = await createDraft(orgId, missionId, contactId, channel);
    const rc = await requestConfirmation(orgId, missionId, draft.messageId!);
    return { missionId, contactId, messageId: draft.messageId!, confirmToken: rc.confirmToken!, rcStatus: rc.status };
  }

  // ── 1. Draft de mensaje ──────────────────────────────────────────────────
  it("1 — crea un draft ligado a Mission→Lead→Contact", async () => {
    const { missionId, contactId } = await seedMissionWithContact(orgAId);
    const draft = await createDraft(orgAId, missionId, contactId, "email");
    expect(draft.status).toBe(201);
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("draft");
    expect(row!.contactId).toBe(contactId);
  });

  // ── 2. Mensaje pendiente de confirmación ─────────────────────────────────
  it("2 — request-confirmation mueve el draft a pending_confirmation y devuelve un token", async () => {
    const { missionId, contactId } = await seedMissionWithContact(orgAId);
    const draft = await createDraft(orgAId, missionId, contactId, "email");
    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    expect(rc.status).toBe(200);
    expect(typeof rc.confirmToken).toBe("string");
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("pending_confirmation");
  });

  // ── 3. Envío sin confirmación → BLOQUEADO ────────────────────────────────
  it("3 — confirm sin token válido está bloqueado", async () => {
    const { missionId, contactId } = await seedMissionWithContact(orgAId);
    const draft = await createDraft(orgAId, missionId, contactId, "email");
    // Ni siquiera se ha pedido confirmación — el mensaje sigue en 'draft'.
    const res = await confirm(orgAId, missionId, draft.messageId!, "un-token-que-no-existe");
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 4. Confirmación válida → permite continuar ───────────────────────────
  it("4 — confirmación válida + saldo suficiente envía el mensaje", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-msg-1" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-4` });
    const ready = await readyMessage(orgAId, { email: `d4-${Date.now()}@test.invalid` });
    expect(ready.rcStatus).toBe(200);
    const res = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // ── 5. Token expirado → BLOQUEADO ────────────────────────────────────────
  it("5 — un token ya caducado está bloqueado", async () => {
    const ready = await readyMessage(orgAId, { email: `d5-${Date.now()}@test.invalid` });
    await db.update(outreachConfirmationsTable).set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(outreachConfirmationsTable.leadMessageId, ready.messageId));
    const res = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 6. Token reutilizado → BLOQUEADO ─────────────────────────────────────
  it("6 — un token ya consumido no puede reutilizarse", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-msg-6" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-6` });
    const ready = await readyMessage(orgAId, { email: `d6-${Date.now()}@test.invalid` });
    const first = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(first.status).toBe(200);
    const second = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(second.status).toBe(409);
    expect(sendMock).toHaveBeenCalledTimes(1); // el segundo intento nunca llegó al provider
  });

  // ── 7. Token de otra organización → BLOQUEADO ────────────────────────────
  it("7 — un token válido de otra organización no confirma nada", async () => {
    const ready = await readyMessage(orgAId, { email: `d7-${Date.now()}@test.invalid` });
    const res = await confirm(orgBId, ready.missionId, ready.messageId, ready.confirmToken);
    // orgB ni siquiera encuentra el mensaje (pertenece a otra org) — mismo
    // comportamiento de seguridad que Fase 2/3 para recursos ajenos.
    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 8, 9, 10. Suppression list (genérica, email y teléfono) ──────────────
  it("8 — un contacto bloqueado para todos los canales (channel=null) no admite confirmación", async () => {
    const email = `d8-${Date.now()}@test.invalid`;
    await db.insert(outreachSuppressionsTable).values({ orgId: orgAId, email, reason: "manual_block", source: "test" });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { email });
    const draft = await createDraft(orgAId, missionId, contactId, "email");
    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    expect(rc.status).toBe(409);
    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("suppressed");
  });

  it("9 — email suprimido específicamente para el canal email bloquea ese canal", async () => {
    const email = `d9-${Date.now()}@test.invalid`;
    await db.insert(outreachSuppressionsTable).values({ orgId: orgAId, email, channel: "email", reason: "bounced", source: "test" });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { email });
    const draft = await createDraft(orgAId, missionId, contactId, "email");
    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    expect(rc.status).toBe(409);
  });

  it("10 — teléfono suprimido bloquea el canal whatsapp para ese contacto", async () => {
    const phone = `+34600${Date.now() % 1000000}`;
    await db.insert(outreachSuppressionsTable).values({ orgId: orgAId, phone, channel: "whatsapp", reason: "opt_out", source: "test" });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { phone });
    const draft = await createDraft(orgAId, missionId, contactId, "whatsapp");
    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    expect(rc.status).toBe(409);
  });

  // ── 11. Cooldown → BLOQUEADO ──────────────────────────────────────────────
  it("11 — un segundo mensaje al mismo contacto+canal dentro del cooldown está bloqueado", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-cooldown-1" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-11` });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { email: `d11-${Date.now()}@test.invalid` });

    const draft1 = await createDraft(orgAId, missionId, contactId, "email");
    const rc1 = await requestConfirmation(orgAId, missionId, draft1.messageId!);
    const sent1 = await confirm(orgAId, missionId, draft1.messageId!, rc1.confirmToken!);
    expect(sent1.status).toBe(200); // primer envío al contacto: ok, entra en cooldown

    const draft2 = await createDraft(orgAId, missionId, contactId, "email");
    const rc2 = await requestConfirmation(orgAId, missionId, draft2.messageId!);
    expect(rc2.status).toBe(429);
  });

  // ── 12. Doble ejecución concurrente → un solo envío ──────────────────────
  it("12 — dos confirm concurrentes con el mismo token solo envían una vez", async () => {
    sendMock.mockResolvedValue({ success: true, providerId: "ext-concurrent" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-12` });
    const ready = await readyMessage(orgAId, { email: `d12-${Date.now()}@test.invalid` });

    const [r1, r2] = await Promise.all([
      confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken),
      confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]); // uno gana, el otro ve el token ya consumido
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // ── 13. Provider error → releaseHold ─────────────────────────────────────
  it("13 — si el provider falla, no queda ningún hold abierto y el mensaje pasa a failed", async () => {
    sendMock.mockResolvedValueOnce({ success: false, error: "simulated provider failure" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-13` });
    const ready = await readyMessage(orgAId, { email: `d13-${Date.now()}@test.invalid` });

    const res = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(502);

    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, ready.messageId));
    expect(row!.status).toBe("failed");

    const holds = await db.select().from(creditHoldsTable).where(like(creditHoldsTable.reference, `outreach:send:${ready.messageId}%`));
    expect(holds.filter(h => h.status === "open")).toHaveLength(0);
  });

  // ── 14 y 18. Envío correcto → settleCredits + external message id ───────
  it("14 y 18 — un envío correcto liquida los créditos y guarda el external message id", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-msg-14" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-14` });
    const before = await getBalance(orgAId);
    const ready = await readyMessage(orgAId, { email: `d14-${Date.now()}@test.invalid` });

    const res = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(200);

    const after = await getBalance(orgAId);
    expect(after).toBe(before - 1);

    const [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, ready.messageId));
    expect(row!.status).toBe("sent");
    expect(row!.externalMessageId).toBe("ext-msg-14");
    expect(row!.creditsSpent).toBe(1);

    const ledger = await db.select().from(creditLedgerTable).where(like(creditLedgerTable.reference, `outreach:send:${ready.messageId}%`));
    expect(ledger.length).toBeGreaterThan(0);
  });

  // ── 15. Crédito insuficiente → no se llama provider ─────────────────────
  it("15 — sin saldo, el provider nunca se llama (402)", async () => {
    const ready = await readyMessage(orgBId, { email: `d15-${Date.now()}@test.invalid` }); // orgB: saldo cero garantizado en este archivo
    const res = await confirm(orgBId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(402);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 16. Kill switch activado → no se llama provider ──────────────────────
  it("16 — con el kill switch de Outreach activado, no se llama al provider (409)", async () => {
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-16` });
    await db.insert(moduleConfigsTable).values({ orgId: orgAId, moduleSlug: "omni_seller_outreach", isEnabled: false, updatedBy: "test" })
      .onConflictDoUpdate({ target: [moduleConfigsTable.orgId, moduleConfigsTable.moduleSlug], set: { isEnabled: false } });
    clearModuleCache(orgAId, "omni_seller_outreach");

    const ready = await readyMessage(orgAId, { email: `d16-${Date.now()}@test.invalid` });
    const res = await confirm(orgAId, ready.missionId, ready.messageId, ready.confirmToken);
    expect(res.status).toBe(409);
    expect((res.body as { error?: string }).error).toBe("blocked_kill_switch");
    expect(sendMock).not.toHaveBeenCalled();

    // Reactivar para no contaminar los tests siguientes de este archivo.
    await db.update(moduleConfigsTable).set({ isEnabled: true })
      .where(and(eq(moduleConfigsTable.orgId, orgAId), eq(moduleConfigsTable.moduleSlug, "omni_seller_outreach")));
    clearModuleCache(orgAId, "omni_seller_outreach");
  });

  // ── 17. Org A no puede enviar para Org B ─────────────────────────────────
  it("17 — Org A no puede confirmar/enviar un mensaje de Org B", async () => {
    const readyB = await readyMessage(orgBId, { email: `d17-${Date.now()}@test.invalid` });
    const res = await confirm(orgAId, readyB.missionId, readyB.messageId, readyB.confirmToken);
    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 19. Estado cambia correctamente a lo largo del ciclo de vida ────────
  it("19 — el estado avanza draft → pending_confirmation → sent, con approved_by y approved_at", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-lifecycle" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-19` });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { email: `d19-${Date.now()}@test.invalid` });

    const draft = await createDraft(orgAId, missionId, contactId, "email");
    let [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("draft");

    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("pending_confirmation");

    await confirm(orgAId, missionId, draft.messageId!, rc.confirmToken!);
    [row] = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.id, draft.messageId!));
    expect(row!.status).toBe("sent");
    expect(row!.approvedBy).toBe(1);
    expect(row!.approvedAt).not.toBeNull();
    expect(row!.sendAttemptedAt).not.toBeNull();
  });

  // ── 20. Audit log generado ────────────────────────────────────────────────
  it("20 — el ciclo completo deja audit log de cada paso", async () => {
    sendMock.mockResolvedValueOnce({ success: true, providerId: "ext-audit" });
    await grantCredits(orgAId, 5, { reference: `f4-grant-${Date.now()}-20` });
    const { missionId, contactId } = await seedMissionWithContact(orgAId, { email: `d20-${Date.now()}@test.invalid` });

    const draft = await createDraft(orgAId, missionId, contactId, "email");
    const rc = await requestConfirmation(orgAId, missionId, draft.messageId!);
    await confirm(orgAId, missionId, draft.messageId!, rc.confirmToken!);

    const logs = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.orgId, orgAId), eq(auditLogsTable.resourceId, String(draft.messageId)),
    ));
    const actions = logs.map(l => l.action);
    expect(actions).toContain("outreach.draft_created");
    expect(actions).toContain("outreach.confirmation_requested");
    expect(actions).toContain("outreach.send_succeeded");
  });
});
