import type { ConnectorManifest, ResourceDefinition } from "../types.js";

export interface ResolvedResource {
  connectorSlug: string;
  resource: ResourceDefinition;
}

/** Read-through index of every resource declared across all loaded manifests. */
export class ResourceRegistry {
  private index = new Map<string, ResolvedResource>();

  constructor(manifests: readonly ConnectorManifest[]) {
    this.rebuild(manifests);
  }

  rebuild(manifests: readonly ConnectorManifest[]): void {
    const next = new Map<string, ResolvedResource>();
    for (const manifest of manifests) {
      for (const resource of manifest.resources) {
        next.set(key(manifest.slug, resource.slug), { connectorSlug: manifest.slug, resource });
      }
    }
    this.index = next;
  }

  get(connectorSlug: string, resourceSlug: string): ResolvedResource | undefined {
    return this.index.get(key(connectorSlug, resourceSlug));
  }

  listForConnector(connectorSlug: string): ResourceDefinition[] {
    return Array.from(this.index.values())
      .filter((r) => r.connectorSlug === connectorSlug)
      .map((r) => r.resource);
  }

  all(): ResolvedResource[] {
    return Array.from(this.index.values());
  }
}

function key(connectorSlug: string, resourceSlug: string): string {
  return `${connectorSlug}::${resourceSlug}`;
}
