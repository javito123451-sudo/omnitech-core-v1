import type { ActionResult, ConnectorContext } from "../types.js";
import type { ConnectorFactory } from "../factory/connectorFactory.js";
import type { IntegrationRegistry } from "../registry/integrationRegistry.js";
import { ConnectorRuntime } from "../runtime/connectorRuntime.js";
import { ExecutionEngine } from "./executionEngine.js";
import { Metrics } from "../observability/metrics.js";
import { InternalConnectorEventBus, makeConnectorEvent, type IConnectorEventBus } from "../observability/events.js";
import { ActionNotFoundError } from "../types.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
  /** Only retry when this returns true. Defaults to retrying non-idempotent-safe transient errors. */
  shouldRetry: (result: ActionResult) => boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 8000),
  shouldRetry: (result) => !result.success && result.errorCode === "TIMEOUT",
};

export const NO_RETRY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: () => 0,
  shouldRetry: () => false,
};

export interface DispatchOptions {
  retry?: RetryPolicy;
}

/**
 * ExecutionDispatcher — the single public entry point the app layer calls to
 * run a connector action. Wraps ExecutionEngine with: connector instantiation
 * via ConnectorFactory, retry policy, metrics, and runtime events. Nothing
 * outside this class should call ConnectorRuntime.execute() directly.
 */
export class ExecutionDispatcher {
  private readonly engine: ExecutionEngine;
  private readonly metrics: Metrics;
  private readonly eventBus: IConnectorEventBus;

  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly factory: ConnectorFactory,
    options: { engine?: ExecutionEngine; metrics?: Metrics; eventBus?: IConnectorEventBus } = {},
  ) {
    this.engine = options.engine ?? new ExecutionEngine();
    this.metrics = options.metrics ?? new Metrics();
    this.eventBus = options.eventBus ?? new InternalConnectorEventBus();
  }

  async dispatch(
    context: ConnectorContext,
    actionSlug: string,
    input: Record<string, unknown>,
    options: DispatchOptions = {},
  ): Promise<ActionResult> {
    const manifest = this.registry.get(context.connectorSlug);
    if (!manifest.actions.some((a) => a.slug === actionSlug)) {
      throw new ActionNotFoundError(manifest.slug, actionSlug);
    }

    const retry = options.retry ?? (manifest.actions.find((a) => a.slug === actionSlug)?.idempotent
      ? DEFAULT_RETRY_POLICY
      : NO_RETRY);

    const module = await this.factory.create(context.connectorSlug);
    const runtime = new ConnectorRuntime(manifest, module, context);

    this.eventBus.publish(
      makeConnectorEvent("connector.action.started", context.orgId, context.connectorSlug, { actionSlug }),
    );

    let lastResult: ActionResult | null = null;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      lastResult = await this.engine.run(runtime, actionSlug, input);
      this.metrics.connectorActionExecuted(
        context.connectorSlug,
        actionSlug,
        lastResult.success,
        lastResult.durationMs ?? 0,
      );

      if (lastResult.success || !retry.shouldRetry(lastResult) || attempt === retry.maxAttempts) {
        break;
      }
      await sleep(retry.backoffMs(attempt));
    }

    const finalResult = lastResult as ActionResult;
    this.eventBus.publish(
      makeConnectorEvent(
        finalResult.success ? "connector.action.completed" : "connector.action.failed",
        context.orgId,
        context.connectorSlug,
        { actionSlug, error: finalResult.error },
      ),
    );

    return finalResult;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
