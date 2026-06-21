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

    // ── FIX D: Accounting tables ─────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invoices (
        id              SERIAL PRIMARY KEY,
        org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        quote_id        INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
        invoice_number  VARCHAR(50) NOT NULL,
        status          VARCHAR(30) NOT NULL DEFAULT 'draft',
        currency        VARCHAR(10) NOT NULL DEFAULT 'EUR',
        subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 21,
        tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
        total           NUMERIC(12,2) NOT NULL DEFAULT 0,
        notes           TEXT,
        due_date        TIMESTAMP,
        paid_at         TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_org_id_idx    ON invoices(org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_client_id_idx ON invoices(client_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_status_idx    ON invoices(status)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id          SERIAL PRIMARY KEY,
        invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT    NOT NULL,
        quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
        total       NUMERIC(12,2) NOT NULL DEFAULT 0,
        order_index INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON invoice_items(invoice_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accounting_payments (
        id          SERIAL PRIMARY KEY,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        invoice_id  INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        amount      NUMERIC(12,2) NOT NULL,
        currency    VARCHAR(10) NOT NULL DEFAULT 'EUR',
        method      VARCHAR(50) NOT NULL DEFAULT 'transfer',
        reference   VARCHAR(200),
        notes       TEXT,
        paid_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS payments_org_id_idx     ON accounting_payments(org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON accounting_payments(invoice_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id          SERIAL PRIMARY KEY,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        invoice_id  INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        note_number VARCHAR(50) NOT NULL,
        amount      NUMERIC(12,2) NOT NULL,
        currency    VARCHAR(10) NOT NULL DEFAULT 'EUR',
        reason      TEXT,
        status      VARCHAR(30) NOT NULL DEFAULT 'issued',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS credit_notes_org_id_idx ON credit_notes(org_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id             SERIAL PRIMARY KEY,
        org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        category       VARCHAR(100) NOT NULL DEFAULT 'general',
        description    TEXT NOT NULL,
        amount         NUMERIC(12,2) NOT NULL,
        currency       VARCHAR(10)  NOT NULL DEFAULT 'EUR',
        vendor         VARCHAR(200),
        expense_date   TIMESTAMP NOT NULL DEFAULT NOW(),
        receipt_url    TEXT,
        tax_deductible BOOLEAN NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expenses_org_id_idx   ON expenses(org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses(category)`);

    logger.info("[Migration] ✅ FIX-D: Accounting tables ensured");

    // ── FIX E: Add tax_rate column to expenses if not present ───────────────
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
    `);
    logger.info("[Migration] ✅ FIX-E: expenses.tax_rate column ensured");

    // ── FIX F: Auto-advance overdue invoices ────────────────────────────────
    // Invoices with due_date < NOW() and status sent/partial become overdue
    await db.execute(sql`
      UPDATE invoices
      SET status = 'overdue', updated_at = NOW()
      WHERE status IN ('sent', 'partial')
        AND due_date IS NOT NULL
        AND due_date < NOW()
    `);
    logger.info("[Migration] ✅ FIX-F: Overdue invoices auto-advanced");

    // ── FIX G: Client portal tokens table ───────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS client_portal_tokens (
        id          SERIAL PRIMARY KEY,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        token       VARCHAR(128) NOT NULL UNIQUE,
        expires_at  TIMESTAMP NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, client_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS portal_tokens_token_idx ON client_portal_tokens(token)`);
    logger.info("[Migration] ✅ FIX-G: client_portal_tokens table ensured");

    // ── FIX H: Recurring invoices table ─────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recurring_invoices (
        id              SERIAL PRIMARY KEY,
        org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        description     TEXT NOT NULL,
        frequency       VARCHAR(20) NOT NULL DEFAULT 'monthly',
        currency        VARCHAR(10) NOT NULL DEFAULT 'EUR',
        tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 21,
        items           JSONB NOT NULL DEFAULT '[]',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        send_on_create  BOOLEAN NOT NULL DEFAULT FALSE,
        next_run_at     TIMESTAMP NOT NULL,
        last_run_at     TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recurring_invoices_org_id_idx      ON recurring_invoices(org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recurring_invoices_next_run_at_idx ON recurring_invoices(next_run_at) WHERE is_active = TRUE`);
    logger.info("[Migration] ✅ FIX-H: recurring_invoices table ensured");

    logger.info("[Migration] ✅ All startup migrations complete");
  } catch (err) {
    logger.error({ err }, "[Migration] ❌ Startup migration failed — continuing anyway");
  }
}
