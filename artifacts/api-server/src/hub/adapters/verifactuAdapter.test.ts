/**
 * Tests del adaptador VeriFactu como ActionAdapter — validate/healthCheck/
 * executeAction, encadenado a través de InMemoryChainStore, sin DB real.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createVerifactuAdapter } from "./verifactuAdapter.js";
import { InMemoryChainStore } from "./verifactu/chainStore.js";
import { FakeAeatClient } from "./verifactu/aeatClient.js";
import type { AdapterContext } from "../types.js";

function ctx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    orgId: 1,
    credentials: { issuerNif: "B12345678" },
    config: { mode: "no_verifactu" },
    ...overrides,
  };
}

const sampleInput = {
  invoiceNumber: "2026-0001",
  issueDate: "2026-08-07",
  issuerNif: "B12345678",
  invoiceType: "F1",
  lines: [{ description: "Suscripción AVA", quantity: 1, unitPrice: 99, taxRate: 0.21 }],
};

describe("VeriFactu adapter — shape", () => {
  test("declares actions/resources/events (ActionAdapter shape, not messaging)", () => {
    const adapter = createVerifactuAdapter();
    assert.ok(Array.isArray(adapter.actions));
    assert.ok(Array.isArray(adapter.resources));
    assert.ok(Array.isArray(adapter.events));
    assert.equal("send" in adapter, false);
    assert.equal("receive" in adapter, false);
  });
});

describe("VeriFactu adapter — validate", () => {
  test("valid when issuerNif present and mode is no_verifactu", async () => {
    const adapter = createVerifactuAdapter();
    const result = await adapter.validate(ctx());
    assert.equal(result.valid, true);
  });

  test("requires aeatEndpoint when mode is verifactu_activo", async () => {
    const adapter = createVerifactuAdapter();
    const result = await adapter.validate(ctx({ config: { mode: "verifactu_activo" } }));
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes("aeatEndpoint"));
  });
});

describe("VeriFactu adapter — generate_invoice_record", () => {
  test("generates a chained record and stores it", async () => {
    const chainStore = new InMemoryChainStore();
    const adapter = createVerifactuAdapter({ chainStore });
    const result = await adapter.executeAction(ctx(), "generate_invoice_record", sampleInput);
    assert.equal(result.success, true);
    assert.equal(result.output?.previousHash, null);
    assert.equal((await chainStore.list(1)).length, 1);
  });

  test("second invoice chains to the first", async () => {
    const chainStore = new InMemoryChainStore();
    const adapter = createVerifactuAdapter({ chainStore });
    await adapter.executeAction(ctx(), "generate_invoice_record", sampleInput);
    const second = await adapter.executeAction(ctx(), "generate_invoice_record", { ...sampleInput, invoiceNumber: "2026-0002" });
    const records = await chainStore.list(1);
    assert.equal(records[1].previousHash, records[0].hash);
    assert.equal(second.output?.previousHash, records[0].hash);
  });

  test("rejects invalid input without throwing", async () => {
    const adapter = createVerifactuAdapter();
    const result = await adapter.executeAction(ctx(), "generate_invoice_record", { invoiceNumber: "" });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_INPUT");
  });
});

describe("VeriFactu adapter — submit_record", () => {
  test("modo no_verifactu never calls AEAT, returns submitted=false", async () => {
    const chainStore = new InMemoryChainStore();
    let called = false;
    const aeatClient = { submit: async () => { called = true; return { accepted: true, submittedAt: "" }; } };
    const adapter = createVerifactuAdapter({ chainStore, aeatClient });
    await adapter.executeAction(ctx(), "generate_invoice_record", sampleInput);
    const result = await adapter.executeAction(ctx(), "submit_record", { invoiceNumber: sampleInput.invoiceNumber });
    assert.equal(result.success, true);
    assert.equal(result.output?.submitted, false);
    assert.equal(called, false);
  });

  test("modo verifactu_activo submits to AEAT client", async () => {
    const chainStore = new InMemoryChainStore();
    const activeCtx = ctx({ config: { mode: "verifactu_activo", aeatEndpoint: "https://example.test/aeat" } });
    const adapter = createVerifactuAdapter({ chainStore, aeatClient: new FakeAeatClient() });
    await adapter.executeAction(activeCtx, "generate_invoice_record", sampleInput);
    const result = await adapter.executeAction(activeCtx, "submit_record", { invoiceNumber: sampleInput.invoiceNumber });
    assert.equal(result.success, true);
    assert.ok((result.output as { csv?: string })?.csv?.startsWith("DEMO-"));
  });
});

describe("VeriFactu adapter — executeAction with unknown action", () => {
  test("fails gracefully instead of throwing", async () => {
    const adapter = createVerifactuAdapter();
    const result = await adapter.executeAction(ctx(), "__nonexistent__", {});
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "ACTION_NOT_FOUND");
  });
});
