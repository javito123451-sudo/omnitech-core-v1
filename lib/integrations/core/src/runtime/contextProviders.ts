import type { ConnectorContext } from "../types.js";
import { randomUUID } from "node:crypto";

/**
 * ContextProvider — resolves the org-scoped config/credentials for a connector.
 * The Core defines only the seam; the app layer supplies the real implementation
 * (reading org_integrations, decrypting credentials, etc.) via `register()`.
 * This keeps DB/encryption concerns out of connector-core entirely.
 */
export interface ContextProvider {
  resolve(orgId: number, connectorSlug: string): Promise<{
    config: Record<string, unknown>;
    credentials: Record<string, string>;
  }>;
}

/** Provider useful for tests, CLI dry-runs, and contract-testing sandbox connectors. */
export class StaticContextProvider implements ContextProvider {
  constructor(
    private readonly config: Record<string, unknown> = {},
    private readonly credentials: Record<string, string> = {},
  ) {}

  async resolve(): Promise<{ config: Record<string, unknown>; credentials: Record<string, string> }> {
    return { config: this.config, credentials: this.credentials };
  }
}

export class ContextProviderRegistry {
  private provider: ContextProvider | null = null;

  register(provider: ContextProvider): void {
    this.provider = provider;
  }

  async buildContext(orgId: number, connectorSlug: string): Promise<ConnectorContext> {
    if (!this.provider) {
      throw new Error(
        "No ContextProvider registered. The app layer must call contextProviderRegistry.register(...) at startup.",
      );
    }
    const { config, credentials } = await this.provider.resolve(orgId, connectorSlug);
    return { orgId, connectorSlug, config, credentials, requestId: randomUUID() };
  }
}

export const contextProviderRegistry = new ContextProviderRegistry();
