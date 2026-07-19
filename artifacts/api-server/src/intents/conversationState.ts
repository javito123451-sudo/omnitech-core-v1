// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Multi-step Conversation State
//  In-memory store for pending Skills (keyed orgId:userId, TTL 10 min)
//  Intentionally ephemeral — cleared on server restart, no DB dependency
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingSkillState {
  skillId:         string;
  intent:          string;
  collectedParams: Record<string, unknown>;
  missingParams:   string[]; // required params still needed, in collection order
  createdAt:       number;
  lastPromptAt:    number;   // TTL resets on every interaction
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes idle before auto-expiry
const store  = new Map<string, PendingSkillState>();

function storeKey(orgId: number, userId: string): string {
  return `${orgId}:${userId}`;
}

export function getPendingSkill(orgId: number, userId: string): PendingSkillState | null {
  const k     = storeKey(orgId, userId);
  const state = store.get(k);
  if (!state) return null;
  if (Date.now() - state.lastPromptAt > TTL_MS) {
    store.delete(k);
    return null;
  }
  return state;
}

export function setPendingSkill(
  orgId:  number,
  userId: string,
  state:  PendingSkillState,
): void {
  store.set(storeKey(orgId, userId), state);
}

export function clearPendingSkill(orgId: number, userId: string): void {
  store.delete(storeKey(orgId, userId));
}
