import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceRecord, computeTotals, computeHash } from "../src/hashChain.js";
import type { InvoiceInput } from "../src/domain.js";

function sampleInvoice(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    invoiceNumber: "2026-0001",
    issueDate: "2026-08-07",
    issuerNif: "B12345678",
    issuerName: "OmniTech C.I.A.",
    invoiceType: "F1",
    lines: [{ description: "Suscripción AVA Profesional", quantity: 1, unitPrice: 99, taxRate: 0.21 }],
    ...overrides,
  };
}

describe("computeTotals", () => {
  test("computes base, tax, and total correctly for a single line", () => {
    const totals = computeTotals(sampleInvoice());
    assert.equal(totals.taxBase, 99);
    assert.equal(totals.taxAmount, 20.79);
    assert.equal(totals.total, 119.79);
  });

  test("sums multiple lines independently before rounding", () => {
    const totals = computeTotals(
      sampleInvoice({
        lines: [
          { description: "A", quantity: 2, unitPrice: 10, taxRate: 0.21 },
          { description: "B", quantity: 1, unitPrice: 5, taxRate: 0.1 },
        ],
      }),
    );
    assert.equal(totals.taxBase, 25);
    assert.equal(totals.taxAmount, 4.7);
  });
});

describe("computeHash", () => {
  test("is deterministic for identical input", () => {
    const invoice = sampleInvoice();
    const totals = computeTotals(invoice);
    const h1 = computeHash(invoice, totals, null);
    const h2 = computeHash(invoice, totals, null);
    assert.equal(h1, h2);
  });

  test("changes when previousHash changes (chaining)", () => {
    const invoice = sampleInvoice();
    const totals = computeTotals(invoice);
    const h1 = computeHash(invoice, totals, null);
    const h2 = computeHash(invoice, totals, "SOME_PREVIOUS_HASH");
    assert.notEqual(h1, h2);
  });

  test("changes when any invoice field changes (tamper evidence)", () => {
    const invoice = sampleInvoice();
    const totals = computeTotals(invoice);
    const h1 = computeHash(invoice, totals, null);
    const tampered = sampleInvoice({ invoiceNumber: "2026-0002" });
    const h2 = computeHash(tampered, computeTotals(tampered), null);
    assert.notEqual(h1, h2);
  });
});

describe("buildInvoiceRecord", () => {
  test("first record in a chain has previousHash = null", () => {
    const record = buildInvoiceRecord(sampleInvoice(), null, "https://example.test/qr");
    assert.equal(record.previousHash, null);
    assert.equal(record.hash.length, 64); // SHA-256 hex
  });

  test("second record chains to the first record's hash", () => {
    const first = buildInvoiceRecord(sampleInvoice(), null, "https://example.test/qr");
    const second = buildInvoiceRecord(sampleInvoice({ invoiceNumber: "2026-0002" }), first.hash, "https://example.test/qr");
    assert.equal(second.previousHash, first.hash);
  });

  test("xml includes the hash and chaining fields", () => {
    const record = buildInvoiceRecord(sampleInvoice(), "PREV", "https://example.test/qr");
    assert.match(record.xml, /<Huella>/);
    assert.match(record.xml, /<HuellaAnterior>PREV<\/HuellaAnterior>/);
  });

  test("qrUrl embeds issuer NIF, invoice number and total", () => {
    const record = buildInvoiceRecord(sampleInvoice(), null, "https://example.test/qr");
    assert.match(record.qrUrl, /nif=B12345678/);
    assert.match(record.qrUrl, /numserie=2026-0001/);
  });
});
