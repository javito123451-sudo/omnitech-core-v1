// Consulta de contactos e importaciones. Toda función recibe orgId y lo aplica en el WHERE.
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, reviewContactsTable, reviewImportBatchesTable } from "@workspace/db";

const CONTACT_STATUSES = ["active", "unsubscribed", "invalid", "bounced", "erased"];
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listContacts(orgId: number, o: { status?: string; q?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200), offset = Math.max(o.offset ?? 0, 0);
  const conds = [eq(reviewContactsTable.orgId, orgId)];
  if (o.status && CONTACT_STATUSES.includes(o.status)) conds.push(eq(reviewContactsTable.status, o.status));
  if (o.q && o.q.trim()) {
    const like = `%${escapeLike(o.q.trim().slice(0, 100))}%`;
    conds.push(or(ilike(reviewContactsTable.name, like), ilike(reviewContactsTable.emailNorm, like), ilike(reviewContactsTable.phoneE164, like))!);
  }
  const where = and(...conds);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewContactsTable).where(where);
  const rows = await db.select().from(reviewContactsTable).where(where).orderBy(desc(reviewContactsTable.id)).limit(limit).offset(offset);
  return { total: n, limit, offset, contacts: rows };
}

export async function getContact(orgId: number, id: number) {
  const [row] = await db.select().from(reviewContactsTable).where(and(eq(reviewContactsTable.orgId, orgId), eq(reviewContactsTable.id, id)));
  return row ?? null;
}

export async function listImports(orgId: number) {
  return db.select({
    id: reviewImportBatchesTable.id, source: reviewImportBatchesTable.source, fileName: reviewImportBatchesTable.fileName,
    legalBasis: reviewImportBatchesTable.legalBasis, totalRows: reviewImportBatchesTable.totalRows, validRows: reviewImportBatchesTable.validRows,
    invalidRows: reviewImportBatchesTable.invalidRows, duplicateRows: reviewImportBatchesTable.duplicateRows, createdAt: reviewImportBatchesTable.createdAt,
  }).from(reviewImportBatchesTable).where(eq(reviewImportBatchesTable.orgId, orgId)).orderBy(desc(reviewImportBatchesTable.id)).limit(100);
}

export async function getImport(orgId: number, id: number) {
  const [row] = await db.select().from(reviewImportBatchesTable).where(and(eq(reviewImportBatchesTable.orgId, orgId), eq(reviewImportBatchesTable.id, id)));
  return row ?? null;
}
