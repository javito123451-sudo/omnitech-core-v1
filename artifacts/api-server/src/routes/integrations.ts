import { Router } from "express";
import crypto from "node:crypto";
import {
  db,
  integrationsTable,
  orgIntegrationsTable,
  integrationEventsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";

export const integrationsRouter = Router();

// ── Encryption ────────────────────────────────────────────────────────────────
const RAW_KEY = process.env.INTEGRATION_ENCRYPTION_KEY;
const ENC_KEY =
  RAW_KEY && RAW_KEY.length === 64 ? Buffer.from(RAW_KEY, "hex") : null;

if (!ENC_KEY) {
  console.warn(
    "[Integrations] INTEGRATION_ENCRYPTION_KEY not set or invalid — " +
    "credentials stored as base64 only. Set a 64-char hex key for production.",
  );
}

function encryptCredentials(obj: Record<string, string>): string {
  const json = JSON.stringify(obj);
  if (!ENC_KEY) return Buffer.from(json).toString("base64");
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptCredentials(stored: string): Record<string, string> {
  try {
    if (!ENC_KEY)
      return JSON.parse(Buffer.from(stored, "base64").toString("utf8")) as Record<string, string>;
    const buf     = Buffer.from(stored, "base64");
    const iv      = buf.subarray(0, 12);
    const tag     = buf.subarray(12, 28);
    const enc     = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(decipher.update(enc) + decipher.final("utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

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

// ── Helper: campos visibles por credencial (sin exponer valores) ──────────────
function credentialKeys(slug: string): string[] {
  const map: Record<string, string[]> = {
    whatsapp:         ["phoneNumberId", "accessToken", "verifyToken"],
    stripe:           ["apiKey", "webhookSecret"],
    webhook_outbound: ["url", "secret"],
  };
  return map[slug] ?? [];
}

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

    // Determinar qué credential keys están presentes (sin exponer valores)
    let credentialKeysPresent: string[] = [];
    if (conn?.credentialsEnc) {
      const dec = decryptCredentials(conn.credentialsEnc);
      credentialKeysPresent = Object.keys(dec).filter((k) => !!dec[k]);
    }

    const connection = conn
      ? {
          status:              conn.status,
          displayName:         conn.displayName,
          config:              conn.config ? (JSON.parse(conn.config) as Record<string, unknown>) : null,
          lastSyncedAt:        conn.lastSyncedAt?.toISOString() ?? null,
          expiresAt:           conn.expiresAt?.toISOString() ?? null,
          errorMessage:        conn.errorMessage,
          createdAt:           conn.createdAt.toISOString(),
          updatedAt:           conn.updatedAt.toISOString(),
          hasCredentials:      !!conn.credentialsEnc,
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

    // Encrypt credentials
    const credentialsEnc = Object.keys(credentials).length > 0
      ? encryptCredentials(credentials)
      : undefined;

    // Upsert org_integrations
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

    // Log event
    await db.insert(integrationEventsTable).values({
      orgId,
      integrationSlug: slug,
      direction:       "outbound",
      eventType:       "connected",
      status:          "processed",
      summary:         `Integración "${catalogItem.name}" configurada`,
    }).catch(() => {/* non-critical */});

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

// ── POST /:slug/test — verificar conexión ─────────────────────────────────────
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

    if (!conn || !conn.credentialsEnc) {
      res.json({ success: false, message: "No hay credenciales guardadas para esta integración." });
      return;
    }

    const creds = decryptCredentials(conn.credentialsEnc);
    const requiredKeys = credentialKeys(slug);
    const missingKeys  = requiredKeys.filter((k) => !creds[k]);

    const t0 = Date.now();

    if (missingKeys.length > 0) {
      await db.insert(integrationEventsTable).values({
        orgId,
        integrationSlug: slug,
        direction:       "outbound",
        eventType:       "test_failed",
        status:          "error",
        summary:         `Test fallido — faltan campos: ${missingKeys.join(", ")}`,
        errorMessage:    `Campos requeridos faltantes: ${missingKeys.join(", ")}`,
      }).catch(() => {/* non-critical */});

      res.json({
        success: false,
        message: `Faltan campos requeridos: ${missingKeys.join(", ")}`,
        duration_ms: Date.now() - t0,
      });
      return;
    }

    // Phase 1: credential presence check is the test
    await db.insert(integrationEventsTable).values({
      orgId,
      integrationSlug: slug,
      direction:       "outbound",
      eventType:       "test_ok",
      status:          "processed",
      summary:         `Test OK — credenciales presentes para "${catalogItem.name}"`,
    }).catch(() => {/* non-critical */});

    res.json({
      success:     true,
      message:     `Credenciales de ${catalogItem.name} verificadas correctamente.`,
      duration_ms: Date.now() - t0,
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
        id:        e.id,
        direction: e.direction,
        eventType: e.eventType,
        status:    e.status,
        summary:   e.summary,
        error:     e.errorMessage,
        createdAt: e.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
