import type { ConnectorModule } from "../types.js";
import { ManifestValidationError } from "../types.js";

const REQUIRED_FNS = ["validate", "healthCheck", "executeAction"] as const;

/**
 * Verifies a loaded connector module actually implements the ConnectorModule
 * contract at runtime. Manifests are validated statically (manifestValidation.ts);
 * this catches the case where `load()` resolves to something malformed —
 * important because `load` is dynamic and can't be checked by Zod alone.
 */
export function validateConnectorModule(mod: unknown, slug: string): asserts mod is ConnectorModule {
  if (!mod || typeof mod !== "object") {
    throw new ManifestValidationError(`Connector "${slug}" load() did not resolve to an object`, slug);
  }
  for (const fn of REQUIRED_FNS) {
    const value = (mod as Record<string, unknown>)[fn];
    if (typeof value !== "function") {
      throw new ManifestValidationError(
        `Connector "${slug}" is missing required method "${fn}"`,
        slug,
      );
    }
  }
}
