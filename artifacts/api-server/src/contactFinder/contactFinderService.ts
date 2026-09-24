/**
 * OmniSeller Fase 3 — Contact Finder Service.
 *
 * Capa equivalente al IntegrationManager del Hub (hub/integrationManager.ts)
 * pero para el contrato ProspectingProvider: resuelve la configuración de
 * proveedor de la organización (reutilizando org_integrations /
 * integration_events / encryptCredentials-decryptCredentials del Hub — sin
 * duplicar esa infraestructura), aplica OmniCredits reserve→ejecución→settle
 * / error→releaseHold SOLO cuando hay un proveedor configurado, persiste los
 * contactos encontrados con deduplicación, y nunca envía ni inicia contacto
 * con nadie (no existe ninguna llamada a Ava/WhatsApp/Telegram/email desde
 * este archivo).
 *
 * El núcleo (este archivo + routes/missions.ts) NUNCA importa un adaptador
 * concreto — solo conoce ProspectingProvider/ProspectingProviderRegistry.
 */
import crypto from "node:crypto";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db,
  orgIntegrationsTable,
  integrationEventsTable,
  leadContactsTable,
  type OrgIntegration,
  type LeadContact,
} from "@workspace/db";
import { decryptCredentials } from "../utils/integrationCreds";
import { reserveCredits, settleCredits, releaseHold, InsufficientCreditsError } from "../credits/creditService";
import { ProspectingProviderRegistry } from "./providerRegistry";
import type { AdapterContext, ProspectingContact, ProspectingContactQuery, ProspectingProvider } from "./types";

export type ContactFinderStatus = "ok" | "provider_not_configured" | "insufficient_credits" | "provider_error";

export interface ContactFinderResult {
  status: ContactFinderStatus;
  contacts: LeadContact[];
  provider?: string;
  creditsSpent?: number;
  creditsRequired?: number;
  error?: string;
}

export interface LeadResultForContactFinder {
  id: number;
  name: string;
  website: string | null;
  sector: string | null;
}

// ── Resolución de proveedor ───────────────────────────────────────────────────
//
// Reglas (aprobadas explícitamente para Fase 3): resolver por configuración
// de la Mission (override puntual) o, si no hay override, por disponibilidad
// en la organización — SIN lógica de selección comercial automática. Si nada
// resuelve, se devuelve null (nunca se inventa un proveedor ni credenciales).

async function resolveProvider(
  orgId: number,
  missionProviderConfig: unknown,
): Promise<{ provider: ProspectingProvider; orgIntegration: OrgIntegration } | null> {
  const registeredSlugs = ProspectingProviderRegistry.list().map((p) => p.slug);
  if (registeredSlugs.length === 0) return null;

  const override = (missionProviderConfig as { providerSlug?: string } | null | undefined)?.providerSlug;

  if (override) {
    if (!registeredSlugs.includes(override)) return null;
    const [row] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(and(
        eq(orgIntegrationsTable.orgId, orgId),
        eq(orgIntegrationsTable.integrationSlug, override),
        eq(orgIntegrationsTable.status, "connected"),
      ));
    if (!row) return null;
    return { provider: ProspectingProviderRegistry.get(override)!, orgIntegration: row };
  }

  const [row] = await db
    .select()
    .from(orgIntegrationsTable)
    .where(and(
      eq(orgIntegrationsTable.orgId, orgId),
      inArray(orgIntegrationsTable.integrationSlug, registeredSlugs),
      eq(orgIntegrationsTable.status, "connected"),
    ))
    .orderBy(orgIntegrationsTable.id)
    .limit(1);
  if (!row) return null;

  return { provider: ProspectingProviderRegistry.get(row.integrationSlug)!, orgIntegration: row };
}

/** Igual que hub/integrationManager.ts's buildContext (no exportada allí) — duplicada aquí en 8 líneas en vez de tocar hub/ para esta fase. */
function buildContext(row: OrgIntegration): AdapterContext {
  return {
    orgId: row.orgId,
    credentials: row.credentialsEnc ? decryptCredentials(row.credentialsEnc) : {},
    config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {},
    displayName: row.displayName ?? undefined,
  };
}

async function logEvent(opts: {
  orgId: number;
  slug: string;
  direction: "inbound" | "outbound";
  eventType: string;
  status: "processed" | "error";
  summary: string;
  errorMessage?: string;
  payloadJson?: Record<string, unknown>;
}) {
  try {
    await db.insert(integrationEventsTable).values({
      orgId: opts.orgId,
      integrationSlug: opts.slug,
      direction: opts.direction,
      eventType: opts.eventType,
      status: opts.status,
      summary: opts.summary,
      errorMessage: opts.errorMessage ?? null,
      payloadJson: opts.payloadJson ? JSON.stringify(opts.payloadJson) : null,
    });
  } catch (e) {
    console.error("[ContactFinderService] logEvent failed:", e);
  }
}

