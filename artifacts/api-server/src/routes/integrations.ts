import { Router } from "express";
import {
  db,
  integrationsTable,
  orgIntegrationsTable,
  integrationEventsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  encryptCredentials,
  decryptCredentials,
} from "../utils/integrationCreds";
import { logAudit } from "../utils/auditLogger";
import { autoSetupTelegramWebhooks } from "./telegram";
import { IntegrationManager } from "../hub";

export const integrationsRouter = Router();

// ── Catálogo estático (fuente de verdad para la UI + seed de DB) ──────────────
const CATALOG = [
  {
    slug:         "whatsapp",
    name:         "WhatsApp Business",
    category:     "communication",
    authType:     "api_key",
    planRequired: "free",
    description:  "Recibe y envía mensajes automáticamente. Activa la aceptación de presupuestos vía WhatsApp.",
    iconSlug:     "MessageCircle",
    sortOrder:    0,
  },
  {
    slug:         "stripe",
    name:         "Stripe",
    category:     "payments",
    authType:     "api_key",
    planRequired: "pro",
    description:  "Procesa pagos y rastrea cobros automáticamente cuando se aceptan presupuestos.",
    iconSlug:     "CreditCard",
    sortOrder:    1,
  },
  {
    slug:         "webhook_outbound",
    name:         "Webhooks Salientes",
    category:     "automation",
    authType:     "webhook",
    planRequired: "free",
    description:  "Envía eventos del CRM a cualquier URL. Conecta con Zapier, Make o tu sistema propio.",
    iconSlug:     "Globe",
    sortOrder:    2,
  },
  {
    slug:         "gmail",
    name:         "Gmail",
    category:     "communication",
    authType:     "oauth2",
    planRequired: "pro",
    description:  "Envía emails directamente desde el CRM usando tu cuenta de Gmail.",
    iconSlug:     "Mail",
    sortOrder:    3,
  },
  {
    slug:         "google_calendar",
    name:         "Google Calendar",
    category:     "calendar",
    authType:     "oauth2",
    planRequired: "pro",
    description:  "Sincroniza citas del CRM con tu Google Calendar en tiempo real.",
    iconSlug:     "CalendarDays",
    sortOrder:    4,
  },
  {
    slug:         "slack",
    name:         "Slack",
    category:     "automation",
    authType:     "oauth2",
    planRequired: "pro",
    description:  "Recibe notificaciones cuando se aceptan presupuestos o se añaden nuevos clientes.",
    iconSlug:     "Hash",
    sortOrder:    5,
  },
  {
    slug:         "telegram",
    name:         "Telegram Bot",
    category:     "communication",
    authType:     "api_key",
    planRequired: "free",
    description:  "Envía notificaciones y mensajes a clientes vía Telegram usando tu propio bot.",
    iconSlug:     "Send",
    sortOrder:    6,
  },
] as const;

// Seed catalog on startup (idempotent)
void (async () => {
  try {
    await db
      .insert(integrationsTable)
      .values(CATALOG.map((c) => ({ ...c, isActive: true })))
      .onConflictDoNothing();
    console.log("[Integrations] Catalog seeded ✓");
  } catch (err) {
    console.error("[Integrations] Catalog seed error:", err);
  }
})();

