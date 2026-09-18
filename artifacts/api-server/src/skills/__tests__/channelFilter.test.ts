// AVA's tool catalog must stay locked down on customer-facing channels
// (WhatsApp/Telegram talk to unauthenticated strangers). This is the fix from
// commit 08838d1 ("Punto 1: restrict AVA's tool catalog on WhatsApp/Telegram
// + escalate_to_human") — these tests exist so a future change can't
// silently widen the customer catalog back to the full internal one.
import { describe, it, expect } from "vitest";
import {
  getOpenAIFunctions,
  getOpenAIFunctionsForChannel,
  isSkillAllowedForChannel,
  listSkills,
} from "../index";

const CUSTOMER_ALLOWED = [
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "get_appointments",
  "escalate_to_human",
];

// Anything that touches accounting, full CRM read/write, quotes or tasks
// must never reach a customer channel — a jailbroken/confused model asking
// for one of these must be refused at the code level, not just by the
// prompt or the tool list we hand the LLM.
const MUST_STAY_INTERNAL_ONLY = [
  "create_client",
  "get_client_detail",
  "list_clients",
  "create_quote",
  "get_quotes",
  "create_invoice",
  "get_invoice",
  "list_pending_invoices",
  "register_payment",
  "get_client_debt",
  "get_monthly_income",
  "accounting_summary",
  "create_task",
  "get_tasks",
];

describe("AVA skill catalog — channel isolation", () => {
  it("the internal catalog contains every registered skill", () => {
    const allIds = listSkills().map((s) => s.id);
    const internalIds = getOpenAIFunctions().map((f) => f.function.name);
    expect(new Set(internalIds)).toEqual(new Set(allIds));
  });

  it("the customer catalog is exactly the 5 self-service appointment skills", () => {
    const customerIds = getOpenAIFunctionsForChannel("customer").map((f) => f.function.name);
    expect(new Set(customerIds)).toEqual(new Set(CUSTOMER_ALLOWED));
  });

  it.each(CUSTOMER_ALLOWED)("isSkillAllowedForChannel allows '%s' on customer channels", (id) => {
    expect(isSkillAllowedForChannel(id, "customer")).toBe(true);
  });

  it.each(MUST_STAY_INTERNAL_ONLY)(
    "isSkillAllowedForChannel rejects '%s' on customer channels",
    (id) => {
      expect(isSkillAllowedForChannel(id, "customer")).toBe(false);
    },
  );

  it("isSkillAllowedForChannel allows every registered skill on the internal channel", () => {
    for (const skill of listSkills()) {
      expect(isSkillAllowedForChannel(skill.id, "internal")).toBe(true);
    }
  });

  it("a made-up / hallucinated tool name is rejected on customer channels", () => {
    expect(isSkillAllowedForChannel("delete_all_clients", "customer")).toBe(false);
  });
});
