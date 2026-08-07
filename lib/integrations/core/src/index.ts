// OmniTech Connector Framework — Core public API (Fase 1)
// Ref: CONNECTOR_ARCHITECTURE.md v1.2

export * from "./types.js";

export { validateManifest } from "./manifest/manifestValidation.js";
export { ManifestLoader } from "./manifest/manifestLoader.js";

export { ActionsRegistry } from "./registry/actionsRegistry.js";
export { EventsRegistry } from "./registry/eventsRegistry.js";
export { ResourceRegistry } from "./registry/resourceRegistry.js";
export { IntegrationRegistry, integrationRegistry } from "./registry/integrationRegistry.js";
export { CapabilityResolver, type ConnectorCapabilities } from "./registry/capabilityResolver.js";

export { validateConnectorModule } from "./factory/connectorValidation.js";
export { ConnectorFactory } from "./factory/connectorFactory.js";

export { ConnectorRuntime } from "./runtime/connectorRuntime.js";
export {
  ContextProviderRegistry,
  StaticContextProvider,
  contextProviderRegistry,
  type ContextProvider,
} from "./runtime/contextProviders.js";

export { ExecutionEngine, TimeoutError } from "./execution/executionEngine.js";
export {
  ExecutionDispatcher,
  DEFAULT_RETRY_POLICY,
  NO_RETRY,
  type RetryPolicy,
  type DispatchOptions,
} from "./execution/executionDispatcher.js";

export { HealthEngine } from "./health/healthEngine.js";

export { Metrics, InMemoryMetricsSink, type MetricsSink } from "./observability/metrics.js";
export {
  InternalConnectorEventBus,
  makeConnectorEvent,
  type IConnectorEventBus,
  type ConnectorRuntimeEvent,
  type ConnectorRuntimeEventType,
} from "./observability/events.js";

export { ContractTestHarness, type ContractTestReport, type ContractTestCase } from "./testing/contractTestHarness.js";
