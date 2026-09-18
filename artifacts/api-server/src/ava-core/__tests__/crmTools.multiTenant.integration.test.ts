// Ava CRM must never leak one workspace's data into another's answer, no
// matter what the model is tricked into asking. These tools take orgId only
// from the backend-resolved AvaContext (see engine.ts / contextRouter.ts),
// never from the model's tool-call arguments — this test proves that at the
// data layer for the two entities Ava CORE adds a new reader for
// (get_tasks via the Skill Engine, get_activity via a new direct query).
//
// Requires a real disposable database in DATABASE_URL — same ci-test branch
// used by the other integration tests. Skips cleanly otherwise.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, organizationsTable, tasksTable, activityTable } from "@workspace/db";
import { CRM_TOOLS } from "../tools/crmTools";
import type { AvaContext } from "../types";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const cleanupTaskIds: number[] = [];
const cleanupActivityIds: number[] = [];

function ctxFor(orgId: number): AvaContext {
  return { type: "crm", orgId, userId: 1, clerkUserId: "smoke-crm-tools", orgRole: "member", platformRole: null };
}

function findTool(name: string) {
  const tool = CRM_TOOLS.find(t => t.definition.function.name === name);
  if (!tool) throw new Error(`Tool '${name}' not found in CRM_TOOLS`);
  return tool;
}

describe.skipIf(!hasRealDb)("Ava Core — CRM tools multi-tenant isolation", () => {
  afterAll(async () => {
    for (const id of cleanupTaskIds) await db.delete(tasksTable).where(eq(tasksTable.id, id));
    for (const id of cleanupActivityIds) await db.delete(activityTable).where(eq(activityTable.id, id));
  });

  async function twoOrgIds(): Promise<[number, number]> {
    const orgs = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(2);
    if (orgs.length < 2) throw new Error("Test database needs at least 2 organizations — seed them before running this test.");
    return [orgs[0]!.id, orgs[1]!.id];
  }

  it("get_tasks only returns tasks belonging to the requesting org", async () => {
    const [orgA, orgB] = await twoOrgIds();
    const marker = `smoke-ava-task-${Date.now()}`;
    const [taskA] = await db.insert(tasksTable).values({ orgId: orgA, title: marker }).returning();
    cleanupTaskIds.push(taskA!.id);

    const tool = findTool("get_tasks");
    const resultForA = await tool.execute({ status: "all" }, ctxFor(orgA)) as { tasks: Array<{ title: string }> };
    expect(resultForA.tasks.some(t => t.title === marker)).toBe(true);

    const resultForB = await tool.execute({ status: "all" }, ctxFor(orgB)) as { tasks: Array<{ title: string }> };
    expect(resultForB.tasks.some(t => t.title === marker)).toBe(false);
  });

  it("get_activity only returns activity belonging to the requesting org", async () => {
    const [orgA, orgB] = await twoOrgIds();
    const marker = `smoke-ava-activity-${Date.now()}`;
    const [row] = await db.insert(activityTable).values({ orgId: orgA, type: "smoke_test", description: marker }).returning();
    cleanupActivityIds.push(row!.id);

    const tool = findTool("get_activity");
    const resultForA = await tool.execute({ limit: 50 }, ctxFor(orgA)) as Array<{ description: string }>;
    expect(resultForA.some(a => a.description === marker)).toBe(true);

    const resultForB = await tool.execute({ limit: 50 }, ctxFor(orgB)) as Array<{ description: string }>;
    expect(resultForB.some(a => a.description === marker)).toBe(false);
  });
});
