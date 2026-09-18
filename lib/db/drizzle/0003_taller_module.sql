CREATE TABLE "repair_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"appointment_id" integer,
	"quote_id" integer,
	"vehicle_plate" text,
	"vehicle_model" text,
	"vehicle_mileage_km" integer,
	"service_type" text DEFAULT 'reparacion' NOT NULL,
	"stage" text DEFAULT 'received' NOT NULL,
	"notes" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_repair_orders_org" ON "repair_orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_repair_orders_org_stage" ON "repair_orders" USING btree ("org_id","stage");