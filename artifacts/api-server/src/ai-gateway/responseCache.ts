// ═══════════════════════════════════════════════════════════════════════════
//  AI Gateway — response cache (opt-in, per workspace)
//
//  A cached answer costs no AI credits. The key ALWAYS starts with the org id,
//  so a hit can never cross workspaces; the rest of the key is a hash of what
//  was asked (model, options, and every message — including any tool output,
//  so data-dependent answers don't collide). Answers that contain tool calls
//  are never cached. In-memory and per-instance: a miss just means a paid call.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from "crypto";
import type { GenerateOptions, GenerateResult, Message } from "../ai/types";

export interface CachedResponse extends GenerateResult {
  provider: string;
  model:    string;
}

export class ResponseCache {
  private store = new Map<string, { value: CachedResponse; expires: number }>();
  constructor(private readonly maxEntries = 500) {}

  static key(orgId: number, scope: string, route: { provider: string; model: string }, messages: Message[], options?: Omit<GenerateOptions, "model">): string {
    const digest = createHash("sha256")
      .update(JSON.stringify([scope, route.provider, route.model, options ?? null, messages]))
      .digest("hex");
    return `${orgId}:${digest}`;
  }

  get(key: string): CachedResponse | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) { this.store.delete(key); return null; }
    return hit.value;
  }

  set(key: string, value: CachedResponse, ttlSeconds: number): void {
    if (value.toolCalls && value.toolCalls.length > 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  clear(): void { this.store.clear(); }
}

export const responseCache = new ResponseCache();
