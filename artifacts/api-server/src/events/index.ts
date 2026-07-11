// ═══════════════════════════════════════════════════════════════════════════
//  OmniTech Core — Event Bus Singleton + emit() helper
//
//  Usage (anywhere in the server):
//
//    import { emit } from "../events";
//
//    // Fire-and-forget (non-blocking):
//    emit({
//      type:    "crm.client.created",
//      orgId:   orgId,
//      userId:  clerkId,
//      module:  "crm",
//      payload: { clientId: client.id, name: client.name },
//    });
//
//  To subscribe to events (e.g. from a future analytics module):
//
//    import { eventBus } from "../events";
//    eventBus.subscribe("crm.client.created", (event) => { ... });
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { db }         from "@workspace/db";
import { sql }        from "drizzle-orm";
import pino           from "pino";
import { InternalEventBus } from "./eventBus";
import type { EmitInput, OmniEvent, OmniEventType, EventHandler } from "./types";

export type { OmniEvent, OmniEventType, EventHandler, EmitInput, OmniModule } from "./types";
export type { IEventBus } from "./types";

const logger = pino({ name: "event-bus" });

// ── Singleton ─────────────────────────────────────────────────────────────────
// Replace with KafkaEventBus here when Kafka is ready — zero other changes.
export const eventBus = new InternalEventBus();

// ── DB persistence ────────────────────────────────────────────────────────────

async function persistToDb(event: OmniEvent): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_events (event_id, org_id, user_id, event_type, module, payload, created_at)
    VALUES (
      ${event.id}::uuid,
      ${event.orgId},
      ${event.userId ?? null},
      ${event.type},
      ${event.module},
      ${JSON.stringify(event.payload)}::jsonb,
      ${event.timestamp.toISOString()}::timestamptz
    )
  `);
}

// ── emit() — the single public API for emitting events ───────────────────────

/**
 * Emit a business event.  Always fire-and-forget — never awaited in hot paths.
 *
 * What this does:
 *   1. Assigns a stable UUID (deduplication key for future Kafka consumers).
 *   2. Persists to the `system_events` table asynchronously.
 *   3. Notifies all in-process subscribers via the EventBus.
 *
 * Errors in persistence are caught and logged — never propagated to callers.
 */
export function emit(input: EmitInput): void {
  const event: OmniEvent = {
    ...input,
    id:        randomUUID(),
    timestamp: new Date(),
  };

  // Notify in-process subscribers immediately (sync)
  try {
    eventBus.publish(event);
  } catch (err) {
    logger.warn({ err, type: event.type }, "[EventBus] in-process subscriber threw");
  }

  // Persist to DB asynchronously — never blocks the caller
  persistToDb(event).catch((err) => {
    logger.warn({ err, type: event.type, orgId: event.orgId }, "[EventBus] failed to persist event to DB");
  });
}
