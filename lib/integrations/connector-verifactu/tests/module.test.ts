import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ConnectorContext } from "@workspace/connector-core";
import { createVerifactuModule } from "../src/module.js";
import { InMemoryChainStore } from "../src/chainStore.js";
import { FakeAeatClient } from "../src/aeatClient.js";

function ctx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    orgId: 1,
    connectorSlug: "verifactu",
    config: { mode: "no_verifactu" },
    credentials: { issuerNif: "B12345678" },
    requestId: "test",
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

describe("VeriFactu module — validate", () => {
  test("valid when issuerNif present and mode is no_verifactu", async () => {
    const mod = createVerifactuModule();
    const result = await mod.validate(ctx());
    assert.equal(result.valid, true);
  });

  test("requires aeatEndpoint when mode is verifactu_activo", async () => {
    const mod = createVerifactuModule();
    const result = await mod.validate(ctx({ config: { mode: "verifactu_activo" } }));
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes("aeatEndpoint"));
  });
});

describe("VeriFactu module — generate_invoice_record", () => {
  test("generates a chained record and stores it", async () => {
    const chainStore = new InMemoryChainStore();
    const mod = createVerifactuModule({ chainStore });
    const result = await mod.executeAction(ctx(), "generate_invoice_record", sampleInput);
    assert.equal(result.success, true);
    assert.equal(result.output?.previousHash, null);
    const records = await chainStore.list(1);
    assert.equal(records.length, 1);
  });

  test("rejects invalid input without throwing", async () => {
    const mod = createVerifactuModule();
    const result = await mod.executeAction(ctx(), "generate_invoice_record", { invoiceNumber: "" });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_INPUT");
  });

  test("second invoice chains to the first", async () => {
    const chainStore = new InMemoryChainStore();
    const mod = createVerifactuModule({ chainStore });
    await mod.executeAction(ctx(), "generate_invoice_record", sampleInput);
    const second = await mod.executeAction(ctx(), "generate_invoice_record", { ...sampleInput, invoiceNumber: "2026-0002" });
    const records = await chainStore.list(1);
    assert.equal(records[1].previousHash, records[0].hash);
    assert.equal(second.output?.previousHash, records[0].hash);
  });
});

describe("VeriFactu module — submit_record", () => {
  test("modo no_verifactu never calls AEAT, returns submitted=false", async () => {
    const chainStore = new InMemoryChainStore();
    let called = false;
    const aeatClient = { submit: async () => { called = true; return { accepted: true, submittedAt: "" }; } };
    const mod = createVerifactuModule({ chainStore, aeatClient });
    await mod.executeAction(ctx(), "generate_invoice_record", sampleInput);
    const result = await mod.executeAction(ctx(), "submit_record", { invoiceNumber: sampleInput.invoiceNumber });
    assert.equal(result.success, true);
    assert.equal(result.output?.submitted, false);
    assert.equal(called, false);
  });

  test("modo verifactu_activo submits to AEAT client", async () => {
    const chainStore = new InMemoryChainStore();
    const aeatClient = new FakeAeatClient();
    const mod = createVerifactuModule({ chainStore, aeatClient });
    const activeCtx = ctx({ config: { mode: "verifactu_activo", aeatEndpoint: "https://example.test/aeat" } });
    await mod.executeAction(activeCtx, "generate_invoice_record", sampleInput);
    const result = await mod.executeAction(activeCtx, "submit_record", { invoiceNumber: sampleInput.invoiceNumber });
    assert.equal(result.success, true);
    assert.ok((result.output as { csv?: string })?.csv?.startsWith("DEMO-"));
  });

  test("fails cleanly when the invoice was never generated", async () => {
    const mod = createVerifactuModule();
    const result = await mod.executeAction(ctx(), "submit_record", { invoiceNumber: "does-not-exist" });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });
});

describe("VeriFactu module — healthCheck", () => {
  test("reports chain length and last hash", async () => {
    const chainStore = new InMemoryChainStore();
    const mod = createVerifactuModule({ chainStore });
    await mod.executeAction(ctx(), "generate_invoice_record", sampleInput);
    const health = await mod.healthCheck(ctx());
    assert.equal(health.status, "healthy");
    assert.equal(health.detail?.chainLength, 1);
  });
});
