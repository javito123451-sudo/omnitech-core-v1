/**
 * Omni Fleet — Delivery Status Provider Registry.
 * Providers register themselves at import time (see hub/index.ts).
 * Same pattern as IntegrationRegistry, kept separate because the contract
 * (DeliveryStatusProvider) is different — see deliveryStatusTypes.ts.
 */
import type { DeliveryStatusProvider } from "./deliveryStatusTypes";

const registry = new Map<string, DeliveryStatusProvider>();

export const DeliveryProviderRegistry = {
  register(provider: DeliveryStatusProvider): void {
    if (registry.has(provider.slug)) {
      console.warn(`[FleetHub] Delivery provider "${provider.slug}" already registered, overwriting`);
    }
    registry.set(provider.slug, provider);
    console.log(`[FleetHub] Delivery provider registered: ${provider.slug}`);
  },

  get(slug: string): DeliveryStatusProvider | undefined {
    return registry.get(slug);
  },

  list(): Array<{ slug: string; displayName: string }> {
    return Array.from(registry.values()).map((p) => ({ slug: p.slug, displayName: p.displayName }));
  },
};
