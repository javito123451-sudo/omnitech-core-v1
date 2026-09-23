CREATE TABLE "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"sector" text,
	"location" text,
	"search_criteria" jsonb,
	"target_prospect_count" integer,
	"credit_budget" numeric(16, 4),
	"status" text DEFAULT 'active' NOT NULL,
	"owner_id" integer,
	"provider_config" jsonb,
	"result_summary" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_searches" ADD COLUMN "mission_id" integer;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "missions_org_id_idx" ON "missions" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_searches_mission_id_idx" ON "lead_searches" USING btree ("mission_id");