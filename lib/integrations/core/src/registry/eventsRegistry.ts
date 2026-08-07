import type { ConnectorManifest, EventDefinition } from "../types.js";

export interface ResolvedEvent {
  connectorSlug: string;
  event: EventDefinition;
}

/** Read-through index of every event declared across all loaded manifests. */
export class EventsRegistry {
  private index = new Map<string, ResolvedEvent>();

  constructor(manifests: readonly ConnectorManifest[]) {
    this.rebuild(manifests);
  }

  rebuild(manifests: readonly ConnectorManifest[]): void {
    const next = new Map<string, ResolvedEvent>();
    for (const manifest of manifests) {
      for (const event of manifest.events) {
        next.set(key(manifest.slug, event.slug), { connectorSlug: manifest.slug, event });
      }
    }
    this.index = next;
  }

  get(connectorSlug: string, eventSlug: string): ResolvedEvent | undefined {
    return this.index.get(key(connectorSlug, eventSlug));
  }

  listForConnector(connectorSlug: string): EventDefinition[] {
    return Array.from(this.index.values())
      .filter((r) => r.connectorSlug === connectorSlug)
      .map((r) => r.event);
  }

  all(): ResolvedEvent[] {
    return Array.from(this.index.values());
  }
}

function key(connectorSlug: string, eventSlug: string): string {
  return `${connectorSlug}::${eventSlug}`;
}
