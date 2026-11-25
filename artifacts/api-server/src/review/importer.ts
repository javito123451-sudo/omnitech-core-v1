// Importador de contactos: validación → normalización → deduplicación (en fichero y contra la BD)
// → comprobación de bajas → límite del plan → inserción por lotes con consentimientos.
// TODO el import es UNA transacción: o se importa entero o no se escribe nada.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, reviewConsentsTable, reviewContactsTable, reviewImportBatchesTable, reviewLocationsTable, reviewSettingsTable, outreachSuppressionsTable,
  type ReviewChannel,
} from "@workspace/db";
import { LEGAL_BASES, phoneVariants, type LegalBasis } from "./consent";
import { mapHeaders, normalizeEmail, normalizePhone, parseServiceDate } from "./normalize";

export const INSERT_CHUNK = 500;
const LOOKUP_CHUNK = 1000;
const MAX_REPORT_ROWS = 200;

export class ImportInputError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "ImportInputError"; }
}

export interface ImportParams {
  orgId: number; userId?: number | null; fileName: string; source: "csv" | "xlsx" | "crm";
  locationId?: number | null; legalBasis: string; legalBasisNote?: string | null;
  headers: string[]; rows: Record<string, unknown>[];
}

export interface RowIssue { row: number; kind: "invalid" | "duplicate_in_file" | "duplicate_existing" | "suppressed" | "warning"; detail: string }

export interface ImportResult {
  batchId: number; totalRows: number; imported: number; invalid: number; duplicates: number; suppressed: number; warnings: number;
  withEmail: number; withWhatsapp: number; report: RowIssue[]; reportTruncated: boolean;
}

interface Candidate {
  row: number; name: string | null; email: string | null; emailNorm: string | null; phone: string | null; whatsappCapable: boolean;
  service: string | null; serviceDate: string | null;
}

