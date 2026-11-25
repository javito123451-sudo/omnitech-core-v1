// Motor de campañas end-to-end con Postgres REAL. Solo la llamada HTTP al proveedor está sustituida (fakeProvider).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, reviewCampaignsTable, reviewContactsTable, reviewEventsTable, reviewMessagesTable, reviewSettingsTable, outreachSuppressionsTable, reviewConsentsTable } from "@workspace/db";
import { previewAudience } from "../engine/audience";
import { cancelCampaign, CampaignError, launchCampaign as launchReal, pauseCampaign, resumeCampaign, retryFailed, campaignResults, updateCampaign, getCampaign } from "../engine/campaigns";
import { runTick, LEASE_MS } from "../engine/worker";
import { applyProviderStatus } from "../engine/status";
import { checkEligibility } from "../guard";
import { unsubscribeContact } from "../consent";
import type { AudienceFilter } from "../audience";
import { at, cleanupOrgs, fakeProvider, hasRealDb, messagesOf, newCampaign, registryOf, seedOrg, setModule, T0, type Seed } from "./testHarness";

// El lanzamiento comprueba que el canal esté listo: aquí se le da un proveedor de pruebas que lo está.
const readyProviders = registryOf(fakeProvider("email"));
const launchCampaign = (orgId: number, id: number, o: Parameters<typeof launchReal>[2] = {}) => launchReal(orgId, id, { providers: readyProviders, ...o });
const people = (n: number, prefix = "c") => Array.from({ length: n }, (_, i) => ({ email: `${prefix}${i}@eng.es` }));
const orgs: number[] = [];
const seed = async (label: string, contacts: { email?: string; phone?: string }[], o: Parameters<typeof seedOrg>[2] = {}) => { const s = await seedOrg(label, contacts, o); orgs.push(s.orgId); return s; };
const launched = async (s: Seed, over = {}) => { const c = await newCampaign(s, over); const l = await launchCampaign(s.orgId, c.id, { now: T0 }); return { c, l: l! }; };
const statusCount = async (campaignId: number) => { const m = await messagesOf(campaignId); const o: Record<string, number> = {}; for (const x of m) o[x.status] = (o[x.status] ?? 0) + 1; return o; };

