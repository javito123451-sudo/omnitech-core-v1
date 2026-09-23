CREATE TABLE "outreach_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"lead_message_id" integer NOT NULL,
	"lead_contact_id" integer NOT NULL,
	"mission_id" integer,
	"channel" text NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"reason" text,
	"generated_lead_message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_followups" ADD CONSTRAINT "outreach_followups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_followups" ADD CONSTRAINT "outreach_followups_lead_message_id_lead_messages_id_fk" FOREIGN KEY ("lead_message_id") REFERENCES "public"."lead_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_followups" ADD CONSTRAINT "outreach_followups_lead_contact_id_lead_contacts_id_fk" FOREIGN KEY ("lead_contact_id") REFERENCES "public"."lead_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_followups" ADD CONSTRAINT "outreach_followups_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_followups" ADD CONSTRAINT "outreach_followups_generated_lead_message_id_lead_messages_id_fk" FOREIGN KEY ("generated_lead_message_id") REFERENCES "public"."lead_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_followups_anchor_attempt_uidx" ON "outreach_followups" USING btree ("lead_message_id","attempt");--> statement-breakpoint
CREATE INDEX "outreach_followups_org_idx" ON "outreach_followups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "outreach_followups_status_next_run_idx" ON "outreach_followups" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "outreach_followups_contact_idx" ON "outreach_followups" USING btree ("lead_contact_id");--> statement-breakpoint
CREATE INDEX "outreach_followups_mission_idx" ON "outreach_followups" USING btree ("mission_id");