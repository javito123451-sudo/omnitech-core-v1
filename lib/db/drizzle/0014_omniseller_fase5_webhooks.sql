CREATE TABLE "outreach_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"lead_message_id" integer,
	"raw_payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"error_message" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "bounced_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "clicked_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "last_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_events_provider_external_id_uidx" ON "outreach_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "outreach_events_org_idx" ON "outreach_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "outreach_events_lead_message_idx" ON "outreach_events" USING btree ("lead_message_id");