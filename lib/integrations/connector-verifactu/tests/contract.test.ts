import { test } from "node:test";
import assert from "node:assert/strict";
import { ContractTestHarness } from "@workspace/connector-core";
import type { ConnectorContext } from "@workspace/connector-core";
import { verifactuManifest } from "../src/manifest.js";
import { createVerifactuModule } from "../src/module.js";
import { InMemoryChainStore } from "../src/chainStore.js";
import { FakeAeatClient } from "../src/aeatClient.js";

const sandboxContext: ConnectorContext = {
  orgId: 999,
  connectorSlug: "verifactu",
  config: { mode: "no_verifactu" },
  credentials: { issuerNif: "B00000000" },
  requestId: "contract-test",
};

test("VeriFactu passes the mandatory Core contract test suite", async () => {
  const harness = new ContractTestHarness(
    verifactuManifest,
    () => createVerifactuModule({ chainStore: new InMemoryChainStore(), aeatClient: new FakeAeatClient() }),
    sandboxContext,
  );
  const report = await harness.run();
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter((r) => !r.ok), null, 2));
  assert.equal(report.connectorSlug, "verifactu");
});
