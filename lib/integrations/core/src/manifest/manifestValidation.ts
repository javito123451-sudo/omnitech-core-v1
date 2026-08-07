import { z } from "zod";
import type { ConnectorManifest } from "../types.js";
import { ManifestValidationError } from "../types.js";

const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
// Field keys become JS/TS object property names at runtime (input.invoiceNumber),
// so camelCase must be allowed alongside snake_case — unlike slugs, which stay kebab-case.
const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const fieldSchema = z.object({
  key: z.string().regex(FIELD_KEY_RE, "key must be a valid identifier (camelCase or snake_case)"),
  label: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "select", "secret", "json", "date"]),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  options: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .optional(),
});

const actionSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  label: z.string().min(1),
  description: z.string().optional(),
  input: z.array(fieldSchema),
  output: z.array(fieldSchema),
  idempotent: z.boolean().optional(),
});

const eventSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  label: z.string().min(1),
  description: z.string().optional(),
  payload: z.array(fieldSchema),
});

const resourceSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(fieldSchema),
  listable: z.boolean().optional(),
});

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export const manifestSchema = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase kebab-case (e.g. 'whatsapp-cloud')"),
  name: z.string().min(1),
  version: z.string().regex(SEMVER_RE, "version must be semver x.y.z"),
  description: z.string().optional(),
  vendor: z.string().optional(),
  category: z.enum(["messaging", "crm", "calendar", "payments", "productivity", "custom"]),
  configSchema: z.array(fieldSchema),
  actions: z.array(actionSchema),
  events: z.array(eventSchema),
  resources: z.array(resourceSchema),
  load: z.function(),
});

/**
 * Validates a manifest's shape AND its internal referential integrity
 * (no duplicate slugs across actions/events/resources).
 * Throws ManifestValidationError on the first violation.
 */
export function validateManifest(manifest: ConnectorManifest): void {
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ManifestValidationError(
      `Invalid manifest for "${manifest?.slug ?? "unknown"}": ${issues}`,
      manifest?.slug,
    );
  }

  assertUniqueSlugs(manifest.actions.map((a) => a.slug), "action", manifest.slug);
  assertUniqueSlugs(manifest.events.map((e) => e.slug), "event", manifest.slug);
  assertUniqueSlugs(manifest.resources.map((r) => r.slug), "resource", manifest.slug);
}

function assertUniqueSlugs(slugs: string[], kind: string, connectorSlug: string): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) {
      throw new ManifestValidationError(
        `Duplicate ${kind} slug "${slug}" in connector "${connectorSlug}"`,
        connectorSlug,
      );
    }
    seen.add(slug);
  }
}
