import { createHash } from "node:crypto";
import type { InvoiceInput, InvoiceRecord, InvoiceTotals } from "./domain.js";

/**
 * hashChain — builds the SHA-256 chained hash for a new invoice record.
 * Per RRSIF: hash = SHA256(canonical_fields + previous_hash). Any retroactive
 * edit to a past invoice breaks every hash after it, which is exactly the
 * tamper-evidence property the regulation requires.
 */
export function computeTotals(invoice: InvoiceInput): InvoiceTotals {
  let taxBase = 0;
  let taxAmount = 0;
  for (const line of invoice.lines) {
    const lineBase = round2(line.quantity * line.unitPrice);
    taxBase += lineBase;
    taxAmount += round2(lineBase * line.taxRate);
  }
  taxBase = round2(taxBase);
  taxAmount = round2(taxAmount);
  return { taxBase, taxAmount, total: round2(taxBase + taxAmount) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Canonical string representation hashed into the chain. Field order matters — never reorder without a migration plan. */
function canonicalize(invoice: InvoiceInput, totals: InvoiceTotals, previousHash: string | null): string {
  return [
    invoice.issuerNif,
    invoice.invoiceNumber,
    invoice.invoiceType,
    invoice.issueDate,
    totals.taxBase.toFixed(2),
    totals.taxAmount.toFixed(2),
    totals.total.toFixed(2),
    previousHash ?? "",
  ].join("|");
}

export function computeHash(invoice: InvoiceInput, totals: InvoiceTotals, previousHash: string | null): string {
  return createHash("sha256").update(canonicalize(invoice, totals, previousHash), "utf8").digest("hex").toUpperCase();
}

/**
 * buildXml — minimal canonical XML for the "registro de facturación".
 * This is a structurally-correct, field-complete representation suitable for
 * demos and for the local tamper-evident store; mapping it 1:1 onto AEAT's
 * official XSD (published on the Sede Electrónica) is a Fase 2 task once the
 * org's exact obligation date and schema version are confirmed.
 */
export function buildXml(invoice: InvoiceInput, totals: InvoiceTotals, hash: string, previousHash: string | null): string {
  const lines = invoice.lines
    .map(
      (l) =>
        `<Linea><Descripcion>${escapeXml(l.description)}</Descripcion><Cantidad>${l.quantity}</Cantidad>` +
        `<PrecioUnitario>${l.unitPrice.toFixed(2)}</PrecioUnitario><TipoImpositivo>${(l.taxRate * 100).toFixed(2)}</TipoImpositivo></Linea>`,
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<RegistroFacturacion>` +
    `<IDFactura><NIFEmisor>${escapeXml(invoice.issuerNif)}</NIFEmisor>` +
    `<NumSerieFactura>${escapeXml(invoice.invoiceNumber)}</NumSerieFactura>` +
    `<FechaExpedicion>${invoice.issueDate}</FechaExpedicion></IDFactura>` +
    `<TipoFactura>${invoice.invoiceType}</TipoFactura>` +
    `<Lineas>${lines}</Lineas>` +
    `<Totales><BaseImponible>${totals.taxBase.toFixed(2)}</BaseImponible>` +
    `<CuotaTotal>${totals.taxAmount.toFixed(2)}</CuotaTotal>` +
    `<ImporteTotal>${totals.total.toFixed(2)}</ImporteTotal></Totales>` +
    `<Encadenamiento><HuellaAnterior>${previousHash ?? ""}</HuellaAnterior></Encadenamiento>` +
    `<Huella>${hash}</Huella>` +
    `</RegistroFacturacion>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** QR payload per the "código QR tributario": issuer NIF + invoice number + date + total, URL-encoded onto AEAT's public verification path. */
export function buildQr(invoice: InvoiceInput, totals: InvoiceTotals, baseVerificationUrl: string): { qrPayload: string; qrUrl: string } {
  const params = new URLSearchParams({
    nif: invoice.issuerNif,
    numserie: invoice.invoiceNumber,
    fecha: invoice.issueDate,
    importe: totals.total.toFixed(2),
  });
  const qrPayload = params.toString();
  const qrUrl = `${baseVerificationUrl}?${qrPayload}`;
  return { qrPayload, qrUrl };
}

export function buildInvoiceRecord(
  invoice: InvoiceInput,
  previousHash: string | null,
  qrVerificationBaseUrl: string,
): InvoiceRecord {
  const totals = computeTotals(invoice);
  const hash = computeHash(invoice, totals, previousHash);
  const xml = buildXml(invoice, totals, hash, previousHash);
  const { qrPayload, qrUrl } = buildQr(invoice, totals, qrVerificationBaseUrl);

  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    issuerNif: invoice.issuerNif,
    totals,
    hash,
    previousHash,
    generatedAt: new Date().toISOString(),
    xml,
    qrPayload,
    qrUrl,
  };
}
