import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestLoader } from "../src/manifest/manifestLoader.js";
import { validateManifest } from "../src/manifest/manifestValidation.js";
import { ManifestValidationError, type ConnectorManifest } from "../src/types.js";

function baseManifest(overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    slug: "demo-connector",
    name: "Demo Connector",
    version: "1.0.0",
    category: "custom",
    configSchema: [],
    actions: [],
    events: [],
    resources: [],
    load: async () => ({
      validate: async () => ({ valid: true, missing: [] }),
      healthCheck: async () => ({ status: "healthy", checkedAt: new Date().toISOString() }),
      executeAction: async () => ({ success: true }),
    }),
    ...overrides,
  };
}

describe("manifestValidation", () => {
  test("accepts a well-formed manifest", () => {
    assert.doesNotThrow(() => validateManifest(baseManifest()));
  });

  test("rejects an invalid slug", () => {
    assert.throws(() => validateManifest(baseManifest({ slug: "Not Valid Slug" })), ManifestValidationError);
  });

  test("rejects a non-semver version", () => {
    assert.throws(() => validateManifest(baseManifest({ version: "v1" })), ManifestValidationError);
  });

  test("accepts camelCase field keys (they become JS object properties)", () => {
    const manifest = baseManifest({
      configSchema: [{ key: "aeatEndpoint", label: "Endpoint", type: "string" }],
      actions: [
        {
          slug: "send",
          label: "Send",
          input: [{ key: "invoiceNumber", label: "Invoice Number", type: "string", required: true }],
          output: [],
        },
      ],
    });
    assert.doesNotThrow(() => validateManifest(manifest));
  });

  test("rejects duplicate action slugs", () => {
    const manifest = baseManifest({
      actions: [
        { slug: "send", label: "Send", input: [], output: [] },
        { slug: "send", label: "Send Again", input: [], output: [] },
      ],
    });
    assert.throws(() => validateManifest(manifest), /Duplicate action slug/);
  });
});

describe("ManifestLoader", () => {
  test("loads and indexes manifests by slug", () => {
    const loader = new ManifestLoader();
    loader.load([baseManifest()]);
    assert.equal(loader.isLoaded(), true);
    assert.equal(loader.has("demo-connector"), true);
    assert.equal(loader.slugs().length, 1);
  });

  test("throws on duplicate slugs within the same load() call", () => {
    const loader = new ManifestLoader();
    assert.throws(() => loader.load([baseManifest(), baseManifest()]), /Duplicate connector slug/);
  });

  test("second load() call fully replaces the previous set", () => {
    const loader = new ManifestLoader();
    loader.load([baseManifest({ slug: "a" })]);
    loader.load([baseManifest({ slug: "b" })]);
    assert.equal(loader.has("a"), false);
    assert.equal(loader.has("b"), true);
  });
});
