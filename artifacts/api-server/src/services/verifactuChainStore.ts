/**
 * PgVerifactuChainStore — implementación real (Postgres) del ChainStore que
 * @workspace/connector-verifactu define como interfaz. Sustituye al
 * InMemoryChainStore usado en tests/demo por la tabla verifactu_records real.
 *
 * Diseño: la interfaz ChainStore del Core es (orgId, record) — no conoce el
 * invoiceId interno de OmniTech. Para reutilizar invoicesTable como FK sin
 * tocar el contrato del conector, append() resuelve el invoiceId buscando la
 * factura existente por (orgId, invoiceNumber). Esto obliga a que exista una
 * fila en invoicesTable antes de generar su registro VeriFactu — que es
 * exactamente el flujo correcto: no se generan registros VeriFactu "sueltos".
 */
import { db, verifactuRecordsTable, invoicesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { ChainStore, InvoiceRecord } from "@workspace/connector-verifactu";

export class InvoiceNotFoundForChainError extends Error {
  constructor(orgId: number, invoiceNumber: string) {
    super(`No existe una factura con número "${invoiceNumber}" para el org ${orgId}. Crea la factura antes de generar su registro VeriFactu.`);
    this.name = "InvoiceNotFoundForChainError";
  }
}

export class PgVerifactuChainStore implements ChainStore {
  async getLastRecord(orgId: number): Promise<InvoiceRecord | null> {
    const [row] = await db
      .select()
      .from(verifactuRecordsTable)
      .where(eq(verifactuRecordsTable.orgId, orgId))
      .orderBy(desc(verifactuRecordsTable.id))
      .limit(1);
    return row ? toInvoiceRecord(row) : null;
  }

  async append(orgId: number, record: InvoiceRecord): Promise<void> {
    const [invoice] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.invoiceNumber, record.invoiceNumber)));

    if (!invoice) throw new InvoiceNotFoundForChainError(orgId, record.invoiceNumber);

    await db.insert(verifactuRecordsTable).values({
      orgId,
      invoiceId: invoice.id,
      hash: record.hash,
      previousHash: record.previousHash,
      xml: record.xml,
      qrPayload: record.qrPayload,
      qrUrl: record.qrUrl,
      taxBase: record.totals.taxBase.toFixed(2),
      taxAmount: record.totals.taxAmount.toFixed(2),
      total: record.totals.total.toFixed(2),
      generatedAt: new Date(record.generatedAt),
    });
  }

  async list(orgId: number): Promise<InvoiceRecord[]> {
    const rows = await db
      .select({ rec: verifactuRecordsTable, invoiceNumber: invoicesTable.invoiceNumber })
      .from(verifactuRecordsTable)
      .innerJoin(invoicesTable, eq(invoicesTable.id, verifactuRecordsTable.invoiceId))
      .where(eq(verifactuRecordsTable.orgId, orgId))
      .orderBy(verifactuRecordsTable.id);
    return rows.map((r) => toInvoiceRecord(r.rec, r.invoiceNumber));
  }

  /**
   * Lectura enriquecida solo para la API/UI (invoiceId, modo, estado de envío).
   * No forma parte de la interfaz ChainStore del Core — el Core no necesita
   * saber nada de esto, es puramente de presentación.
   */
  async listWithMeta(orgId: number) {
    const rows = await db
      .select({
        invoiceId: verifactuRecordsTable.invoiceId,
        invoiceNumber: invoicesTable.invoiceNumber,
        hash: verifactuRecordsTable.hash,
        previousHash: verifactuRecordsTable.previousHash,
        qrUrl: verifactuRecordsTable.qrUrl,
        taxBase: verifactuRecordsTable.taxBase,
        taxAmount: verifactuRecordsTable.taxAmount,
        total: verifactuRecordsTable.total,
        mode: verifactuRecordsTable.mode,
        submitted: verifactuRecordsTable.submitted,
        aeatStatus: verifactuRecordsTable.aeatStatus,
        aeatCsv: verifactuRecordsTable.aeatCsv,
        generatedAt: verifactuRecordsTable.generatedAt,
      })
      .from(verifactuRecordsTable)
      .innerJoin(invoicesTable, eq(invoicesTable.id, verifactuRecordsTable.invoiceId))
      .where(eq(verifactuRecordsTable.orgId, orgId))
      .orderBy(verifactuRecordsTable.id);

    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      hash: r.hash,
      previousHash: r.previousHash,
      qrUrl: r.qrUrl,
      totals: { taxBase: Number(r.taxBase), taxAmount: Number(r.taxAmount), total: Number(r.total) },
      mode: r.mode,
      submitted: r.submitted === "true",
      aeatStatus: r.aeatStatus,
      aeatCsv: r.aeatCsv,
      generatedAt: r.generatedAt.toISOString(),
    }));
  }

  async getByInvoiceId(orgId: number, invoiceId: number): Promise<InvoiceRecord | null> {
    const [row] = await db
      .select()
      .from(verifactuRecordsTable)
      .where(and(eq(verifactuRecordsTable.orgId, orgId), eq(verifactuRecordsTable.invoiceId, invoiceId)));
    return row ? toInvoiceRecord(row) : null;
  }

  async markSubmitted(
    orgId: number,
    invoiceId: number,
    result: { accepted: boolean; aeatStatus?: string; csv?: string; error?: string; mode: string },
  ): Promise<void> {
    await db
      .update(verifactuRecordsTable)
      .set({
        mode: result.mode,
        submitted: String(result.accepted),
        aeatStatus: result.aeatStatus ?? null,
        aeatCsv: result.csv ?? null,
        submitError: result.error ?? null,
        submittedAt: new Date(),
      })
      .where(and(eq(verifactuRecordsTable.orgId, orgId), eq(verifactuRecordsTable.invoiceId, invoiceId)));
  }
}

function toInvoiceRecord(row: typeof verifactuRecordsTable.$inferSelect, invoiceNumber = ""): InvoiceRecord {
  return {
    invoiceNumber,
    issueDate: "",
    issuerNif: "",
    totals: {
      taxBase: Number(row.taxBase),
      taxAmount: Number(row.taxAmount),
      total: Number(row.total),
    },
    hash: row.hash,
    previousHash: row.previousHash,
    generatedAt: row.generatedAt.toISOString(),
    xml: row.xml,
    qrPayload: row.qrPayload,
    qrUrl: row.qrUrl,
  };
}
