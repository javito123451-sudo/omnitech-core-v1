import type { ConnectorManifest } from "../types.js";
import { validateManifest } from "./manifestValidation.js";

/**
 * ManifestLoader — the ONLY sanctioned entry point for connector discovery.
 *
 * Per CONNECTOR_ARCHITECTURE.md v1.2: discovery via filesystem scanning is
 * prohibited. The Core receives an explicit, statically-imported array of
 * ConnectorManifest objects (conventionally defined in connectors/manifest.ts
 * at the application layer) and validates each one before it is usable.
 */
export class ManifestLoader {
  private manifests = new Map<string, ConnectorManifest>();
  private loaded = false;

  /**
   * Loads and validates an explicit list of manifests. Not idempotent by
   * accident: calling load() twice replaces the previous set, which is useful
   * for tests but should only happen once at process startup in production.
   */
  load(manifests: readonly ConnectorManifest[]): void {
    const next = new Map<string, ConnectorManifest>();
    for (const manifest of manifests) {
      validateManifest(manifest);
      if (next.has(manifest.slug)) {
        throw new Error(`Duplicate connector slug in manifest list: "${manifest.slug}"`);
      }
      next.set(manifest.slug, manifest);
    }
    this.manifests = next;
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  get(slug: string): ConnectorManifest | undefined {
    return this.manifests.get(slug);
  }

  has(slug: string): boolean {
    return this.manifests.has(slug);
  }

  all(): ConnectorManifest[] {
    return Array.from(this.manifests.values());
  }

  slugs(): string[] {
    return Array.from(this.manifests.keys());
  }
}
