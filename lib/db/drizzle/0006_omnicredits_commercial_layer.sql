CREATE TABLE "ai_model_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_cost" numeric(14, 6) NOT NULL,
	"output_cost" numeric(14, 6) NOT NULL,
	"cached_input_cost" numeric(14, 6),
	"reasoning_cost" numeric(14, 6),
	"image_cost" numeric(14, 6),
	"audio_cost" numeric(14, 6),
	"video_cost" numeric(14, 6),
	"currency" text DEFAULT 'USD' NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"kind" text NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"period_key" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_alerts_dedupe_unique" UNIQUE("org_id","kind","threshold","period_key")
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"credits" numeric(16, 4) NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"reference" text NOT NULL,
	"agent_id" integer,
	"user_clerk_id" text,
	"expires_at" timestamp NOT NULL,
	"settled_credits" numeric(16, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_holds_org_reference_unique" UNIQUE("org_id","reference"),
	CONSTRAINT "credit_holds_status_check" CHECK ("credit_holds"."status" in ('held', 'settled', 'released')),
	CONSTRAINT "credit_holds_positive_check" CHECK ("credit_holds"."credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"included_credits" numeric(16, 4),
	"monthly_limit" numeric(16, 4),
	"daily_limit" numeric(16, 4),
	"per_agent_monthly_limit" numeric(16, 4),
	"rollover" boolean DEFAULT false NOT NULL,
	"rollover_cap" numeric(16, 4),
	"block_at_limit" boolean DEFAULT true NOT NULL,
	"alert_thresholds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_plans_plan_unique" UNIQUE("plan")
);
--> statement-breakpoint
CREATE TABLE "credit_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"credits" numeric(16, 4) NOT NULL,
	"price_amount" numeric(12, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"payment_reference" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"ledger_entry_id" integer,
	"created_by" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_purchases_org_payment_unique" UNIQUE("org_id","payment_reference"),
	CONSTRAINT "credit_purchases_status_check" CHECK ("credit_purchases"."status" in ('completed', 'reversed')),
	CONSTRAINT "credit_purchases_positive_check" CHECK ("credit_purchases"."credits" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "balance_before" numeric(16, 4) NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_alerts" ADD CONSTRAINT "credit_alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_ledger_entry_id_credit_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."credit_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_model_pricing_lookup" ON "ai_model_pricing" USING btree ("provider","model","active");--> statement-breakpoint
CREATE INDEX "idx_credit_alerts_org" ON "credit_alerts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credit_holds_org_status" ON "credit_holds" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_credit_purchases_org" ON "credit_purchases" USING btree ("org_id","purchased_at");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_type_check" CHECK ("credit_ledger"."entry_type" in ('grant', 'purchase', 'subscription', 'consumption', 'refund', 'adjustment', 'expiration'));--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_amount_check" CHECK ("credit_ledger"."credits" <> 0 and (
    ("credit_ledger"."entry_type" in ('grant', 'purchase', 'subscription', 'refund') and "credit_ledger"."credits" > 0)
    or ("credit_ledger"."entry_type" in ('consumption', 'expiration') and "credit_ledger"."credits" < 0)
    or "credit_ledger"."entry_type" = 'adjustment'));--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_chain_check" CHECK ("credit_ledger"."balance_after" = "credit_ledger"."balance_before" + "credit_ledger"."credits");--> statement-breakpoint
CREATE FUNCTION credit_ledger_check_chain() RETURNS trigger AS $$
DECLARE
  account_row credit_accounts%ROWTYPE;
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_chain BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_check_chain();
--> statement-breakpoint
CREATE FUNCTION credit_ledger_apply_balance() RETURNS trigger AS $$
BEGIN
  -- El saldo lo actualiza este trigger, como consecuencia de insertar el movimiento.
  PERFORM set_config('omnicredits.ledger_write', 'on', true);
  UPDATE credit_accounts SET balance = NEW.balance_after, updated_at = now() WHERE id = NEW.account_id;
  PERFORM set_config('omnicredits.ledger_write', 'off', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_apply AFTER INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_apply_balance();
--> statement-breakpoint
CREATE FUNCTION credit_accounts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 THEN
      RAISE EXCEPTION 'credit_accounts: una cuenta nueva empieza en 0; el saldo solo cambia mediante un movimiento de ledger';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.balance IS DISTINCT FROM OLD.balance AND COALESCE(current_setting('omnicredits.ledger_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'credit_accounts: el saldo solo puede cambiar mediante un movimiento de ledger';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'credit_accounts: no se puede cambiar la organización de una cuenta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_accounts_guard_trg BEFORE INSERT OR UPDATE ON credit_accounts FOR EACH ROW EXECUTE FUNCTION credit_accounts_guard();
