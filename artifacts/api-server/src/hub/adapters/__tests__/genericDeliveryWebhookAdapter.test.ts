import { describe, it, expect } from "vitest";
import genericDeliveryWebhookAdapter from "../genericDeliveryWebhookAdapter";

describe("genericDeliveryWebhookAdapter.parseUpdate", () => {
  it("parses a single canonical update", () => {
    const updates = genericDeliveryWebhookAdapter.parseUpdate(
      { delivery_id: "ABC123", status: "delivered", occurred_at: "2026-09-18T10:00:00Z", note: "left at door" },
      {},
    );
    expect(updates).toEqual([{
      externalDeliveryId: "ABC123",
      status: "delivered",
      occurredAt: "2026-09-18T10:00:00Z",
      note: "left at door",
      driverExternalId: undefined,
      lat: undefined,
      lng: undefined,
    }]);
  });

  it("parses a batch under `updates`", () => {
    const updates = genericDeliveryWebhookAdapter.parseUpdate(
      { updates: [{ delivery_id: "A", status: "en_route" }, { delivery_id: "B", status: "failed" }] },
      {},
    );
    expect(updates.map((u) => [u.externalDeliveryId, u.status])).toEqual([["A", "en_route"], ["B", "failed"]]);
  });

  it("maps common status synonyms to the canonical set", () => {
    const cases: Array<[string, string]> = [
      ["out_for_delivery", "en_route"], ["picked_up", "en_route"],
      ["completed", "delivered"], ["success", "delivered"],
      ["not_delivered", "failed"], ["returned", "failed"],
      ["exception", "incident"], ["delayed", "incident"],
    ];
    for (const [input, expected] of cases) {
      const [update] = genericDeliveryWebhookAdapter.parseUpdate({ delivery_id: "X", status: input }, {});
      expect(update?.status).toBe(expected);
    }
  });

  it("drops entries with no delivery id or an unrecognized status", () => {
    expect(genericDeliveryWebhookAdapter.parseUpdate({ status: "delivered" }, {})).toEqual([]);
    expect(genericDeliveryWebhookAdapter.parseUpdate({ delivery_id: "X", status: "made_up" }, {})).toEqual([]);
  });

  it("returns [] for a non-object payload instead of throwing", () => {
    expect(genericDeliveryWebhookAdapter.parseUpdate(null, {})).toEqual([]);
    expect(genericDeliveryWebhookAdapter.parseUpdate("not json", {})).toEqual([]);
  });
});
