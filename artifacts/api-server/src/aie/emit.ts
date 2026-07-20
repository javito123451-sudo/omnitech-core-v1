/**
 * AIE — Typed Event Emitter Helper
 *
 * Provides a single emit() function for modules to publish events.
 * Modules should import this file instead of importing aieEventBus directly.
 *
 * Features:
 *  - Auto-generates event.id (timestamp + counter)
 *  - Auto-fills event.emittedAt
 *  - Validates that orgId is present (logs a warning and returns if missing)
 *  - Fire-and-forget: never throws, never blocks the caller
 *
 * Usage in any module route handler:
 *   import { emitAieEvent } from "../aie/emit";
 *   import { EVENT_TYPES }  from "../aie/eventRegistry";
 *
 *   // At the END of a successful route handler, after sending the response:
 *   void emitAieEvent({
 *     type:    EVENT_TYPES.APPOINTMENT_CREATED,
 *     orgId:   req.orgId!,
 *     userId:  req.userId,
 *     source:  "appointments",
 *     payload: { appointmentId: newAppt.id, clientId: newAppt.clientId },
 *   });
 *
 * The `void` prefix is important: it signals intentional fire-and-forget
 * and suppresses TypeScript's unhandled-promise warnings.
 */

import { aieEventBus } from "./eventBus";
import type { AieEvent, AieEventSource } from "./types";

// ── Sequence counter for unique IDs ───────────────────────────────────────────

let _seq = 0;
function nextEventId(): string {
  return `evt_${Date.now()}_${(++_seq).toString(36)}`;
}

// ── Public emit function ──────────────────────────────────────────────────────

export type EmitPayload = Omit<AieEvent, "id" | "emittedAt">;

export function emitAieEvent(payload: EmitPayload): void {
  // Guard: orgId is mandatory — enforce multi-tenant isolation at the source
  if (!payload.orgId || payload.orgId <= 0) {
    console.warn(
      `[AIE emit] Blocked event "${payload.type}" — orgId missing or invalid.`,
      { type: payload.type, source: payload.source },
    );
    return;
  }

  // Guard: event type must be a non-empty string
  if (!payload.type || typeof payload.type !== "string") {
    console.warn("[AIE emit] Blocked event — type is missing or not a string.");
    return;
  }

  const event: AieEvent = {
    ...payload,
    id:        nextEventId(),
    emittedAt: new Date().toISOString(),
    // Ensure timestamp has a fallback if the caller didn't set it
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };

  try {
    aieEventBus.emit(event);
  } catch (err) {
    // The bus should never throw, but if it does, we absorb it here
    // so the module that called emit() is never affected.
    console.error("[AIE emit] Unexpected error from eventBus.emit():", err);
  }
}
