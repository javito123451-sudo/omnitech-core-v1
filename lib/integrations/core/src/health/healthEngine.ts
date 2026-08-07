import type { HealthCheckResult, HealthStatus } from "../types.js";
import type { ConnectorFactory } from "../factory/connectorFactory.js";
import type { IntegrationRegistry } from "../registry/integrationRegistry.js";
import { ConnectorRuntime } from "../runtime/connectorRuntime.js";
import { Metrics } from "../observability/metrics.js";
import { InternalConnectorEventBus, makeConnectorEvent, type IConnectorEventBus } from "../observability/events.js";
import type { ConnectorContext } from "../types.js";

interface CachedHealth {
  result: HealthCheckResult;
  status: HealthStatus;
}

/**
 * HealthEngine — runs a connector's healthCheck(), caches the last known
 * status per (orgId, connectorSlug), and emits a "connector.health.changed"
 * event only on transitions (never spams the bus on every check).
 */
export class HealthEngine {
  private readonly metrics: Metrics;
  private readonly eventBus: IConnectorEventBus;
  private cache = new Map<string, CachedHealth>();

  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly factory: ConnectorFactory,
    options: { metrics?: Metrics; eventBus?: IConnectorEventBus } = {},
  ) {
    this.metrics = options.metrics ?? new Metrics();
    this.eventBus = options.eventBus ?? new InternalConnectorEventBus();
  }

  async check(context: ConnectorContext): Promise<HealthCheckResult> {
    const manifest = this.registry.get(context.connectorSlug);
    const module = await this.factory.create(context.connectorSlug);
    const runtime = new ConnectorRuntime(manifest, module, context);

    const start = Date.now();
    let result: HealthCheckResult;
    try {
      result = await runtime.healthCheck();
    } catch (err) {
      result = {
        status: "unhealthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    this.metrics.connectorHealthChecked(context.connectorSlug, result.status);

    const cacheKey = `${context.orgId}::${context.connectorSlug}`;
    const previous = this.cache.get(cacheKey);
    if (!previous || previous.status !== result.status) {
      this.eventBus.publish(
        makeConnectorEvent("connector.health.changed", context.orgId, context.connectorSlug, {
          from: previous?.status ?? "unknown",
          to: result.status,
        }),
      );
    }
    this.cache.set(cacheKey, { result, status: result.status });

    return result;
  }

  /** Last cached result without triggering a new provider call. */
  getCached(orgId: number, connectorSlug: string): HealthCheckResult | undefined {
    return this.cache.get(`${orgId}::${connectorSlug}`)?.result;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
