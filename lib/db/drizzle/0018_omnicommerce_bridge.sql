CREATE TABLE "activation_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"activation_request_id" integer NOT NULL,
	"actor_clerk_id" text,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" integer,
	"subscription_id" integer,
	"requested_plan" text,
	"requested_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_verified" boolean DEFAULT false NOT NULL,
	"payment_verified_via" text,
	"org_id" integer,
	"reviewer_clerk_id" text,
	"review_notes" text,
	"info_request" text,
	"last_error" text,
	"decided_at" timestamp,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "activation_requests_order_unique" UNIQUE("order_id"),
	CONSTRAINT "activation_requests_status_check" CHECK ("activation_requests"."status" in ('pending_payment','pending_review','info_requested','approved','rejected','activated','failed'))
);
--> statement-breakpoint
CREATE TABLE "billing_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"external_transaction_id" text NOT NULL,
	"order_id" integer,
	"subscription_id" integer,
	"customer_id" integer,
	"org_id" integer,
	"amount" numeric(12, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"details" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_history_source_tx_kind_unique" UNIQUE("source","external_transaction_id","kind"),
	CONSTRAINT "billing_history_kind_check" CHECK ("billing_history"."kind" in ('charge','renewal','failed_payment','refund','chargeback'))
);
--> statement-breakpoint
CREATE TABLE "commerce_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_customer_id" text NOT NULL,
	"email" text,
	"name" text,
	"phone" text,
	"company_name" text,
	"tax_id" text,
	"org_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_customers_source_ext_unique" UNIQUE("source","external_customer_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_order_id" text NOT NULL,
	"order_number" text,
	"customer_id" integer,
	"financial_status" text DEFAULT 'pending' NOT NULL,
	"order_status" text DEFAULT 'open' NOT NULL,
	"total_amount" numeric(12, 2),
	"refunded_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_orders_source_ext_unique" UNIQUE("source","external_order_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'plan' NOT NULL,
	"plan_key" text,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_amount" numeric(12, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"billing_interval" text DEFAULT 'monthly' NOT NULL,
	"price_custom" boolean DEFAULT false NOT NULL,
	"shopify_product_id" text,
	"shopify_variant_id" text,
	"hotmart_product_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "commerce_products_kind_check" CHECK ("commerce_products"."kind" in ('plan','module','service')),
	CONSTRAINT "commerce_products_interval_check" CHECK ("commerce_products"."billing_interval" in ('monthly','one_time'))
);
--> statement-breakpoint
CREATE TABLE "commerce_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_contract_id" text NOT NULL,
	"customer_id" integer,
	"origin_order_id" integer,
	"product_id" integer,
	"org_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_period_end" timestamp,
	"next_billing_at" timestamp,
	"grace_until" timestamp,
	"last_payment_at" timestamp,
	"failed_payment_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp,
	"suspended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_subscriptions_source_ext_unique" UNIQUE("source","external_contract_id"),
	CONSTRAINT "commerce_subscriptions_status_check" CHECK ("commerce_subscriptions"."status" in ('pending','active','past_due','grace','suspended','cancelled','expired'))
);
--> statement-breakpoint
CREATE TABLE "commerce_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"topic" text NOT NULL,
	"shop_domain" text,
	"payload_hash" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "commerce_webhook_events_source_event_unique" UNIQUE("source","event_id")
);
--> statement-breakpoint
ALTER TABLE "org_invitations" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD COLUMN IF NOT EXISTS "last_send_error" text;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "experience_type" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "persona_needs" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "a3_service_types" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "a3_client_segment" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "experience_template_slug" text;--> statement-breakpoint
ALTER TABLE "activation_audit_logs" ADD CONSTRAINT "activation_audit_logs_activation_request_id_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "public"."activation_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_requests" ADD CONSTRAINT "activation_requests_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_requests" ADD CONSTRAINT "activation_requests_customer_id_commerce_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."commerce_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_requests" ADD CONSTRAINT "activation_requests_subscription_id_commerce_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."commerce_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_requests" ADD CONSTRAINT "activation_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_subscription_id_commerce_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."commerce_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_customer_id_commerce_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."commerce_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_customers" ADD CONSTRAINT "commerce_customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_customer_id_commerce_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."commerce_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_customer_id_commerce_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."commerce_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_origin_order_id_commerce_orders_id_fk" FOREIGN KEY ("origin_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_audit_logs_request_idx" ON "activation_audit_logs" USING btree ("activation_request_id");--> statement-breakpoint
CREATE INDEX "activation_requests_status_idx" ON "activation_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_history_org_idx" ON "billing_history" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "commerce_customers_email_idx" ON "commerce_customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "commerce_orders_customer_idx" ON "commerce_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commerce_orders_financial_idx" ON "commerce_orders" USING btree ("financial_status");--> statement-breakpoint
CREATE INDEX "commerce_subscriptions_status_idx" ON "commerce_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commerce_subscriptions_org_idx" ON "commerce_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "commerce_webhook_events_status_idx" ON "commerce_webhook_events" USING btree ("status");--> statement-breakpoint
-- OmniCommerce: catálogo inicial = planes OFICIALES de credit_plans (fuente única de precios).
-- No se escribe ningún importe aquí: se copia de credit_plans. Enterprise queda como price_custom
-- (no vendible online, va a "Solicitar demostración"). Idempotente.
INSERT INTO "commerce_products" ("sku", "name", "kind", "plan_key", "modules", "price_amount", "currency", "billing_interval", "price_custom", "is_active")
SELECT
  'omnitech-plan-' || cp."plan",
  'OmniTech Core ' || COALESCE(cp."display_name", initcap(cp."plan")),
  'plan',
  cp."plan",
  CASE cp."plan"
    WHEN 'starter' THEN '["crm","whatsapp","omni_marketing","knowledge_base","omni_accounting","ai_agents","omni_agent_factory","quotes","portal_cliente"]'::jsonb
    WHEN 'professional' THEN '["crm","whatsapp","omni_marketing","knowledge_base","omni_accounting","ai_agents","omni_agent_factory","quotes","portal_cliente","automations","integrations","analytics","omni_docs"]'::jsonb
    ELSE '["*"]'::jsonb
  END,
  cp."price_amount",
  cp."currency",
  'monthly',
  cp."price_custom",
  cp."active" AND NOT cp."price_custom"
FROM "credit_plans" cp
WHERE cp."plan" IN ('starter','professional','business','enterprise')
ON CONFLICT ("sku") DO NOTHING;