const text = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, " ");
  return s === "" ? null : s.slice(0, max);
};
const chunks = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export async function importContacts(p: ImportParams): Promise<ImportResult> {
  // ── Validaciones de entrada ────────────────────────────────────────────────
  if (!(LEGAL_BASES as readonly string[]).includes(p.legalBasis))
    throw new ImportInputError("legal_basis_required", "Indica la base jurídica de los contactos (consentimiento, relación contractual previa u otra).");
  if (p.legalBasis === "other" && (p.legalBasisNote ?? "").trim().length < 10)
    throw new ImportInputError("legal_basis_note_required", "Para «otra» base jurídica describe cuál es (mínimo 10 caracteres).");
  const cols = mapHeaders(p.headers);
  if (!cols.email && !cols.phone)
    throw new ImportInputError("columns_not_found", "No se encontró ninguna columna de email ni de teléfono. Cabeceras reconocidas: email/correo, teléfono/móvil/whatsapp (más nombre, servicio y fecha opcionales).");
  const legalBasis = p.legalBasis as LegalBasis;

  // ── Fase 1: normalizar y deduplicar dentro del fichero (en memoria) ────────
  const report: RowIssue[] = [];
  let invalid = 0, duplicatesFile = 0, warnings = 0;
  const addIssue = (i: RowIssue) => { if (report.length < MAX_REPORT_ROWS) report.push(i); };
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  p.rows.forEach((raw, idx) => {
    const rowNo = idx + 2; // fila del fichero (la 1 es la cabecera)
    const rawEmail = cols.email ? raw[cols.email] : null;
    const rawPhone = cols.phone ? raw[cols.phone] : null;
    const hasRawEmail = rawEmail != null && String(rawEmail).trim() !== "";
    const hasRawPhone = rawPhone != null && String(rawPhone).trim() !== "";
    const emailNorm = hasRawEmail ? normalizeEmail(rawEmail) : null;
    const phone = hasRawPhone ? normalizePhone(rawPhone) : null;

    if (!emailNorm && !phone) {
      invalid++;
      addIssue({ row: rowNo, kind: "invalid", detail: !hasRawEmail && !hasRawPhone ? "Sin email ni teléfono" : `Email/teléfono no válidos${hasRawEmail ? ` (email «${String(rawEmail).slice(0, 60)}»)` : ""}${hasRawPhone ? ` (teléfono «${String(rawPhone).slice(0, 30)}»)` : ""}` });
      return;
    }
    const notes: string[] = [];
    if (hasRawEmail && !emailNorm) notes.push("email no válido, ignorado");
    if (hasRawPhone && !phone) notes.push("teléfono no válido, ignorado");
    if (phone?.note) notes.push(phone.note);
    const sd = cols.serviceDate ? parseServiceDate(raw[cols.serviceDate]) : undefined;
    if (sd === null) notes.push("fecha de servicio no válida, ignorada");
    if (notes.length) { warnings++; addIssue({ row: rowNo, kind: "warning", detail: notes.join("; ") }); }

    const keys = [emailNorm ? `e:${emailNorm}` : null, phone ? `p:${phone.e164}` : null].filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k))) { duplicatesFile++; addIssue({ row: rowNo, kind: "duplicate_in_file", detail: "Repetido en el mismo fichero" }); return; }
    keys.forEach((k) => seen.add(k));
    candidates.push({
      row: rowNo, name: cols.name ? text(raw[cols.name], 200) : null,
      email: emailNorm, emailNorm, phone: phone?.e164 ?? null, whatsappCapable: phone?.whatsappCapable ?? false,
      service: cols.service ? text(raw[cols.service], 200) : null, serviceDate: sd ?? null,
    });
  });

  return db.transaction(async (tx) => {
    if (p.locationId != null) {
      const [loc] = await tx.select({ id: reviewLocationsTable.id }).from(reviewLocationsTable)
        .where(and(eq(reviewLocationsTable.orgId, p.orgId), eq(reviewLocationsTable.id, p.locationId)));
      if (!loc) throw new ImportInputError("location_not_found", "El establecimiento no existe en este workspace.", 404);
    }

    // ── Fase 2: contra la BD de ESTA empresa (existentes y bajas) ────────────
    const emails = candidates.map((c) => c.emailNorm).filter((v): v is string => !!v);
    const phones = candidates.map((c) => c.phone).filter((v): v is string => !!v);
    const existingEmail = new Set<string>(), existingPhone = new Set<string>();
    for (const part of chunks(emails, LOOKUP_CHUNK)) {
      const r = await tx.select({ e: reviewContactsTable.emailNorm }).from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, p.orgId), inArray(reviewContactsTable.emailNorm, part)));
      r.forEach((x) => x.e && existingEmail.add(x.e));
    }
    for (const part of chunks(phones, LOOKUP_CHUNK)) {
      const r = await tx.select({ ph: reviewContactsTable.phoneE164 }).from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, p.orgId), inArray(reviewContactsTable.phoneE164, part)));
      r.forEach((x) => x.ph && existingPhone.add(x.ph));
    }
    // Bajas: channel NULL = oposición global (descarta TODA la fila); canal concreto = solo esa dirección.
    const optOutEmail = new Set<string>(), optOutPhone = new Set<string>(), blockEmail = new Set<string>(), blockPhone = new Set<string>();
    for (const part of chunks(emails, LOOKUP_CHUNK)) {
      const r = await tx.select({ e: outreachSuppressionsTable.email, ch: outreachSuppressionsTable.channel }).from(outreachSuppressionsTable)
        .where(and(eq(outreachSuppressionsTable.orgId, p.orgId), inArray(outreachSuppressionsTable.email, part)));
      r.forEach((x) => { if (!x.e) return; if (x.ch === null) optOutEmail.add(x.e); else if (x.ch === "email") blockEmail.add(x.e); });
    }
    const phoneByVariant = new Map<string, string>();
    phones.forEach((ph) => phoneVariants(ph).forEach((v) => phoneByVariant.set(v, ph)));
    for (const part of chunks([...phoneByVariant.keys()], LOOKUP_CHUNK)) {
      const r = await tx.select({ ph: outreachSuppressionsTable.phone, ch: outreachSuppressionsTable.channel }).from(outreachSuppressionsTable)
        .where(and(eq(outreachSuppressionsTable.orgId, p.orgId), inArray(outreachSuppressionsTable.phone, part)));
      r.forEach((x) => { const e164 = x.ph ? phoneByVariant.get(x.ph) : undefined; if (!e164) return; if (x.ch === null) optOutPhone.add(e164); else if (x.ch === "whatsapp") blockPhone.add(e164); });
    }

    let duplicatesDb = 0, suppressed = 0;
    const survivors: Candidate[] = [];
    for (const c of candidates) {
      if ((c.emailNorm && optOutEmail.has(c.emailNorm)) || (c.phone && optOutPhone.has(c.phone))) {
        suppressed++; addIssue({ row: c.row, kind: "suppressed", detail: "En la lista de bajas: no se importa" }); continue;
      }
      if ((c.emailNorm && existingEmail.has(c.emailNorm)) || (c.phone && existingPhone.has(c.phone))) {
        duplicatesDb++; addIssue({ row: c.row, kind: "duplicate_existing", detail: "Ya existe en este workspace" }); continue;
      }
      const eBlocked = !!(c.emailNorm && blockEmail.has(c.emailNorm)), pBlocked = !!(c.phone && blockPhone.has(c.phone));
      if (eBlocked && (pBlocked || !c.phone)) { suppressed++; addIssue({ row: c.row, kind: "suppressed", detail: "Dirección bloqueada (rebote/queja)" }); continue; }
      if (pBlocked && !c.emailNorm) { suppressed++; addIssue({ row: c.row, kind: "suppressed", detail: "Dirección bloqueada (rebote/queja)" }); continue; }
      survivors.push({ ...c, email: eBlocked ? null : c.email, emailNorm: eBlocked ? null : c.emailNorm, phone: pBlocked ? null : c.phone, whatsappCapable: pBlocked ? false : c.whatsappCapable });
    }

    // ── Fase 3: límite del plan/empresa (aplicado ANTES de escribir) ─────────
    const [settings] = await tx.select({ limit: reviewSettingsTable.monthlyContactLimit }).from(reviewSettingsTable).where(eq(reviewSettingsTable.orgId, p.orgId));
    if (settings?.limit != null) {
      const [cur] = await tx.select({ n: sql<number>`count(*)::int` }).from(reviewContactsTable)
        .where(and(eq(reviewContactsTable.orgId, p.orgId), eq(reviewContactsTable.status, "active")));
      if ((cur?.n ?? 0) + survivors.length > settings.limit)
        throw new ImportInputError("contact_limit_exceeded", `La importación superaría el límite de contactos del workspace (${settings.limit}). Actuales: ${cur?.n ?? 0}, a importar: ${survivors.length}.`, 422);
    }

    // ── Fase 4: escribir (lote + contactos + consentimientos) ────────────────
    const [batch] = await tx.insert(reviewImportBatchesTable).values({
      orgId: p.orgId, locationId: p.locationId ?? null, source: p.source, fileName: p.fileName.slice(0, 255),
      legalBasis, legalBasisNote: p.legalBasisNote?.trim() || null, totalRows: p.rows.length, createdBy: p.userId ?? null,
    }).returning({ id: reviewImportBatchesTable.id });
    const batchId = batch!.id;

    let imported = 0, withEmail = 0, withWhatsapp = 0, raceDuplicates = 0;
    const evidence = `Importación #${batchId} (${p.fileName.slice(0, 120)}). Base jurídica declarada por el usuario ${p.userId ?? "?"}: ${legalBasis}${p.legalBasisNote ? ` — ${p.legalBasisNote.trim().slice(0, 500)}` : ""}`;
    const capable = new Map(survivors.map((c) => [`${c.emailNorm ?? ""}|${c.phone ?? ""}`, c.whatsappCapable]));
    for (const part of chunks(survivors, INSERT_CHUNK)) {
      const inserted = await tx.insert(reviewContactsTable).values(part.map((c) => ({
        orgId: p.orgId, locationId: p.locationId ?? null, batchId, name: c.name, email: c.email, emailNorm: c.emailNorm, phoneE164: c.phone,
        service: c.service, serviceDate: c.serviceDate, source: p.source,
      }))).onConflictDoNothing().returning({ id: reviewContactsTable.id, emailNorm: reviewContactsTable.emailNorm, phoneE164: reviewContactsTable.phoneE164 });
      raceDuplicates += part.length - inserted.length;
      const consents: { contactId: number; channel: ReviewChannel }[] = [];
      for (const r of inserted) {
        if (r.emailNorm) { consents.push({ contactId: r.id, channel: "email" }); withEmail++; }
        if (r.phoneE164 && capable.get(`${r.emailNorm ?? ""}|${r.phoneE164}`)) { consents.push({ contactId: r.id, channel: "whatsapp" }); withWhatsapp++; }
      }
      // Un INSERT por lote (no uno por consentimiento): con latencia de red a Neon marca la diferencia entre segundos y minutos.
      if (consents.length) await tx.insert(reviewConsentsTable).values(consents.map((c) => ({
        orgId: p.orgId, contactId: c.contactId, channel: c.channel, legalBasis, evidence, source: "import", createdBy: p.userId ?? null,
      })));
      imported += inserted.length;
    }
    const duplicates = duplicatesFile + duplicatesDb + raceDuplicates;
    await tx.update(reviewImportBatchesTable).set({
      validRows: imported, invalidRows: invalid, duplicateRows: duplicates,
      errorReport: { summary: { suppressed, warnings, imported, withEmail, withWhatsapp }, rows: report, truncated: report.length >= MAX_REPORT_ROWS },
    }).where(eq(reviewImportBatchesTable.id, batchId));

    return { batchId, totalRows: p.rows.length, imported, invalid, duplicates, suppressed, warnings, withEmail, withWhatsapp, report, reportTruncated: report.length >= MAX_REPORT_ROWS };
  });
}
