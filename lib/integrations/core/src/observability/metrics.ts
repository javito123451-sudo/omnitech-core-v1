/**
 * Metrics — lightweight counters/timers for connector execution.
 * No provider (Prometheus/Datadog/etc.) is imported here; a `MetricsSink` can
 * be plugged in later without touching call sites, same seam pattern as IEventBus.
 */

export interface MetricsSink {
  incrementCounter(name: string, tags: Record<string, string>, value?: number): void;
  recordDuration(name: string, tags: Record<string, string>, durationMs: number): void;
}

/** Default in-memory sink. Good enough for tests and for local dev dashboards. */
export class InMemoryMetricsSink implements MetricsSink {
  private counters = new Map<string, number>();
  private durations = new Map<string, number[]>();

  incrementCounter(name: string, tags: Record<string, string>, value = 1): void {
    const k = this.key(name, tags);
    this.counters.set(k, (this.counters.get(k) ?? 0) + value);
  }

  recordDuration(name: string, tags: Record<string, string>, durationMs: number): void {
    const k = this.key(name, tags);
    const arr = this.durations.get(k) ?? [];
    arr.push(durationMs);
    this.durations.set(k, arr);
  }

  getCounter(name: string, tags: Record<string, string> = {}): number {
    return this.counters.get(this.key(name, tags)) ?? 0;
  }

  getDurations(name: string, tags: Record<string, string> = {}): number[] {
    return this.durations.get(this.key(name, tags)) ?? [];
  }

  reset(): void {
    this.counters.clear();
    this.durations.clear();
  }

  private key(name: string, tags: Record<string, string>): string {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return tagStr ? `${name}{${tagStr}}` : name;
  }
}

export class Metrics {
  constructor(private readonly sink: MetricsSink = new InMemoryMetricsSink()) {}

  connectorActionExecuted(connectorSlug: string, actionSlug: string, success: boolean, durationMs: number): void {
    const tags = { connector: connectorSlug, action: actionSlug, success: String(success) };
    this.sink.incrementCounter("connector.action.executed", tags);
    this.sink.recordDuration("connector.action.duration_ms", tags, durationMs);
  }

  connectorHealthChecked(connectorSlug: string, status: string): void {
    this.sink.incrementCounter("connector.health.checked", { connector: connectorSlug, status });
  }

  connectorLoadFailed(connectorSlug: string): void {
    this.sink.incrementCounter("connector.load.failed", { connector: connectorSlug });
  }
}
