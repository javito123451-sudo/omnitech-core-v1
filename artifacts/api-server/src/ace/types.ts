/**
 * Ava Context Engine (ACE) — Type Definitions
 *
 * ACE is the single source of truth for the user's live session context.
 * It does NOT contain business logic, AI calls, or database writes.
 * Its sole responsibility is to know, at any moment, what the user is doing.
 *
 * Principle: SRP — one responsibility, one place.
 */

// ── Primitive entity reference ─────────────────────────────────────────────

export type AceEntityType =
  | "client"
  | "project"
  | "conversation"
  | "quote"
  | "work_order"
  | "invoice"
  | "campaign";

export interface AceEntity {
  id:   number;
  name: string;
  type: AceEntityType;
}

// ── OmniTime workday state (nullable until module exists) ──────────────────

export interface AceWorkday {
  entryId:    number;
  clockInAt:  string;   // ISO-8601 UTC
  breakCount: number;
}

export type AceClockStatus = "clocked_in" | "on_break" | "clocked_out";
export type AceClockMethod  = "manual" | "web" | "mobile" | "ava";

// ── Full context snapshot ──────────────────────────────────────────────────

export interface AceContext {
  // ── Identity (sourced from auth middleware — never mutated by frontend) ──
  userId:       number;
  clerkUserId:  string;
  orgId:        number;
  orgRole:      string;
  permissions:  string[];
  platformRole: string | null;

  // ── Navigation state ─────────────────────────────────────────────────────
  activePage:   string;        // current route path e.g. "/clients/42"
  activeModule: string | null; // module slug e.g. "crm", "omni_time"

  // ── Client-side environment ───────────────────────────────────────────────
  device:    string | null;  // "desktop" | "mobile" | "tablet"
  browser:   string | null;  // parsed from User-Agent
  ipAddress: string | null;  // from req.ip (Express)
  timezone:  string | null;  // IANA tz e.g. "Europe/Madrid"
  language:  string | null;  // BCP-47 e.g. "es"

  // ── Active business entities (all nullable — user may have none active) ──
  activeClient:       AceEntity | null;
  activeProject:      AceEntity | null;
  activeConversation: AceEntity | null;
  activeQuote:        AceEntity | null;
  activeWorkOrder:    AceEntity | null;

  // ── OmniTime state (null until omni_time module is active) ───────────────
  activeWorkday: AceWorkday | null;
  clockStatus:   AceClockStatus | null;
  clockMethod:   AceClockMethod | null;

  // ── Activity tracking ─────────────────────────────────────────────────────
  lastActivity:     string; // ISO-8601 UTC — updated on every context touch
  sessionStartedAt: string; // ISO-8601 UTC — when the context was first created
}

// ── Partial update payload (frontend sends only changed fields) ────────────

export type AceContextUpdate = Partial<Omit<
  AceContext,
  // Identity fields are always derived from auth — frontend cannot override them
  | "userId"
  | "clerkUserId"
  | "orgId"
  | "orgRole"
  | "permissions"
  | "platformRole"
  | "sessionStartedAt"
  | "lastActivity"
>>;

// ── Computed view (read-only additions derived at query time) ──────────────

export interface AceContextView extends AceContext {
  inactiveFor: number; // seconds since lastActivity — computed, never stored
  serverTime:  string; // ISO-8601 UTC of the moment this view was built
}

// ── Store key type (for internal use only) ────────────────────────────────

export type AceStoreKey = `${number}:${number}`; // orgId:userId
