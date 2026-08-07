/**
 * VeriFactu connector — domain types.
 *
 * Grounded in the AEAT "Sistema VERI*FACTU" (RD 1007/2023 + Reglamento
 * RRSIF): every invoice becomes a "registro de facturación" that is hashed
 * with SHA-256, chained to the previous record's hash, tagged with a QR
 * payload, and — in modo VeriFactu activo — submitted in near-real-time to
 * AEAT's webservice. Modo "no VeriFactu" skips the live submission but must
 * keep the same chained, exportable record locally.
 *
 * NOTE: the AEAT production/testing webservice endpoints and the exact
 * current mandatory dates have shifted more than once (see RD-ley 15/2025).
 * This connector treats the submission endpoint and mode as configuration,
 * not a hardcoded assumption — do not go live without confirming current
 * values against the AEAT Sede Electrónica for the org's obligation date.
 */

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number; // e.g. 0.21 for 21% IVA
}

export interface InvoiceInput {
  invoiceNumber: string;
  issueDate: string; // ISO date
  issuerNif: string;
  issuerName: string;
  recipientNif?: string;
  recipientName?: string;
  lines: InvoiceLine[];
  /** "F1" factura completa, "F2" factura simplificada, etc. Follows AEAT's tipo de factura codes. */
  invoiceType: "F1" | "F2" | "R1" | "R2" | "R3" | "R4" | "R5";
}

export interface InvoiceTotals {
  taxBase: number;
  taxAmount: number;
  total: number;
}

/** The "registro de facturación" — one chained, hashed record per invoice. */
export interface InvoiceRecord {
  invoiceNumber: string;
  issueDate: string;
  issuerNif: string;
  totals: InvoiceTotals;
  /** SHA-256 hash of this record's canonical content. */
  hash: string;
  /** Hash of the immediately preceding record in this org's chain, or null for the first record. */
  previousHash: string | null;
  /** ISO timestamp of when this record was generated (sello de tiempo). */
  generatedAt: string;
  /** Raw canonical XML representation submitted/stored for this record. */
  xml: string;
  qrPayload: string;
  qrUrl: string;
}

export interface SubmissionResult {
  accepted: boolean;
  aeatStatus?: "correcto" | "aceptado_con_errores" | "rechazado";
  csv?: string; // Código Seguro de Verificación returned by AEAT, when applicable
  error?: string;
  submittedAt: string;
}
