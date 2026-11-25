CREATE TABLE "review_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"template_id" integer,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"schedule_at" timestamp,
	"send_window" jsonb,
	"rate_per_minute" integer DEFAULT 30 NOT NULL,
	"max_reminders" integer DEFAULT 0 NOT NULL,
	"reminder_after_days" integer,
	"audience_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_campaigns_channel_chk" CHECK (channel IN ('whatsapp', 'email')),
	CONSTRAINT "review_campaigns_status_chk" CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "review_campaigns_reminders_chk" CHECK (max_reminders BETWEEN 0 AND 1 AND rate_per_minute BETWEEN 1 AND 600)
);
--> statement-breakpoint
CREATE TABLE "review_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"channel" text NOT NULL,
	"legal_basis" text NOT NULL,
	"evidence" text,
	"source" text,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_by" integer,
	CONSTRAINT "review_consents_channel_chk" CHECK (channel IN ('whatsapp', 'email')),
	CONSTRAINT "review_consents_basis_chk" CHECK (legal_basis IN ('consent', 'existing_customer_relationship', 'other'))
);
--> statement-breakpoint
CREATE TABLE "review_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer,
	"batch_id" integer,
	"client_id" integer,
	"name" text,
	"email" text,
	"email_norm" text,
	"phone_e164" text,
	"service" text,
	"service_date" date,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"erasure_requested_at" timestamp,
	"anonymized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_contacts_status_chk" CHECK (status IN ('active', 'unsubscribed', 'invalid', 'bounced', 'erased')),
	CONSTRAINT "review_contacts_source_chk" CHECK (source IN ('csv', 'xlsx', 'crm', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"message_id" integer,
	"contact_id" integer,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer,
	"source" text NOT NULL,
	"file_name" text,
	"legal_basis" text NOT NULL,
	"legal_basis_note" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"error_report" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_import_batches_source_chk" CHECK (source IN ('csv', 'xlsx', 'crm'))
);
--> statement-breakpoint
CREATE TABLE "review_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"google_place_id" text,
	"google_review_url" text,
	"gbp_account_id" text,
	"gbp_location_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_locations_status_chk" CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "review_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"channel" text NOT NULL,
	"kind" text DEFAULT 'request' NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"provider" text,
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"tracking_token" text NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"first_clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_messages_status_chk" CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
	CONSTRAINT "review_messages_channel_chk" CHECK (channel IN ('whatsapp', 'email')),
	CONSTRAINT "review_messages_kind_chk" CHECK (kind IN ('request', 'reminder'))
);
--> statement-breakpoint
CREATE TABLE "review_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"google_review_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"reviewer_name" text,
	"published_at" timestamp NOT NULL,
	"sentiment" text,
	"topics" jsonb,
	"needs_human" boolean DEFAULT false NOT NULL,
	"needs_human_reason" text,
	"ai_analyzed_at" timestamp,
	"reply_status" text DEFAULT 'none' NOT NULL,
	"suggested_reply" text,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_reviews_rating_chk" CHECK (rating BETWEEN 1 AND 5),
	CONSTRAINT "review_reviews_sentiment_chk" CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')),
	CONSTRAINT "review_reviews_reply_chk" CHECK (reply_status IN ('none', 'draft', 'approved', 'published', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "review_settings" (
	"org_id" integer PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"quiet_hours" jsonb,
	"monthly_contact_limit" integer,
	"monthly_message_limit" integer,
	"max_active_campaigns" integer,
	"retention_months" integer DEFAULT 24 NOT NULL,
	"ai_approval" jsonb DEFAULT '{"reply_publish":"always_approve","alert_notify":"always_approve"}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_settings_retention_chk" CHECK (retention_months BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wa_template_name" text,
	"wa_language" text,
	"wa_status" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_templates_channel_chk" CHECK (channel IN ('whatsapp', 'email'))
);
--> statement-breakpoint
CREATE TABLE "review_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"period" text NOT NULL,
	"channel" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"provider_cost" numeric(14, 6),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_consents" ADD CONSTRAINT "review_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_consents" ADD CONSTRAINT "review_consents_contact_id_review_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."review_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_contacts" ADD CONSTRAINT "review_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_contacts" ADD CONSTRAINT "review_contacts_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_contacts" ADD CONSTRAINT "review_contacts_batch_id_review_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."review_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_message_id_review_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."review_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_contact_id_review_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."review_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_import_batches" ADD CONSTRAINT "review_import_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_import_batches" ADD CONSTRAINT "review_import_batches_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_locations" ADD CONSTRAINT "review_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_messages" ADD CONSTRAINT "review_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_messages" ADD CONSTRAINT "review_messages_campaign_id_review_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."review_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_messages" ADD CONSTRAINT "review_messages_contact_id_review_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."review_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reviews" ADD CONSTRAINT "review_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reviews" ADD CONSTRAINT "review_reviews_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_settings" ADD CONSTRAINT "review_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_campaigns_org_idx" ON "review_campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_consents_org_contact_idx" ON "review_consents" USING btree ("org_id","contact_id","channel");--> statement-breakpoint
CREATE INDEX "review_contacts_org_idx" ON "review_contacts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_contacts_org_activity_idx" ON "review_contacts" USING btree ("org_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_contacts_org_email_uq" ON "review_contacts" USING btree ("org_id","email_norm") WHERE email_norm IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_contacts_org_phone_uq" ON "review_contacts" USING btree ("org_id","phone_e164") WHERE phone_e164 IS NOT NULL;--> statement-breakpoint
CREATE INDEX "review_events_org_idx" ON "review_events" USING btree ("org_id","type","created_at");--> statement-breakpoint
CREATE INDEX "review_events_message_idx" ON "review_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "review_import_batches_org_idx" ON "review_import_batches" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "review_locations_org_idx" ON "review_locations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_locations_org_place_uq" ON "review_locations" USING btree ("org_id","google_place_id") WHERE google_place_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_messages_idem_uq" ON "review_messages" USING btree ("campaign_id","contact_id","kind","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "review_messages_token_uq" ON "review_messages" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "review_messages_org_campaign_idx" ON "review_messages" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "review_messages_claim_idx" ON "review_messages" USING btree ("next_attempt_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "review_messages_provider_id_idx" ON "review_messages" USING btree ("provider_message_id") WHERE provider_message_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_reviews_org_google_uq" ON "review_reviews" USING btree ("org_id","google_review_id");--> statement-breakpoint
CREATE INDEX "review_reviews_org_loc_idx" ON "review_reviews" USING btree ("org_id","location_id","published_at");--> statement-breakpoint
CREATE INDEX "review_reviews_flagged_idx" ON "review_reviews" USING btree ("org_id") WHERE needs_human = true;--> statement-breakpoint
CREATE INDEX "review_templates_org_idx" ON "review_templates" USING btree ("org_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "review_usage_org_period_channel_uq" ON "review_usage" USING btree ("org_id","period","channel");