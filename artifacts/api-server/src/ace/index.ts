/**
 * Ava Context Engine (ACE) — Public API
 *
 * This is the ONLY file that external modules should import from the ACE.
 * The internal store implementation is an opaque detail hidden behind this API.
 *
 * Contract:
 *  - All functions are pure (no side-effects beyond updating the store).
 *  - No business logic. No AI calls. No DB queries.
 *  - All functions are org-scoped — orgId is always required.
 *  - Consumers should never hold onto a context reference; always call
 *    getCurrentContext() to get a fresh snapshot.
 *
 * Usage example:
 *   import { updateContext, getActiveClient } from "../ace";
 *   await updateContext(req.orgId, req.userId, { activeModule: "crm" });
 *   const client = getActiveClient(req.orgId, req.userId);
 */

import {
  storeGet,
  storeSet,
  storeUpdate,
  storeDelete,
  storeTouchActivity,
  storeSize,
} from "./contextStore";
import type {
  AceContext,
  AceContextUpdate,
  AceContextView,
  AceEntity,
  AceWorkday,
  AceClockStatus,
  AceClockMethod,
} from "./types";

export type {
  AceContext,
  AceContextUpdate,
  AceContextView,
  AceEntity,
  AceWorkday,
  AceClockStatus,
  AceClockMethod,
};

// ── Internal factory — builds a blank context for a new session ────────────

function buildInitialContext(
  orgId:       number,
  userId:      number,
  clerkUserId: string,
  overrides:   Partial<AceContext> = {},
): AceContext {
  const now = new Date().toISOString();
  return {
    userId,
    clerkUserId,
    orgId,
    orgRole:      overrides.orgRole      ?? "member",
    permissions:  overrides.permissions  ?? [],
    platformRole: overrides.platformRole ?? null,

    activePage:   overrides.activePage   ?? "/",
    activeModule: overrides.activeModule ?? null,

    device:    overrides.device    ?? null,
    browser:   overrides.browser   ?? null,
    ipAddress: overrides.ipAddress ?? null,
    timezone:  overrides.timezone  ?? null,
    language:  overrides.language  ?? null,

    activeClient:       null,
    activeProject:      null,
    activeConversation: null,
    activeQuote:        null,
    activeWorkOrder:    null,

    activeWorkday: null,
    clockStatus:   null,
    clockMethod:   null,

    lastActivity:     now,
    sessionStartedAt: now,

    ...overrides,
  };
}

// ── Internal: build a computed view from stored context ────────────────────

function toView(ctx: AceContext): AceContextView {
  const now    = new Date();
  const last   = new Date(ctx.lastActivity);
  const diffMs = now.getTime() - last.getTime();
  return {
    ...ctx,
    inactiveFor: Math.floor(diffMs / 1_000),
    serverTime:  now.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns the full context view for a user, or null if no session exists.
 * `inactiveFor` and `serverTime` are computed at call time.
 */
export function getCurrentContext(
  orgId:  number,
  userId: number,
): AceContextView | null {
  const ctx = storeGet(orgId, userId);
  if (!ctx) return null;
  return toView(ctx);
}

/**
 * Initialises or completely replaces the context for a session.
 * Use updateContext() for partial updates.
 */
export function setContext(
  orgId:       number,
  userId:      number,
  clerkUserId: string,
  overrides:   Partial<AceContext> = {},
): AceContextView {
  const ctx = buildInitialContext(orgId, userId, clerkUserId, overrides);
  storeSet(orgId, userId, ctx);
  return toView(ctx);
}

/**
 * Applies a partial update to an existing context.
 * If no context exists for this session, returns null (caller may call
 * setContext first or ignore — ACE never throws on missing context).
 */
export function updateContext(
  orgId:   number,
  userId:  number,
  partial: AceContextUpdate,
): AceContextView | null {
  const updated = storeUpdate(orgId, userId, partial as Partial<AceContext>);
  if (!updated) return null;
  return toView(updated);
}

/**
 * Clears the context for a user (called on logout).
 */
export function clearContext(orgId: number, userId: number): void {
  storeDelete(orgId, userId);
}

/**
 * Records that the user was recently active without changing any other field.
 * Called on every authenticated request to keep inactiveFor accurate.
 */
export function touchActivity(orgId: number, userId: number): void {
  storeTouchActivity(orgId, userId);
}

// ── Focused getters — convenience wrappers over getCurrentContext ──────────

export function getActiveClient(
  orgId:  number,
  userId: number,
): AceEntity | null {
  return storeGet(orgId, userId)?.activeClient ?? null;
}

export function getActiveProject(
  orgId:  number,
  userId: number,
): AceEntity | null {
  return storeGet(orgId, userId)?.activeProject ?? null;
}

export function getActiveConversation(
  orgId:  number,
  userId: number,
): AceEntity | null {
  return storeGet(orgId, userId)?.activeConversation ?? null;
}

export function getActiveQuote(
  orgId:  number,
  userId: number,
): AceEntity | null {
  return storeGet(orgId, userId)?.activeQuote ?? null;
}

export function getCurrentWorkspace(
  orgId:  number,
  userId: number,
): { orgId: number; orgRole: string } | null {
  const ctx = storeGet(orgId, userId);
  if (!ctx) return null;
  return { orgId: ctx.orgId, orgRole: ctx.orgRole };
}

export function getCurrentSession(
  orgId:  number,
  userId: number,
): { sessionStartedAt: string; lastActivity: string; inactiveFor: number } | null {
  const ctx = storeGet(orgId, userId);
  if (!ctx) return null;
  const view = toView(ctx);
  return {
    sessionStartedAt: view.sessionStartedAt,
    lastActivity:     view.lastActivity,
    inactiveFor:      view.inactiveFor,
  };
}

export function getCurrentModule(
  orgId:  number,
  userId: number,
): string | null {
  return storeGet(orgId, userId)?.activeModule ?? null;
}

export function getCurrentWorkday(
  orgId:  number,
  userId: number,
): AceWorkday | null {
  return storeGet(orgId, userId)?.activeWorkday ?? null;
}

export function getClockStatus(
  orgId:  number,
  userId: number,
): AceClockStatus | null {
  return storeGet(orgId, userId)?.clockStatus ?? null;
}

// ── Diagnostics (internal — for health checks only) ───────────────────────

export function aceStoreSize(): number {
  return storeSize();
}
