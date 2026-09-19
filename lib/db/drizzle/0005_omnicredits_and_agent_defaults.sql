CREATE TABLE "ai_agent_defaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"channel" text NOT NULL,
	"agent_id" integer NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_defaults_org_channel_unique" UNIQUE("org_id","channel")
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"balance" numeric(16, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"entry_type" text NOT NULL,
	"credits" numeric(16, 4) NOT NULL,
	"balance_after" numeric(16, 4) NOT NULL,
	"agent_id" integer,
	"agent_version_id" integer,
	"user_clerk_id" text,
	"provider" text,
	"model" text,
	"technical_cost_usd" numeric(12, 6),
	"estimated_credits" numeric(16, 4),
	"usage_log_id" integer,
	"reference" text,
	"source" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_org_reference_unique" UNIQUE("org_id","reference")
);
--> statement-breakpoint
ALTER TABLE "ai_agent_defaults" ADD CONSTRAINT "ai_agent_defaults_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_defaults" ADD CONSTRAINT "ai_agent_defaults_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_log_id_ai_usage_logs_id_fk" FOREIGN KEY ("usage_log_id") REFERENCES "public"."ai_usage_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_agent_defaults_agent" ON "ai_agent_defaults" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_org_created" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_org_agent" ON "credit_ledger" USING btree ("org_id","agent_id");--> statement-breakpoint
CREATE FUNCTION credit_ledger_block_update() RETURNS trigger AS $$
BEGIN
  -- El ledger es append-only: un movimiento no se edita, se corrige con otro
  -- movimiento (adjustment/refund). Única excepción: las acciones ON DELETE SET NULL
  -- de las claves foráneas (agent_id, usage_log_id), que solo pueden poner NULL.
  IF (to_jsonb(NEW) - 'agent_id' - 'usage_log_id') IS DISTINCT FROM (to_jsonb(OLD) - 'agent_id' - 'usage_log_id')
     OR (NEW.agent_id IS NOT NULL AND NEW.agent_id IS DISTINCT FROM OLD.agent_id)
     OR (NEW.usage_log_id IS NOT NULL AND NEW.usage_log_id IS DISTINCT FROM OLD.usage_log_id) THEN
    RAISE EXCEPTION 'credit_ledger es inmutable: registra un movimiento de ajuste en lugar de modificar uno existente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_block_update();
