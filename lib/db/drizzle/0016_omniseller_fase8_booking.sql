ALTER TABLE "appointments" ADD COLUMN "lead_contact_id" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "mission_id" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_contact_id_lead_contacts_id_fk" FOREIGN KEY ("lead_contact_id") REFERENCES "public"."lead_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_lead_contact_id_idx" ON "appointments" USING btree ("lead_contact_id");--> statement-breakpoint
CREATE INDEX "appointments_mission_id_idx" ON "appointments" USING btree ("mission_id");