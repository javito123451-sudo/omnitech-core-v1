CREATE TABLE "b2b_diagnostic_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"empresa" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text,
	"necesidad" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
