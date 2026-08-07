/**
 * connectors/manifest.ts — THE sole discovery entry point for the Connector
 * Framework Core (CONNECTOR_ARCHITECTURE.md v1.2).
 *
 * The Core (lib/integrations/core) never scans the filesystem. Every
 * connector must be explicitly imported and listed here. Adding a connector
 * to the platform means, and only means, adding one line to this array.
 *
 * Fase 1 status: this file exists and is validated by tests, but is NOT YET
 * wired into any existing route or the legacy hub/ system. Bootstrapping the
 * app-wide `integrationRegistry` singleton with this list, and bridging a
 * real Postgres-backed ChainStore + ContextProvider, is Fase 2 (Strangler
 * Fig cutover) — it must not happen inside Fase 1 per the restrictions on
 * touching public endpoints.
 */
import type { ConnectorManifest } from "@workspace/connector-core";
import { verifactuManifest } from "@workspace/connector-verifactu";

export const connectorManifests: readonly ConnectorManifest[] = [verifactuManifest];
