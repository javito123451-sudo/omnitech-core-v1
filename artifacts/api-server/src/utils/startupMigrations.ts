import { db, organizationsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Idempotent fixes that run once at server startup.
 * Safe to run multiple times — each check guards before writing.
 */
export async function runStartupMigrations(): Promise<void> {
  logger.info("[Migration] Running startup migrations…");

  try {
    // ── FIX 1: Rename org omnitech-x5mn9 → OmniTech Core / omnitech-core ─────
    const result = await db.execute(sql`
      UPDATE organizations
      SET name = 'OmniTech Core',
          slug = 'omnitech-core'
      WHERE slug = 'omnitech-x5mn9'
    `);
    const rows1 = (result as { rowCount?: number }).rowCount ?? 0;
    if (rows1 > 0) {
      logger.info(`[Migration] ✅ FIX-1: Renamed omnitech-x5mn9 → omnitech-core (${rows1} row)`);
    } else {
      logger.info("[Migration] FIX-1: omnitech-x5mn9 not found — already fixed or not needed");
    }

    // ── FIX 2: Ensure SUPER_ADMIN row exists for production owner ─────────────
    // In production javito's Clerk ID is user_3F1zAV5SAv6U5h8A583fNDEheSf
    const superAdminClerkIds = [
      "user_3F1zAV5SAv6U5h8A583fNDEheSf", // javito prod
      "user_3F0QXYl1n6KKCsKs7wxRYdgZKJe", // javito dev
    ];

    for (const clerkId of superAdminClerkIds) {
      // Check if user exists in this environment
      const users = await db.execute(sql`
        SELECT id, email FROM users WHERE clerk_id = ${clerkId} LIMIT 1
      `);
      const userRows = (users as { rows: Array<{id: number; email: string}> }).rows;
      if (userRows.length === 0) continue;

      const userEmail = userRows[0]?.email ?? "unknown";

      // Upsert platform_roles
      const upsert = await db.execute(sql`
        INSERT INTO platform_roles (clerk_user_id, role, display_name, email, is_active, granted_by, notes, created_at, updated_at)
        VALUES (
          ${clerkId},
          'SUPER_ADMIN',
          'Javier',
          ${userEmail},
          true,
          'startup-migration',
          'Auto-seeded on startup',
          NOW(),
          NOW()
        )
        ON CONFLICT (clerk_user_id) DO UPDATE
          SET is_active  = true,
              updated_at = NOW()
      `);
      const rows2 = (upsert as { rowCount?: number }).rowCount ?? 0;
      logger.info(`[Migration] ✅ FIX-2: SUPER_ADMIN upserted for ${userEmail} (${clerkId}) — ${rows2} row`);
    }

    logger.info("[Migration] ✅ All startup migrations complete");
  } catch (err) {
    logger.error({ err }, "[Migration] ❌ Startup migration failed — continuing anyway");
  }
}
