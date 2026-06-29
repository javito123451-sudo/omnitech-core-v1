-- BackOffice Phase — Migrations
-- Ejecutar vía: psql "$DATABASE_URL" -f lib/db/src/schema/migrations_backoffice.sql

-- 1. Organizations: onboarding state
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;

-- 2. Support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_email TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_org ON support_tickets(org_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to_user_id);

-- 3. Ticket comments
CREATE TABLE IF NOT EXISTS ticket_comments (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);

-- 4. Pipeline stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  order_index INTEGER NOT NULL DEFAULT 0,
  win_probability REAL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_org ON pipeline_stages(org_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order ON pipeline_stages(org_id, order_index);

-- 5. Deals
CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  value REAL DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expected_close_date TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deals_org ON deals(org_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned ON deals(assigned_to_user_id);

-- 6. Seed default pipeline stages for existing orgs (if table was just created)
INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Lead', '#64748b', 0, 10 FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Contactado', '#3b82f6', 1, 25 FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Propuesta', '#8b5cf6', 2, 50 FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Negociación', '#f59e0b', 3, 75 FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Cerrado (Ganado)', '#10b981', 4, 100 FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, order_index, win_probability)
SELECT id, 'Cerrado (Perdido)', '#ef4444', 5, 0 FROM organizations
ON CONFLICT DO NOTHING;
