import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { IntegrationRegistry } from "../src/registry/integrationRegistry.js";
import { CapabilityResolver } from "../src/registry/capabilityResolver.js";
import { ConnectorFactory } from "../src/factory/connectorFactory.js";
import { ExecutionDispatcher, NO_RETRY, DEFAULT_RETRY_POLICY } from "../src/execution/executionDispatcher.js";
import { HealthEngine } from "../src/health/healthEngine.js";
import { ContractTestHarness } from "../src/testing/contractTestHarness.js";
import type { ConnectorContext, ConnectorManifest, ConnectorModule } from "../src/types.js";
import { ConnectorNotFoundError } from "../src/types.js";

function makeManifest(overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    slug: "demo",
    name: "Demo",
    version: "1.0.0",
    category: "custom",
    configSchema: [],
    actions: [
      { slug: "ping", label: "Ping", input: [], output: [], idempotent: true },
      {
        slug: "fail_once",
        label: "Fail then succeed",
        input: [{ key: "id", label: "Id", type: "string", required: true }],
        output: [],
        idempotent: true,
      },
    ],
    events: [],
    resources: [],
    load: () => makeModule(),
    ...overrides,
  };
}

let timeoutCallCount = 0;

function makeModule(): ConnectorModule {
  return {
    async validate() {
      return { valid: true, missing: [] };
    },
    async healthCheck() {
      return { status: "healthy", checkedAt: new Date().toISOString() };
    },
    async executeAction(_ctx, actionSlug, input) {
      if (actionSlug === "ping") return { success: true, output: { pong: true } };
      if (actionSlug === "fail_once") {
        timeoutCallCount++;
        if (timeoutCallCount < 2) return { success: false, error: "boom", errorCode: "TIMEOUT" };
        return { success: true, output: { id: input.id } };
      }
      return { success: false, error: "unknown action" };
    },
    async parseEvent(raw) {
      if (raw && typeof raw === "object" && "known" in (raw as object)) {
        return { eventSlug: "known", orgId: 1, connectorSlug: "demo", payload: {}, occurredAt: new Date().toISOString() };
      }
      return null;
    },
  };
}

function ctx(): ConnectorContext {
  return { orgId: 1, connectorSlug: "demo", config: {}, credentials: {}, requestId: "test" };
}

describe("IntegrationRegistry + CapabilityResolver", () => {
  test("bootstrap loads manifests and rebuilds sub-registries", () => {
    const registry = new IntegrationRegistry();
    registry.bootstrap([makeManifest()]);
    assert.equal(registry.isBootstrapped(), true);
    assert.equal(registry.actions.get("demo", "ping")?.action.slug, "ping");
    const resolver = new CapabilityResolver(registry);
    const caps = resolver.resolve("demo");
    assert.equal(caps.actions.length, 2);
  });

  test("get() throws ConnectorNotFoundError for unknown slug", () => {
    const registry = new IntegrationRegistry();
    registry.bootstrap([]);
    assert.throws(() => registry.get("nope"), ConnectorNotFoundError);
  });
});

describe("ConnectorFactory", () => {
  test("caches instances across calls", async () => {
    const registry = new IntegrationRegistry();
    registry.bootstrap([makeManifest()]);
    const factory = new ConnectorFactory(registry);
    const a = await factory.create("demo");
    const b = await factory.create("demo");
    assert.equal(a, b);
  });
});

describe("ExecutionDispatcher", () => {
  test("dispatches a successful action", async () => {
    const registry = new IntegrationRegistry();
    registry.bootstrap([makeManifest()]);
    const dispatcher = new ExecutionDispatcher(registry, new ConnectorFactory(registry));
    const result = await dispatcher.dispatch(ctx(), "ping", {}, { retry: NO_RETRY });
    assert.equal(result.success, true);
    assert.deepEqual(result.output, { pong: true });
  });

  test("retries idempotent actions on TIMEOUT and eventually succeeds", async () => {
    timeoutCallCount = 0;
    const registry = new IntegrationRegistry();
    registry.bootstrap([makeManifest()]);
    const dispatcher = new ExecutionDispatcher(registry, new ConnectorFactory(registry));
    const result = await dispatcher.dispatch(
      ctx(),
      "fail_once",
      { id: "x" },
      { retry: { ...DEFAULT_RETRY_POLICY, backoffMs: () => 1 } },
    );
    assert.equal(result.success, true);
    assert.equal(timeoutCallCount, 2);
  });
});

describe("HealthEngine", () => {
  test("check() returns healthy status and caches it", async () => {
    const registry = new IntegrationRegistry();
    registry.bootstrap([makeManifest()]);
    const engine = new HealthEngine(registry, new ConnectorFactory(registry));
    const result = await engine.check(ctx());
    assert.equal(result.status, "healthy");
    assert.equal(engine.getCached(1, "demo")?.status, "healthy");
  });
});

describe("ContractTestHarness", () => {
  test("a well-formed connector passes all contract cases", async () => {
    const manifest = makeManifest();
    const harness = new ContractTestHarness(manifest, () => makeModule(), ctx());
    const report = await harness.run();
    assert.equal(report.failed, 0, JSON.stringify(report.results.filter((r) => !r.ok)));
  });

  test("a connector missing executeAction fails the contract", async () => {
    const manifest = makeManifest();
    const brokenModule = {
      validate: makeModule().validate,
      healthCheck: makeModule().healthCheck,
    } as unknown as ConnectorModule;
    const harness = new ContractTestHarness(manifest, () => brokenModule, ctx());
    const report = await harness.run();
    assert.ok(report.failed > 0);
  });
});
