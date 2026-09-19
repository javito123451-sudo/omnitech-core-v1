CREATE TABLE "ai_agent_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"published_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_versions_agent_number_unique" UNIQUE("agent_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"active_version_id" integer,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_credit_limit" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_active_version_id_ai_agent_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."ai_agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_agent_versions_agent" ON "ai_agent_versions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_versions_org" ON "ai_agent_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ai_agents_org" ON "ai_agents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ai_agents_org_status" ON "ai_agents" USING btree ("org_id","status");