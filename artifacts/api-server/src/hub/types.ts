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
 * Every provider adapter must implement this interface.
 * New adapters register via IntegrationRegistry.register(slug, adapter).
 */
export interface IntegrationAdapter {
  /** Validate that credentials are present and non-empty. */
  validate(context: AdapterContext): Promise<ValidationResult>;

  /** Full health check — calls provider APIs to verify connectivity. */
  healthCheck(context: AdapterContext): Promise<IntegrationHealth>;

  /** Send a message through the provider. */
  send(context: AdapterContext, payload: SendMessagePayload): Promise<SendMessageResult>;

  /**
   * Receive a message. Called by the webhook handler.
   * Returns the processed payload or null if the raw payload is not relevant.
   */
  receive(rawPayload: unknown): Promise<ReceiveMessagePayload | null>;

  /** Optional: refresh tokens/credentials before expiry. */
  refreshCredentials?(context: AdapterContext): Promise<ValidationResult>;

  /** Optional: disconnect / cleanup hooks. */
  disconnect?(context: AdapterContext): Promise<void>;
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
