// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — confirmation store
//
//  Backend-held record of a pending action proposal. A confirmation is never
//  a plain boolean from the client — /confirm must present a token this
//  store issued, scoped to the same user+org+action, and single-use.
//  In-memory is enough for this phase (same pattern/tradeoff as ace/contextStore.ts
//  and the platform-role caches): AVA CORE has no multi-instance deployment
//  yet, and a lost pending proposal on restart just means "propose again."
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";

interface PendingAction {
  actionId:   string;
  params:     Record<string, unknown>;
  orgId:      number;
  userId:     number;
  expiresAt:  number;
}

const TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, PendingAction>();

export function createProposal(actionId: string, params: Record<string, unknown>, orgId: number, userId: number): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = Date.now() + TTL_MS;
  pending.set(token, { actionId, params, orgId, userId, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/** Consumes the token (single-use) if it's valid for this exact user+org. Returns null otherwise. */
export function consumeProposal(token: string, orgId: number, userId: number): PendingAction | null {
  const entry = pending.get(token);
  if (!entry) return null;
  pending.delete(token); // single-use regardless of outcome below
  if (entry.orgId !== orgId || entry.userId !== userId) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}
