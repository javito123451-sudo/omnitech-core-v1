/**
 * OmniSeller Fase 3 — Contact Finder — superficie pública.
 *
 * Mismo patrón que hub/index.ts: re-exporta el contrato, el registry y el
 * servicio; los adaptadores REALES se auto-registrarían aquí mismo, vía
 * imports de efecto secundario, cuando exista al menos uno (hoy no hay
 * ninguno — Fase 3 no elige proveedor comercial, ver informe). El adaptador
 * mock vive aparte (adapters/mockAdapter.ts) y a propósito NO se importa
 * aquí: solo los tests lo cargan explícitamente.
 */
export * from "./types";
export { ProspectingProviderRegistry } from "./providerRegistry";
export { findContactsForLead } from "./contactFinderService";
export type { ContactFinderResult, ContactFinderStatus, LeadResultForContactFinder } from "./contactFinderService";

// ── Auto-registro de adaptadores reales ───────────────────────────────────────
// (ninguno todavía — ver "### PROVIDER DECISION" en el informe de Fase 3)
