// Restricciones reales del esquema review_* (Postgres real): deduplicación por empresa,
// idempotencia de envíos, CHECKs, cascada y valores por defecto de cumplimiento.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db, reviewContactsTable, reviewLocationsTable, reviewCampaignsTable, reviewMessagesTable, reviewReviewsTable, reviewSettingsTable } from "@workspace/db";
import { cleanupOrgs, createOrg, hasRealDb } from "./testHarness";

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return ((e as { cause?: { code?: string } }).cause?.code) ?? (e as { code?: string }).code ?? "ERR"; } };

describe.skipIf(!hasRealDb)("esquema review_* (Postgres real)", () => {
  let a = 0, b = 0, loc = 0, camp = 0, c1 = 0;
  beforeAll(async () => {
    a = await createOrg("sa"); b = await createOrg("sb");
    loc = (await db.insert(reviewLocationsTable).values({ orgId: a, name: "L" }).returning())[0]!.id;
    camp = (await db.insert(reviewCampaignsTable).values({ orgId: a, locationId: loc, name: "C", channel: "whatsapp" }).returning())[0]!.id;
    c1 = (await db.insert(reviewContactsTable).values({ orgId: a, emailNorm: "x@y.es", source: "csv" }).returning())[0]!.id;
  });
  afterAll(async () => { await cleanupOrgs([a, b]); });

  it("email duplicado en la misma empresa → violación única (23505)", async () => {
    expect(await code(db.insert(reviewContactsTable).values({ orgId: a, emailNorm: "x@y.es", source: "csv" }))).toBe("23505");
  });
  it("el mismo email en otra empresa es válido", async () => {
    expect(await code(db.insert(reviewContactsTable).values({ orgId: b, emailNorm: "x@y.es", source: "csv" }))).toBeNull();
  });
  it("teléfono E.164 duplicado → 23505; varios sin teléfono/email no chocan", async () => {
    await db.insert(reviewContactsTable).values({ orgId: a, phoneE164: "+34600111222", source: "csv" });
    expect(await code(db.insert(reviewContactsTable).values({ orgId: a, phoneE164: "+34600111222", source: "xlsx" }))).toBe("23505");
    expect(await code(db.insert(reviewContactsTable).values({ orgId: a, source: "manual" }))).toBeNull();
    expect(await code(db.insert(reviewContactsTable).values({ orgId: a, source: "manual" }))).toBeNull();
  });
  it("canal no registrado (sms) rechazado por CHECK hasta que exista su ChannelProvider", async () => {
    expect(await code(db.insert(reviewCampaignsTable).values({ orgId: a, locationId: loc, name: "x", channel: "sms" }))).toBe("23514");
  });
  it("máximo 1 recordatorio y límite de ritmo acotado", async () => {
    expect(await code(db.insert(reviewCampaignsTable).values({ orgId: a, locationId: loc, name: "x", channel: "email", maxReminders: 2 }))).toBe("23514");
    expect(await code(db.insert(reviewCampaignsTable).values({ orgId: a, locationId: loc, name: "x", channel: "email", ratePerMinute: 0 }))).toBe("23514");
  });
  it("idempotencia: segundo envío del mismo (campaña, contacto, tipo, seq) → 23505; recordatorio seq=1 permitido; token único", async () => {
    const base = { orgId: a, campaignId: camp, contactId: c1, channel: "whatsapp" };
    await db.insert(reviewMessagesTable).values({ ...base, trackingToken: "t1" });
    expect(await code(db.insert(reviewMessagesTable).values({ ...base, trackingToken: "t2" }))).toBe("23505");
    expect(await code(db.insert(reviewMessagesTable).values({ ...base, kind: "reminder", seq: 1, trackingToken: "t3" }))).toBeNull();
    expect(await code(db.insert(reviewMessagesTable).values({ ...base, kind: "reminder", seq: 2, trackingToken: "t3" }))).toBe("23505");
  });
  it("la cola solo reclama mensajes 'queued' vencidos y dos reclamaciones simultáneas no cogen el mismo", async () => {
    const claim = () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM review_messages WHERE org_id = ${a}::integer AND status = 'queued' AND next_attempt_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const id = (r as unknown as { rows: { id: number }[] }).rows[0]?.id ?? null;
      await new Promise((res) => setTimeout(res, 150)); // mantiene el bloqueo mientras la otra intenta
      return id;
    });
    const [x, y] = await Promise.all([claim(), claim()]);
    expect([x, y].filter((v) => v !== null).length).toBeGreaterThanOrEqual(1);
    if (x !== null && y !== null) expect(x).not.toBe(y);
  });
  it("valoración fuera de 1–5 rechazada; google_review_id único por empresa", async () => {
    const r = { orgId: a, locationId: loc, publishedAt: new Date() };
    expect(await code(db.insert(reviewReviewsTable).values({ ...r, googleReviewId: "g1", rating: 6 }))).toBe("23514");
    await db.insert(reviewReviewsTable).values({ ...r, googleReviewId: "g1", rating: 5 });
    expect(await code(db.insert(reviewReviewsTable).values({ ...r, googleReviewId: "g1", rating: 4 }))).toBe("23505");
  });
  it("valores por defecto de cumplimiento: retención 24 meses y aprobación humana siempre", async () => {
    await db.insert(reviewSettingsTable).values({ orgId: a });
    const [s] = await db.select().from(reviewSettingsTable).where(eq(reviewSettingsTable.orgId, a));
    expect(s!.retentionMonths).toBe(24);
    expect(s!.aiApproval).toEqual({ reply_publish: "always_approve", alert_notify: "always_approve" });
    expect(await code(db.update(reviewSettingsTable).set({ retentionMonths: 0 }).where(eq(reviewSettingsTable.orgId, a)))).toBe("23514");
  });
  it("borrar una empresa elimina todos sus datos review_* y no toca los de otra", async () => {
    const tmp = await createOrg("cascade");
    await db.insert(reviewContactsTable).values({ orgId: tmp, emailNorm: "z@z.es", source: "csv" });
    await cleanupOrgs([tmp]);
    const left = await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.orgId, tmp));
    expect(left.length).toBe(0);
    expect((await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.orgId, b))).length).toBe(1);
  });
});
