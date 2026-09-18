// The confirmation store is what stands between "Ava proposed a write" and
// "the write actually happened". These tests exist so a future change can't
// silently turn a confirmation into a trust-the-frontend boolean: a token
// must be single-use, scoped to the exact org+user that requested it, and
// expire.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createProposal, consumeProposal } from "../actions/confirmationStore";

describe("Ava Core — confirmation store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("consumes a valid token exactly once", () => {
    const { token } = createProposal("create_task", { title: "Llamar a Juan" }, 1, 10);
    const first = consumeProposal(token, 1, 10);
    expect(first).not.toBeNull();
    expect(first!.actionId).toBe("create_task");
    expect(first!.params).toEqual({ title: "Llamar a Juan" });

    const second = consumeProposal(token, 1, 10);
    expect(second).toBeNull();
  });

  it("rejects a token replayed against a different org or user (manipulated/borrowed confirmation)", () => {
    const { token: tokenWrongOrg }  = createProposal("create_task", { title: "X" }, 1, 10);
    expect(consumeProposal(tokenWrongOrg, 2, 10)).toBeNull();

    const { token: tokenWrongUser } = createProposal("create_task", { title: "X" }, 1, 10);
    expect(consumeProposal(tokenWrongUser, 1, 99)).toBeNull();
  });

  it("rejects an unknown / made-up token", () => {
    expect(consumeProposal("not-a-real-token", 1, 10)).toBeNull();
  });

  it("expires a proposal after its TTL", () => {
    vi.useFakeTimers();
    const { token } = createProposal("create_task", { title: "X" }, 1, 10);
    vi.advanceTimersByTime(6 * 60 * 1000); // TTL is 5 minutes
    expect(consumeProposal(token, 1, 10)).toBeNull();
  });
});
