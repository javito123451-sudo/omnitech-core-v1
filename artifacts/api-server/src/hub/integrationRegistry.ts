/**
 * Omni Integration Hub — Adapter Registry
 * Adapters register themselves at import time.
 */
import type { IntegrationAdapter } from "./types";

const registry = new Map<string, IntegrationAdapter>();

export const IntegrationRegistry = {
  register(slug: string, adapter: IntegrationAdapter): void {
    if (registry.has(slug)) {
      console.warn(`[IntegrationHub] Adapter "${slug}" already registered, overwriting`);
    }
    registry.set(slug, adapter);
    console.log(`[IntegrationHub] Adapter registered: ${slug}`);
  },

  get(slug: string): IntegrationAdapter | undefined {
    return registry.get(slug);
  },

  has(slug: string): boolean {
    return registry.has(slug);
  },

  list(): string[] {
    return Array.from(registry.keys());
  },
};
