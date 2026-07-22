/**
 * OmniTech NotificationService
 * Central dispatcher: Autopilot → NotificationService → IntegrationManager → Adapter → Provider
 * Never calls WhatsApp / Telegram / Email directly.
 */
import { db, orgIntegrationsTable, activityTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { IntegrationManager } from "../hub/integrationManager";
import type { SendMessageResult } from "../hub/types";

// Priority order used in "auto" mode
const AUTO_PRIORITY = ["telegram", "whatsapp", "email", "slack"] as const;

export type NotifChannel =
  | "auto"       // cascade: try in priority order, stop at first success
  | "all"        // broadcast: send to ALL active channels
  | "telegram"
  | "whatsapp"
  | "email"
  | "slack"
  | "teams"
  | "internal";  // log to activity table as fallback

export interface NotifResult {
  channel: string;
  success: boolean;
  error?: string;
  providerId?: string;
}

export interface NotifOptions {
  orgId:    number;
  channels: NotifChannel | NotifChannel[];
  to:       string;                         // phone / chat_id / email — channel-specific
  message:  string;
  context?: Record<string, unknown>;
}

// ── Get slugs of active (connected/production) integrations for an org ─────────
export async function getActiveChannels(orgId: number): Promise<string[]> {
  const rows = await db
    .select({ slug: orgIntegrationsTable.integrationSlug, status: orgIntegrationsTable.status })
    .from(orgIntegrationsTable)
    .where(
      and(
        eq(orgIntegrationsTable.orgId, orgId),
        inArray(orgIntegrationsTable.status, ["connected", "production"]),
      ),
    );
  return rows.map(r => r.slug);
}

// ── Send via a single channel slug ────────────────────────────────────────────
async function sendOne(
  orgId:   number,
  slug:    string,
  to:      string,
  message: string,
  context?: Record<string, unknown>,
): Promise<NotifResult> {
  if (slug === "internal") {
    try {
      await db.insert(activityTable).values({
        orgId,
        type:        "autopilot_internal_notification",
        description: `[Notificación interna] ${message.slice(0, 400)}`,
        clientName:  null,
      });
    } catch (err) {
      console.warn("[NotificationService] Internal log failed:", String(err));
    }
    return { channel: "internal", success: true };
  }

  try {
    const result: SendMessageResult = await IntegrationManager.send(orgId, slug, {
      to,
      message,
      metadata: context,
    });
    return {
      channel:    slug,
      success:    result.success,
      error:      result.error,
      providerId: result.providerId,
    };
  } catch (err) {
    return { channel: slug, success: false, error: String(err) };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
export const NotificationService = {

  /** Returns slugs of active integrations for the org — used by the UI channel picker. */
  getActiveChannels,

  /** Dispatch a notification through the selected channel(s). Error-isolated per channel. */
  async send(opts: NotifOptions): Promise<NotifResult[]> {
    const { orgId, channels, to, message, context } = opts;
    const channelList = Array.isArray(channels) ? channels : [channels];
    const activeChannels = await getActiveChannels(orgId);

    // ── auto: cascade in priority order, stop at first success ───────────────
    if (channelList.includes("auto")) {
      const results: NotifResult[] = [];
      for (const slug of AUTO_PRIORITY) {
        if (!activeChannels.includes(slug)) continue;
        const r = await sendOne(orgId, slug, to, message, context);
        results.push(r);
        if (r.success) return results;
      }
      // Nothing worked — fallback to internal
      results.push(await sendOne(orgId, "internal", to, message, context));
      return results;
    }

    // ── all: broadcast to every active channel in parallel ───────────────────
    if (channelList.includes("all")) {
      const slugsToSend = activeChannels.length > 0 ? activeChannels : ["internal"];
      return Promise.all(slugsToSend.map(slug => sendOne(orgId, slug, to, message, context)));
    }

    // ── specific channels: send in parallel, error-isolated ───────────────────
    const specific = channelList.filter(ch => ch !== "auto" && ch !== "all") as string[];
    return Promise.all(
      specific.map(slug => {
        if (slug !== "internal" && !activeChannels.includes(slug)) {
          return Promise.resolve<NotifResult>({
            channel: slug,
            success: false,
            error:   `Canal "${slug}" no está activo en este workspace`,
          });
        }
        return sendOne(orgId, slug, to, message, context);
      }),
    );
  },

  /** Human-readable one-line summary of a dispatch result set. */
  summarize(results: NotifResult[]): string {
    if (results.length === 0) return "Sin canales disponibles.";
    const ok  = results.filter(r => r.success).map(r => r.channel);
    const err = results.filter(r => !r.success).map(r => `${r.channel}(${(r.error ?? "error").slice(0, 40)})`);
    const parts: string[] = [];
    if (ok.length)  parts.push(`✅ Enviado por: ${ok.join(", ")}`);
    if (err.length) parts.push(`⚠️ Falló: ${err.join(", ")}`);
    return parts.join(" | ");
  },
};
