import type { ConnectorManifest } from "../types.js";
import { ConnectorNotFoundError } from "../types.js";
import { ManifestLoader } from "../manifest/manifestLoader.js";
import { ActionsRegistry } from "./actionsRegistry.js";
import { EventsRegistry } from "./eventsRegistry.js";
import { ResourceRegistry } from "./resourceRegistry.js";

/**
 * IntegrationRegistry — single source of truth for "which connectors exist".
 * Composes the ManifestLoader with the three capability sub-registries so
 * callers have one object to depend on.
 *
 * Strangler Fig note: this supersedes artifacts/api-server/src/hub/integrationRegistry.ts.
 * The old hub registry keeps running unmodified until Fase 2 swaps callers over.
 */
export class IntegrationRegistry {
  readonly actions: ActionsRegistry;
  readonly events: EventsRegistry;
  readonly resources: ResourceRegistry;

  constructor(private readonly loader: ManifestLoader = new ManifestLoader()) {
    this.actions = new ActionsRegistry([]);
    this.events = new EventsRegistry([]);
    this.resources = new ResourceRegistry([]);
  }

  /** Loads (and validates) the definitive connector manifest list for this process. */
  bootstrap(manifests: readonly ConnectorManifest[]): void {
    this.loader.load(manifests);
    const all = this.loader.all();
    this.actions.rebuild(all);
    this.events.rebuild(all);
    this.resources.rebuild(all);
  }

  isBootstrapped(): boolean {
    return this.loader.isLoaded();
  }

  get(slug: string): ConnectorManifest {
    const manifest = this.loader.get(slug);
    if (!manifest) throw new ConnectorNotFoundError(slug);
    return manifest;
  }

  tryGet(slug: string): ConnectorManifest | undefined {
    return this.loader.get(slug);
  }

  has(slug: string): boolean {
    return this.loader.has(slug);
  }

  list(): ConnectorManifest[] {
    return this.loader.all();
  }

  listByCategory(category: ConnectorManifest["category"]): ConnectorManifest[] {
    return this.loader.all().filter((m) => m.category === category);
  }
}

/** Process-wide singleton — mirrors the pattern used by eventBus in src/events/index.ts. */
export const integrationRegistry = new IntegrationRegistry();