// ── GET / — catálogo + estado de conexión por org ─────────────────────────────
integrationsRouter.get("/", async (req, res) => {
  try {
    const orgId = req.orgId!;

    const connections = await db
      .select()
      .from(orgIntegrationsTable)
      .where(eq(orgIntegrationsTable.orgId, orgId));

    const connMap = new Map(connections.map((c) => [c.integrationSlug, c]));

    const result = CATALOG.map((item) => {
      const conn = connMap.get(item.slug);
      return {
        ...item,
        connected:    !!conn,
        status:       conn?.status ?? "inactive",
        displayName:  conn?.displayName ?? null,
        lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
        errorMessage: conn?.errorMessage ?? null,
        connectedAt:  conn?.createdAt?.toISOString() ?? null,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /:slug — detalle + eventos ────────────────────────────────────────────
integrationsRouter.get("/:slug", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const catalogItem = CATALOG.find((c) => c.slug === slug);
    if (!catalogItem) {
      res.status(404).json({ error: "Integración no encontrada" });
      return;
    }

    const [conn] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(
        and(
          eq(integrationEventsTable.orgId, orgId),
          eq(integrationEventsTable.integrationSlug, slug),
        ),
      )
      .orderBy(desc(integrationEventsTable.createdAt))
      .limit(50);

    // Credential keys present (without exposing values)
    let credentialKeysPresent: string[] = [];
    if (conn?.credentialsEnc) {
      const dec = decryptCredentials(conn.credentialsEnc);
      credentialKeysPresent = Object.keys(dec).filter((k) => !!dec[k]);
    }

    const connection = conn
      ? {
          status:                conn.status,
          displayName:           conn.displayName,
          config:                conn.config ? (JSON.parse(conn.config) as Record<string, unknown>) : null,
          lastSyncedAt:          conn.lastSyncedAt?.toISOString() ?? null,
          expiresAt:             conn.expiresAt?.toISOString() ?? null,
          errorMessage:          conn.errorMessage,
          createdAt:             conn.createdAt.toISOString(),
          updatedAt:             conn.updatedAt.toISOString(),
          hasCredentials:        !!conn.credentialsEnc,
          credentialKeysPresent,
        }
      : null;

    res.json({
      ...catalogItem,
      connection,
      events: events.map((e) => ({
        id:        e.id,
        direction: e.direction,
        eventType: e.eventType,
        status:    e.status,
        summary:   e.summary,
        error:     e.errorMessage,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /:slug/connect — guardar credenciales ────────────────────────────────
integrationsRouter.post("/:slug/connect", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const catalogItem = CATALOG.find((c) => c.slug === slug);
    if (!catalogItem) {
      res.status(404).json({ error: "Integración no encontrada" });
      return;
    }

    const {
      credentials = {},
      config      = {},
      displayName,
    } = req.body as {
      credentials?: Record<string, string>;
      config?:      Record<string, string>;
      displayName?: string;
    };

    const credentialsEnc = Object.keys(credentials).length > 0
      ? encryptCredentials(credentials)
      : undefined;

    const now = new Date();
    const existing = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(orgIntegrationsTable)
        .set({
          status:         "active",
          config:         Object.keys(config).length > 0 ? JSON.stringify(config) : existing[0]?.config,
          credentialsEnc: credentialsEnc ?? existing[0]?.credentialsEnc,
          displayName:    displayName ?? existing[0]?.displayName,
          errorMessage:   null,
          updatedAt:      now,
        })
        .where(
          and(
            eq(orgIntegrationsTable.orgId, orgId),
            eq(orgIntegrationsTable.integrationSlug, slug),
          ),
        );
    } else {
      await db.insert(orgIntegrationsTable).values({
        orgId,
        integrationSlug: slug,
        status:          "active",
        config:          Object.keys(config).length > 0 ? JSON.stringify(config) : null,
        credentialsEnc:  credentialsEnc ?? null,
        displayName:     displayName ?? null,
      });
    }

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:    "integration_connected",
      resource:  "integration",
      resourceId: slug,
      orgId,
      details: { slug, name: catalogItem.name, displayName: displayName ?? null, hasCredentials: Object.keys(credentials).length > 0 },
      severity: "info",
      result:   "success",
      req,
    });

    await db.insert(integrationEventsTable).values({
      orgId,
      integrationSlug: slug,
      direction:       "outbound",
      eventType:       "connected",
      status:          "processed",
      summary:         `Integración "${catalogItem.name}" configurada`,
    }).catch(() => {/* non-critical */});

    // ── Telegram: register webhook immediately after saving bot token ─────────
    // autoSetupTelegramWebhooks reads from DB, so credentials must be saved first.
    if (slug === "telegram" && credentials.botToken) {
      const publicBase = process.env["PUBLIC_URL"] ?? "https://omnitech-core.com";
      void autoSetupTelegramWebhooks(publicBase).catch((e) =>
        console.error("[Integrations] Telegram webhook auto-setup failed:", e),
      );
    }

    res.json({ success: true, status: "active" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /:slug/disconnect — eliminar conexión ──────────────────────────────
integrationsRouter.delete("/:slug/disconnect", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const catalogItem = CATALOG.find((c) => c.slug === slug);

    await db
      .delete(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    logAudit({
      actorClerkId: req.clerkUserId!,
      action:    "integration_disconnected",
      resource:  "integration",
      resourceId: slug,
      orgId,
      details: { slug, name: catalogItem?.name ?? slug },
      severity: "warning",
      result:   "success",
      req,
    });

    await db.insert(integrationEventsTable).values({
      orgId,
      integrationSlug: slug,
      direction:       "outbound",
      eventType:       "disconnected",
      status:          "processed",
      summary:         `Integración "${catalogItem?.name ?? slug}" desconectada`,
    }).catch(() => {/* non-critical */});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /:slug/config — actualizar config no sensible ───────────────────────
integrationsRouter.patch("/:slug/config", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;
    const { config, displayName } = req.body as {
      config?:      Record<string, unknown>;
      displayName?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (config      !== undefined) updates["config"]      = JSON.stringify(config);
    if (displayName !== undefined) updates["displayName"] = displayName;

    await db
      .update(orgIntegrationsTable)
      .set(updates)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /:slug/test — verificar credenciales ────────────────────────────────
integrationsRouter.post("/:slug/test", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const catalogItem = CATALOG.find((c) => c.slug === slug);
    if (!catalogItem) {
      res.status(404).json({ error: "Integración no encontrada" });
      return;
    }

    const [conn] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    if (!conn?.credentialsEnc) {
      res.json({ success: false, message: "No hay credenciales guardadas para esta integración." });
      return;
    }

    const requiredKeys: Record<string, string[]> = {
      whatsapp:         ["phoneNumberId", "accessToken"],
      stripe:           ["apiKey"],
      webhook_outbound: ["url"],
      telegram:         ["botToken"],
    };

    const creds      = decryptCredentials(conn.credentialsEnc);
    const required   = requiredKeys[slug] ?? [];
    const missing    = required.filter((k) => !creds[k]);
    const t0         = Date.now();

    if (missing.length > 0) {
      await db.insert(integrationEventsTable).values({
        orgId, integrationSlug: slug, direction: "outbound",
        eventType: "test_failed", status: "error",
        summary: `Test fallido — faltan campos: ${missing.join(", ")}`,
        errorMessage: `Campos requeridos faltantes: ${missing.join(", ")}`,
      }).catch(() => {/**/});

      res.json({ success: false, message: `Faltan campos: ${missing.join(", ")}`, duration_ms: Date.now() - t0 });
      return;
    }

    await db.insert(integrationEventsTable).values({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: "test_ok", status: "processed",
      summary: `Test OK — credenciales presentes para "${catalogItem.name}"`,
    }).catch(() => {/**/});

    res.json({ success: true, message: `Credenciales de ${catalogItem.name} verificadas.`, duration_ms: Date.now() - t0 });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /:slug/test — real test via IntegrationManager ───────────────────────
integrationsRouter.post("/:slug/test", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const catalogItem = CATALOG.find((c) => c.slug === slug);
    if (!catalogItem) {
      res.status(404).json({ error: "Integración no encontrada" });
      return;
    }

    const t0 = Date.now();

    const validation = await IntegrationManager.validate(orgId, slug);
    if (!validation.valid) {
      res.json({
        success: false, stage: "validation",
        message: validation.errors?.join("; ") ?? "Credenciales inválidas",
        missing: validation.missing,
        duration_ms: Date.now() - t0,
      });
      return;
    }

    const health = await IntegrationManager.healthCheck(orgId, slug);

    let sendTest: { success: boolean; error?: string } | null = null;
    if (catalogItem.category === "communication" && req.body?.testNumber) {
      sendTest = await IntegrationManager.send(orgId, slug, {
        to:      req.body.testNumber as string,
        message: "🤖 Prueba Omni Integration Hub — mensaje de validación enviado correctamente.",
      });
    }

    res.json({
      success: true, stage: "complete", validation: { valid: true },
      health: {
        overall: health.overall, checkedAt: health.checkedAt,
        results: health.results.map((r) => ({
          name: r.name, status: r.status, message: r.message, durationMs: r.durationMs,
        })),
      },
      sendTest, duration_ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /:slug/health — run health check via IntegrationManager ───────────────
integrationsRouter.get("/:slug/health", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;
    const t0 = Date.now();
    const health = await IntegrationManager.healthCheck(orgId, slug);
    res.json({
      success: true,
      health: { overall: health.overall, checkedAt: health.checkedAt, results: health.results },
      duration_ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /:slug/production — mark integration as production ───────────────────
integrationsRouter.post("/:slug/production", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;
    const { mode } = req.body as { mode?: string };
    const targetMode = mode === "staging" ? "staging" : "production";

    const [row] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Integración no configurada" });
      return;
    }

    const cfg = row.config ? JSON.parse(row.config) : {};
    cfg._mode = targetMode;
    cfg._modeChangedAt = new Date().toISOString();

    await db
      .update(orgIntegrationsTable)
      .set({ config: JSON.stringify(cfg), updatedAt: new Date() })
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    await db.insert(integrationEventsTable).values({
      orgId, integrationSlug: slug, direction: "outbound",
      eventType: "mode_changed", status: "processed",
      summary: `Integración "${slug}" marcada como ${targetMode.toUpperCase()}`,
    }).catch(() => {/**/});

    logAudit({
      actorClerkId: req.clerkUserId!, action: "integration_mode_changed",
      resource: "integration", resourceId: slug, orgId,
      details: { slug, mode: targetMode }, severity: "info", result: "success", req,
    });

    res.json({ success: true, mode: targetMode });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /:slug/report — final report: status, issues, pending actions ─────────
integrationsRouter.get("/:slug/report", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;

    const [conn] = await db
      .select()
      .from(orgIntegrationsTable)
      .where(
        and(
          eq(orgIntegrationsTable.orgId, orgId),
          eq(orgIntegrationsTable.integrationSlug, slug),
        ),
      );

    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(
        and(
          eq(integrationEventsTable.orgId, orgId),
          eq(integrationEventsTable.integrationSlug, slug),
        ),
      )
      .orderBy(desc(integrationEventsTable.createdAt))
      .limit(20);

    const errors = events.filter((e) => e.status === "error");
    const health = conn?.config ? (JSON.parse(conn.config)._health as Record<string, unknown> | undefined) : undefined;
    const mode = conn?.config ? (JSON.parse(conn.config)._mode as string | undefined) : "staging";

    const issues: string[] = [];
    if (errors.length > 0) issues.push(`${errors.length} errores recientes`);
    if (conn?.status === "error") issues.push("Estado actual: ERROR");
    if (conn?.status === "inactive") issues.push("No conectada");
    if (health?.overall === "unhealthy") issues.push("Health check: NO SALUDABLE");
    if (health?.overall === "degraded") issues.push("Health check: DEGRADADO");
    if (!conn?.credentialsEnc) issues.push("Sin credenciales");

    const pending: string[] = [];
    if (mode !== "production") pending.push("Marcar como PRODUCCIÓN");
    if (health?.overall !== "healthy") pending.push("Resolver problemas de health check");
    if (errors.length > 3) pending.push("Revisar errores recurrentes");

    res.json({
      slug, status: conn?.status ?? "inactive", mode: mode ?? "staging",
      connectedAt: conn?.createdAt?.toISOString() ?? null,
      lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
      errorCount: errors.length, totalEvents: events.length,
      health, issues, pendingActions: pending,
      lastEvents: events.slice(0, 5).map((e) => ({
        eventType: e.eventType, status: e.status, summary: e.summary,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /:slug/events — log de eventos ───────────────────────────────────────
integrationsRouter.get("/:slug/events", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { slug } = req.params;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const events = await db
      .select()
      .from(integrationEventsTable)
      .where(
        and(
          eq(integrationEventsTable.orgId, orgId),
          eq(integrationEventsTable.integrationSlug, slug),
        ),
      )
      .orderBy(desc(integrationEventsTable.createdAt))
      .limit(limit);

    res.json(
      events.map((e) => ({
        id:          e.id,
        direction:   e.direction,
        eventType:   e.eventType,
        status:      e.status,
        summary:     e.summary,
        error:       e.errorMessage,
        payloadJson: e.payloadJson ? (() => { try { return JSON.parse(e.payloadJson as string); } catch { return null; } })() : null,
        createdAt:   e.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
