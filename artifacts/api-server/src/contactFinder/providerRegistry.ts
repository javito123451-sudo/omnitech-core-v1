/**
 * OmniSeller Fase 3 — Contact Finder Provider Registry.
 * Mismo patrón que hub/deliveryProviderRegistry.ts: un Map por slug, los
 * adaptadores se registran a sí mismos al importarse. Registro separado del
 * IntegrationRegistry del Hub porque el contrato (ProspectingProvider) es
 * distinto — ver types.ts.
 */
import type { ProspectingProvider } from "./types";

const registry = new Map<string, ProspectingProvider>();

export const ProspectingProviderRegistry = {
  register(provider: ProspectingProvider): void {
    if (registry.has(provider.slug)) {
      console.warn(`[OmniSeller/ContactFinder] Provider "${provider.slug}" ya registrado, se sobrescribe`);
    }
    registry.set(provider.slug, provider);
    console.log(`[OmniSeller/ContactFinder] Provider registrado: ${provider.slug}`);
  },

  get(slug: string): ProspectingProvider | undefined {
    return registry.get(slug);
  },

  list(): Array<{ slug: string; displayName: string }> {
    return Array.from(registry.values()).map((p) => ({ slug: p.slug, displayName: p.displayName }));
  },

  /** Solo para tests: vaciar el registro entre archivos de test. */
  _clearForTests(): void {
    registry.clear();
  },
};