// ── Persistencia con deduplicación ────────────────────────────────────────────

function mapStatus(quality: ProspectingContact["quality"]): "encontrado" | "verificado" | "no_verificado" {
  if (quality === "verificado") return "verificado";
  if (quality === "no_verificado") return "no_verificado";
  // El proveedor no declaró nada — nunca se asume verificado por defecto.
  return "encontrado";
}

async function persistContacts(
  orgId: number,
  leadResultId: number,
  providerSlug: string,
  found: ProspectingContact[],
): Promise<LeadContact[]> {
  const saved: LeadContact[] = [];

  for (const c of found) {
    // Dedup primaria: provider + provider_contact_id, aislada por organización.
    if (c.externalId) {
      const [existing] = await db
        .select()
        .from(leadContactsTable)
        .where(and(
          eq(leadContactsTable.orgId, orgId),
          eq(leadContactsTable.provider, providerSlug),
          eq(leadContactsTable.providerContactId, c.externalId),
        ));
      if (existing) { saved.push(existing); continue; }
    } else if (c.email || c.phone) {
      // Fallback: no hay id de proveedor — comprobamos por email/teléfono
      // dentro del MISMO lead_result antes de insertar un duplicado. No es
      // una garantía a nivel de Postgres (no siempre hay email/teléfono),
      // por eso está documentado como fallback de aplicación, no de esquema.
      const conditions = [];
      if (c.email) conditions.push(ilike(leadContactsTable.email, c.email));
      if (c.phone) conditions.push(eq(leadContactsTable.phone, c.phone));
      const [existing] = await db
        .select()
        .from(leadContactsTable)
        .where(and(
          eq(leadContactsTable.orgId, orgId),
          eq(leadContactsTable.leadResultId, leadResultId),
          or(...conditions),
        ));
      if (existing) { saved.push(existing); continue; }
    }

    // Fase 10 (auditoría de concurrencia) — hallazgo: dos llamadas casi
    // simultáneas a "buscar contactos" para el MISMO lead_result+proveedor
    // podían pasar ambas el SELECT de dedup de arriba (todavía no existía
    // ninguna fila) y luego chocar en este INSERT contra
    // lead_contacts_org_provider_contact_uidx — una excepción sin capturar
    // que se propagaba fuera de persistContacts() y dejaba el hold de
    // OmniCredits ya reservado sin liberar (nunca se llegaba a
    // settleCredits/releaseHold; solo se auto-expiraba tras el TTL del
    // hold). Arreglo: mismo idioma onConflictDoNothing ya usado en el resto
    // del repo (Fase 5/6/8) en vez de un INSERT que puede lanzar — sobre la
    // MISMA restricción única que ya existía, sin tabla ni índice nuevo. Si
    // otra petición concurrente ya insertó esta fila, se relee y se
    // reutiliza en vez de duplicar o fallar.
    const [row] = await db.insert(leadContactsTable).values({
      orgId,
      leadResultId,
      name: c.name ?? null,
      role: c.role ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      linkedinUrl: c.linkedinUrl ?? null,
      provider: providerSlug,
      providerContactId: c.externalId ?? null,
      confidence: c.confidence ?? null,
      status: mapStatus(c.quality),
    })
      .onConflictDoNothing(
        c.externalId
          ? { target: [leadContactsTable.orgId, leadContactsTable.provider, leadContactsTable.providerContactId], where: sql`${leadContactsTable.providerContactId} is not null` }
          : undefined,
      )
      .returning();

    if (row) { saved.push(row); continue; }

    // onConflictDoNothing no insertó nada: otra petición concurrente ganó
    // la carrera — releer la fila real en vez de perderla.
    if (c.externalId) {
      const [winner] = await db.select().from(leadContactsTable).where(and(
        eq(leadContactsTable.orgId, orgId), eq(leadContactsTable.provider, providerSlug), eq(leadContactsTable.providerContactId, c.externalId),
      ));
      if (winner) saved.push(winner);
    }
  }

  return saved;
}

// ── Orquestación principal ────────────────────────────────────────────────────

