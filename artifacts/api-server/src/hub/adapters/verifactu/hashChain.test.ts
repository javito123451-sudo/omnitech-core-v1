/**
 * Tests de la lógica de dominio pura de VeriFactu (encadenado SHA-256).
 * Sin dependencias del hub ni de la DB — funciones puras.
 *
 * NOTA: api-server no tiene wired ningún test runner/script hasta ahora
 * (WhatsApp/Telegram tampoco tienen tests). Este archivo se ejecuta con
 * `node --import tsx --test` directamente; falta añadir un script "test"
 * al package.json de api-server y wiring de CI — eso queda pendiente,
 * no lo doy por hecho.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceRecord, computeTotals, computeHash } from "./hashChain.js";
import type { InvoiceInput } from "./domain.js";

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
  test("computes base, tax, and total correctly", () => {
    const totals = computeTotals(sampleInvoice());
    assert.equal(totals.taxBase, 99);
    assert.equal(totals.taxAmount, 20.79);
    assert.equal(totals.total, 119.79);
  });
});

describe("computeHash", () => {
  test("is deterministic for identical input", () => {
    const invoice = sampleInvoice();
    const totals = computeTotals(invoice);
    assert.equal(computeHash(invoice, totals, null), computeHash(invoice, totals, null));
  });

  test("changes when previousHash changes (chaining)", () => {
    const invoice = sampleInvoice();
    const totals = computeTotals(invoice);
    assert.notEqual(computeHash(invoice, totals, null), computeHash(invoice, totals, "PREV"));
  });

  test("changes when any invoice field changes (tamper evidence)", () => {
    const a = sampleInvoice();
    const b = sampleInvoice({ invoiceNumber: "2026-0002" });
    assert.notEqual(computeHash(a, computeTotals(a), null), computeHash(b, computeTotals(b), null));
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
});
