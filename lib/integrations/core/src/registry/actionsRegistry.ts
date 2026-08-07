import type { ActionDefinition, ConnectorManifest } from "../types.js";

export interface ResolvedAction {
  connectorSlug: string;
  action: ActionDefinition;
}

/** Read-through index of every action declared across all loaded manifests. */
export class ActionsRegistry {
  private index = new Map<string, ResolvedAction>();

  constructor(manifests: readonly ConnectorManifest[]) {
    this.rebuild(manifests);
  }

  rebuild(manifests: readonly ConnectorManifest[]): void {
    const next = new Map<string, ResolvedAction>();
    for (const manifest of manifests) {
      for (const action of manifest.actions) {
        next.set(key(manifest.slug, action.slug), { connectorSlug: manifest.slug, action });
      }
    }
    this.index = next;
  }

  get(connectorSlug: string, actionSlug: string): ResolvedAction | undefined {
    return this.index.get(key(connectorSlug, actionSlug));
  }

  listForConnector(connectorSlug: string): ActionDefinition[] {
    return Array.from(this.index.values())
      .filter((r) => r.connectorSlug === connectorSlug)
      .map((r) => r.action);
  }

  all(): ResolvedAction[] {
    return Array.from(this.index.values());
  }
}

function key(connectorSlug: string, actionSlug: string): string {
  return `${connectorSlug}::${actionSlug}`;
}
