/**
 * Connector runtime events — internal lifecycle/execution events (distinct
 * from ParsedEvent, which is a provider webhook normalized into a business event).
 *
 * Mirrors the IEventBus seam documented in .agents/memory/event-bus.md
 * (publish/subscribe/unsubscribe) so the app layer can wire this into the
 * real InternalEventBus / future KafkaEventBus without connector-core ever
 * importing that package directly (Core never imports app-layer code either).
 */

export type ConnectorRuntimeEventType =
  | "connector.installed"
  | "connector.uninstalled"
  | "connector.action.started"
  | "connector.action.completed"
  | "connector.action.failed"
  | "connector.health.changed";

export interface ConnectorRuntimeEvent {
  type: ConnectorRuntimeEventType;
  orgId: number;
  connectorSlug: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type ConnectorRuntimeEventHandler = (event: ConnectorRuntimeEvent) => void;

export interface IConnectorEventBus {
  publish(event: ConnectorRuntimeEvent): void;
  subscribe(type: ConnectorRuntimeEventType, handler: ConnectorRuntimeEventHandler): () => void;
  unsubscribe(type: ConnectorRuntimeEventType, handler: ConnectorRuntimeEventHandler): void;
}

/** Default in-process bus. Swap point for the app layer to bridge into the real eventBus singleton. */
export class InternalConnectorEventBus implements IConnectorEventBus {
  private handlers = new Map<ConnectorRuntimeEventType, Set<ConnectorRuntimeEventHandler>>();

  publish(event: ConnectorRuntimeEvent): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    // Fire-and-forget semantics: never throws, never blocks the caller.
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // Swallow — a misbehaving subscriber must never break connector execution.
      }
    }
  }

  subscribe(type: ConnectorRuntimeEventType, handler: ConnectorRuntimeEventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.unsubscribe(type, handler);
  }

  unsubscribe(type: ConnectorRuntimeEventType, handler: ConnectorRuntimeEventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }
}

export function makeConnectorEvent(
  type: ConnectorRuntimeEventType,
  orgId: number,
  connectorSlug: string,
  payload: Record<string, unknown> = {},
): ConnectorRuntimeEvent {
  return { type, orgId, connectorSlug, payload, occurredAt: new Date().toISOString() };
}
