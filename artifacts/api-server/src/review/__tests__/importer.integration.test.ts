// Importador, consentimientos, bajas, supresión y reglas de elegibilidad — Postgres real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, reviewContactsTable, reviewConsentsTable, reviewImportBatchesTable, reviewLocationsTable, reviewSettingsTable, outreachSuppressionsTable } from "@workspace/db";
import { importContacts, ImportInputError } from "../importer";
import { checkEligibility } from "../guard";
import { eraseContact, unsubscribeContact } from "../consent";
import { cleanupOrgs, createOrg, hasRealDb } from "./testHarness";

const HEAD = ["Nombre", "Email", "Teléfono", "Servicio", "Fecha"];
const base = (orgId: number, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  importContacts({ orgId, userId: 7, fileName: "clientes.csv", source: "csv", legalBasis: "existing_customer_relationship", headers: HEAD, rows, ...extra } as Parameters<typeof importContacts>[0]);
const row = (n: string, e: string | null, t: string | null, extra: Record<string, unknown> = {}) => ({ Nombre: n, Email: e, Teléfono: t, Servicio: "Reparación frigorífico", Fecha: "10/03/2026", ...extra });

describe.skipIf(!hasRealDb)("importador de contactos (Postgres real)", () => {
  let A = 0, B = 0;
  beforeAll(async () => { A = await createOrg("imp-a"); B = await createOrg("imp-b"); });
  afterAll(async () => { await cleanupOrgs([A, B]); });

  it("importa filas válidas, normaliza, registra lote y crea un consentimiento por canal con la base jurídica y su evidencia", async () => {
    const r = await base(A, [row("Ana", " Ana@Mail.COM ", "600 111 222"), row("Luis", "luis@mail.com", null), row("Eva", null, "611222333")], { legalBasisNote: "Clientes de 2025" });
    expect(r).toMatchObject({ totalRows: 3, imported: 3, invalid: 0, duplicates: 0, suppressed: 0, withEmail: 2, withWhatsapp: 2 });
    const [ana] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "ana@mail.com")));
    expect(ana).toMatchObject({ phoneE164: "+34600111222", source: "csv", status: "active", service: "Reparación frigorífico", serviceDate: "2026-03-10" });
    const consents = await db.select().from(reviewConsentsTable).where(eq(reviewConsentsTable.contactId, ana!.id));
    expect(consents.map((c) => c.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(consents[0]!.legalBasis).toBe("existing_customer_relationship");
    expect(consents[0]!.evidence).toMatch(/Importación #\d+ .*Clientes de 2025/);
    const [batch] = await db.select().from(reviewImportBatchesTable).where(eq(reviewImportBatchesTable.id, r.batchId));
    expect(batch).toMatchObject({ orgId: A, totalRows: 3, validRows: 3, legalBasis: "existing_customer_relationship" });
  });

  it("deduplica: repetidos en el fichero, ya existentes en la BD y cruces email/teléfono; informa fila a fila", async () => {
    const r = await base(A, [
      row("Nuevo", "nuevo@x.es", "622000111"),
      row("Dup fichero", "NUEVO@x.es", null),             // mismo email en el fichero
      row("Dup tel fichero", null, "+34 622 000 111"),     // mismo teléfono en el fichero
      row("Ya existe email", "ana@mail.com", null),        // existente en BD
      row("Ya existe tel", null, "611222333"),             // existente en BD
      row("Sin datos", null, null),                         // inválida
      row("Mal", "no-es-email", "123"),                     // inválida
    ]);
    expect(r).toMatchObject({ totalRows: 7, imported: 1, invalid: 2, duplicates: 4 });
    expect(r.report.filter((x) => x.kind === "duplicate_in_file")).toHaveLength(2);
    expect(r.report.filter((x) => x.kind === "duplicate_existing")).toHaveLength(2);
    expect(r.report.find((x) => x.kind === "invalid" && x.row === 8)?.detail).toMatch(/no válidos/); expect(r.report.find((x) => x.kind === "invalid" && x.row === 7)?.detail).toBe("Sin email ni teléfono");
    expect(r.report.every((x) => x.row >= 2)).toBe(true); // numeración de fila del fichero (cabecera = 1)
  });

  it("filas con un dato malo pero otro válido se importan con aviso; teléfono fijo no genera consentimiento de WhatsApp", async () => {
    const r = await base(A, [row("Pepe", "pepe@x.es", "123"), row("Fijo", "fijo@x.es", "911234567", { Fecha: "31/02/2026" })]);
    expect(r).toMatchObject({ imported: 2, invalid: 0, warnings: 2, withWhatsapp: 0 });
    const [fijo] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "fijo@x.es")));
    expect(fijo!.serviceDate).toBeNull();
    const ch = (await db.select().from(reviewConsentsTable).where(eq(reviewConsentsTable.contactId, fijo!.id))).map((c) => c.channel);
    expect(ch).toEqual(["email"]);
  });

  it("la base jurídica es obligatoria y «otra» exige descripción; sin columnas reconocibles → error claro", async () => {
    await expect(base(A, [row("x", "x@x.es", null)], { legalBasis: "" })).rejects.toMatchObject({ code: "legal_basis_required" });
    await expect(base(A, [row("x", "x@x.es", null)], { legalBasis: "magia" })).rejects.toMatchObject({ code: "legal_basis_required" });
    await expect(base(A, [row("x", "x@x.es", null)], { legalBasis: "other", legalBasisNote: "corta" })).rejects.toMatchObject({ code: "legal_basis_note_required" });
    await expect(base(A, [{ foo: 1 }], { headers: ["foo"] })).rejects.toMatchObject({ code: "columns_not_found" });
  });

  it("respeta la lista de bajas: oposición global descarta la fila entera, bloqueo de canal solo esa dirección", async () => {
    await db.insert(outreachSuppressionsTable).values([
      { orgId: A, email: "baja@x.es", channel: null, reason: "opt_out", source: "test" },
      { orgId: A, phone: "+34633000111", channel: null, reason: "no_contactar", source: "test" },
      { orgId: A, email: "rebote@x.es", channel: "email", reason: "bounced", source: "test" },
    ]);
    const r = await base(A, [row("Baja", "baja@x.es", "644000222"), row("BajaTel", "otro@x.es", "633 000 111"), row("Rebote", "rebote@x.es", "655000333")]);
    expect(r).toMatchObject({ imported: 1, suppressed: 2 });
    expect(await base(A, [row("SoloRebote", "rebote@x.es", null)])).toMatchObject({ imported: 0, suppressed: 1 }); // sin otra dirección útil: se descarta
    const [rebote] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.phoneE164, "+34655000333")));
    expect(rebote!.emailNorm).toBeNull(); // el email rebotado se descarta, el teléfono se conserva
  });

  it("aislamiento: las bajas, contactos y duplicados de A no afectan a B", async () => {
    const r = await base(B, [row("Ana en B", "ana@mail.com", "600111222"), row("Baja en B", "baja@x.es", null)]);
    expect(r).toMatchObject({ imported: 2, duplicates: 0, suppressed: 0 });
  });

  it("establecimiento de otra empresa → 404; límite mensual de contactos → 422 sin escribir nada", async () => {
    const locA = (await db.insert(reviewLocationsTable).values({ orgId: A, name: "L" }).returning())[0]!.id;
    await expect(base(B, [row("x", "loc@x.es", null)], { locationId: locA })).rejects.toMatchObject({ code: "location_not_found", status: 404 });
    const before = (await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.orgId, B))).length;
    await db.insert(reviewSettingsTable).values({ orgId: B, monthlyContactLimit: before + 1 });
    await expect(base(B, [row("1", "l1@x.es", null), row("2", "l2@x.es", null)])).rejects.toMatchObject({ code: "contact_limit_exceeded", status: 422 });
    expect((await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.orgId, B))).length).toBe(before);
    expect(await base(B, [row("1", "l1@x.es", null)])).toMatchObject({ imported: 1 });
  });

  it("transaccional: si falla algo, no queda ni el lote ni contactos a medias", async () => {
    const lote = (await db.select().from(reviewImportBatchesTable).where(eq(reviewImportBatchesTable.orgId, A))).length;
    await expect(base(A, [row("x", "tx@x.es", null)], { locationId: 99999999 })).rejects.toBeInstanceOf(ImportInputError);
    expect((await db.select().from(reviewImportBatchesTable).where(eq(reviewImportBatchesTable.orgId, A))).length).toBe(lote);
  });

  describe("reglas de elegibilidad (guard): la única puerta a la cola", () => {
    let ana = 0;
    beforeAll(async () => { ana = (await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "ana@mail.com"))))[0]!.id; });

    it("contacto importado con base jurídica → elegible por email y por WhatsApp", async () => {
      expect(await checkEligibility(A, ana, "email")).toMatchObject({ ok: true, destination: "ana@mail.com" });
      expect(await checkEligibility(A, ana, "whatsapp")).toMatchObject({ ok: true, destination: "+34600111222" });
    });
    it("canal no registrado (SMS), contacto de otra empresa o inexistente → no elegible", async () => {
      expect(await checkEligibility(A, ana, "sms")).toEqual({ ok: false, reason: "channel_invalid" });
      expect(await checkEligibility(B, ana, "email")).toEqual({ ok: false, reason: "contact_not_found" });
      expect(await checkEligibility(A, 999999999, "email")).toEqual({ ok: false, reason: "contact_not_found" });
    });
    it("sin consentimiento para ese canal → no_consent (un fijo tiene email pero no WhatsApp)", async () => {
      const [fijo] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "fijo@x.es")));
      expect(await checkEligibility(A, fijo!.id, "email")).toMatchObject({ ok: true });
      expect(await checkEligibility(A, fijo!.id, "whatsapp")).toEqual({ ok: false, reason: "no_consent" }); // tiene teléfono pero es fijo: no se le concedió WhatsApp
    });
    it("consentimiento revocado, sin base registrada o dirección suprimida después de importar → no elegible", async () => {
      const [c] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "nuevo@x.es")));
      await db.update(reviewConsentsTable).set({ revokedAt: new Date() }).where(and(eq(reviewConsentsTable.contactId, c!.id), eq(reviewConsentsTable.channel, "email")));
      expect(await checkEligibility(A, c!.id, "email")).toEqual({ ok: false, reason: "no_consent" });
      const [e] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "pepe@x.es")));
      await db.insert(outreachSuppressionsTable).values({ orgId: A, email: "pepe@x.es", channel: null, reason: "no_contactar", source: "otro-modulo" });
      expect(await checkEligibility(A, e!.id, "email")).toEqual({ ok: false, reason: "suppressed" }); // una baja de OTRO módulo (OmniSeller) también bloquea
    });
    it("estados bounced/invalid no son elegibles", async () => {
      const [c] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "luis@mail.com")));
      await db.update(reviewContactsTable).set({ status: "bounced" }).where(eq(reviewContactsTable.id, c!.id));
      expect(await checkEligibility(A, c!.id, "email")).toEqual({ ok: false, reason: "contact_invalid" });
    });
    it("baja: revoca consentimientos, suprime direcciones (visible para toda la plataforma), es idempotente y bloquea la reimportación", async () => {
      expect(await unsubscribeContact(A, ana, { source: "test", createdBy: 7 })).toBe(true);
      expect(await unsubscribeContact(A, ana, { source: "test", createdBy: 7 })).toBe(true);
      expect(await checkEligibility(A, ana, "email")).toEqual({ ok: false, reason: "contact_unsubscribed" });
      expect(await checkEligibility(A, ana, "whatsapp")).toEqual({ ok: false, reason: "contact_unsubscribed" });
      const sup = await db.select().from(outreachSuppressionsTable).where(and(eq(outreachSuppressionsTable.orgId, A), eq(outreachSuppressionsTable.email, "ana@mail.com")));
      expect(sup).toHaveLength(1); expect(sup[0]).toMatchObject({ channel: null, reason: "opt_out", source: "test" });
      expect(await unsubscribeContact(B, ana, { source: "test" })).toBe(false); // otra empresa: no existe
      const r = await base(A, [row("Ana otra vez", "ANA@mail.com", null)]);
      expect(r).toMatchObject({ imported: 0 }); // ya existe (y está suprimida)
    });
    it("supresión RGPD: borra datos personales, conserva solo la supresión y no se puede contactar ni reimportar", async () => {
      const [c] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.emailNorm, "eva-no-existe@x.es")));
      expect(c).toBeUndefined();
      const [eva] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, A), eq(reviewContactsTable.phoneE164, "+34611222333")));
      expect(await eraseContact(A, eva!.id, { createdBy: 7 })).toBe(true);
      const [after] = await db.select().from(reviewContactsTable).where(eq(reviewContactsTable.id, eva!.id));
      expect(after).toMatchObject({ name: null, email: null, emailNorm: null, phoneE164: null, service: null, status: "erased" });
      expect(after!.anonymizedAt).toBeTruthy();
      expect(await checkEligibility(A, eva!.id, "whatsapp")).toEqual({ ok: false, reason: "contact_erased" });
      const r = await base(A, [row("Eva vuelve", null, "611222333")]);
      expect(r).toMatchObject({ imported: 0, suppressed: 1 }); // la oposición se respeta aunque se reimporte
      expect(await eraseContact(B, eva!.id, {})).toBe(false);
    });
  });
});
