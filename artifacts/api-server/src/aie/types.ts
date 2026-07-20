/**
 * Ava Intelligence Engine (AIE) — Type Definitions
 *
 * AIE is the platform-wide intelligence layer. It receives events from every
 * module, analyses them using ACE context, and decides what (if anything)
 * should happen. Execution of those decisions is delegated to the Action Engine.
 *
 * This file defines ONLY types — no logic, no state, no side-effects.
 *
 * Architecture position:
 *   Modules → emit() → AIE Event Bus → Dispatcher → Handlers → Action Engine
 *
 * Principles:
 *  - orgId is MANDATORY in every event — multi-tenant isolation at the type level.
 *  - Handlers receive the full event and are responsible for filtering by orgId.
 *  - emit() is always fire-and-forget from the caller's perspective.
 *  - Handler errors are caught and logged — never propagated to the emitter.
 */

// ── Event ─────────────────────────────────────────────────────────────────────

/**
 * The atomic unit of information flowing through the AIE.
 *
 * Every module that wants intelligence must emit an AieEvent.
 * The orgId field is the primary isolation boundary — it must ALWAYS
 * match the organization that owns the data in the payload.
 */
export interface AieEvent {
  /** Unique event ID (timestamp + counter) — used for deduplication and tracing */
  id: string;

  /**
   * Event type in dot-notation: "<domain>.<action>"
   * Examples: "crm.appointment_created", "time.clock_in", "accounting.invoice_paid"
   * Use EVENT_TYPES constants to avoid typos.
   */
  type: string;

  /** Organization that owns this event — MANDATORY, never omit */
  orgId: number;

  /** Internal user ID who triggered the event (null for system-generated events) */
  userId?: number;

  /** Clerk user ID (for cross-referencing with ACE context) */
  clerkUserId?: string;

  /** Module that emitted the event — aids debugging and handler routing */
  source: AieEventSource;

  /** Event-specific data. Each event type has its own payload shape. */
  payload: Record<string, unknown>;

  /** ISO-8601 UTC — when the underlying action occurred (not when emitted) */
  timestamp: string;

  /** ISO-8601 UTC — when emit() was called — may differ from timestamp */
  emittedAt: string;
}

export type AieEventSource =
  | "crm"
  | "appointments"
  | "accounting"
  | "marketing"
  | "tax"
  | "time"
  | "portal"
  | "autopilot"
  | "channels"
  | "auth"
  | "platform"
  | "system";

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * A function that reacts to an AieEvent.
 *
 * Rules for handler implementations:
 *  1. Always filter by event.orgId before querying the DB.
 *  2. Never emit new events (prevents infinite loops).
 *  3. Never throw — wrap logic in try/catch and log errors internally.
 *  4. Keep handlers fast — offload heavy work to the Action Engine.
 *  5. Returning a Promise is allowed; it will be awaited by the dispatcher.
 */
export type AieHandler = (event: AieEvent) => Promise<void> | void;

// ── Subscription ──────────────────────────────────────────────────────────────

/** Opaque handle returned by on(). Required to unsubscribe. */
export interface AieSubscription {
  readonly id:        string;
  readonly eventType: string;
  readonly handler:   AieHandler;
}

// ── Event Bus interface ───────────────────────────────────────────────────────

/**
 * The contract that every event bus implementation must fulfil.
 *
 * The default implementation is InternalEventBus (in-process Node EventEmitter).
 * A future Redis Pub/Sub or Kafka implementation would satisfy this same interface,
 * allowing a drop-in replacement without touching any handler or module code.
 */
export interface IEventBus {
  /**
   * Publish an event to all registered handlers.
   * Fire-and-forget from the caller: never throws, never blocks.
   */
  emit(event: AieEvent): void;

  /**
   * Subscribe a handler to a specific event type.
   * @param eventType - Exact event type string or "*" for all events.
   * @returns A subscription handle needed to unsubscribe.
   */
  on(eventType: string, handler: AieHandler): AieSubscription;

  /**
   * Subscribe to ALL events — useful for logging, metrics, and debugging.
   * Equivalent to on("*", handler).
   */
  onAny(handler: AieHandler): AieSubscription;

  /**
   * Remove a previously registered subscription.
   */
  off(subscription: AieSubscription): void;

  /**
   * Returns the number of active subscriptions (for diagnostics).
   */
  subscriptionCount(): number;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/** Registered handler entry used internally by the Dispatcher */
export interface AieHandlerRegistration {
  eventType:    string;           // exact type or "*"
  handler:      AieHandler;
  description:  string;           // human-readable, for debugging
  subscription: AieSubscription;
}

// ── Event metadata (used by the Event Registry) ────────────────────────────────

export interface AieEventMeta {
  type:        string;
  source:      AieEventSource;
  description: string;
  /** Expected payload fields for documentation purposes */
  payloadSchema: Record<string, string>;
}
