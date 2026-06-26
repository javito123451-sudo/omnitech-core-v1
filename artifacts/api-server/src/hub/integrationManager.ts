/**
 * Omni Integration Hub — Integration Manager
 * Central service that all integrations go through.
 * Ava never talks directly to a provider; always goes through the Manager.
 */
import { db, orgIntegrationsTable, integrationEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  decryptCredentials,
  encryptCredentials,
} from "../utils/integrationCreds";
import { IntegrationRegistry } from "./integrationRegistry";
import type {
  IntegrationAdapter,
  AdapterContext,
  SendMessagePayload,
  SendMessageResult,
  ReceiveMessagePayload,
  IntegrationHealth,
  ValidationResult,
  IntegrationRecord,
} from "./types";

export { IntegrationRegistry };

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getOrgIntegration(
  orgId: number,
  slug: string,
): Promise<IntegrationRecord | null> {
  const [row] = await db
    .select()
    .from(orgIntegrationsTable)
    .where(
      and(
        eq(orgIntegrationsTable.orgId, orgId),
        eq(orgIntegrationsTable.integrationSlug, slug),
      ),
    );
  return row as IntegrationRecord | null;
}

function buildContext(row: IntegrationRecord): AdapterContext {
  const credentials: Record<string, string> = row.credentialsEnc
    ? decryptCredentials(row.credentialsEnc)
    : {};
  const config: Record<string, unknown> = row.config
    ? JSON.parse(row.config)
    : {};
  return {
    orgId:       row.orgId,
    credentials,
    config,
    displayName: row.displayName ?? undefined,
  };
}

async function logEvent(opts: {
  orgId:           number;
  integrationSlug: string;
  direction:       "inbound" | "outbound";
  eventType:       string;
  status:          "processed" | "error";
  summary:         string;
  errorMessage?:   string;
  payloadJson?:    Record<string, unknown>;
}) {
  try {
    await db.insert(integrationEventsTable).values({
      orgId:           opts.orgId,
      integrationSlug: opts.integrationSlug,
      direction:       opts.direction,
      eventType:       opts.eventType,
      status:          opts.status,
      summary:         opts.summary,
      errorMessage:    opts.errorMessage ?? null,
      payloadJson:     opts.payloadJson ? JSON.stringify(opts.payloadJson) : null,
    });
  } catch (e) {
    console.error("[IntegrationManager] logEvent failed:", e);
  }
}

async function updateStatus(
  orgId: number,
  slug: string,
  status: string,
  errorMessage?: string,
  healthJson?: string,
) {
  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (errorMessage !== undefined) updates.errorMessage = errorMessage;
  if (healthJson !== undefined) {
    // We don't have a dedicated health column yet; store in config
    // But we'll also update the record if a column exists
    try {
      const [row] = await db
        .select()
        .from(orgIntegrationsTable)
        .where(
          and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, slug)),
        );
      if (row) {
        const cfg = row.config ? JSON.parse(row.config) : {};
        cfg._health = healthJson ? JSON.parse(healthJson) : null;
        updates.config = JSON.stringify(cfg);
      }
    } catch { /* ignore */ }
  }
  await db
    .update(orgIntegrationsTable)
    .set(updates)
    .where(
      and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, slug)),
    );
}

// ── Integration Manager ───────────────────────────────────────────────────────

