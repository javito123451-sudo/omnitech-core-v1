/**
 * OmniSeller Fase 3 — Contact Finder — contrato de proveedor.
 *
 * Deliberadamente NO reutiliza IntegrationAdapter (hub/types.ts): ese
 * contrato está pensado para mensajería conversacional (send/receive un
 * mensaje a una persona). Contact Finder busca y estructura DATOS de
 * contacto (nombre, cargo, email, teléfono) de personas dentro de una
 * empresa — forzarlo dentro de SendMessagePayload/ReceiveMessagePayload
 * significaría meter JSON dentro de un campo "message: string".
 *
 * Es un contrato hermano, más estrecho y adicional, siguiendo exactamente
 * el mismo espíritu que hub/deliveryStatusTypes.ts (DeliveryStatusProvider):
 * los adaptadores se auto-registran por slug (ver providerRegistry.ts), y
 * la configuración/credenciales por organización reutiliza el mismo
 * almacenamiento que el Hub (org_integrations, integration_events — ver
 * hub/integrationManager.ts) a través del mismo AdapterContext
 * ({orgId, credentials, config, displayName}, definido en hub/types.ts y
 * reutilizado aquí tal cual, sin duplicarlo).
 *
 * El núcleo de OmniSeller (contactFinderService.ts, routes/missions.ts)
 * SOLO conoce esta interfaz — nunca el nombre de un proveedor concreto
 * (Apollo/Cognism/Kaspr/eInforma/otro). Añadir o quitar un proveedor real
 * es escribir un adaptador nuevo y registrarlo; el núcleo no cambia.
 */
import type { AdapterContext } from "../hub/types";

export type { AdapterContext };

// ── searchCompanies / verifyCompany ──────────────────────────────────────────
// Declaradas en la interfaz porque el enunciado de Fase 3 pide las 5
// capacidades del contrato conceptual (searchCompanies, verifyCompany,
// findContacts, estimateCost, healthCheck) para que el núcleo pueda, en el
// futuro, delegar también la fase de Hunter a un proveedor sin tocar esta
// interfaz. Hoy (Fase 3) ningún código del núcleo las llama todavía — el
// Hunter sigue siendo Google Places (routes/leads.ts, sin cambios) — así que
// son OPCIONALES: un adaptador real puede no implementarlas sin romper nada.

export interface ProspectingCompanyQuery {
  name?:     string;
  website?:  string;
  sector?:   string;
  location?: string;
}

export interface ProspectingCompanyMatch {
  externalId: string;
  name:       string;
  domain?:    string;
  confidence?: number;
}

// ── findContacts — la única capacidad que Fase 3 ejercita de verdad ─────────

export interface ProspectingContactQuery {
  companyName:      string;
  companyWebsite?:  string | null;
  companyDomain?:   string | null;
  sector?:          string | null;
  location?:        string | null;
  /** Límite de contactos a devolver; el adaptador decide su propio máximo si se omite. */
  maxContacts?:     number;
}

/**
 * Un contacto tal como lo devuelve el proveedor, ANTES de persistir.
 *
 * `quality` es una autodeclaración del proveedor, nunca un valor inventado
 * por el core: si el proveedor no distingue verificado/no verificado, debe
 * omitirse (undefined) — el core nunca asume "verificado" por defecto (ver
 * contactFinderService.ts, mapeo a lead_contacts.status).
 */
export interface ProspectingContact {
  /** Identificador del proveedor para esta persona — clave de deduplicación primaria (ver dedupe en contactFinderService.ts). */
  externalId?: string;
  name?:       string;
  role?:       string;
  email?:      string;
  phone?:      string;
  linkedinUrl?: string;
  /** 0..1 — confianza que el proveedor asigna al dato. Nunca inventada por el core. */
  confidence?: number;
  quality?:    "verificado" | "no_verificado";
}

export interface ProspectingFindContactsResult {
  contacts: ProspectingContact[];
  /** Opcional, solo para trazabilidad en integration_events — nunca se persiste en lead_contacts tal cual. */
  raw?: unknown;
}

// ── estimateCost — OmniCredits, coste PROVISIONAL, nunca tarifa comercial ───

export interface ProspectingCostEstimate {
  /** Créditos OmniCredits a reservar para ESTA búsqueda concreta. Puede ser 0. */
  credits: number;
  notes?:  string;
}

// ── healthCheck ───────────────────────────────────────────────────────────────

export interface ProspectingHealth {
  healthy:    boolean;
  message?:   string;
  checkedAt:  string;
}

/**
 * Contrato que implementa cada adaptador de proveedor de Contact Finder.
 * Los adaptadores se auto-registran en ProspectingProviderRegistry al
 * cargarse (mismo patrón que hub/adapters/*.ts con IntegrationRegistry).
 */
export interface ProspectingProvider {
  /** Slug único, guardado en org_integrations.integration_slug. */
  slug:        string;
  displayName: string;

  /** Busca personas de contacto en una empresa. Única capacidad que Fase 3 invoca. */
  findContacts(ctx: AdapterContext, query: ProspectingContactQuery): Promise<ProspectingFindContactsResult>;

  /** Coste provisional en créditos OmniCredits para esta búsqueda concreta. */
  estimateCost(query: ProspectingContactQuery): Promise<ProspectingCostEstimate>;

  /** Chequeo de conectividad/credenciales del proveedor. */
  healthCheck(ctx: AdapterContext): Promise<ProspectingHealth>;

  /** Opcional — ver nota arriba. No se usa en Fase 3. */
  searchCompanies?(ctx: AdapterContext, query: ProspectingCompanyQuery): Promise<ProspectingCompanyMatch[]>;

  /** Opcional — ver nota arriba. No se usa en Fase 3. */
  verifyCompany?(ctx: AdapterContext, match: ProspectingCompanyMatch): Promise<ProspectingCompanyMatch>;
}
