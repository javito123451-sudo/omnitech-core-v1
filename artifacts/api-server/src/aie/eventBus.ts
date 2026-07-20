/**
 * AIE — Internal Event Bus
 *
 * In-process event bus backed by Node.js EventEmitter.
 *
 * Design decisions:
 *  - EventEmitter is battle-tested, dependency-free, and synchronous.
 *    emit() dispatches to all listeners synchronously (Node guarantees this).
 *  - Handlers that return a Promise are NOT awaited — they run concurrently
 *    and are fire-and-forget from the emitter's perspective.
 *  - Errors inside handlers are caught and logged, NEVER propagated to
 *    the emitter (an invoice route must never crash because a handler failed).
 *  - Wildcard ("*") listeners receive every event regardless of type.
 *  - subscriptionCount() is exposed for diagnostics and health checks.
 *
 * Future scalability:
 *  - If horizontal scaling requires multi-process event distribution,
 *    replace InternalEventBus with a Redis Pub/Sub adapter that satisfies
 *    the same IEventBus interface. No handler or module code changes.
 */

import EventEmitter from "node:events";
import type { IEventBus, AieEvent, AieHandler, AieSubscription } from "./types";

// ── ID generator — simple timestamp + counter (no external dep) ───────────────

let _seq = 0;
function nextSubscriptionId(): string {
  return `sub_${Date.now()}_${(++_seq).toString(36)}`;
}

// ── Internal event bus implementation ────────────────────────────────────────

class InternalEventBus implements IEventBus {
  private readonly _emitter: EventEmitter;
  private readonly _subscriptions = new Map<string, AieSubscription>();

  constructor() {
    this._emitter = new EventEmitter();
    // Increase the default max listeners to avoid Node.js warnings
    // when many handlers subscribe to the same event type.
    this._emitter.setMaxListeners(100);
  }

  // ── emit ─────────────────────────────────────────────────────────────────

  emit(event: AieEvent): void {
    // Dispatch to exact-type listeners
    this._emitter.emit(event.type, event);
    // Dispatch to wildcard listeners (if any, and only if the type isn't "*")
    if (event.type !== "*") {
      this._emitter.emit("*", event);
    }
  }

  // ── on ───────────────────────────────────────────────────────────────────

  on(eventType: string, handler: AieHandler): AieSubscription {
    const id = nextSubscriptionId();

    // Wrap the handler to catch errors and prevent crashes in the emitter.
    const safeListener = (event: AieEvent) => {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            console.error(
              `[AIE] Handler error for event "${event.type}" (sub: ${id}):`,
              err,
            );
          });
        }
      } catch (err) {
        console.error(
          `[AIE] Sync handler error for event "${event.type}" (sub: ${id}):`,
          err,
        );
      }
    };

    this._emitter.on(eventType, safeListener);

    const subscription: AieSubscription = {
      id,
      eventType,
      handler,
      // Store the wrapped listener so we can remove it precisely via off()
      // We cast to allow storing the wrapped reference on the sub object.
    } as AieSubscription & { _listener: typeof safeListener };

    // Attach the wrapped listener to the subscription object for off()
    (subscription as AieSubscription & { _listener: typeof safeListener })._listener = safeListener;

    this._subscriptions.set(id, subscription);
    return subscription;
  }

  // ── onAny ─────────────────────────────────────────────────────────────────

  onAny(handler: AieHandler): AieSubscription {
    return this.on("*", handler);
  }

  // ── off ──────────────────────────────────────────────────────────────────

  off(subscription: AieSubscription): void {
    const sub = this._subscriptions.get(subscription.id);
    if (!sub) return;

    const listener = (sub as AieSubscription & { _listener?: (e: AieEvent) => void })._listener;
    if (listener) {
      this._emitter.off(sub.eventType, listener);
    }
    this._subscriptions.delete(subscription.id);
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────

  subscriptionCount(): number {
    return this._subscriptions.size;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────
// One shared bus for the entire process lifetime.
// Modules import { aieEventBus } and call emit() directly.

export const aieEventBus = new InternalEventBus();
