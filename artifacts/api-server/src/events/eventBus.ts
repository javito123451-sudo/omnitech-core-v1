// ═══════════════════════════════════════════════════════════════════════════
//  OmniTech Core — Internal Event Bus
//
//  Current implementation: in-process Node.js EventEmitter.
//  Future implementation: swap for KafkaEventBus (see interface IEventBus).
//
//  SWAP GUIDE (when adding Kafka):
//    1. Create KafkaEventBus implementing IEventBus.
//    2. In index.ts: replace `new InternalEventBus()` with `new KafkaEventBus(config)`.
//    3. Zero changes required in business logic.
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from "events";
import type { IEventBus, OmniEvent, OmniEventType, EventHandler } from "./types";

const WILDCARD = "*";

export class InternalEventBus implements IEventBus {
  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Prevent memory leak warnings in large deployments
    this.emitter.setMaxListeners(200);
  }

  publish(event: OmniEvent): void {
    // Emit to specific type subscribers
    this.emitter.emit(event.type, event);
    // Emit to wildcard subscribers (analytics, logging, etc.)
    this.emitter.emit(WILDCARD, event);
  }

  subscribe(eventType: OmniEventType | "*", handler: EventHandler): void {
    this.emitter.on(eventType, handler as (...args: unknown[]) => void);
  }

  unsubscribe(eventType: OmniEventType | "*", handler: EventHandler): void {
    this.emitter.off(eventType, handler as (...args: unknown[]) => void);
  }

  /** How many subscribers are listening for a given event type. */
  listenerCount(eventType: OmniEventType | "*"): number {
    return this.emitter.listenerCount(eventType);
  }
}
