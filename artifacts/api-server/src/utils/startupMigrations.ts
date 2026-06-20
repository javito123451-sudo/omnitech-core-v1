import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Idempotent startup migrations — run once per deploy.
 * Each step checks before writing — safe to re-run.
 */
export async function runStartupMigrations(): Promise<void> {
  logger.info("[Migration] Running startup migrations…");

  try {
    // ── FIX A: Rename org 7 to OmniTech Core / omnitech-core ───────────────
    const renamed = await db.execute(sql`
      UPDATE organizations
      SET name = 'OmniTech Core', slug = 'omnitech-core'
      WHERE id = 7 AND slug != 'omnitech-core'
    `);
    if ((renamed as { rowCount?: number }).rowCount ?? 0 > 0) {
      logger.info("[Migration] ✅ FIX-A: Org 7 renamed → OmniTech Core / omnitech-core");
    }

    // ── FIX B: SUPER_ADMIN for both Clerk IDs of javito ────────────────────
    const superAdmins = [
      { clerkId: "user_3F1zAV5SAv6U5h8A583fNDEheSf", email: "javito123451@gmail.com" }, // prod
      { clerkId: "user_3F0QXYl1n6KKCsKs7wxRYdgZKJe", email: "javito123451@gmail.com" }, // dev
    ];
    for (const { clerkId, email } of superAdmins) {
      const exists = await db.execute(sql`SELECT 1 FROM users WHERE clerk_id = ${clerkId} LIMIT 1`);
      if ((exists as { rows: unknown[] }).rows.length === 0) continue;
      await db.execute(sql`
        INSERT INTO platform_roles (clerk_user_id, role, display_name, email, is_active, granted_by, notes, created_at, updated_at)
        VALUES (${clerkId}, 'SUPER_ADMIN', 'Javier', ${email}, true, 'startup-migration', 'Auto-seeded', NOW(), NOW())
        ON CONFLICT (clerk_user_id) DO UPDATE SET is_active = true, updated_at = NOW()
      `);
      logger.info(`[Migration] ✅ FIX-B: SUPER_ADMIN upserted for ${email}`);
    }

    // ── FIX C: Missing membership — a3servicio@gmail.com → A3SERVICIOS ─────
    // User registered but org_members record was never created by POST /workspaces
    const missingMemberships = [
      { email: "a3servicio@gmail.com", orgId: 12, role: "owner" },
    ];
    for (const { email, orgId, role } of missingMemberships) {
      const userResult = await db.execute(sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
      const userRows = (userResult as { rows: Array<{id: number}> }).rows;
      if (userRows.length === 0) continue;

      const userId = userRows[0]!.id;
      const already = await db.execute(sql`
        SELECT 1 FROM org_members WHERE user_id = ${userId} AND org_id = ${orgId} LIMIT 1
      `);
      if ((already as { rows: unknown[] }).rows.length > 0) {
        logger.info(`[Migration] FIX-C: membership ${email}→org${orgId} already exists`);
        continue;
      }

      await db.execute(sql`
        INSERT INTO org_members (org_id, user_id, role, joined_at, is_suspended)
        VALUES (${orgId}, ${userId}, ${role}, NOW(), false)
      `);
      logger.info(`[Migration] ✅ FIX-C: Created membership ${email} → org_id=${orgId} (${role})`);
    }

    logger.info("[Migration] ✅ All startup migrations complete");
  } catch (err) {
    logger.error({ err }, "[Migration] ❌ Startup migration failed — continuing anyway");
  }
}