export const IntegrationManager = {
  // ── Adapter registry shortcuts ─────────────────────────────────────────────
  registerAdapter(slug: string, adapter: IntegrationAdapter): void {
    IntegrationRegistry.register(slug, adapter);
  },

  // ── connect() — activate an integration ───────────────────────────────────
  async connect(orgId: number, slug: string): Promise<ValidationResult> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) {
      return { valid: false, missing: [], errors: [`No adapter registered for "${slug}"`] };
    }

    const row = await getOrgIntegration(orgId, slug);
    if (!row) {
      return { valid: false, missing: [], errors: ["Integration not configured"] };
    }

    const ctx = buildContext(row);
    const validation = await adapter.validate(ctx);
    if (!validation.valid) {
      await updateStatus(orgId, slug, "error", validation.errors?.join("; ") ?? "Validation failed");
      await logEvent({
        orgId, integrationSlug: slug, direction: "outbound",
        eventType: "connect_failed", status: "error",
        summary: `Connect failed: ${validation.errors?.join("; ") ?? "Validation failed"}`,
        errorMessage: validation.errors?.join("; "),
      });
      return validation;
    }

    await updateStatus(orgId, slug, "connected");
    await logEvent({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: "connected", status: "processed",
      summary: `Integration "${slug}" connected successfully`,
    });

    return { valid: true, missing: [] };
  },

  // ── disconnect() — deactivate ───────────────────────────────────────────────
  async disconnect(orgId: number, slug: string): Promise<void> {
    const adapter = IntegrationRegistry.get(slug);
    const row = await getOrgIntegration(orgId, slug);
    if (adapter && row) {
      await adapter.disconnect?.(buildContext(row)).catch(() => { /* non-critical */ });
    }
    await updateStatus(orgId, slug, "inactive");
    await logEvent({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: "disconnected", status: "processed",
      summary: `Integration "${slug}" disconnected`,
    });
  },

  // ── validate() — only check credentials, don't update status ──────────────
  async validate(orgId: number, slug: string): Promise<ValidationResult> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) return { valid: false, missing: [], errors: [`No adapter for "${slug}"`] };

    const row = await getOrgIntegration(orgId, slug);
    if (!row) return { valid: false, missing: [], errors: ["Not configured"] };

    return adapter.validate(buildContext(row));
  },

  // ── healthCheck() — full provider connectivity check ─────────────────────────
  async healthCheck(orgId: number, slug: string): Promise<IntegrationHealth> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) {
      return {
        overall: "unhealthy",
        checkedAt: new Date().toISOString(),
        results: [{ name: "adapter_registered", status: "fail", message: `No adapter for "${slug}"`, durationMs: 0 }],
      };
    }

    const row = await getOrgIntegration(orgId, slug);
    if (!row) {
      return {
        overall: "unhealthy",
        checkedAt: new Date().toISOString(),
        results: [{ name: "configured", status: "fail", message: "Integration not configured", durationMs: 0 }],
      };
    }

    const ctx = buildContext(row);
    const t0 = Date.now();
    const health = await adapter.healthCheck(ctx);
    const durationMs = Date.now() - t0;

    // Store health result
    const healthJson = JSON.stringify({
      ...health,
      checkedAt: health.checkedAt,
      durationMs,
    });
    await updateStatus(orgId, slug, health.overall === "healthy" ? "connected" : health.overall === "degraded" ? "pending" : "error", undefined, healthJson);

    await logEvent({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: "health_check", status: health.overall === "healthy" ? "processed" : "error",
      summary: `Health check: ${health.overall}`,
      payloadJson: { overall: health.overall, resultCount: health.results.length },
    });

    return health;
  },

  // ── send() — send a message through the provider ─────────────────────────────
  async send(
    orgId: number,
    slug: string,
    payload: SendMessagePayload,
  ): Promise<SendMessageResult> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) {
      const err = `No adapter registered for "${slug}"`;
      await logEvent({
        orgId, integrationSlug: slug, direction: "outbound",
        eventType: "send_failed", status: "error",
        summary: err, errorMessage: err,
      });
      return { success: false, error: err };
    }

    const row = await getOrgIntegration(orgId, slug);
    if (!row) {
      const err = `Integration "${slug}" not configured for org ${orgId}`;
      await logEvent({
        orgId, integrationSlug: slug, direction: "outbound",
        eventType: "send_failed", status: "error",
        summary: err, errorMessage: err,
      });
      return { success: false, error: err };
    }

    const ctx = buildContext(row);
    const t0 = Date.now();
    const result = await adapter.send(ctx, payload);
    const durationMs = Date.now() - t0;

    await logEvent({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: result.success ? "message_sent" : "send_failed",
      status: result.success ? "processed" : "error",
      summary: result.success
        ? `Message sent to ${payload.to} (${durationMs}ms)`
        : `Send failed: ${result.error}`,
      errorMessage: result.error ?? null,
      payloadJson: { to: payload.to, durationMs, providerId: result.providerId },
    });

    return result;
  },

  // ── receive() — process an incoming webhook payload ─────────────────────────
  async receive(
    slug: string,
    rawPayload: unknown,
  ): Promise<ReceiveMessagePayload | null> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) {
      console.warn(`[IntegrationManager] receive() — no adapter for "${slug}"`);
      return null;
    }
    return adapter.receive(rawPayload);
  },

  // ── refreshCredentials() — rotate tokens if needed ─────────────────────────
  async refreshCredentials(orgId: number, slug: string): Promise<ValidationResult> {
    const adapter = IntegrationRegistry.get(slug);
    if (!adapter) return { valid: false, missing: [], errors: [`No adapter for "${slug}"`] };
    if (!adapter.refreshCredentials) return { valid: true, missing: [], errors: [] };

    const row = await getOrgIntegration(orgId, slug);
    if (!row) return { valid: false, missing: [], errors: ["Not configured"] };

    const ctx = buildContext(row);
    const result = await adapter.refreshCredentials(ctx);
    if (result.valid && row.credentialsEnc) {
      // If the adapter returned new credentials in the context, persist them
      // (Adapters should mutate ctx.credentials with new tokens)
      const newEnc = encryptCredentials(ctx.credentials);
      await db
        .update(orgIntegrationsTable)
        .set({ credentialsEnc: newEnc, updatedAt: new Date() })
        .where(
          and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.integrationSlug, slug)),
        );
    }
    return result;
  },
};