export async function findContactsForLead(opts: {
  orgId: number;
  userClerkId: string | null;
  missionId: number;
  leadResult: LeadResultForContactFinder;
  missionProviderConfig: unknown;
}): Promise<ContactFinderResult> {
  const resolved = await resolveProvider(opts.orgId, opts.missionProviderConfig);
  if (!resolved) {
    // Sin proveedor configurado: NO se reservan créditos, no se inventa nada.
    return { status: "provider_not_configured", contacts: [] };
  }
  const { provider, orgIntegration } = resolved;

  const query: ProspectingContactQuery = {
    companyName: opts.leadResult.name,
    companyWebsite: opts.leadResult.website,
    sector: opts.leadResult.sector,
  };

  let estimatedCredits = 0;
  try {
    const estimate = await provider.estimateCost(query);
    estimatedCredits = Math.max(0, Math.round(estimate.credits ?? 0));
  } catch (err) {
    await logEvent({
      orgId: opts.orgId, slug: provider.slug, direction: "outbound",
      eventType: "contacts_find_failed", status: "error",
      summary: `estimateCost falló para lead_result ${opts.leadResult.id}`,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { status: "provider_error", contacts: [], provider: provider.slug, error: err instanceof Error ? err.message : String(err) };
  }

  // A diferencia de "missions:research:<resultId>" (Fase 2) — donde
  // reservar dos veces para el mismo resultId es imposible porque su status
  // deja de ser 'new' tras el primer intento — Contact Finder SÍ permite
  // volver a buscar contactos sobre el mismo lead_result (p. ej. para
  // ampliar la búsqueda más adelante). Por eso la referencia de OmniCredits
  // lleva un sufijo único por invocación: si fuera estable por
  // lead_result+proveedor, la segunda búsqueda legítima chocaría con
  // DuplicateRequestError. La deduplicación de CONTACTOS (que sí debe ser
  // estable) vive aparte, en persistContacts(), por provider_contact_id o
  // email/teléfono — nunca en esta referencia de créditos.
  const reference = `missions:contacts:${opts.leadResult.id}:${provider.slug}:${crypto.randomUUID()}`;

  if (estimatedCredits > 0) {
    try {
      await reserveCredits({ orgId: opts.orgId, credits: estimatedCredits, reference, userClerkId: opts.userClerkId });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return { status: "insufficient_credits", contacts: [], provider: provider.slug, creditsRequired: estimatedCredits };
      }
      throw err;
    }
  }

  let contacts: ProspectingContact[];
  try {
    const ctx = buildContext(orgIntegration);
    const result = await provider.findContacts(ctx, query);
    contacts = result.contacts;
  } catch (err) {
    if (estimatedCredits > 0) await releaseHold(opts.orgId, reference).catch(() => {});
    await logEvent({
      orgId: opts.orgId, slug: provider.slug, direction: "outbound",
      eventType: "contacts_find_failed", status: "error",
      summary: `findContacts falló para lead_result ${opts.leadResult.id}`,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { status: "provider_error", contacts: [], provider: provider.slug, error: err instanceof Error ? err.message : String(err) };
  }

  const saved = await persistContacts(opts.orgId, opts.leadResult.id, provider.slug, contacts);

  if (estimatedCredits > 0) {
    await settleCredits({
      orgId: opts.orgId, reference, credits: estimatedCredits, userClerkId: opts.userClerkId,
      metadata: { missionId: opts.missionId, leadResultId: opts.leadResult.id, provider: provider.slug },
    }).catch(() => {});
  }

  await logEvent({
    orgId: opts.orgId, slug: provider.slug, direction: "outbound",
    eventType: "contacts_found", status: "processed",
    summary: `${saved.length} contacto(s) guardados (de ${contacts.length} devueltos) para lead_result ${opts.leadResult.id}`,
    payloadJson: { leadResultId: opts.leadResult.id, missionId: opts.missionId, returned: contacts.length, saved: saved.length },
  });

  return { status: "ok", contacts: saved, provider: provider.slug, creditsSpent: estimatedCredits };
}

// ── Carga manual (sin proveedor) ──────────────────────────────────────────────
//
// Mientras no haya un ProspectingProvider real conectado (ver "###
// PROVIDER DECISION" al inicio de este archivo y contactFinder/index.ts), un
// operador puede añadir un contacto que ya conoce a mano. Reutiliza
// EXACTAMENTE persistContacts() — misma deduplicación por email/teléfono
// dentro del lead_result, mismo onConflictDoNothing ante una carrera — para
// que Outreach/Booking no tengan que distinguir si un lead_contact vino de
// un proveedor pagado o de un operador. A propósito NO pasa por
// reserveCredits/settleCredits: no hay proveedor externo que cobrar.
export const MANUAL_CONTACT_PROVIDER_SLUG = "manual";

export interface ManualContactInput {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
}

export async function addManualContact(
  orgId: number,
  leadResultId: number,
  input: ManualContactInput,
): Promise<LeadContact> {
  // El operador escribió el dato él mismo — a diferencia de un proveedor
  // externo que puede no declarar su confianza (ver mapStatus más arriba:
  // "nunca se asume verificado por defecto"), aquí no hay ambigüedad sobre
  // el origen: se marca "verificado" explícitamente.
  const [saved] = await persistContacts(orgId, leadResultId, MANUAL_CONTACT_PROVIDER_SLUG, [{
    name: input.name,
    role: input.role,
    email: input.email,
    phone: input.phone,
    linkedinUrl: input.linkedinUrl,
    quality: "verificado",
  }]);
  return saved!;
}
