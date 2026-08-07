import type {
  ConnectorContext,
  ConnectorManifest,
  ConnectorModule,
  HealthCheckResult,
  ParsedEvent,
  ValidationResult,
} from "../types.js";
import { ActionNotFoundError } from "../types.js";

/**
 * ConnectorRuntime — binds one (manifest, live module) pair for one org.
 * This is the object callers actually interact with; it never leaks the
 * raw ConnectorModule so the Core can enforce the manifest's declared
 * action list (a module could technically define more, but only declared
 * actions are reachable through the runtime).
 */
export class ConnectorRuntime {
  constructor(
    private readonly manifest: ConnectorManifest,
    private readonly module: ConnectorModule,
    private readonly context: ConnectorContext,
  ) {}

  get slug(): string {
    return this.manifest.slug;
  }

  validate(): Promise<ValidationResult> {
    return this.module.validate(this.context);
  }

  healthCheck(): Promise<HealthCheckResult> {
    return this.module.healthCheck(this.context);
  }

  async execute(actionSlug: string, input: Record<string, unknown>) {
    const declared = this.manifest.actions.find((a) => a.slug === actionSlug);
    if (!declared) throw new ActionNotFoundError(this.manifest.slug, actionSlug);
    return this.module.executeAction(this.context, actionSlug, input);
  }

  parseEvent(rawPayload: unknown): Promise<ParsedEvent | null> {
    if (!this.module.parseEvent) return Promise.resolve(null);
    return this.module.parseEvent(rawPayload);
  }

  onInstall(): Promise<void> {
    return this.module.onInstall?.(this.context) ?? Promise.resolve();
  }

  onUninstall(): Promise<void> {
    return this.module.onUninstall?.(this.context) ?? Promise.resolve();
  }
}
