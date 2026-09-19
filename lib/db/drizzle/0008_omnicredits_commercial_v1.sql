CREATE TABLE "credit_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"credits" numeric(16, 4) NOT NULL,
	"price_amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_packs_code_unique" UNIQUE("code"),
	CONSTRAINT "credit_packs_positive_check" CHECK ("credit_packs"."credits" > 0 and "credit_packs"."price_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "daily_credit_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "per_execution_credit_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_model_pricing" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "ai_model_pricing" ADD COLUMN "provisional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD COLUMN "included_balance" numeric(16, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD COLUMN "rollover_balance" numeric(16, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD COLUMN "extra_balance" numeric(16, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "bucket" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "rollover_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "price_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "price_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "agent_limit" integer;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "workspace_limit" integer;--> statement-breakpoint--> statement-breakpoint
-- Cuentas existentes (si las hubiera): todo el saldo previo pasa al cubo "extra", el último en consumirse.
UPDATE "credit_accounts" SET "extra_balance" = "balance";--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_buckets_check" CHECK ("credit_accounts"."included_balance" + "credit_accounts"."rollover_balance" + "credit_accounts"."extra_balance" = "credit_accounts"."balance");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_origin_check" CHECK (("credit_ledger"."bucket" is null or "credit_ledger"."bucket" in ('included', 'rollover', 'extra')) and ("credit_ledger"."credits" > 0 or "credit_ledger"."bucket" is null) and ("credit_ledger"."credits" < 0 or "credit_ledger"."breakdown" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION credit_ledger_check_chain() RETURNS trigger AS $$
DECLARE
  account_row credit_accounts%ROWTYPE;
  part  numeric;
  total numeric := 0;
  k     text;
  inc   numeric := 0;
  rol   numeric := 0;
BEGIN
  -- Bloquea la cuenta y exige que el movimiento parta del saldo real: dos
  -- escrituras concurrentes no pueden encadenarse sobre el mismo saldo.
  SELECT * INTO account_row FROM credit_accounts WHERE id = NEW.account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_ledger: la cuenta % no existe', NEW.account_id;
  END IF;
  IF NEW.org_id IS DISTINCT FROM account_row.org_id THEN
    RAISE EXCEPTION 'credit_ledger: el movimiento no pertenece a la organización de la cuenta';
  END IF;
  IF NEW.balance_before IS DISTINCT FROM account_row.balance THEN
    RAISE EXCEPTION 'credit_ledger: el saldo anterior (%) no coincide con el saldo real de la cuenta (%)', NEW.balance_before, account_row.balance;
  END IF;

  -- Origen de los créditos: un movimiento que resta debe repartirse entre los cubos
  -- (included, rollover, extra) sumando exactamente su importe. Solo "extra" puede quedar
  -- en negativo (desvío de un consumo real sobre lo reservado); incluidos y rollover nunca.
  IF NEW.credits < 0 AND NEW.breakdown IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.breakdown) x WHERE x NOT IN ('included', 'rollover', 'extra')) THEN
      RAISE EXCEPTION 'credit_ledger: el reparto por origen solo admite included, rollover y extra';
    END IF;
    FOREACH k IN ARRAY ARRAY['included', 'rollover', 'extra'] LOOP
      part := COALESCE((NEW.breakdown->>k)::numeric, 0);
      IF part < 0 THEN
        RAISE EXCEPTION 'credit_ledger: el reparto por origen no admite importes negativos';
      END IF;
      total := total + part;
      IF k = 'included' THEN inc := part; END IF;
      IF k = 'rollover' THEN rol := part; END IF;
    END LOOP;
    IF total <> -NEW.credits THEN
      RAISE EXCEPTION 'credit_ledger: el reparto por origen (%) no suma el importe del movimiento (%)', total, -NEW.credits;
    END IF;
    IF account_row.included_balance - inc < 0 THEN
      RAISE EXCEPTION 'credit_ledger: los créditos incluidos no alcanzan (%) para este movimiento (%)', account_row.included_balance, inc;
    END IF;
    IF account_row.rollover_balance - rol < 0 THEN
      RAISE EXCEPTION 'credit_ledger: el rollover no alcanza (%) para este movimiento (%)', account_row.rollover_balance, rol;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION credit_ledger_apply_balance() RETURNS trigger AS $$
DECLARE
  inc numeric := 0;
  rol numeric := 0;
  ext numeric := 0;
BEGIN
  IF NEW.credits > 0 THEN
    IF NEW.bucket = 'included' THEN inc := NEW.credits;
    ELSIF NEW.bucket = 'rollover' THEN rol := NEW.credits;
    ELSE ext := NEW.credits; END IF;
  ELSIF NEW.breakdown IS NULL THEN
    ext := NEW.credits;  -- sin reparto informado: se resta del último cubo
  ELSE
    inc := -COALESCE((NEW.breakdown->>'included')::numeric, 0);
    rol := -COALESCE((NEW.breakdown->>'rollover')::numeric, 0);
    ext := -COALESCE((NEW.breakdown->>'extra')::numeric, 0);
  END IF;

  -- Los saldos los actualiza este trigger, como consecuencia de insertar el movimiento.
  PERFORM set_config('omnicredits.ledger_write', 'on', true);
  UPDATE credit_accounts
     SET balance = NEW.balance_after,
         included_balance = included_balance + inc,
         rollover_balance = rollover_balance + rol,
         extra_balance = extra_balance + ext,
         updated_at = now()
   WHERE id = NEW.account_id;
  PERFORM set_config('omnicredits.ledger_write', 'off', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION credit_accounts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 OR NEW.included_balance <> 0 OR NEW.rollover_balance <> 0 OR NEW.extra_balance <> 0 THEN
      RAISE EXCEPTION 'credit_accounts: una cuenta nueva empieza en 0; el saldo solo cambia mediante un movimiento de ledger';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.balance IS DISTINCT FROM OLD.balance
      OR NEW.included_balance IS DISTINCT FROM OLD.included_balance
      OR NEW.rollover_balance IS DISTINCT FROM OLD.rollover_balance
      OR NEW.extra_balance IS DISTINCT FROM OLD.extra_balance)
     AND COALESCE(current_setting('omnicredits.ledger_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'credit_accounts: el saldo solo puede cambiar mediante un movimiento de ledger';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'credit_accounts: no se puede cambiar la organización de una cuenta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- OmniCredits v1: configuración comercial oficial. Idempotente: no pisa lo que ya exista.
-- Los planes definen créditos incluidos, límite diario, alertas y rollover (% de lo incluido sin consumir).
-- ENTERPRISE es a medida: precio y límites configurables (NULL hasta que se acuerden por cliente).
INSERT INTO "credit_plans" ("plan", "display_name", "price_amount", "currency", "price_custom", "included_credits", "daily_limit", "rollover", "rollover_pct", "block_at_limit", "alert_thresholds", "active")
VALUES
  ('starter',      'Starter',      149.00, 'EUR', false,  50000,  5000, false,    0, true, '[70, 90, 100]'::jsonb, true),
  ('professional', 'Professional', 349.00, 'EUR', false, 150000, 15000, true,    25, true, '[70, 90, 100]'::jsonb, true),
  ('business',     'Business',     699.00, 'EUR', false, 400000, 40000, true,    50, true, '[70, 90, 100]'::jsonb, true),
  ('enterprise',   'Enterprise',   NULL,   'EUR', true,   NULL,   NULL, false, NULL, true, '[]'::jsonb, true)
ON CONFLICT ("plan") DO NOTHING;
--> statement-breakpoint
-- Catálogo de OmniCredits extra (sin integración de pago todavía).
INSERT INTO "credit_packs" ("code", "credits", "price_amount", "currency", "active", "sort_order")
VALUES
  ('pack_25k',     25000,  29.00, 'EUR', true, 1),
  ('pack_100k',   100000,  89.00, 'EUR', true, 2),
  ('pack_250k',   250000, 199.00, 'EUR', true, 3),
  ('pack_1m',    1000000, 599.00, 'EUR', true, 4)
ON CONFLICT ("code") DO NOTHING;
