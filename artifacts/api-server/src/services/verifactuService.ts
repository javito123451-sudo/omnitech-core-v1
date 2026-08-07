/**
 * VeriFactu service — la única puerta de entrada desde el resto de la
 * aplicación al adapter VeriFactu del hub. Construye el InvoiceInput a
 * partir de datos YA existentes (invoicesTable + invoiceItemsTable +
 * organizationsTable.taxId), nunca pide datos de factura duplicados.
 *
 * Toda la resolución de config/credenciales por org (org_integrations,
 * descifrado AES-256-GCM) la hace IntegrationManager internamente — este
 * servicio no la duplica.
 */
import { db, invoicesTable, invoiceItemsTable, organizationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { IntegrationManager } from "../hub";
import type { InvoiceInput } from "../hub/adapters/verifactu/domain";
import { PgVerifactuChainStore } from "./verifactuChainStore";

const VERIFACTU_SLUG = "verifactu";
const chainStore = new PgVerifactuChainStore();

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: number) {
    super(`Factura ${invoiceId} no encontrada`);
    this.name = "InvoiceNotFoundError";
  }
}

async function buildInvoiceInput(orgId: number, invoiceId: number): Promise<InvoiceInput> {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.id, invoiceId)));
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);

  const items = await db
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, invoiceId))
    .orderBy(invoiceItemsTable.orderIndex);

  const taxRate = Number(invoice.taxRate) / 100; // invoicesTable guarda el tipo como porcentaje (21), VeriFactu espera fracción (0.21)

  const [org] = await db
    .select({ taxId: organizationsTable.taxId, legalName: organizationsTable.legalName, name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));

  if (!org?.taxId) {
    throw new Error(
      "El org no tiene NIF configurado (organizations.tax_id vacío). Complétalo antes de generar registros VeriFactu.",
    );
  }

  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.createdAt.toISOString().slice(0, 10),
    issuerNif: org.taxId,
    issuerName: org.legalName ?? org.name,
    invoiceType: "F1",
    lines: items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate,
    })),
  };
}

// ── API pública del servicio ────────────────────────────────────────────────

export async function generateVerifactuRecord(orgId: number, invoiceId: number) {
  const invoiceInput = await buildInvoiceInput(orgId, invoiceId);
  return IntegrationManager.executeAction(
    orgId,
    VERIFACTU_SLUG,
    "generate_invoice_record",
    invoiceInput as unknown as Record<string, unknown>,
  );
}

export async function submitVerifactuRecord(orgId: number, invoiceId: number) {
  const [invoice] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.id, invoiceId)));
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);

  const result = await IntegrationManager.executeAction(orgId, VERIFACTU_SLUG, "submit_record", {
    invoiceNumber: invoice.invoiceNumber,
  });

  const mode = (result.output as { mode?: string } | undefined)?.mode ?? "no_verifactu";

  await chainStore.markSubmitted(orgId, invoiceId, {
    accepted: result.success,
    aeatStatus: (result.output as { aeatStatus?: string } | undefined)?.aeatStatus,
    csv: (result.output as { csv?: string } | undefined)?.csv,
    error: result.error,
    mode,
  });

  return result;
}

export async function getVerifactuRecord(orgId: number, invoiceId: number) {
  return chainStore.getByInvoiceId(orgId, invoiceId);
}

export async function listVerifactuRecords(orgId: number) {
  return chainStore.listWithMeta(orgId);
}

export async function checkVerifactuHealth(orgId: number) {
  return IntegrationManager.healthCheck(orgId, VERIFACTU_SLUG);
}
