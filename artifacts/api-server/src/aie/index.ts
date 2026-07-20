/**
 * Ava Intelligence Engine (AIE) — Public API
 *
 * This is the ONLY file that external modules should import from the AIE.
 * Internal implementation details (eventBus, dispatcher internals) are
 * encapsulated and not exposed directly.
 *
 * Architecture:
 *   Modules → emitAieEvent() → aieEventBus → Dispatcher → Handlers
 *                                                            ↓
 *                                                    Action Engine (Phase 2)
 *
 * What modules need:
 *   import { emitAieEvent }  from "../aie";          // to publish events
 *   import { EVENT_TYPES }   from "../aie";           // to avoid magic strings
 *
 * What handler modules need (Phase 4+):
 *   import { registerHandler } from "../aie";         // to subscribe
 *
 * What diagnostics need:
 *   import { getAieSummary }  from "../aie";          // health info
 *   import { initAIE }        from "../aie";          // startup
 */

// ── Re-exports for modules ────────────────────────────────────────────────────

export { emitAieEvent }                                  from "./emit";
export { EVENT_TYPES, getEventMeta, isKnownEventType, listEventTypes } from "./eventRegistry";
export { registerHandler, unregisterHandler, getDispatcherSummary }    from "./dispatcher";
export type { AieEvent, AieEventSource, AieHandler, AieSubscription, IEventBus } from "./types";

// ── Initialisation ────────────────────────────────────────────────────────────

import { initDispatcher }      from "./dispatcher";
import { registerAllHandlers } from "./handlers";
import { aieEventBus }         from "./eventBus";

/**
 * Initialise the AIE.
 * Must be called once at server startup, after all modules are loaded.
 * Called by src/index.ts after runStartupMigrations() completes.
 */
export function initAIE(): void {
  initDispatcher();
  registerAllHandlers();
  console.log(
    `[AIE] Initialised — bus subscriptions: ${aieEventBus.subscriptionCount()}`,
  );
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

import { getDispatcherSummary } from "./dispatcher";

export function getAieSummary() {
  return {
    version:  "1.0.0-phase1",
    status:   "operational",
    ...getDispatcherSummary(),
    busSubscriptions: aieEventBus.subscriptionCount(),
  };
}
