/**
 * Ava Context Engine (ACE) — In-Memory Context Store
 *
 * Stores one AceContext per (orgId, userId) pair.
 *
 * Design decisions:
 *  - In-memory only (same pattern as conversationState.ts) — context
 *    changes dozens of times per minute; DB writes would be wasteful.
 *  - TTL 2 hours — covers a full work session without excessive memory use.
 *  - Auto-cleanup every 15 minutes to prevent unbounded growth.
 *  - Keyed by "orgId:userId" — multi-tenant isolation is enforced at the
 *    store level, not just at the handler level.
 *
 * If the server restarts, context is rebuilt on the next PATCH from the
 * frontend — an acceptable trade-off for the simplicity gained.
 */

import type { AceContext, AceStoreKey } from "./types";

const TTL_MS      = 2 * 60 * 60 * 1_000; // 2 hours
const CLEANUP_MS  = 15 * 60 * 1_000;      // prune stale entries every 15 min

interface StoreEntry {
  context:    AceContext;
  lastTouched: number; // Date.now() — used for TTL eviction
}

const store = new Map<AceStoreKey, StoreEntry>();

// ── Key helper ────────────────────────────────────────────────────────────

function key(orgId: number, userId: number): AceStoreKey {
  return `${orgId}:${userId}`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function storeGet(orgId: number, userId: number): AceContext | null {
  const entry = store.get(key(orgId, userId));
  if (!entry) return null;
  if (Date.now() - entry.lastTouched > TTL_MS) {
    store.delete(key(orgId, userId));
    return null;
  }
  return entry.context;
}

export function storeSet(orgId: number, userId: number, ctx: AceContext): void {
  store.set(key(orgId, userId), { context: ctx, lastTouched: Date.now() });
}

export function storeUpdate(
  orgId:   number,
  userId:  number,
  partial: Partial<AceContext>,
): AceContext | null {
  const existing = storeGet(orgId, userId);
  if (!existing) return null;
  const updated: AceContext = {
    ...existing,
    ...partial,
    // Always refresh lastActivity on any update
    lastActivity: new Date().toISOString(),
  };
  storeSet(orgId, userId, updated);
  return updated;
}

export function storeDelete(orgId: number, userId: number): void {
  store.delete(key(orgId, userId));
}

export function storeTouchActivity(orgId: number, userId: number): void {
  const entry = store.get(key(orgId, userId));
  if (!entry) return;
  entry.context.lastActivity = new Date().toISOString();
  entry.lastTouched = Date.now();
}

// ── Diagnostics (internal — not exposed via public API) ────────────────────

export function storeSize(): number {
  return store.size;
}

// ── TTL eviction — runs on a fixed interval ───────────────────────────────

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, entry] of store.entries()) {
    if (now - entry.lastTouched > TTL_MS) {
      store.delete(k);
    }
  }
}

// Start the cleanup timer immediately when the module is imported.
// setInterval returns a NodeJS.Timeout; unref() prevents it from keeping
// the process alive if there are no other pending async operations.
const _cleanupTimer = setInterval(pruneExpired, CLEANUP_MS);
if (_cleanupTimer.unref) _cleanupTimer.unref();
