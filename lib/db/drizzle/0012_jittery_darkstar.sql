CREATE TABLE "lead_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"lead_result_id" integer NOT NULL,
	"name" text,
	"role" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"provider" text NOT NULL,
	"provider_contact_id" text,
	"confidence" double precision,
	"status" text DEFAULT 'encontrado' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_lead_result_id_lead_results_id_fk" FOREIGN KEY ("lead_result_id") REFERENCES "public"."lead_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_contacts_org_id_idx" ON "lead_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lead_contacts_lead_result_id_idx" ON "lead_contacts" USING btree ("lead_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_contacts_org_provider_contact_uidx" ON "lead_contacts" USING btree ("org_id","provider","provider_contact_id") WHERE "lead_contacts"."provider_contact_id" is not null;