import type { CapabilityKind, ConnectorManifest, FieldSchema } from "../types.js";
import type { IntegrationRegistry } from "./integrationRegistry.js";

/**
 * Flattened, UI-ready description of one connector's full capability surface.
 * This is the ONLY shape the frontend should ever consume — it never needs
 * provider-specific form components because everything here is field-schema
 * driven (see FieldSchema in types.ts).
 */
export interface ConnectorCapabilities {
  slug: string;
  name: string;
  version: string;
  category: ConnectorManifest["category"];
  configSchema: FieldSchema[];
  actions: { slug: string; label: string; input: FieldSchema[]; output: FieldSchema[] }[];
  events: { slug: string; label: string; payload: FieldSchema[] }[];
  resources: { slug: string; label: string; fields: FieldSchema[]; listable: boolean }[];
}

/**
 * CapabilityResolver — turns raw manifests into the metadata-driven shape the
 * Control Center UI renders generically. Adding a connector should never
 * require writing a new form component; it only requires a manifest.
 */
export class CapabilityResolver {
  constructor(private readonly registry: IntegrationRegistry) {}

  resolve(slug: string): ConnectorCapabilities {
    const m = this.registry.get(slug);
    return toCapabilities(m);
  }

  resolveAll(): ConnectorCapabilities[] {
    return this.registry.list().map(toCapabilities);
  }

  /** Returns true if the connector declares the given capability. */
  supports(slug: string, kind: CapabilityKind, capabilitySlug: string): boolean {
    const m = this.registry.tryGet(slug);
    if (!m) return false;
    switch (kind) {
      case "action":
        return m.actions.some((a) => a.slug === capabilitySlug);
      case "event":
        return m.events.some((e) => e.slug === capabilitySlug);
      case "resource":
        return m.resources.some((r) => r.slug === capabilitySlug);
    }
  }
}

function toCapabilities(m: ConnectorManifest): ConnectorCapabilities {
  return {
    slug: m.slug,
    name: m.name,
    version: m.version,
    category: m.category,
    configSchema: m.configSchema,
    actions: m.actions.map((a) => ({ slug: a.slug, label: a.label, input: a.input, output: a.output })),
    events: m.events.map((e) => ({ slug: e.slug, label: e.label, payload: e.payload })),
    resources: m.resources.map((r) => ({
      slug: r.slug,
      label: r.label,
      fields: r.fields,
      listable: r.listable ?? false,
    })),
  };
}
