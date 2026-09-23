/**
 * OmniSeller Fase 13 — tipos compartidos por los paneles del pipeline
 * (Prospectos/Research/Contact Finder, Outreach, Follow-up, Booking).
 *
 * Estos tipos reflejan exactamente las formas de respuesta ya existentes en
 * el backend (routes/missions.ts, routes/leads.ts, routes/outreachFollowup.ts,
 * routes/outreachBookings.ts) — no se inventa ningún campo nuevo. Los campos
 * de GET /api/leads/results y GET /api/leads/results/:id/messages llegan en
 * snake_case porque esas rutas usan SQL crudo (db.execute) en vez de Drizzle;
 * el resto (missions.ts, outreachFollowup.ts) usa camelCase porque son
 * resultados de Drizzle. Se respeta cada convención tal cual la devuelve la
 * API — no se renombra nada en el cliente.
 */

// ── Prospectos (GET /api/leads/results?searchId=...) ───────────────────────
export interface LeadResultRow {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  rating: number | null;
  review_count: number | null;
  sector: string | null;
  status: string;
  crm_client_id: number | null;
  created_at: string;
  // Vienen del LEFT JOIN con lead_analysis — null si el prospecto no se ha investigado todavía.
  score: number | null;
  opportunity: "alta" | "media" | "baja" | null;
  summary: string | null;
}

export interface LeadResultsPage {
  data: LeadResultRow[];
  total: number;
  page: number;
  pages: number;
}

// ── Contact Finder (POST /api/missions/:id/contacts/find) ──────────────────
export interface FoundContact {
  id: number;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  status: string;
  confidence: number | null;
}

export interface ContactFinderResult {
  missionId: number;
  leadResultId: number;
  provider: string | null;
  contactsFound: number;
  creditsSpent: number;
  contacts: FoundContact[];
}

/** Contactos ya encontrados en esta sesión, indexados por leadResultId —
 * no existe (todavía) un GET para volver a listarlos tras recargar la
 * página; ver "Decisiones abiertas" del informe de Fase 13. */
export type ContactsByResult = Record<number, FoundContact[] | undefined>;

/** Un contacto "aplanado" con el contexto del prospecto al que pertenece —
 * lo que consume el panel de Outreach para poder elegir "a quién". */
export interface ContactWithLeadContext extends FoundContact {
  leadResultId: number;
  leadName: string;
}

// ── Outreach (lead_messages) ────────────────────────────────────────────────
export type OutreachChannel = "email" | "whatsapp" | "telegram";
export const OUTREACH_CHANNELS: readonly OutreachChannel[] = ["email", "whatsapp", "telegram"];

export interface LeadMessageDraft {
  id: number;
  orgId: number;
  resultId: number;
  contactId: number | null;
  channel: string;
  content: string;
  status: string;
  createdAt?: string;
}

// GET /api/leads/results/:id/messages — SQL crudo, snake_case.
export interface LeadMessageHistoryRow {
  id: number;
  channel: string;
  content: string;
  tone: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
}

// ── Follow-up (outreach_followups) — camelCase, Drizzle ────────────────────
export interface FollowupRow {
  id: number;
  orgId: number;
  leadMessageId: number;
  leadContactId: number;
  missionId: number | null;
  channel: string;
  attempt: number;
  maxAttempts: number;
  status: string;
  nextRunAt: string;
  reason: string | null;
  generatedLeadMessageId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Booking (POST /api/outreach/bookings) ───────────────────────────────────
export interface OmniSellerAppointment {
  id: number;
  [key: string]: unknown;
}

// ── Trazabilidad (GET /api/missions/:id/audit) — Fase 16, camelCase, Drizzle ──
export interface AuditEntry {
  id: number;
  action: string;
  resource: string | null;
  resourceId: string | null;
  actorEmail: string | null;
  details: Record<string, unknown> | null;
  severity: string;
  createdAt: string;
}