describe.skipIf(!hasRealDb)("motor de campañas (Postgres real)", () => {
  beforeAll(() => { process.env["PUBLIC_URL"] = "https://app.test"; });
  afterAll(async () => { await cleanupOrgs(orgs); });

  describe("validación de campañas", () => {
    let s: Seed, other: Seed;
    beforeAll(async () => { s = await seed("val", people(2, "v")); other = await seed("val-other", []); });
    it("rechaza filtros de audiencia por satisfacción/valoración con un mensaje que explica la regla", async () => {
      for (const key of ["rating", "satisfaction", "nps", "sentiment"])
        await expect(newCampaign(s, { audienceFilter: { [key]: 5 } })).rejects.toThrow(/no está permitido/);
    });
    it("plantilla de otro canal o de otra empresa → error; recordatorios máx. 1; ritmo acotado; ventana válida", async () => {
      await expect(newCampaign(s, { channel: "whatsapp" })).rejects.toThrow(/es de email/);
      await expect(newCampaign(s, { templateId: other.templateId })).rejects.toMatchObject({ code: "template_not_found", status: 404 });
      await expect(newCampaign(s, { locationId: other.locationId })).rejects.toMatchObject({ code: "location_not_found" });
      await expect(newCampaign(s, { maxReminders: 2 })).rejects.toThrow(/máximo 1/i);
      await expect(newCampaign(s, { maxReminders: 1 })).rejects.toThrow(/3 y 30/);
      await expect(newCampaign(s, { ratePerMinute: 601 })).rejects.toThrow(/600/);
      await expect(newCampaign(s, { sendWindow: { startHour: 20, endHour: 9 } })).rejects.toThrow(/Ventana/);
    });
    it("solo se edita en borrador", async () => {
      const c = await newCampaign(s); await launchCampaign(s.orgId, c.id, { now: T0 });
      await expect(updateCampaign(s.orgId, c.id, { name: "otro" })).rejects.toMatchObject({ code: "not_editable", status: 409 });
    });
  });

  describe("audiencia y lanzamiento", () => {
    let s: Seed;
    beforeAll(async () => {
      s = await seed("aud", people(6, "a"));
      // a0 → baja; a1 → sin consentimiento de email; a2 → suprimido por OTRO módulo; a3 → estado bounced
      const ids = Object.fromEntries((await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.orgId, s.orgId))).map((c) => [c.emailNorm, c.id]));
      await unsubscribeContact(s.orgId, ids["a0@eng.es"]!, { source: "test" });
      await db.update(reviewConsentsTable).set({ revokedAt: new Date() }).where(eq(reviewConsentsTable.contactId, ids["a1@eng.es"]!));
      await db.insert(outreachSuppressionsTable).values({ orgId: s.orgId, email: "a2@eng.es", channel: null, reason: "no_contactar", source: "omniseller" });
      await db.update(reviewContactsTable).set({ status: "bounced" }).where(eq(reviewContactsTable.id, ids["a3@eng.es"]!));
      // un contacto de OTRO establecimiento nunca recibe la petición de este
      const [loc2] = await db.execute(sql`INSERT INTO review_locations (org_id, name) VALUES (${s.orgId}::integer, 'Otro local') RETURNING id`).then((r) => (r as unknown as { rows: { id: number }[] }).rows);
      await db.execute(sql`UPDATE review_contacts SET location_id = ${loc2!.id}::integer WHERE id = ${ids["a5@eng.es"]!}::integer`);
    });
    it("la vista previa explica cuántos son elegibles y por qué se excluye el resto", async () => {
      const c = await newCampaign(s); const p = await previewAudience(s.orgId, c, {});
      expect(p).toEqual({ matchingContacts: 5, eligible: 1, excluded: { notActive: 2, missingAddress: 0, noConsent: 1, suppressed: 1, recentlyContacted: 0, alreadyInCampaign: 0 } });
    });
    it("PARIDAD: la audiencia SQL coincide exactamente con el guard contacto a contacto", async () => {
      const c = await newCampaign(s); await launchCampaign(s.orgId, c.id, { now: T0 });
      const queued = new Set((await messagesOf(c.id)).map((m) => m.contactId));
      const all = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, s.orgId), eq(reviewContactsTable.locationId, s.locationId)));
      for (const contact of all) expect(queued.has(contact.id), `contacto ${contact.emailNorm}`).toBe((await checkEligibility(s.orgId, contact.id, "email")).ok);
    });
    it("no se vuelve a pedir a quien ya recibió una solicitud de otra campaña (control de frecuencia)", async () => {
      const c2 = await newCampaign(s); const p = await previewAudience(s.orgId, c2, {});
      expect(p.eligible).toBe(0); expect(p.excluded.recentlyContacted).toBe(1);
      await expect(launchCampaign(s.orgId, c2.id, { now: T0 })).rejects.toMatchObject({ code: "empty_audience" });
    });
  });

  describe("lanzamiento: precondiciones y concurrencia", () => {
    it("sin enlace de reseña, sin PUBLIC_URL, canal no listo o límites → no se lanza", async () => {
      const s = await seed("pre", people(3, "p"));
      await db.execute(sql`UPDATE review_locations SET google_place_id = NULL, google_review_url = NULL WHERE id = ${s.locationId}::integer`);
      await expect(launched(s)).rejects.toMatchObject({ code: "location_without_review_link" });
      await db.execute(sql`UPDATE review_locations SET google_review_url = 'https://search.google.com/local/writereview?placeid=ChIJx' WHERE id = ${s.locationId}::integer`);
      const c = await newCampaign(s);
      const old = process.env["PUBLIC_URL"]; delete process.env["PUBLIC_URL"];
      await expect(launchCampaign(s.orgId, c.id, { now: T0 })).rejects.toMatchObject({ code: "public_url_not_configured" });
      process.env["PUBLIC_URL"] = old;
      const notReady = { ...fakeProvider("email"), readiness: async () => ({ ready: false as const, reason: "sin credenciales" }) };
      await expect(launchCampaign(s.orgId, c.id, { now: T0, providers: registryOf(notReady) })).rejects.toMatchObject({ code: "channel_not_ready" });
      await db.insert(reviewSettingsTable).values({ orgId: s.orgId, monthlyMessageLimit: 2, maxActiveCampaigns: 1 });
      await expect(launchCampaign(s.orgId, c.id, { now: T0 })).rejects.toMatchObject({ code: "message_limit_exceeded" });
      await db.update(reviewSettingsTable).set({ monthlyMessageLimit: 100 }).where(eq(reviewSettingsTable.orgId, s.orgId));
      await launchCampaign(s.orgId, c.id, { now: T0 });
      const c2 = await newCampaign(s, { name: "otra" });
      await expect(launchCampaign(s.orgId, c2.id, { now: T0 })).rejects.toMatchObject({ code: "campaign_limit_exceeded" });
    });
    it("dos lanzamientos simultáneos: solo uno encola (sin duplicados)", async () => {
      const s = await seed("race", people(40, "r")); const c = await newCampaign(s);
      const res = await Promise.allSettled([launchCampaign(s.orgId, c.id, { now: T0 }), launchCampaign(s.orgId, c.id, { now: T0 })]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(CampaignError);
      expect((await messagesOf(c.id)).length).toBe(40);
    });
    it("programada a futuro: queda «scheduled», no se envía antes de la hora y arranca después", async () => {
      const s = await seed("sched", people(3, "s")); const prov = fakeProvider("email");
      const c = await newCampaign(s, { scheduleAt: at(3 * 3600_000).toISOString() });
      expect((await launchCampaign(s.orgId, c.id, { now: T0 }))!.status).toBe("scheduled");
      expect((await runTick({ orgId: s.orgId, now: at(60_000), providers: registryOf(prov) })).claimed).toBe(0);
      expect(prov.calls).toHaveLength(0);
      const t = await runTick({ orgId: s.orgId, now: at(3 * 3600_000 + 1000), providers: registryOf(prov) });
      expect(t.sent).toBe(3); expect((await getCampaign(s.orgId, c.id))!.status).toBe("completed");
    });
  });

  describe("worker: envío, límites y concurrencia", () => {
    it("envía todo, deja constancia (sent_at, proveedor, id) y completa la campaña; usa enlaces propios por mensaje", async () => {
      const s = await seed("send", people(15, "w")); const { c } = await launched(s); const prov = fakeProvider("email");
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect(t).toMatchObject({ claimed: 15, sent: 15, failed: 0 });
      const msgs = await messagesOf(c.id);
      expect(msgs.every((m) => m.status === "sent" && m.sentAt && m.provider === "fake_email" && m.providerMessageId?.startsWith("fake-") && m.attempts === 1)).toBe(true);
      expect(new Set(msgs.map((m) => m.trackingToken)).size).toBe(15);
      expect(prov.calls[0]!.links.review).toMatch(/^https:\/\/app\.test\/api\/review-public\/r\/[A-Za-z0-9_-]{40,}$/);
      expect(prov.calls[0]!.links.unsubscribe).toMatch(/\/api\/review-public\/u\//);
      expect((await getCampaign(s.orgId, c.id))!.status).toBe("completed");
      const [u] = (await db.execute(sql`SELECT sent FROM review_usage WHERE org_id = ${s.orgId}::integer AND channel = 'email'`) as unknown as { rows: { sent: number }[] }).rows;
      expect(u!.sent).toBe(15);
    });
    it("respeta el ritmo de la campaña: 10/min → 10 en el primer minuto, 0 inmediatamente después, 10 más pasado el minuto", async () => {
      const s = await seed("rate", people(25, "t")); const { c } = await launched(s, { ratePerMinute: 10 }); const prov = fakeProvider("email");
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).sent).toBe(10);
      const t2 = await runTick({ orgId: s.orgId, now: at(5_000), providers: registryOf(prov) });
      expect(t2.sent).toBe(0); expect(t2.blocked[String(c.id)]).toBe("rate_or_quota_exhausted");
      expect((await runTick({ orgId: s.orgId, now: at(61_000), providers: registryOf(prov) })).sent).toBe(10);
      expect((await runTick({ orgId: s.orgId, now: at(122_000), providers: registryOf(prov) })).sent).toBe(5);
      expect(prov.calls).toHaveLength(25);
    });
    it("respeta el límite del proveedor (por minuto) aunque la campaña pida más", async () => {
      const s = await seed("prov", people(12, "q")); await launched(s); const prov = fakeProvider("email", undefined, { maxPerMinute: 4, maxPerDay: null });
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).sent).toBe(4);
    });
    it("respeta el tope diario del proveedor y el tope mensual de la empresa", async () => {
      const s = await seed("quota", people(10, "u"));
      await launched(s); await db.insert(reviewSettingsTable).values({ orgId: s.orgId, monthlyMessageLimit: 7 }); const prov = fakeProvider("email", undefined, { maxPerMinute: 1000, maxPerDay: 3 });
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).sent).toBe(3);
      expect((await runTick({ orgId: s.orgId, now: at(30 * 3600_000), providers: registryOf(fakeProvider("email", undefined, { maxPerMinute: 1000, maxPerDay: null })) })).sent).toBe(4); // mensual: 7 en total
    });
    it("dos workers simultáneos: cada mensaje se envía EXACTAMENTE una vez", async () => {
      const s = await seed("conc", people(120, "k")); const { c } = await launched(s);
      const prov = fakeProvider("email", async (_r, n) => { await new Promise((r) => setTimeout(r, 2)); return { ok: true, providerMessageId: `f${n}` }; });
      const [a, b] = await Promise.all([runTick({ orgId: s.orgId, now: T0, workerId: "A", providers: registryOf(prov) }), runTick({ orgId: s.orgId, now: T0, workerId: "B", providers: registryOf(prov) })]);
      expect(a.sent + b.sent).toBe(120); expect(prov.calls).toHaveLength(120);
      expect(new Set(prov.calls.map((r) => r.to)).size).toBe(120);
      expect((await statusCount(c.id))["sent"]).toBe(120);
    });
    it("fuera de la ventana horaria o con el módulo apagado no se envía nada", async () => {
      const s = await seed("win", people(3, "x")); await launched(s); const prov = fakeProvider("email");
      expect((await runTick({ orgId: s.orgId, now: new Date("2026-12-01T20:30:00Z"), providers: registryOf(prov) })).blocked).toMatchObject({ [String((await db.select().from(reviewCampaignsTable).where(eq(reviewCampaignsTable.orgId, s.orgId)))[0]!.id)]: "outside_send_window" });
      await setModule(s.orgId, false);
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) }); expect(Object.values(t.blocked)).toContain("module_disabled");
      expect(prov.calls).toHaveLength(0);
      await setModule(s.orgId, true);
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).sent).toBe(3);
    });
  });

  describe("worker: guard final, errores y recuperación", () => {
    it("consentimiento revocado DESPUÉS de encolar → se omite y nunca se llama al proveedor", async () => {
      const s = await seed("late", people(3, "l")); const { c } = await launched(s); const prov = fakeProvider("email");
      const [victim] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, s.orgId), eq(reviewContactsTable.emailNorm, "l1@eng.es")));
      await unsubscribeContact(s.orgId, victim!.id, { source: "test" });
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect(t).toMatchObject({ sent: 2, skipped: 1 }); expect(prov.calls.map((r) => r.to)).not.toContain("l1@eng.es");
      expect((await messagesOf(c.id)).find((m) => m.contactId === victim!.id)).toMatchObject({ status: "skipped", skipReason: "contact_unsubscribed" });
    });
    it("error transitorio → reintento con espera creciente, y tras 3 intentos queda failed", async () => {
      const s = await seed("retry", people(1, "e")); const { c } = await launched(s);
      const prov = fakeProvider("email", () => ({ ok: false, retryable: true, code: "email_transient", message: "429" }));
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).retried).toBe(1);
      let m = (await messagesOf(c.id))[0]!; expect(m).toMatchObject({ status: "queued", attempts: 1 }); expect(m.nextAttemptAt.getTime()).toBe(T0.getTime() + 60_000);
      expect((await runTick({ orgId: s.orgId, now: at(30_000), providers: registryOf(prov) })).claimed).toBe(0); // aún en espera
      await runTick({ orgId: s.orgId, now: at(61_000), providers: registryOf(prov) });
      m = (await messagesOf(c.id))[0]!; expect(m).toMatchObject({ status: "queued", attempts: 2 }); expect(m.nextAttemptAt.getTime()).toBe(T0.getTime() + 61_000 + 5 * 60_000);
      const t3 = await runTick({ orgId: s.orgId, now: at(61_000 + 5 * 60_000 + 1000), providers: registryOf(prov) });
      expect(t3.failed).toBe(1); m = (await messagesOf(c.id))[0]!; expect(m).toMatchObject({ status: "failed", attempts: 3, errorCode: "email_transient" });
      expect(prov.calls).toHaveLength(3);
    });
    it("error permanente → failed sin reintentar; destino inválido → supresión SOLO de ese canal", async () => {
      const s = await seed("perm", [{ email: "bad@eng.es", phone: "600111222" }, { email: "ok@eng.es" }]); const { c } = await launched(s);
      const prov = fakeProvider("email", (r) => (r.to === "bad@eng.es" ? { ok: false, retryable: false, code: "email_invalid_address", message: "no existe", invalidDestination: true } : { ok: true, providerMessageId: "x" }));
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect(t).toMatchObject({ sent: 1, failed: 1, retried: 0 });
      const sup = await db.select().from(outreachSuppressionsTable).where(and(eq(outreachSuppressionsTable.orgId, s.orgId), eq(outreachSuppressionsTable.email, "bad@eng.es")));
      expect(sup).toHaveLength(1); expect(sup[0]).toMatchObject({ channel: "email", reason: "bounced", source: "omni_review" });
      const bad = (await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, s.orgId), eq(reviewContactsTable.emailNorm, "bad@eng.es"))))[0]!;
      expect((await checkEligibility(s.orgId, bad.id, "email"))).toEqual({ ok: false, reason: "suppressed" });
      expect((await checkEligibility(s.orgId, bad.id, "whatsapp")).ok).toBe(true); // el teléfono del mismo contacto sigue válido
      expect((await retryFailed(s.orgId, c.id))).toBe(0); // destino inválido: no se reintenta
    });
    it("error de configuración → se PAUSA la campaña, el resto queda en cola intacto, y se retoma al corregirlo", async () => {
      const s = await seed("fatal", people(30, "f")); const { c } = await launched(s, { ratePerMinute: 600 });
      let broken = true;
      const prov = fakeProvider("email", () => (broken ? { ok: false, retryable: false, fatal: true, code: "email_config", message: "RESEND_API_KEY no configurado" } : { ok: true, providerMessageId: "ok" }));
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov), concurrency: 1 });
      expect(t.paused).toEqual([c.id]); expect((await getCampaign(s.orgId, c.id))!.status).toBe("paused");
      const st = await statusCount(c.id); expect(st["failed"]).toBeGreaterThanOrEqual(1); expect((st["queued"] ?? 0) + (st["failed"] ?? 0)).toBe(30);
      expect(prov.calls.length).toBeLessThanOrEqual(20); // no sigue gastando intentos tras pausar
      broken = false;
      expect((await runTick({ orgId: s.orgId, now: at(61_000), providers: registryOf(prov) })).sent).toBe(0); // pausada: no procesa
      await retryFailed(s.orgId, c.id); await resumeCampaign(s.orgId, c.id);
      await runTick({ orgId: s.orgId, now: at(122_000), providers: registryOf(prov) });
      expect((await statusCount(c.id))["sent"]).toBe(30);
    });
    it("un envío «sending» con bloqueo caducado NO se reenvía (como máximo una vez): pasa a failed/lease_expired", async () => {
      const s = await seed("lease", people(2, "z")); const { c } = await launched(s); const prov = fakeProvider("email");
      const [m] = await messagesOf(c.id);
      await db.update(reviewMessagesTable).set({ status: "sending", lockedAt: new Date(T0.getTime() - LEASE_MS - 1000), lockedBy: "worker-muerto", attempts: 1 }).where(eq(reviewMessagesTable.id, m!.id));
      const t = await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect(t.leaseExpired).toBe(1); expect(t.sent).toBe(1); expect(prov.calls).toHaveLength(1);
      expect((await messagesOf(c.id)).find((x) => x.id === m!.id)).toMatchObject({ status: "failed", errorCode: "lease_expired" });
      const ev = await db.select().from(reviewEventsTable).where(and(eq(reviewEventsTable.orgId, s.orgId), eq(reviewEventsTable.type, "error")));
      expect(ev.length).toBeGreaterThan(0);
    });
    it("un bloqueo vigente (otro worker trabajando) no se toca", async () => {
      const s = await seed("lease2", people(1, "y")); const { c } = await launched(s); const prov = fakeProvider("email");
      const [m] = await messagesOf(c.id);
      await db.update(reviewMessagesTable).set({ status: "sending", lockedAt: T0, lockedBy: "otro-worker", attempts: 1 }).where(eq(reviewMessagesTable.id, m!.id));
      const t = await runTick({ orgId: s.orgId, now: at(30_000), providers: registryOf(prov) });
      expect(t.leaseExpired).toBe(0); expect(prov.calls).toHaveLength(0);
    });
  });

  describe("pausa, cancelación, recordatorios y estados", () => {
    it("pausada no envía; reanudada sí; cancelada marca lo pendiente como omitido", async () => {
      const s = await seed("ctl", people(6, "m")); const { c } = await launched(s); const prov = fakeProvider("email");
      await pauseCampaign(s.orgId, c.id);
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).claimed).toBe(0);
      await resumeCampaign(s.orgId, c.id);
      await cancelCampaign(s.orgId, c.id);
      const st = await statusCount(c.id); expect(st).toEqual({ skipped: 6 });
      expect((await messagesOf(c.id))[0]!.skipReason).toBe("campaign_cancelled");
      expect((await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) })).claimed).toBe(0); expect(prov.calls).toHaveLength(0);
    });
    it("recordatorio: UNO como máximo, tras N días, y no a quien ya hizo clic", async () => {
      const s = await seed("rem", people(3, "n")); const { c } = await launched(s, { maxReminders: 1, reminderAfterDays: 3 }); const prov = fakeProvider("email");
      await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect((await getCampaign(s.orgId, c.id))!.status).toBe("running"); // quedan recordatorios por decidir: no se completa aún
      const [clicked] = await messagesOf(c.id);
      await db.update(reviewMessagesTable).set({ firstClickedAt: at(1000) }).where(eq(reviewMessagesTable.id, clicked!.id));
      expect((await runTick({ orgId: s.orgId, now: at(2 * 24 * 3600_000), providers: registryOf(prov) })).remindersQueued).toBe(0); // 2 días: aún no
      const t = await runTick({ orgId: s.orgId, now: at(3 * 24 * 3600_000 + 1000), providers: registryOf(prov) });
      expect(t.remindersQueued).toBe(2); expect(t.sent).toBe(2);
      const again = await runTick({ orgId: s.orgId, now: at(10 * 24 * 3600_000), providers: registryOf(prov) });
      expect(again.remindersQueued).toBe(0); expect(prov.calls).toHaveLength(5);
      expect((await messagesOf(c.id)).filter((m) => m.kind === "reminder")).toHaveLength(2);
      expect((await getCampaign(s.orgId, c.id))!.status).toBe("completed");
    });
    it("resultados: cuatro magnitudes separadas, motivos de omisión y de fallo; reseñas NO estimadas", async () => {
      const s = await seed("res", people(4, "o")); const { c } = await launched(s); const prov = fakeProvider("email", (r) => (r.to === "o3@eng.es" ? { ok: false, retryable: false, code: "email_rejected", message: "x" } : { ok: true, providerMessageId: `id-${r.to}` }));
      await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      await applyProviderStatus({ providerMessageId: "id-o0@eng.es", status: "delivered", at: at(5000) });
      await applyProviderStatus({ providerMessageId: "id-o1@eng.es", status: "read", at: at(9000) });
      const first = (await messagesOf(c.id)).find((m) => m.providerMessageId === "id-o0@eng.es")!;
      await db.update(reviewMessagesTable).set({ firstClickedAt: at(7000) }).where(eq(reviewMessagesTable.id, first.id));
      const r = await campaignResults(s.orgId, c.id);
      expect(r!.messages).toMatchObject({ requests: 4, sent: 3, delivered: 2, read: 1, failed: 1, clicked: 1, queued: 0 });
      expect(r!.failedByCode).toEqual([{ code: "email_rejected", n: 1 }]);
      expect(r!.reviews).toMatchObject({ available: false });
    });
    it("estados del proveedor: monótonos, idempotentes, sin retroceder y con uso contado una vez", async () => {
      const s = await seed("st", people(1, "s")); const { c } = await launched(s); const prov = fakeProvider("email", () => ({ ok: true, providerMessageId: "wamid.ST1" }));
      await runTick({ orgId: s.orgId, now: T0, providers: registryOf(prov) });
      expect((await applyProviderStatus({ providerMessageId: "wamid.ST1", status: "delivered", at: at(1000) })).applied).toBe(true);
      await applyProviderStatus({ providerMessageId: "wamid.ST1", status: "delivered", at: at(2000) }); // webhook duplicado
      await applyProviderStatus({ providerMessageId: "wamid.ST1", status: "sent", at: at(3000) });      // llega tarde: no retrocede
      let m = (await messagesOf(c.id))[0]!; expect(m.status).toBe("delivered"); expect(m.deliveredAt!.getTime()).toBe(at(1000).getTime());
      await applyProviderStatus({ providerMessageId: "wamid.ST1", status: "read", at: at(4000) });
      m = (await messagesOf(c.id))[0]!; expect(m.status).toBe("read"); expect(m.readAt).toBeTruthy();
      await applyProviderStatus({ providerMessageId: "wamid.ST1", status: "failed", at: at(5000), errorCode: "x" }); // fallo tardío tras leído: ignorado
      expect((await messagesOf(c.id))[0]!.status).toBe("read");
      const [u] = (await db.execute(sql`SELECT delivered FROM review_usage WHERE org_id = ${s.orgId}::integer AND channel = 'email'`) as unknown as { rows: { delivered: number }[] }).rows;
      expect(u!.delivered).toBe(1);
      expect((await applyProviderStatus({ providerMessageId: "desconocido", status: "delivered", at: at(1) })).applied).toBe(false);
    });
  });

  describe("rendimiento de la cola", () => {
    it("5.000 mensajes: lanzamiento (INSERT…SELECT) y drenaje por la cola con reclamación SKIP LOCKED", async () => {
      const s = await seed("perf", people(5000, "pf"));
      const t0 = Date.now(); const { c, l } = await launched(s, { ratePerMinute: 600 }); const launchMs = Date.now() - t0;
      expect(l.enqueued).toBe(5000);
      const prov = fakeProvider("email"); const t1 = Date.now(); let sent = 0, ticks = 0;
      while (sent < 5000 && ticks < 20) { sent += (await runTick({ orgId: s.orgId, now: at(ticks * 61_000), providers: registryOf(prov), maxMs: 120_000 })).sent; ticks++; }
      console.log(`[perf] lanzar 5.000: ${launchMs} ms · drenar 5.000 con proveedor instantáneo: ${Date.now() - t1} ms en ${ticks} ticks (Postgres local)`);
      expect(sent).toBe(5000); expect(new Set(prov.calls.map((r) => r.messageId)).size).toBe(5000);
      expect((await getCampaign(s.orgId, c.id))!.status).toBe("completed");
    }, 120_000);
  });
});
