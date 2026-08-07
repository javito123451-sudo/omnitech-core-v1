import type { ActionResult } from "../types.js";
import { ConnectorRuntime } from "../runtime/connectorRuntime.js";

export interface ExecutionEngineOptions {
  /** Hard timeout per action execution. A connector that hangs must never hang the caller. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * ExecutionEngine — runs exactly ONE attempt of one action against a
 * ConnectorRuntime, enforcing a hard timeout. Retry policy, metrics, and
 * events live one layer up in ExecutionDispatcher; this engine stays dumb
 * and single-purpose on purpose (easy to contract-test in isolation).
 */
export class ExecutionEngine {
  private readonly timeoutMs: number;

  constructor(options: ExecutionEngineOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run(
    runtime: ConnectorRuntime,
    actionSlug: string,
    input: Record<string, unknown>,
  ): Promise<ActionResult> {
    const start = Date.now();
    try {
      const result = await withTimeout(
        runtime.execute(actionSlug, input),
        this.timeoutMs,
        `Action "${actionSlug}" on connector "${runtime.slug}" timed out after ${this.timeoutMs}ms`,
      );
      return { ...result, durationMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: err instanceof TimeoutError ? "TIMEOUT" : "EXECUTION_ERROR",
        durationMs: Date.now() - start,
      };
    }
  }
}

export class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
