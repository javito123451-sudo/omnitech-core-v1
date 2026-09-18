CREATE TABLE "fleet_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"client_id" integer,
	"external_delivery_id" text,
	"address" text,
	"recipient_name" text,
	"recipient_phone" text,
	"sequence_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_updated_at" timestamp,
	"last_status_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_deliveries_org_external_id_unique" UNIQUE("org_id","external_delivery_id")
);
--> statement-breakpoint
CREATE TABLE "fleet_drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"phone" text,
	"license_number" text,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"driver_id" integer,
	"vehicle_id" integer,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_route_id" text,
	"total_stops" integer DEFAULT 0 NOT NULL,
	"completed_stops" integer DEFAULT 0 NOT NULL,
	"incident_stops" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"driver_id" integer,
	"plate" text NOT NULL,
	"model" text,
	"odometer_km" integer,
	"itv_expires_at" date,
	"insurance_expires_at" date,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_vehicles_org_plate_unique" UNIQUE("org_id","plate")
);
--> statement-breakpoint
ALTER TABLE "fleet_deliveries" ADD CONSTRAINT "fleet_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_deliveries" ADD CONSTRAINT "fleet_deliveries_route_id_fleet_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."fleet_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_deliveries" ADD CONSTRAINT "fleet_deliveries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_driver_id_fleet_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."fleet_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_driver_id_fleet_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."fleet_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fleet_deliveries_route" ON "fleet_deliveries" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_deliveries_org" ON "fleet_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_drivers_org" ON "fleet_drivers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_routes_org_date" ON "fleet_routes" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "idx_fleet_vehicles_org" ON "fleet_vehicles" USING btree ("org_id");