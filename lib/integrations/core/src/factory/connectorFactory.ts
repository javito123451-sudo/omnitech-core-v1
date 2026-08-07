import type { ConnectorModule } from "../types.js";
import { ConnectorNotFoundError } from "../types.js";
import type { IntegrationRegistry } from "../registry/integrationRegistry.js";
import { validateConnectorModule } from "./connectorValidation.js";

/**
 * ConnectorFactory — resolves a manifest's `load()` into a live ConnectorModule.
 * Provider SDKs are required lazily inside each connector package's `load()`,
 * so the Core's module graph never imports a third-party SDK directly.
 *
 * Instances are cached per slug for the lifetime of the process (connectors
 * are stateless w.r.t. org — org-specific data always travels via ConnectorContext).
 */
export class ConnectorFactory {
  private cache = new Map<string, Promise<ConnectorModule>>();

  constructor(private readonly registry: IntegrationRegistry) {}

  async create(slug: string): Promise<ConnectorModule> {
    const cached = this.cache.get(slug);
    if (cached) return cached;

    const manifest = this.registry.tryGet(slug);
    if (!manifest) throw new ConnectorNotFoundError(slug);

    const promise = Promise.resolve(manifest.load()).then((mod) => {
      validateConnectorModule(mod, slug);
      return mod;
    });

    this.cache.set(slug, promise);
    try {
      return await promise;
    } catch (err) {
      // Don't poison the cache with a failed load — allow retry on next call.
      this.cache.delete(slug);
      throw err;
    }
  }

  /** Drops a cached instance, forcing the next create() to re-run load(). Used by LifecycleManager on reconnect/reconfigure. */
  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  clear(): void {
    this.cache.clear();
  }
}
