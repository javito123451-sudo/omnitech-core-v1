/**
 * OmniTech Connector Framework — Core Types
 * Ref: CONNECTOR_ARCHITECTURE.md v1.2
 *
 * The Core NEVER imports a provider SDK. Every provider-specific detail lives
 * inside a Connector package (lib/integrations/connector-<slug>). The Core only
 * knows about the shapes defined in this file.
 */

// ── Capability primitives ──────────────────────────────────────────────────

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "secret"
  | "json"
  | "date";

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  secret?: boolean;
  description?: string;
  default?: unknown;
  options?: { label: string; value: string }[];
}

/** Metadata describing one callable action a connector exposes (e.g. "send_message"). */
export interface ActionDefinition {
  slug: string;
  label: string;
  description?: string;
  input: FieldSchema[];
  output: FieldSchema[];
  idempotent?: boolean;
}

/** Metadata describing one inbound event a connector can emit (e.g. "message.received"). */
export interface EventDefinition {
  slug: string;
  label: string;
  description?: string;
  payload: FieldSchema[];
}

/** Metadata describing a queryable resource a connector exposes (e.g. "contacts"). */
export interface ResourceDefinition {
  slug: string;
  label: string;
  description?: string;
  fields: FieldSchema[];
  listable?: boolean;
}

export type CapabilityKind = "action" | "event" | "resource";

export interface CapabilityRef {
  kind: CapabilityKind;
  slug: string;
}

// ── Manifest (declarative, no filesystem scanning) ─────────────────────────

/**
 * Static description of a connector. Manifests are registered exclusively via
 * connectors/manifest.ts — the Core never scans the filesystem to discover
 * connectors.
 */
export interface ConnectorManifest {
  slug: string;
  name: string;
  version: string;
  description?: string;
  vendor?: string;
  category: "messaging" | "crm" | "calendar" | "payments" | "productivity" | "custom";
  configSchema: FieldSchema[];
  actions: ActionDefinition[];
  events: EventDefinition[];
  resources: ResourceDefinition[];
  /** Lazily-loaded factory that builds the runtime connector instance. Keeps SDKs out of the Core's module graph until actually needed. */
  load: () => Promise<ConnectorModule> | ConnectorModule;
}

/** The actual runtime implementation a connector package exports. */
export interface ConnectorModule {
  validate(ctx: ConnectorContext): Promise<ValidationResult>;
  healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult>;
  executeAction(
    ctx: ConnectorContext,
    actionSlug: string,
    input: Record<string, unknown>,
  ): Promise<ActionResult>;
  /** Normalizes a raw provider webhook/payload into a typed platform event, or null if irrelevant. */
  parseEvent?(rawPayload: unknown): Promise<ParsedEvent | null>;
  onInstall?(ctx: ConnectorContext): Promise<void>;
  onUninstall?(ctx: ConnectorContext): Promise<void>;
}

// ── Execution context ───────────────────────────────────────────────────────

export interface ConnectorContext {
  orgId: number;
  connectorSlug: string;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  requestId: string;
}

// ── Results ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors?: string[];
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthCheckResult {
  status: HealthStatus;
  checkedAt: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface ActionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  durationMs?: number;
}

export interface ParsedEvent {
  eventSlug: string;
  orgId: number;
  connectorSlug: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

// ── Errors ───────────────────────────────────────────────────────────────

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly connectorSlug?: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export class ManifestValidationError extends ConnectorError {
  constructor(message: string, connectorSlug?: string) {
    super(message, "MANIFEST_INVALID", connectorSlug);
    this.name = "ManifestValidationError";
  }
}

export class ConnectorNotFoundError extends ConnectorError {
  constructor(slug: string) {
    super(`Connector "${slug}" is not registered`, "CONNECTOR_NOT_FOUND", slug);
    this.name = "ConnectorNotFoundError";
  }
}

export class ActionNotFoundError extends ConnectorError {
  constructor(slug: string, actionSlug: string) {
    super(`Action "${actionSlug}" is not defined on connector "${slug}"`, "ACTION_NOT_FOUND", slug);
    this.name = "ActionNotFoundError";
  }
}
