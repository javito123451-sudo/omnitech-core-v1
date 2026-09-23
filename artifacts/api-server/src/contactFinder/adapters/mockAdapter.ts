/**
 * OmniSeller Fase 3 — Adaptador MOCK de Contact Finder.
 *
 * SOLO PARA TESTS. No es una integración real: no llama a ningún proveedor
 * externo, no usa credenciales reales y NUNCA debe presentarse como Apollo,
 * Cognism, Kaspr, eInforma ni ningún otro proveedor comercial (esa decisión
 * sigue pendiente — ver "### PROVIDER DECISION" en el informe de Fase 3).
 *
 * A propósito, este archivo NO se importa desde contactFinder/index.ts (el
 * punto de entrada que cargaría el servidor en producción) — solo los tests
 * lo importan explícitamente. Ninguna organización real tiene una fila en
 * org_integrations con integration_slug="contact_finder_mock", así que
 * aunque este módulo se cargase por accidente, resolveProvider() nunca lo
 * elegiría para un tenant real (no hay fila que lo active).
 */
import { ProspectingProviderRegistry } from "../providerRegistry";
import type {
  AdapterContext,
  ProspectingContactQuery,
  ProspectingCostEstimate,
  ProspectingFindContactsResult,
  ProspectingHealth,
  ProspectingProvider,
} from "../types";

export const CONTACT_FINDER_MOCK_SLUG = "contact_finder_mock";

/** ctx.config puede llevar `{ behavior: "ok" | "empty" | "error", contacts?: [...], credits?: number }` para que cada test controle el resultado sin red real. */
export const ContactFinderMockAdapter: ProspectingProvider = {
  slug: CONTACT_FINDER_MOCK_SLUG,
  displayName: "Mock Contact Finder (solo tests)",

  async estimateCost(_query: ProspectingContactQuery): Promise<ProspectingCostEstimate> {
    return { credits: 1, notes: "Coste provisional fijo del adaptador mock — no es una tarifa comercial." };
  },

  async healthCheck(_ctx: AdapterContext): Promise<ProspectingHealth> {
    return { healthy: true, checkedAt: new Date().toISOString(), message: "mock siempre saludable" };
  },

  async findContacts(ctx: AdapterContext, query: ProspectingContactQuery): Promise<ProspectingFindContactsResult> {
    const behavior = (ctx.config?.behavior as string | undefined) ?? "ok";
    if (behavior === "error") throw new Error("mock: fallo simulado del proveedor");
    if (behavior === "empty") return { contacts: [] };

    const configured = ctx.config?.contacts as ProspectingFindContactsResult["contacts"] | undefined;
    const contacts = configured ?? [{
      externalId: `mock-${query.companyName}`,
      name: "Contacto de Prueba",
      role: "Gerente",
      email: "contacto@example-test.invalid",
      quality: "no_verificado" as const,
    }];
    return { contacts };
  },
};

ProspectingProviderRegistry.register(ContactFinderMockAdapter);
