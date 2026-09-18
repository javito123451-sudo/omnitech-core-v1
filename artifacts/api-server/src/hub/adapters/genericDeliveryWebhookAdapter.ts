/**
 * Generic Delivery Webhook adapter — the reference / default
 * DeliveryStatusProvider. Accepts a simple canonical JSON shape directly,
 * for delivery apps that can be configured to POST arbitrary JSON (most
 * route-planning/delivery apps let you set a custom webhook URL + payload
 * template — this is the shape to configure them with):
 *
 *   { "delivery_id": "ABC123", "status": "delivered", "occurred_at": "...", "note": "..." }
 *
 * or a batch: { "updates": [ {...}, {...} ] }
 *
 * `status` accepts a few common synonyms per app (see STATUS_MAP) so the
 * client doesn't need custom templating on their end.
 *
 * A specific named delivery app with its own, different payload shape gets
 * its own adapter file implementing the same DeliveryStatusProvider
 * interface, registered the same way — routes/fleet.ts and the org's
 * chosen `providerSlug` never change.
 */
import { DeliveryProviderRegistry } from "../deliveryProviderRegistry";
import type { DeliveryStatusProvider, DeliveryStatusUpdate, DeliveryStatus } from "../deliveryStatusTypes";

const STATUS_MAP: Record<string, DeliveryStatus> = {
  en_route: "en_route", in_transit: "en_route", out_for_delivery: "en_route", picked_up: "en_route",
  delivered: "delivered", completed: "delivered", success: "delivered",
  failed: "failed", not_delivered: "failed", returned: "failed",
  incident: "incident", exception: "incident", problem: "incident", delayed: "incident",
};

function normalizeStatus(raw: unknown): DeliveryStatus | null {
  if (typeof raw !== "string") return null;
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

function parseOne(item: Record<string, unknown>): DeliveryStatusUpdate | null {
  const externalDeliveryId = item["delivery_id"] ?? item["deliveryId"] ?? item["id"];
  const status = normalizeStatus(item["status"]);
  if (typeof externalDeliveryId !== "string" || !externalDeliveryId.trim() || !status) return null;

  return {
    externalDeliveryId: externalDeliveryId.trim(),
    status,
    occurredAt:       typeof item["occurred_at"] === "string" ? item["occurred_at"] : undefined,
    note:             typeof item["note"] === "string" ? item["note"] : undefined,
    driverExternalId: typeof item["driver_id"] === "string" ? item["driver_id"] : undefined,
    lat:              typeof item["lat"] === "number" ? item["lat"] : undefined,
    lng:              typeof item["lng"] === "number" ? item["lng"] : undefined,
  };
}

const genericDeliveryWebhookAdapter: DeliveryStatusProvider = {
  slug: "generic",
  displayName: "Genérico (JSON personalizado)",

  parseUpdate(rawPayload: unknown): DeliveryStatusUpdate[] {
    if (!rawPayload || typeof rawPayload !== "object") return [];
    const body = rawPayload as Record<string, unknown>;

    const items = Array.isArray(body["updates"]) ? (body["updates"] as unknown[]) : [body];
    const parsed = items
      .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
      .map(parseOne)
      .filter((u): u is DeliveryStatusUpdate => u !== null);

    return parsed;
  },
};

DeliveryProviderRegistry.register(genericDeliveryWebhookAdapter);

export default genericDeliveryWebhookAdapter;
