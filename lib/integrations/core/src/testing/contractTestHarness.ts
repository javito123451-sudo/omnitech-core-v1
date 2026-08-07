import assert from "node:assert/strict";
import type { ConnectorContext, ConnectorManifest, ConnectorModule } from "../types.js";
import { validateManifest } from "../manifest/manifestValidation.js";
import { validateConnectorModule } from "../factory/connectorValidation.js";

export interface ContractTestCase {
  name: string;
  run: () => Promise<void>;
}

export interface ContractTestReport {
  connectorSlug: string;
  passed: number;
  failed: number;
  results: { name: string; ok: boolean; error?: string }[];
}

/**
 * ContractTestHarness — the mandatory conformance suite for every connector.
 * A connector is not "official" until this passes. Runs against a sandbox
 * context supplied by the caller (contract tests must never hit real
 * provider credentials/production traffic).
 */
export class ContractTestHarness {
  constructor(
    private readonly manifest: ConnectorManifest,
    private readonly moduleFactory: () => Promise<ConnectorModule> | ConnectorModule,
    private readonly sandboxContext: ConnectorContext,
  ) {}

  private cases(): ContractTestCase[] {
    return [
      {
        name: "manifest: passes static validation",
        run: async () => validateManifest(this.manifest),
      },
      {
        name: "module: implements required contract methods",
        run: async () => {
          const mod = await this.moduleFactory();
          validateConnectorModule(mod, this.manifest.slug);
        },
      },
      {
        name: "validate(): returns a well-formed ValidationResult",
        run: async () => {
          const mod = await this.moduleFactory();
          const result = await mod.validate(this.sandboxContext);
          assert.equal(typeof result.valid, "boolean");
          assert.ok(Array.isArray(result.missing));
        },
      },
      {
        name: "healthCheck(): returns a well-formed HealthCheckResult",
        run: async () => {
          const mod = await this.moduleFactory();
          const result = await mod.healthCheck(this.sandboxContext);
          assert.ok(["healthy", "degraded", "unhealthy", "unknown"].includes(result.status));
          assert.equal(typeof result.checkedAt, "string");
        },
      },
      {
        name: "executeAction(): rejects an undeclared action instead of throwing an unrelated error",
        run: async () => {
          const mod = await this.moduleFactory();
          const result = await mod.executeAction(this.sandboxContext, "__nonexistent_action__", {});
          assert.equal(result.success, false);
        },
      },
      {
        name: "actions: every declared action is executable without throwing on missing optional input",
        run: async () => {
          const mod = await this.moduleFactory();
          for (const action of this.manifest.actions) {
            const minimalInput = buildMinimalInput(action.input);
            // Contract requirement: must resolve to an ActionResult, never throw.
            const result = await mod.executeAction(this.sandboxContext, action.slug, minimalInput);
            assert.equal(typeof result.success, "boolean", `action "${action.slug}" must return {success:boolean}`);
          }
        },
      },
      {
        name: "events: parseEvent (if implemented) returns null for unrecognized payloads",
        run: async () => {
          const mod = await this.moduleFactory();
          if (!mod.parseEvent) return;
          const result = await mod.parseEvent({ __not_a_real_payload__: true });
          assert.equal(result, null);
        },
      },
    ];
  }

  async run(): Promise<ContractTestReport> {
    const results: ContractTestReport["results"] = [];
    for (const testCase of this.cases()) {
      try {
        await testCase.run();
        results.push({ name: testCase.name, ok: true });
      } catch (err) {
        results.push({ name: testCase.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return {
      connectorSlug: this.manifest.slug,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}

function buildMinimalInput(fields: { key: string; required?: boolean; type: string; default?: unknown }[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.required) continue;
    if (field.default !== undefined) {
      input[field.key] = field.default;
      continue;
    }
    switch (field.type) {
      case "string":
      case "secret":
        input[field.key] = "contract-test-value";
        break;
      case "number":
        input[field.key] = 1;
        break;
      case "boolean":
        input[field.key] = true;
        break;
      case "date":
        input[field.key] = new Date().toISOString();
        break;
      case "json":
        input[field.key] = {};
        break;
      case "select":
        input[field.key] = "contract-test-value";
        break;
    }
  }
  return input;
}
