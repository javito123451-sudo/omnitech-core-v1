import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Idempotent startup migrations — run once per deploy.
 * Safe to re-run: every step checks before writing.
 */
export async function runStartupMigrations(): Promise<void> {
  logger.info("[Migration] Running startup migrations…");

  try {
    // ── GUARD: skip if cleanup already done ─────────────────────────────────
    const orgCount = await db.execute(sql`SELECT COUNT(*) AS n FROM organizations WHERE id != 7`);
    const remaining = Number((orgCount as { rows: Array<{n: string}> }).rows[0]?.n ?? 0);

    if (remaining === 0) {
      logger.info("[Migration] Cleanup already applied — skipping bulk delete");
    } else {
      logger.info(`[Migration] Found ${remaining} orgs to purge — starting cleanup…`);

      // ── Step 1: quote_items (FK → quotes) ───────────────────────────────
      await db.execute(sql`
        DELETE FROM quote_items
        WHERE quote_id IN (SELECT id FROM quotes WHERE org_id != 7)
      `);

      // ── Step 2: messages (FK → clients, org_id) ─────────────────────────
      await db.execute(sql`DELETE FROM messages WHERE org_id != 7`);

      // ── Step 3: appointments (FK → clients, org_id) ──────────────────────
      await db.execute(sql`DELETE FROM appointments WHERE org_id != 7`);

      // ── Step 4: quotes (FK → clients, org_id) ───────────────────────────
      await db.execute(sql`DELETE FROM quotes WHERE org_id != 7`);

      // ── Step 5: clients ──────────────────────────────────────────────────
      await db.execute(sql`DELETE FROM clients WHERE org_id != 7`);

      // ── Step 6: activity ─────────────────────────────────────────────────
      await db.execute(sql`DELETE FROM activity WHERE org_id != 7`);

      // ── Step 7: agent_memory ─────────────────────────────────────────────
      await db.execute(sql`DELETE FROM agent_memory WHERE org_id != 7`);

      // ── Step 8: ai_usage_logs ────────────────────────────────────────────
      await db.execute(sql`DELETE FROM ai_usage_logs WHERE org_id != 7`);

      // ── Step 9: ai_sessions (FK → users too) ────────────────────────────
      await db.execute(sql`
        DELETE FROM ai_sessions
        WHERE org_id != 7
           OR user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = 7)
      `);

      // ── Step 10: ai_budgets ──────────────────────────────────────────────
      await db.execute(sql`DELETE FROM ai_budgets WHERE org_id != 7`);

      // ── Step 11: import_jobs ─────────────────────────────────────────────
      await db.execute(sql`DELETE FROM import_jobs WHERE org_id != 7`);

      // ── Step 12: integration_events ──────────────────────────────────────
      await db.execute(sql`DELETE FROM integration_events WHERE org_id != 7`);

      // ── Step 13: knowledge_base ──────────────────────────────────────────
      await db.execute(sql`DELETE FROM knowledge_base WHERE org_id != 7`);

      // ── Step 14: license_plans ───────────────────────────────────────────
      await db.execute(sql`DELETE FROM license_plans WHERE org_id != 7`);

      // ── Step 15: module_configs ──────────────────────────────────────────
      await db.execute(sql`DELETE FROM module_configs WHERE org_id != 7`);

      // ── Step 16: org_integrations — keep only org 7 ─────────────────────
      await db.execute(sql`DELETE FROM org_integrations WHERE org_id != 7`);

      // ── Step 17: org_invitations ─────────────────────────────────────────
      await db.execute(sql`DELETE FROM org_invitations WHERE org_id != 7`);

      // ── Step 18: audit_logs (no FK constraint but has org_id) ───────────
      await db.execute(sql`DELETE FROM audit_logs WHERE org_id IS NOT NULL AND org_id != 7`);

      // ── Step 19: backup_jobs ─────────────────────────────────────────────
      await db.execute(sql`DELETE FROM backup_jobs WHERE org_id IS NOT NULL AND org_id != 7`);

      // ── Step 20: memory_history ──────────────────────────────────────────
      await db.execute(sql`DELETE FROM memory_history WHERE org_id IS NOT NULL AND org_id != 7`);

      // ── Step 21: org_members — remove from all non-7 orgs ───────────────
      await db.execute(sql`DELETE FROM org_members WHERE org_id != 7`);

      // ── Step 22: organizations — keep only id=7 ──────────────────────────
      await db.execute(sql`DELETE FROM organizations WHERE id != 7`);

      // ── Step 23: users — keep only those belonging to org 7 ─────────────
      await db.execute(sql`
        DELETE FROM users
        WHERE id NOT IN (SELECT user_id FROM org_members WHERE org_id = 7)
      `);

      logger.info("[Migration] ✅ Bulk cleanup complete");
    }

    // ── FIX A: Rename org 7 to OmniTech Core / omnitech-core ───────────────
    const renamed = await db.execute(sql`
      UPDATE organizations
      SET name = 'OmniTech Core', slug = 'omnitech-core'
      WHERE id = 7 AND slug != 'omnitech-core'
    `);
    const renamedRows = (renamed as { rowCount?: number }).rowCount ?? 0;
    if (renamedRows > 0) {
      logger.info("[Migration] ✅ FIX-A: Org renamed → OmniTech Core / omnitech-core");
    }

    // ── FIX B: Ensure SUPER_ADMIN for both known Clerk IDs of javito ────────
    const superAdmins = [
      { clerkId: "user_3F1zAV5SAv6U5h8A583fNDEheSf", email: "javito123451@gmail.com" }, // prod
      { clerkId: "user_3F0QXYl1n6KKCsKs7wxRYdgZKJe", email: "javito123451@gmail.com" }, // dev
    ];

    for (const { clerkId, email } of superAdmins) {
      const userExists = await db.execute(sql`
        SELECT 1 FROM users WHERE clerk_id = ${clerkId} LIMIT 1
      `);
      if ((userExists as { rows: unknown[] }).rows.length === 0) continue;

      await db.execute(sql`
        INSERT INTO platform_roles
          (clerk_user_id, role, display_name, email, is_active, granted_by, notes, created_at, updated_at)
        VALUES
          (${clerkId}, 'SUPER_ADMIN', 'Javier', ${email}, true, 'startup-migration', 'Auto-seeded', NOW(), NOW())
        ON CONFLICT (clerk_user_id)
        DO UPDATE SET is_active = true, updated_at = NOW()
      `);
      logger.info(`[Migration] ✅ FIX-B: SUPER_ADMIN upserted for ${email} (${clerkId})`);
    }

    logger.info("[Migration] ✅ All startup migrations complete");
  } catch (err) {
    logger.error({ err }, "[Migration] ❌ Startup migration failed — continuing anyway");
  }
}
