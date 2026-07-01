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

    // ── FIX I: Seed WhatsApp integration row from env vars (bootstrap only) ──
    // Only inserts if no row exists yet — NEVER overwrites credentials set via UI.
    // To update credentials use the Integrations page inside the app.
    const waPhoneId = process.env["WHATSAPP_BUSINESS_PHONE_ID"];
    const waToken   = process.env["WHATSAPP_ACCESS_TOKEN"];
    const waVerify  = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] ?? "omnitech-webhook";

    if (waPhoneId && waToken) {
      const credsJson = JSON.stringify({ phoneNumberId: waPhoneId, accessToken: waToken, verifyToken: waVerify });
      const credsEnc  = Buffer.from(credsJson).toString("base64");

      const orgsResult = await db.execute(sql`SELECT id FROM organizations`);
      for (const org of (orgsResult as { rows: Array<{ id: number }> }).rows) {
        // INSERT only — skip if a row already exists (UI-configured credentials take priority)
        await db.execute(sql`
          INSERT INTO org_integrations (org_id, integration_slug, status, credentials_enc, display_name)
          VALUES (${org.id}, 'whatsapp', 'active', ${credsEnc}, 'WhatsApp Business API')
          ON CONFLICT (org_id, integration_slug) DO NOTHING
        `);
        logger.info(`[Migration] ✅ FIX-I: WhatsApp bootstrap check → org ${org.id}`);
      }
    }

    // ── FIX J: Diagnostic reports table ──────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS diagnostic_reports (
        id               SERIAL PRIMARY KEY,
        org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        run_by           TEXT,
        scope            VARCHAR(20) NOT NULL DEFAULT 'workspace',
        score            INTEGER NOT NULL DEFAULT 0,
        status           VARCHAR(20) NOT NULL DEFAULT 'healthy',
        summary          TEXT,
        modules          JSONB NOT NULL DEFAULT '[]',
        issues           JSONB NOT NULL DEFAULT '[]',
        recommendations  JSONB NOT NULL DEFAULT '[]',
        actions_taken    JSONB NOT NULL DEFAULT '[]',
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS diagnostic_reports_org_id_idx ON diagnostic_reports(org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS diagnostic_reports_created_at_idx ON diagnostic_reports(created_at DESC)`);
    logger.info("[Migration] ✅ FIX-J: diagnostic_reports table ensured");

    // ── FIX K: Onboard Wizard tables + org columns ─────────────────────────────
    // New columns on organizations table
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS fiscal_config JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS wizard_state JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS legal_name TEXT,
      ADD COLUMN IF NOT EXISTS tax_id TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Madrid',
      ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'es',
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR'
    `);
    // Tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS onboard_wizard_drafts (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        wizard_data     JSONB NOT NULL DEFAULT '{}',
        current_step    INTEGER NOT NULL DEFAULT 1,
        created_by      TEXT,
        status          TEXT NOT NULL DEFAULT 'draft',
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS onboard_templates (
        id               SERIAL PRIMARY KEY,
        slug             TEXT NOT NULL UNIQUE,
        name             TEXT NOT NULL,
        description      TEXT,
        icon             TEXT,
        default_modules  JSONB NOT NULL DEFAULT '[]',
        default_fiscal   JSONB DEFAULT '{}',
        recommended_plan TEXT DEFAULT 'starter',
        default_roles    JSONB DEFAULT '[]',
        is_active        BOOLEAN DEFAULT TRUE,
        order_index      INTEGER DEFAULT 0,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Seed templates if empty
    const tplCount = await db.execute(sql`SELECT COUNT(*) AS cnt FROM onboard_templates`);
    if (Number((tplCount as { rows: Array<{cnt: string}> }).rows?.[0]?.cnt ?? 0) === 0) {
      const templates = [
        { slug: "autonomo", name: "Autonomo", description: "Freelance individual: CRM, facturacion, gestoria", icon: "User", default_modules: ["crm","quotes","omni_accounting","omni_tax"], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "starter", default_roles: [{ role: "admin", count: 1 }] },
        { slug: "pyme", name: "PYME", description: "Pequena empresa: todos los modulos esenciales", icon: "Building2", default_modules: ["crm","quotes","omni_accounting","omni_tax","ai_agents","whatsapp","automations"], default_fiscal: { companyType: "sociedad", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "growth", default_roles: [{ role: "admin", count: 1 }, { role: "vendedor", count: 2 }, { role: "member", count: 2 }] },
        { slug: "agencia", name: "Agencia", description: "Agencia de marketing: CRM, marketing, IA, automatizaciones", icon: "Megaphone", default_modules: ["crm","quotes","ai_agents","automations","omni_tax","portal_cliente"], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "growth", default_roles: [{ role: "admin", count: 1 }, { role: "manager", count: 1 }, { role: "member", count: 3 }] },
        { slug: "inmobiliaria", name: "Inmobiliaria", description: "Inmobiliaria: CRM, portal cliente, presupuestos", icon: "Home", default_modules: ["crm","quotes","portal_cliente","omni_tax","omni_accounting"], default_fiscal: { companyType: "sociedad", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "starter", default_roles: [{ role: "admin", count: 1 }, { role: "vendedor", count: 3 }] },
        { slug: "clinica", name: "Clinica", description: "Clinica/centro medico: CRM, agenda, automatizaciones", icon: "Heart", default_modules: ["crm","ai_agents","automations","whatsapp","portal_cliente"], default_fiscal: { companyType: "sociedad", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "growth", default_roles: [{ role: "admin", count: 1 }, { role: "member", count: 2 }, { role: "vendedor", count: 1 }] },
        { slug: "restaurante", name: "Restaurante", description: "Restaurante: CRM, WhatsApp, automatizaciones", icon: "UtensilsCrossed", default_modules: ["crm","whatsapp","automations","omni_tax","ai_agents"], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "starter", default_roles: [{ role: "admin", count: 1 }, { role: "member", count: 2 }] },
        { slug: "comercio", name: "Comercio", description: "Tienda fisica/online: CRM, facturacion, WhatsApp", icon: "ShoppingBag", default_modules: ["crm","quotes","omni_accounting","whatsapp","omni_tax"], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "starter", default_roles: [{ role: "admin", count: 1 }, { role: "vendedor", count: 2 }] },
        { slug: "asesoria", name: "Asesoria", description: "Asesoria/gestoria: contabilidad, fiscal, CRM, presupuestos", icon: "Scale", default_modules: ["crm","quotes","omni_accounting","omni_tax","automations","ai_agents"], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "scale", default_roles: [{ role: "admin", count: 1 }, { role: "member", count: 3 }, { role: "vendedor", count: 1 }] },
        { slug: "servicios", name: "Empresa de Servicios", description: "Empresa de servicios: CRM, contabilidad, gestoria", icon: "Briefcase", default_modules: ["crm","quotes","omni_accounting","omni_tax","automations"], default_fiscal: { companyType: "sociedad", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "growth", default_roles: [{ role: "admin", count: 1 }, { role: "member", count: 2 }, { role: "vendedor", count: 1 }] },
        { slug: "personalizado", name: "Plantilla Personalizada", description: "Configuracion desde cero", icon: "Settings", default_modules: [], default_fiscal: { companyType: "autonomo", regime: "estimacion_directa", vat: true, irpf: true, country: "ES" }, recommended_plan: "free", default_roles: [{ role: "admin", count: 1 }] },
      ];
      for (const t of templates) {
        await db.execute(sql`
          INSERT INTO onboard_templates (slug, name, description, icon, default_modules, default_fiscal, recommended_plan, default_roles, is_active, order_index)
          VALUES (${t.slug}, ${t.name}, ${t.description}, ${t.icon}, ${JSON.stringify(t.default_modules)}::jsonb, ${JSON.stringify(t.default_fiscal)}::jsonb, ${t.recommended_plan}, ${JSON.stringify(t.default_roles)}::jsonb, true, ${templates.indexOf(t)})
          ON CONFLICT (slug) DO NOTHING
        `);
      }
      logger.info("[Migration] ✅ FIX-K: Onboard templates seeded (10 plantillas)");
    }
    logger.info("[Migration] ✅ FIX-K: Onboard Wizard tables + org columns ensured");

    // ── FIX-M: share_token column on invoices ─────────────────────────────────
    await db.execute(sql`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token VARCHAR(128)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token_idx ON invoices(share_token) WHERE share_token IS NOT NULL
    `);
    logger.info("[Migration] ✅ FIX-M: invoices.share_token column ensured");

    // ── FIX-L: Marketing campaigns table ──────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id              SERIAL PRIMARY KEY,
        org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'draft',
        channel         TEXT NOT NULL DEFAULT 'email',
        subject         TEXT,
        body            TEXT,
        audience_filter TEXT NOT NULL DEFAULT 'all',
        sent_count      INTEGER NOT NULL DEFAULT 0,
        opened_count    INTEGER NOT NULL DEFAULT 0,
        clicked_count   INTEGER NOT NULL DEFAULT 0,
        created_by      TEXT,
        scheduled_at    TIMESTAMP,
        sent_at         TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("[Migration] ✅ FIX-L: marketing_campaigns table ensured");

    logger.info("[Migration] ✅ All startup migrations complete");
  } catch (err) {
    logger.error({ err }, "[Migration] ❌ Startup migration failed — continuing anyway");
  }
}
