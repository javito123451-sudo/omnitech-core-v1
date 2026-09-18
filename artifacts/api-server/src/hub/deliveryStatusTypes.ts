/**
 * Omni Fleet — Delivery Status Provider contract.
 *
 * Deliberately NOT part of IntegrationAdapter (types.ts): that contract is
 * shaped around conversational messaging (send/receive a text message to a
 * person). A delivery-app status push is structured data about a delivery
 * (which one, what status, when) — forcing it into
 * SendMessagePayload/ReceiveMessagePayload would mean stuffing JSON into a
 * "message: string" field. This is a narrower, additive sibling contract
 * that reuses the same registration spirit (adapters register themselves,
 * looked up by slug) and the same storage (org_integrations, integration_events)
 * — see routes/fleet.ts and hub/deliveryProviderRegistry.ts.
 *
 * We never build our own GPS tracking. The client's drivers already use
 * some delivery app; that app pushes status changes to our webhook, one
 * DeliveryStatusProvider per app translates its payload shape into this
 * canonical one.
 */

export type DeliveryStatus = "en_route" | "delivered" | "failed" | "incident";

export interface DeliveryStatusUpdate {
  /** Matches fleet_deliveries.externalDeliveryId for this org. */
  externalDeliveryId: string;
  status:             DeliveryStatus;
  occurredAt?:        string; // ISO timestamp; defaults to "now" if omitted
  note?:               string;
  driverExternalId?:   string;
  lat?:                number;
  lng?:                number;
}

export interface DeliveryStatusProvider {
  /** Unique slug, stored in org_integrations.config.providerSlug. */
  slug:        string;
  displayName: string;

  /**
   * Parse a raw webhook body (already JSON-parsed) from this specific
   * delivery app into 0, 1 or many canonical updates. Return an empty array
   * (not an error) for payloads that are valid but not delivery-status
   * events for us (e.g. a ping/health-check the app also sends).
   */
  parseUpdate(rawPayload: unknown, headers: Record<string, string>): DeliveryStatusUpdate[];
}
