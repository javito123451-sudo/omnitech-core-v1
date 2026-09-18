// The create_task pilot must reject an unprivileged proposal in the action
// layer itself — not rely on the model "choosing" not to call it, and not
// rely only on the tool list the LLM was handed. Pure unit test: propose()
// never touches the database.
import { describe, it, expect } from "vitest";
import { createTaskAction } from "../actions/createTaskAction";
import type { AvaContext } from "../types";

function ctx(overrides: Partial<AvaContext>): AvaContext {
  return {
    type: "crm", orgId: 1, userId: 10, clerkUserId: "user_test", orgRole: "member", platformRole: null,
    ...overrides,
  };
}

describe("Ava Core — create_task action (propose)", () => {
  it("a read_only workspace role cannot propose the action", async () => {
    await expect(createTaskAction.propose({ title: "Llamar a Juan" }, ctx({ orgRole: "read_only" })))
      .rejects.toThrow(/crm\.write/);
  });

  it("a workspace role with crm.write (e.g. member) can propose it", async () => {
    const { summary, params } = await createTaskAction.propose(
      { title: "Llamar a Juan", due_date: "2026-09-20", assigned_to: "Fran" },
      ctx({ orgRole: "member" }),
    );
    expect(summary).toContain("Llamar a Juan");
    expect(summary).toContain("¿Quieres que la cree?");
    expect(params.title).toBe("Llamar a Juan");
  });

  it("a real platform SUPER_ADMIN bypasses the workspace role check", async () => {
    const { params } = await createTaskAction.propose(
      { title: "Revisar incidencia" },
      ctx({ orgRole: "read_only", platformRole: "SUPER_ADMIN" }),
    );
    expect(params.title).toBe("Revisar incidencia");
  });

  it("rejects a proposal with no title", async () => {
    await expect(createTaskAction.propose({}, ctx({ orgRole: "owner" })))
      .rejects.toThrow(/título/i);
  });
});
