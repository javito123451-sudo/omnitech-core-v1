// The single most important guarantee of this phase: Ava Super Admin must
// only ever be granted to a real SUPER_ADMIN — never to STAFF_OMNITECH (who
// DOES get req.isSuperAdmin=true elsewhere in the app, which is exactly the
// trap this router was written to avoid — see contextRouter.ts's comment),
// and never to a plain workspace user just because the client asked for it.
//
// Requires a real disposable database in DATABASE_URL — same ci-test branch
// used by the other integration tests. Skips cleanly otherwise.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { db, platformRolesTable, organizationsTable } from "@workspace/db";
import { resolveAvaContext, AvaContextRouterError } from "../contextRouter";
import { clearRoleCache } from "../../middlewares/superAdmin";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const cleanupClerkIds: string[] = [];

function fakeReq(overrides: Partial<Request>): Request {
  return overrides as Request;
}

describe.skipIf(!hasRealDb)("Ava Core — context router", () => {
  afterAll(async () => {
    for (const clerkId of cleanupClerkIds) {
      await db.delete(platformRolesTable).where(eq(platformRolesTable.clerkUserId, clerkId));
    }
  });

  async function firstOrgId(): Promise<number> {
    const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(1);
    if (!org) throw new Error("Test database has no organizations — seed one before running this test.");
    return org.id;
  }

  async function grantPlatformRole(role: "SUPER_ADMIN" | "STAFF_OMNITECH"): Promise<string> {
    const clerkId = `smoke-ava-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await db.insert(platformRolesTable).values({ clerkUserId: clerkId, role, isActive: true });
    clearRoleCache(clerkId);
    cleanupClerkIds.push(clerkId);
    return clerkId;
  }

  it("grants super_admin context to a real SUPER_ADMIN", async () => {
    const orgId = await firstOrgId();
    const clerkId = await grantPlatformRole("SUPER_ADMIN");
    const ctx = await resolveAvaContext(
      fakeReq({ clerkUserId: clerkId, userId: 1, orgId, orgRole: "member" }),
      "super_admin",
    );
    expect(ctx.type).toBe("super_admin");
  });

  it("rejects super_admin context for STAFF_OMNITECH, even though it gets req.isSuperAdmin=true elsewhere in the app", async () => {
    const orgId = await firstOrgId();
    const clerkId = await grantPlatformRole("STAFF_OMNITECH");
    await expect(
      resolveAvaContext(fakeReq({ clerkUserId: clerkId, userId: 1, orgId, orgRole: "member" }), "super_admin"),
    ).rejects.toThrow(AvaContextRouterError);
  });

  it("rejects super_admin context for a user with no platform role at all", async () => {
    const orgId = await firstOrgId();
    await expect(
      resolveAvaContext(
        fakeReq({ clerkUserId: `smoke-ava-none-${Date.now()}`, userId: 1, orgId, orgRole: "owner" }),
        "super_admin",
      ),
    ).rejects.toThrow(AvaContextRouterError);
  });

  it("grants crm context to any authenticated, org-scoped user regardless of platform role", async () => {
    const orgId = await firstOrgId();
    const ctx = await resolveAvaContext(
      fakeReq({ clerkUserId: `smoke-ava-crm-${Date.now()}`, userId: 1, orgId, orgRole: "member" }),
    );
    expect(ctx.type).toBe("crm");
  });

  it("throws when there is no resolved org/user session at all", async () => {
    await expect(resolveAvaContext(fakeReq({}))).rejects.toThrow(AvaContextRouterError);
  });
});
