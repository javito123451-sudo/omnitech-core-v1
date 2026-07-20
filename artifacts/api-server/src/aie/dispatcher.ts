/**
 * AIE — Dispatcher
 *
 * The Dispatcher is the wiring layer between the Event Bus and Handler modules.
 *
 * Responsibilities:
 *  - Maintains the registry of all active handler registrations.
 *  - Provides registerHandler() / unregisterHandler() for handler modules.
 *  - Provides a logging subscription ("*") for diagnostics.
 *  - Exposes a health/diagnostic summary of active subscriptions.
 *
 * What the Dispatcher does NOT do:
 *  - Execute business logic (that is the handlers' job).
 *  - Decide which events trigger which actions (that is the handlers' job).
 *  - Modify the database (that is the Action Engine's job).
 *
 * Usage by handler modules (Phase 4+):
 *   import { registerHandler } from "../aie/dispatcher";
 *   registerHandler(EVENT_TYPES.TIME_CLOCK_IN, handleClockIn, "OmniTime clock-in detector");
 */

import { aieEventBus } from "./eventBus";
import { isKnownEventType } from "./eventRegistry";
import type {
  AieHandler,
  AieHandlerRegistration,
  AieSubscription,
} from "./types";

// ── Handler registry ──────────────────────────────────────────────────────────

const _handlers = new Map<string, AieHandlerRegistration>();

// ── Diagnostics subscription (always active) ──────────────────────────────────
// Logs every event that flows through the bus at debug level.
// Disabled in production to avoid log noise (can be re-enabled via env var).

let _diagnosticsSubscription: AieSubscription | null = null;

function startDiagnosticsListener(): void {
  if (_diagnosticsSubscription) return;

  if (process.env.AIE_DEBUG === "true") {
    _diagnosticsSubscription = aieEventBus.onAny((event) => {
      console.log(
        `[AIE] event="${event.type}" org=${event.orgId} src=${event.source} id=${event.id}`,
      );
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a handler for a specific event type.
 *
 * @param eventType   - The event type string (use EVENT_TYPES constants).
 * @param handler     - The async function to call when the event fires.
 * @param description - Human-readable label for diagnostics.
 * @returns           - A registration ID (use with unregisterHandler).
 */
export function registerHandler(
  eventType:   string,
  handler:     AieHandler,
  description: string,
): string {
  if (!isKnownEventType(eventType) && eventType !== "*") {
    console.warn(
      `[AIE Dispatcher] Registering handler for unknown event type: "${eventType}". ` +
      "Add it to eventRegistry.ts if this is intentional.",
    );
  }

  const subscription = aieEventBus.on(eventType, handler);

  const registration: AieHandlerRegistration = {
    eventType,
    handler,
    description,
    subscription,
  };

  _handlers.set(subscription.id, registration);

  console.log(
    `[AIE Dispatcher] Handler registered: "${description}" → "${eventType}" (id: ${subscription.id})`,
  );

  return subscription.id;
}

/**
 * Remove a previously registered handler by its registration ID.
 */
export function unregisterHandler(registrationId: string): void {
  const registration = _handlers.get(registrationId);
  if (!registration) {
    console.warn(`[AIE Dispatcher] unregisterHandler: unknown id "${registrationId}"`);
    return;
  }
  aieEventBus.off(registration.subscription);
  _handlers.delete(registrationId);
  console.log(
    `[AIE Dispatcher] Handler unregistered: "${registration.description}" (id: ${registrationId})`,
  );
}

/**
 * Returns a diagnostic summary of all active handler registrations.
 * Used by health check endpoints and the Control Center diagnostics panel.
 */
export function getDispatcherSummary(): {
  totalHandlers:   number;
  totalBusSubscriptions: number;
  handlers: Array<{ id: string; eventType: string; description: string }>;
} {
  return {
    totalHandlers:        _handlers.size,
    totalBusSubscriptions: aieEventBus.subscriptionCount(),
    handlers: [..._handlers.entries()].map(([id, reg]) => ({
      id,
      eventType:   reg.eventType,
      description: reg.description,
    })),
  };
}

// ── Initialise ────────────────────────────────────────────────────────────────
// Called once when the module is first imported (Phase 4 handlers call
// initDispatcher to register themselves after the dispatcher is ready).

export function initDispatcher(): void {
  startDiagnosticsListener();
  console.log("[AIE Dispatcher] Initialised — ready to accept handler registrations.");
}
