CREATE TABLE "ai_agent_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"agent_version_id" integer NOT NULL,
	"tool_id" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"test_only" boolean DEFAULT false NOT NULL,
	"run_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "ai_agent_proposals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_agent_run_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"mode" text NOT NULL,
	"idempotency_key_hash" text,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"http_status" integer,
	"response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "ai_agent_run_requests_run_id_unique" UNIQUE("run_id"),
	CONSTRAINT "ai_agent_run_requests_idem_unique" UNIQUE("org_id","user_id","agent_id","mode","idempotency_key_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_agent_proposals" ADD CONSTRAINT "ai_agent_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_proposals" ADD CONSTRAINT "ai_agent_proposals_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_run_requests" ADD CONSTRAINT "ai_agent_run_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_run_requests" ADD CONSTRAINT "ai_agent_run_requests_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_agent_proposals_org" ON "ai_agent_proposals" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_proposals_expires" ON "ai_agent_proposals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_run_requests_org_time" ON "ai_agent_run_requests" USING btree ("org_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_run_requests_user_time" ON "ai_agent_run_requests" USING btree ("user_id","mode","created_at");