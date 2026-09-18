/**
 * Omni Integration Hub — Public API
 * All integration operations go through the IntegrationManager.
 * Ava never talks directly to a provider.
 */
export { IntegrationManager } from "./integrationManager";
export { IntegrationRegistry } from "./integrationRegistry";
export { DeliveryProviderRegistry } from "./deliveryProviderRegistry";
export type {
  IntegrationAdapter,
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
} from "./types";
export type { DeliveryStatusProvider, DeliveryStatusUpdate, DeliveryStatus } from "./deliveryStatusTypes";

// Auto-register adapters
import "./adapters/whatsappAdapter";
import "./adapters/telegramAdapter";
import "./adapters/emailAdapter";
import "./adapters/genericDeliveryWebhookAdapter";
