/**
 * Omni Integration Hub — Public API
 * All integration operations go through the IntegrationManager.
 * Ava never talks directly to a provider.
 */
export { IntegrationManager } from "./integrationManager";
export { IntegrationRegistry } from "./integrationRegistry";
export { isMessagingAdapter, isActionAdapter } from "./types";
export type {
  IntegrationAdapter,
  IntegrationAdapterBase,
  MessagingAdapter,
  ActionAdapter,
  AdapterContext,
  IntegrationStatus,
  HealthStatus,
  HealthCheckResult,
  IntegrationHealth,
  SendMessagePayload,
  SendMessageResult,
  ReceiveMessagePayload,
  ValidationResult,
  IntegrationCredentials,
  IntegrationConfig,
  IntegrationRecord,
  FieldSchema,
  FieldType,
  ActionDefinition,
  ResourceDefinition,
  EventDefinition,
  ActionResult,
  ParsedEvent,
} from "./types";

// Auto-register adapters
import "./adapters/whatsappAdapter";
import "./adapters/telegramAdapter";
import "./adapters/verifactuAdapter";
