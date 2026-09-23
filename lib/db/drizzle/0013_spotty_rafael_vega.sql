CREATE TABLE "outreach_suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"email" text,
	"phone" text,
	"channel" text,
	"reason" text NOT NULL,
	"source" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"org_id" integer NOT NULL,
	"lead_message_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"consumed_by" integer,
	CONSTRAINT "outreach_confirmations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "contact_id" integer;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "external_message_id" text;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "approved_by" integer;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "send_attempted_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "send_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "credits_spent" integer;--> statement-breakpoint
ALTER TABLE "outreach_suppressions" ADD CONSTRAINT "outreach_suppressions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_confirmations" ADD CONSTRAINT "outreach_confirmations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_suppressions_org_idx" ON "outreach_suppressions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "outreach_suppressions_org_email_idx" ON "outreach_suppressions" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "outreach_suppressions_org_phone_idx" ON "outreach_suppressions" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "outreach_confirmations_org_idx" ON "outreach_confirmations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "outreach_confirmations_message_idx" ON "outreach_confirmations" USING btree ("lead_message_id");--> statement-breakpoint
CREATE INDEX "outreach_confirmations_expires_idx" ON "outreach_confirmations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "lead_messages_org_contact_channel_idx" ON "lead_messages" USING btree ("org_id","contact_id","channel");