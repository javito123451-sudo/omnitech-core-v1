/**
 * Omni Integration Hub — Shared types for all integration adapters.
 * Every adapter (WhatsApp, Telegram, etc.) implements IntegrationAdapter.
 * Ava never talks directly to a provider; always goes through IntegrationManager.
 */

export type IntegrationStatus =
  | "connected"    // 🟢
  | "pending"      // 🟡
  | "error"        // 🔴
  | "inactive"     // ⚪
  | "production";  // ✅ ready for live traffic

export type HealthStatus =
  | "healthy"      // all checks pass
  | "degraded"     // some checks fail but still functional
  | "unhealthy"    // critical checks fail
  | "unknown";     // not yet checked

export interface HealthCheckResult {
  name:        string;
  status:      "pass" | "fail" | "skip";
  message:     string;
  durationMs:  number;
  detail?:     Record<string, unknown>;
}

export interface IntegrationHealth {
  overall:      HealthStatus;
  checkedAt:    string;
  results:      HealthCheckResult[];
  nextCheckAt?: string;
}

export interface SendMessagePayload {
  to:      string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageResult {
  success:    boolean;
  providerId?: string;
  error?:     string;
  detail?:    Record<string, unknown>;
}

export interface ReceiveMessagePayload {
  from:      string;
  message:   string;
  providerId?: string;
  metadata?: Record<string, unknown>;
  raw?:      unknown;
}

export interface ValidationResult {
  valid:       boolean;
  missing:     string[];
  errors?:     string[];
}

export interface IntegrationCredentials {
  [key: string]: string;
}

export interface IntegrationConfig {
  [key: string]: unknown;
}

export interface AdapterContext {
  orgId:       number;
  credentials: IntegrationCredentials;
  config:      IntegrationConfig;
  displayName?: string;
}

/**
 * Omni Integration Hub — Base contract every adapter implements.
 * Deliberately minimal: only the lifecycle every provider shares regardless
 * of shape (messaging vs. action-based). Nothing provider-specific lives here.
 */
export interface IntegrationAdapterBase {
  /** Validate that credentials are present and non-empty. */
  validate(context: AdapterContext): Promise<ValidationResult>;

  /** Full health check — calls provider APIs to verify connectivity. */
  healthCheck(context: AdapterContext): Promise<IntegrationHealth>;

  /** Optional: refresh tokens/credentials before expiry. */
  refreshCredentials?(context: AdapterContext): Promise<ValidationResult>;

  /** Optional: disconnect / cleanup hooks. */
  disconnect?(context: AdapterContext): Promise<void>;
}

/**
 * Messaging-shaped adapters (WhatsApp, Telegram, and future channels like
 * Slack/Teams): bidirectional send/receive of a single message concept.
 * This is the ORIGINAL IntegrationAdapter shape, unchanged — WhatsAppAdapter
 * and telegramAdapter satisfy this with zero modification.
 */
export interface MessagingAdapter extends IntegrationAdapterBase {
  /** Send a message through the provider. */
  send(context: AdapterContext, payload: SendMessagePayload): Promise<SendMessageResult>;

  /**
   * Receive a message. Called by the webhook handler.
   * Returns the processed payload or null if the raw payload is not relevant.
   */
  receive(rawPayload: unknown): Promise<ReceiveMessagePayload | null>;
}

/**
 * Action-shaped adapters (VeriFactu, Stripe, Google Calendar, Microsoft 365,
 * and future non-messaging providers): a declared set of typed actions,
 * resources, and events rather than a single send/receive pair. This is
 * where "capability metadata" lives — never normalized into send()/receive(),
 * because forcing action-based providers into a messaging contract would be
 * exactly the kind of artificial normalization the Core must never do.
 */
export interface ActionAdapter extends IntegrationAdapterBase {
  /** Declared actions this adapter can execute, with typed input/output schemas. */
  actions: ActionDefinition[];

  /** Declared resources this adapter exposes for read/list operations. */
  resources: ResourceDefinition[];

  /** Declared inbound events this adapter can emit, if any (webhooks, polling, etc.). */
  events: EventDefinition[];

  /** Execute a declared action by slug. */
  executeAction(
    context: AdapterContext,
    actionSlug: string,
    input: Record<string, unknown>,
  ): Promise<ActionResult>;

  /** Optional: normalize a raw provider webhook payload into a typed event, or null if irrelevant. */
  parseEvent?(rawPayload: unknown): Promise<ParsedEvent | null>;
}

/**
 * Every provider adapter must implement one of these two shapes.
 * New adapters register via IntegrationRegistry.register(slug, adapter) exactly
 * as before — registration doesn't change based on shape.
 */
export type IntegrationAdapter = MessagingAdapter | ActionAdapter;

/** Structural (duck-typed) discriminant — no adapter needs a "kind" field to use these. */
export function isMessagingAdapter(adapter: IntegrationAdapter): adapter is MessagingAdapter {
  return typeof (adapter as MessagingAdapter).send === "function";
}

export function isActionAdapter(adapter: IntegrationAdapter): adapter is ActionAdapter {
  return Array.isArray((adapter as ActionAdapter).actions);
}

// ── Action-adapter capability metadata ──────────────────────────────────────

export type FieldType = "string" | "number" | "boolean" | "select" | "secret" | "json" | "date";

export interface FieldSchema {
  key:          string;
  label:        string;
  type:         FieldType;
  required?:    boolean;
  secret?:      boolean;
  description?: string;
  default?:     unknown;
  options?:     { label: string; value: string }[];
}

export interface ActionDefinition {
  slug:         string;
  label:        string;
  description?: string;
  input:        FieldSchema[];
  output:       FieldSchema[];
  idempotent?:  boolean;
}

export interface ResourceDefinition {
  slug:         string;
  label:        string;
  description?: string;
  fields:       FieldSchema[];
  listable?:    boolean;
}

export interface EventDefinition {
  slug:         string;
  label:        string;
  description?: string;
  payload:      FieldSchema[];
}

export interface ActionResult {
  success:    boolean;
  output?:    Record<string, unknown>;
  error?:     string;
  errorCode?: string;
  durationMs?: number;
}

export interface ParsedEvent {
  eventSlug:     string;
  orgId:         number;
  integrationSlug: string;
  payload:       Record<string, unknown>;
  occurredAt:    string;
}

/**
 * Internal record stored in the DB for each org-integration pair.
 */
export interface IntegrationRecord {
  id:              number;
  orgId:           number;
  integrationSlug: string;
  status:          IntegrationStatus;
  config:          string | null;        // JSON
  credentialsEnc:  string | null;
  displayName:     string | null;
  externalId:      string | null;
  health:          string | null;        // JSON
  lastSyncedAt:    Date | null;
  errorMessage:    string | null;
  mode:            "staging" | "production";
  createdAt:       Date;
  updatedAt:       Date;
}
