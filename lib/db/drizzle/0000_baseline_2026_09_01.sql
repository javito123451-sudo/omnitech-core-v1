CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"invoice_id" integer,
	"client_id" integer,
	"note_number" varchar(50) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"reason" text,
	"status" varchar(30) DEFAULT 'issued' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"category" varchar(100) DEFAULT 'general' NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"vendor" varchar(200),
	"expense_date" timestamp DEFAULT now() NOT NULL,
	"receipt_url" text,
	"tax_deductible" boolean DEFAULT false NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer,
	"quote_id" integer,
	"invoice_number" varchar(50) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '21' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"due_date" timestamp,
	"paid_at" timestamp,
	"recurring_invoice_id" integer,
	"payment_notification_pending" boolean DEFAULT false NOT NULL,
	"payment_notified_at" timestamp,
	"payment_reference" text,
	"share_token" varchar(128),
	"share_token_expires_at" timestamp,
	"verifactu_hash" text,
	"verifactu_hash_anterior" text,
	"verifactu_qr_url" text,
	"verifactu_registered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"invoice_id" integer,
	"client_id" integer,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"method" varchar(50) DEFAULT 'transfer' NOT NULL,
	"reference" varchar(200),
	"notes" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer,
	"description" text NOT NULL,
	"frequency" varchar(20) DEFAULT 'monthly' NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT 21 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"send_on_create" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"client_name" text,
	"client_id" integer,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"business_name" text,
	"business_type" text,
	"product" text,
	"target_audience" text,
	"goal" text,
	"budget" numeric(12, 2),
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_content" jsonb,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"roi" numeric(10, 2) DEFAULT 0 NOT NULL,
	"spend" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_by" text,
	"scheduled_at" timestamp,
	"launched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads_creatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"type" text NOT NULL,
	"platform" text,
	"title" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generation_status" text DEFAULT 'idle' NOT NULL,
	"preview_url" text,
	"download_url" text,
	"thumbnail" text,
	"provider_name" text,
	"request_params" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"monthly_budget_usd" numeric(10, 2) DEFAULT '10.00',
	"alert_80" boolean DEFAULT true,
	"alert_90" boolean DEFAULT true,
	"block_at_100" boolean DEFAULT true,
	"is_blocked" boolean DEFAULT false,
	"block_reason" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_budgets_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"user_clerk_id" text,
	"function_name" text NOT NULL,
	"model" text NOT NULL,
	"tokens_input" integer DEFAULT 0,
	"tokens_output" integer DEFAULT 0,
	"tokens_total" integer DEFAULT 0,
	"cost_usd" numeric(10, 6) DEFAULT '0',
	"duration_ms" integer,
	"status" text DEFAULT 'ok',
	"error_msg" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"agent_slug" text NOT NULL,
	"memory_key" text NOT NULL,
	"memory_val" text NOT NULL,
	"title" text,
	"category" text,
	"tags" text,
	"source" text DEFAULT 'user_input',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memory_org_id_agent_slug_memory_key_unique" UNIQUE("org_id","agent_slug","memory_key")
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tokens_used" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"agent_slug" text DEFAULT 'operator' NOT NULL,
	"title" text,
	"client_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"action" text NOT NULL,
	"prev_title" text,
	"new_title" text,
	"prev_val" text,
	"new_val" text,
	"source" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"client_id" integer,
	"guest_name" text,
	"guest_phone" text,
	"guest_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text,
	"reminder" boolean DEFAULT false NOT NULL,
	"tags" text,
	"location" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"result_summary" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "autopilot_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb,
	"action_type" text NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"client_id" integer,
	"current_step" integer DEFAULT 0 NOT NULL,
	"paused_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_portal_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_tokens_org_id_client_id_key" UNIQUE("org_id","client_id"),
	CONSTRAINT "client_portal_tokens_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"status" text DEFAULT 'lead' NOT NULL,
	"tags" text,
	"notes" text,
	"value" real,
	"telegram_chat_id" text,
	"lead_score" text DEFAULT 'cold',
	"lead_intent" text,
	"assigned_admin_id" integer,
	"assigned_seller_id" integer,
	"assigned_by" integer,
	"commercial_status" text,
	"sector" text,
	"contact_person" text,
	"company_phone" text,
	"company_email" text,
	"instagram" text,
	"website" text,
	"location" text,
	"first_contact_at" timestamp,
	"dolor_principal" text,
	"recurso_enviado" text,
	"fuente_lead" text,
	"followup1_at" timestamp,
	"followup2_at" timestamp,
	"followup3_at" timestamp,
	"next_followup_at" timestamp,
	"last_contact_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"preferred_channel" text,
	"resultado" text,
	"next_action" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"observaciones" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"run_by" text,
	"scope" varchar(20) DEFAULT 'workspace' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'healthy' NOT NULL,
	"summary" text,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions_taken" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"chapter_order" integer DEFAULT 0 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"updated_by_clerk_id" text,
	"updated_by_email" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "docs_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "docs_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_slug" text NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"author_clerk_id" text,
	"author_email" text,
	"change_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_clerk_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"file_name" text,
	"file_type" text,
	"detected_type" text,
	"confidence_pct" integer,
	"raw_text" text,
	"extracted_data" jsonb,
	"suggested_dest" text,
	"records_created" integer DEFAULT 0,
	"errors" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"invited_by" integer NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"is_suspended" boolean DEFAULT false,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"logo_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarding_status" text DEFAULT 'pending',
	"onboarding_step" integer DEFAULT 0,
	"onboarding_completed_at" timestamp,
	"feature_flags" jsonb DEFAULT '{}'::jsonb,
	"fiscal_config" jsonb DEFAULT '{}'::jsonb,
	"wizard_state" jsonb DEFAULT '{}'::jsonb,
	"legal_name" text,
	"tax_id" text,
	"country" text,
	"address" text,
	"phone" text,
	"email" text,
	"website" text,
	"timezone" text DEFAULT 'Europe/Madrid',
	"language" text DEFAULT 'es',
	"currency" text DEFAULT 'EUR',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"suspended_at" timestamp,
	"platform_role" text DEFAULT 'NONE' NOT NULL,
	"assigned_org_id" integer,
	"assigned_company_id" integer,
	"seller_id" integer,
	"seller_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"client_id" integer,
	"autopilot_task_id" integer,
	"autopilot_step" integer,
	"external_id" text,
	"external_name" text,
	"content" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"channel" text DEFAULT 'telegram',
	"is_ai" boolean DEFAULT false,
	"status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit_price" real DEFAULT 0 NOT NULL,
	"total" real DEFAULT 0 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"subtotal" real DEFAULT 0 NOT NULL,
	"tax_rate" real DEFAULT 21 NOT NULL,
	"tax_amount" real DEFAULT 0 NOT NULL,
	"total" real DEFAULT 0 NOT NULL,
	"notes" text,
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"integration_slug" text NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'processed' NOT NULL,
	"summary" text,
	"error_message" text,
	"payload_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"auth_type" text NOT NULL,
	"description" text,
	"icon_slug" text,
	"plan_required" text DEFAULT 'free' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "integrations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "org_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"integration_slug" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"config" text,
	"credentials_enc" text,
	"display_name" text,
	"external_id" text,
	"last_synced_at" timestamp,
	"expires_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_integrations_org_id_integration_slug_unique" UNIQUE("org_id","integration_slug")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_clerk_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" text,
	"org_id" integer,
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"severity" text DEFAULT 'info',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "license_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"seats" integer DEFAULT 5,
	"valid_from" timestamp DEFAULT now(),
	"valid_until" timestamp,
	"is_active" boolean DEFAULT true,
	"billing_cycle" text DEFAULT 'monthly',
	"notes" text,
	"assigned_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "module_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"module_slug" text NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"config" jsonb DEFAULT '{}'::jsonb,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "module_configs_org_module_unique" UNIQUE("org_id","module_slug")
);
--> statement-breakpoint
CREATE TABLE "platform_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text DEFAULT 'STAFF_OMNITECH' NOT NULL,
	"display_name" text,
	"email" text,
	"granted_by" text,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "platform_roles_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" timestamp,
	"client_id" integer,
	"assigned_to" text,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"creator_user_id" integer,
	"creator_email" text,
	"assigned_to_user_id" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"user_id" integer,
	"author_name" text,
	"is_internal" boolean DEFAULT false,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"stage_id" integer NOT NULL,
	"value" real DEFAULT 0,
	"currency" text DEFAULT 'EUR',
	"assigned_to_user_id" integer,
	"expected_close_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6',
	"order_index" integer DEFAULT 0 NOT NULL,
	"win_probability" real DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_calculations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"tax_type" text NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer,
	"month" integer,
	"total_income" real DEFAULT 0 NOT NULL,
	"total_expenses" real DEFAULT 0 NOT NULL,
	"iva_repercutido" real DEFAULT 0 NOT NULL,
	"iva_soportado" real DEFAULT 0 NOT NULL,
	"iva_resultado" real DEFAULT 0 NOT NULL,
	"irpf_retenciones" real DEFAULT 0 NOT NULL,
	"irpf_base" real DEFAULT 0 NOT NULL,
	"irpf_estimate" real DEFAULT 0 NOT NULL,
	"renta_beneficio" real DEFAULT 0 NOT NULL,
	"renta_base" real DEFAULT 0 NOT NULL,
	"renta_estimate" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_url" text,
	"file_size" integer,
	"file_data" text,
	"category" text DEFAULT 'other' NOT NULL,
	"fiscal_year" integer,
	"quarter" integer,
	"ocr_text" text,
	"ai_category" text,
	"ai_confidence" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_health_score" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"score" integer NOT NULL,
	"compliance_score" integer DEFAULT 0 NOT NULL,
	"accuracy_score" integer DEFAULT 0 NOT NULL,
	"document_score" integer DEFAULT 0 NOT NULL,
	"timeliness_score" integer DEFAULT 0 NOT NULL,
	"recommendations" text,
	"snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_obligations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tax_type" text NOT NULL,
	"period" text DEFAULT 'quarterly' NOT NULL,
	"month" integer,
	"quarter" integer,
	"year" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"obligation_id" integer,
	"title" text NOT NULL,
	"message" text,
	"remind_at" timestamp NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_whatsapp" boolean DEFAULT false NOT NULL,
	"notify_telegram" boolean DEFAULT false NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"sent_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboard_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"default_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_fiscal" jsonb DEFAULT '{}'::jsonb,
	"recommended_plan" text DEFAULT 'starter',
	"default_roles" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"order_index" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboard_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "onboard_wizard_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"wizard_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"created_by" integer,
	"has_website" boolean,
	"has_https" boolean,
	"has_form" boolean,
	"has_whatsapp" boolean,
	"has_facebook" boolean,
	"has_instagram" boolean,
	"has_google_business" boolean,
	"has_cta" boolean,
	"has_mobile_optimization" boolean,
	"has_load_speed" boolean,
	"has_contact_info" boolean,
	"score" integer,
	"opportunity" text,
	"improvements" text,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"created_by" integer,
	"channel" text DEFAULT 'email' NOT NULL,
	"content" text NOT NULL,
	"tone" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"search_id" integer,
	"created_by" integer,
	"place_id" text,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"website" text,
	"email" text,
	"rating" double precision,
	"review_count" integer,
	"lat" double precision,
	"lng" double precision,
	"sector" text,
	"status" text DEFAULT 'new' NOT NULL,
	"crm_client_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"created_by" integer,
	"sector" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text,
	"radius_km" integer DEFAULT 20 NOT NULL,
	"max_results" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_found" integer DEFAULT 0,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"zone" text NOT NULL,
	"timing" text,
	"contact_phone" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"client_id" integer,
	"client_name" text,
	"phone_raw" text,
	"phone_normalized" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" text,
	"error_message" text,
	"meta_http_status" integer,
	"meta_response" text,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body" text,
	"audience_filter" text DEFAULT 'all' NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"clicked_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0,
	"send_report" text,
	"created_by" text,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"target_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"level" text DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_clerk_id" text NOT NULL,
	"org_id" integer NOT NULL,
	"org_name" text,
	"reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"clock_in_at" timestamp NOT NULL,
	"clock_out_at" timestamp,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"total_minutes" integer,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"method" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"entry_id" integer,
	"type" text NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"description" text,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"type" text DEFAULT 'vacation' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"position" text,
	"weekly_hours" numeric(5, 2) DEFAULT 40 NOT NULL,
	"hourly_rate" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"view_count" bigint,
	"user_count" bigint,
	"video_count" bigint,
	"follower_count" bigint
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_campaigns" ADD CONSTRAINT "ads_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_creatives" ADD CONSTRAINT "ads_creatives_campaign_id_ads_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ads_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_history" ADD CONSTRAINT "memory_history_memory_id_agent_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."agent_memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_task_id_autopilot_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."autopilot_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_tasks" ADD CONSTRAINT "autopilot_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_tasks" ADD CONSTRAINT "autopilot_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_tokens" ADD CONSTRAINT "client_portal_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_tokens" ADD CONSTRAINT "client_portal_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_autopilot_task_id_autopilot_tasks_id_fk" FOREIGN KEY ("autopilot_task_id") REFERENCES "public"."autopilot_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD CONSTRAINT "org_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_plans" ADD CONSTRAINT "license_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_calculations" ADD CONSTRAINT "tax_calculations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_health_score" ADD CONSTRAINT "tax_health_score_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reminders" ADD CONSTRAINT "tax_reminders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reminders" ADD CONSTRAINT "tax_reminders_obligation_id_tax_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."tax_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_analysis" ADD CONSTRAINT "lead_analysis_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_analysis" ADD CONSTRAINT "lead_analysis_result_id_lead_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lead_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_result_id_lead_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lead_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_search_id_lead_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."lead_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_crm_client_id_clients_id_fk" FOREIGN KEY ("crm_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_logs" ADD CONSTRAINT "campaign_send_logs_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_worker_id_time_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."time_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_incidents" ADD CONSTRAINT "time_incidents_worker_id_time_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."time_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_incidents" ADD CONSTRAINT "time_incidents_entry_id_time_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_worker_id_time_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."time_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_org_id_idx" ON "credit_notes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "expenses_org_id_idx" ON "expenses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_recurring_invoice_id_idx" ON "invoices" USING btree ("recurring_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_share_token_idx" ON "invoices" USING btree ("share_token") WHERE "invoices"."share_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_org_id_idx" ON "accounting_payments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "accounting_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_org_id_idx" ON "recurring_invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_next_run_at_idx" ON "recurring_invoices" USING btree ("next_run_at") WHERE "recurring_invoices"."is_active" = true;--> statement-breakpoint
CREATE INDEX "ads_campaigns_org_id_idx" ON "ads_campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ads_creatives_campaign_id_idx" ON "ads_creatives" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ads_creatives_org_id_idx" ON "ads_creatives" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "portal_tokens_token_idx" ON "client_portal_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "diagnostic_reports_org_id_idx" ON "diagnostic_reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "diagnostic_reports_created_at_idx" ON "diagnostic_reports" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tax_calculations_org_id_idx" ON "tax_calculations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tax_calculations_type_period_idx" ON "tax_calculations" USING btree ("tax_type","year","quarter");--> statement-breakpoint
CREATE INDEX "tax_documents_org_id_idx" ON "tax_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tax_documents_category_idx" ON "tax_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tax_documents_status_idx" ON "tax_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_health_score_org_id_idx" ON "tax_health_score" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tax_health_score_created_idx" ON "tax_health_score" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tax_obligations_org_id_idx" ON "tax_obligations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tax_obligations_status_idx" ON "tax_obligations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_obligations_due_date_idx" ON "tax_obligations" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tax_reminders_org_id_idx" ON "tax_reminders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tax_reminders_remind_at_idx" ON "tax_reminders" USING btree ("remind_at");--> statement-breakpoint
CREATE INDEX "tax_reminders_sent_at_idx" ON "tax_reminders" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "lead_analysis_result_id_idx" ON "lead_analysis" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "lead_messages_result_id_idx" ON "lead_messages" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "lead_results_org_id_idx" ON "lead_results" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lead_results_search_id_idx" ON "lead_results" USING btree ("search_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_results_org_place_id_uidx" ON "lead_results" USING btree ("org_id","place_id") WHERE "lead_results"."place_id" is not null;--> statement-breakpoint
CREATE INDEX "lead_searches_org_id_idx" ON "lead_searches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_csl_campaign" ON "campaign_send_logs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("org_id","target_user_id","is_read");--> statement-breakpoint
CREATE INDEX "support_sessions_admin_idx" ON "support_sessions" USING btree ("admin_clerk_id","status");--> statement-breakpoint
CREATE INDEX "idx_time_entries_open" ON "time_entries" USING btree ("org_id","status") WHERE "time_entries"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_time_entries_worker" ON "time_entries" USING btree ("org_id","worker_id","clock_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_time_incidents_open" ON "time_incidents" USING btree ("org_id","resolved_at") WHERE "time_incidents"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_time_off_pending" ON "time_off_requests" USING btree ("org_id","status") WHERE "time_off_requests"."status" = 'pending';