import { Router } from "express";
import { db, clientsTable } from "@workspace/db";
import { eq, desc, count, sql, and, inArray } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { getWhatsAppCreds, logIntegrationEvent } from "../utils/integrationCreds";

export const marketingRouter = Router();

// ── Phone normalisation ──────────────────────────────────────────────────────
// WhatsApp/Meta expects the number in E.164 format without the leading "+".
// Examples of what we accept and what we produce:
//   "+34 612 345 678"  → "34612345678"
//   "0034612345678"    → "34612345678"
//   "612345678"        → "34612345678" (9-digit Spain local → prepend 34)
//   "34612345678"      → "34612345678" (already correct)
//   "+1 415 555 0100"  → "14155550100"
function normalizePhone(raw: string): { normalized: string; valid: boolean; reason?: string } {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  // 9-digit numbers without country code → assume Spain (+34)
  if (d.length === 9) d = "34" + d;
  if (d.length < 7)  return { normalized: d, valid: false, reason: `Número demasiado corto: "${raw}"` };
  if (d.length > 15) return { normalized: d, valid: false, reason: `Número demasiado largo: "${raw}"` };
  return { normalized: d, valid: true };
}

// ── Send a single WhatsApp message via Meta Graph API ───────────────────────
interface SendResult {
  ok:           boolean;
  messageId?:   string;
  httpStatus:   number;
  rawResponse:  string;
  error?:       string;
}

async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken:   string,
  to:            string,
  body:          string,
): Promise<SendResult> {
  const { normalized, valid, reason } = normalizePhone(to);
  if (!valid) {
    return { ok: false, httpStatus: 0, rawResponse: "", error: reason };
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to:   normalized,
          type: "text",
          text: { body },
        }),
      },
    );
    const raw     = await r.text();
    let parsed: { messages?: { id: string }[]; error?: { message: string; code?: number } } = {};
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { /* raw text stays */ }

    if (!r.ok) {
      return {
        ok:          false,
        httpStatus:  r.status,
        rawResponse: raw,
        error:       parsed.error?.message ?? `HTTP ${r.status}`,
      };
    }
    return {
      ok:          true,
      httpStatus:  r.status,
      rawResponse: raw,
      messageId:   parsed.messages?.[0]?.id,
    };
  } catch (err) {
    return { ok: false, httpStatus: 0, rawResponse: "", error: String(err) };
  }
}

// ── GET /api/marketing/campaigns ────────────────────────────────────────────
marketingRouter.get("/campaigns", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.execute(sql`
      SELECT id, org_id, name, status, channel, subject, body, audience_filter,
             sent_count, failed_count, opened_count, clicked_count, created_by,
             scheduled_at, sent_at, created_at, updated_at
      FROM marketing_campaigns
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `);
    res.json({ ok: true, campaigns: (rows as { rows: unknown[] }).rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/marketing/campaigns ───────────────────────────────────────────
marketingRouter.post("/campaigns", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { name, channel = "email", subject, body, audience_filter = "all" } = req.body as {
      name?: string; channel?: string; subject?: string; body?: string; audience_filter?: string;
    };
    if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

    const result = await db.execute(sql`
      INSERT INTO marketing_campaigns
        (org_id, name, status, channel, subject, body, audience_filter, created_by, created_at, updated_at)
      VALUES
        (${orgId}, ${name.trim()}, 'draft', ${channel}, ${subject ?? null}, ${body ?? null},
         ${audience_filter}, ${req.clerkUserId ?? null}, NOW(), NOW())
      RETURNING *
    `);
    res.status(201).json({ ok: true, campaign: (result as { rows: unknown[] }).rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/marketing/campaigns/:id ──────────────────────────────────────
marketingRouter.patch("/campaigns/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    const { name, channel, subject, body, audience_filter, status } = req.body as Record<string, string>;

    const VALID_STATUSES = ["draft", "active", "paused", "sending", "sent", "sent_with_errors", "completed", "error"];
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }

    const updates: string[] = [];
    if (name            !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
    if (channel         !== undefined) updates.push(`channel = '${channel.replace(/'/g, "''")}'`);
    if (subject         !== undefined) updates.push(`subject = ${subject ? `'${subject.replace(/'/g, "''")}'` : "NULL"}`);
    if (body            !== undefined) updates.push(`body = ${body ? `'${body.replace(/'/g, "''")}'` : "NULL"}`);
    if (audience_filter !== undefined) updates.push(`audience_filter = '${audience_filter.replace(/'/g, "''")}'`);
    if (status          !== undefined) {
      updates.push(`status = '${status}'`);
      if (status === "active" || status === "sent" || status === "sent_with_errors") {
        updates.push(`sent_at = NOW()`);
      }
    }

    if (updates.length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
    updates.push("updated_at = NOW()");

    const result = await db.execute(
      sql.raw(`UPDATE marketing_campaigns SET ${updates.join(", ")} WHERE id = ${id} AND org_id = ${orgId} RETURNING *`)
    );
    const updated = (result as { rows: unknown[] }).rows[0];
    if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ ok: true, campaign: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/marketing/campaigns/:id ─────────────────────────────────────
marketingRouter.delete("/campaigns/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    await db.execute(sql`DELETE FROM marketing_campaigns WHERE id = ${id} AND org_id = ${orgId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/marketing/campaigns/:id/duplicate ─────────────────────────────
marketingRouter.post("/campaigns/:id/duplicate", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    const result = await db.execute(sql`
      INSERT INTO marketing_campaigns
        (org_id, name, status, channel, subject, body, audience_filter, created_by, created_at, updated_at)
      SELECT org_id, name || ' (copia)', 'draft', channel, subject, body, audience_filter,
             ${req.clerkUserId ?? null}, NOW(), NOW()
      FROM marketing_campaigns WHERE id = ${id} AND org_id = ${orgId}
      RETURNING *
    `);
    const copy = (result as { rows: unknown[] }).rows[0];
    if (!copy) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.status(201).json({ ok: true, campaign: copy });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/marketing/campaigns/:id/launch ────────────────────────────────
// Full send engine: per-recipient logging, correct status transitions,
// phone normalisation, raw API response capture.
marketingRouter.post("/campaigns/:id/launch", requirePermission("workspace.edit"), async (req, res) => {
  const orgId = req.orgId!;
  const id    = parseInt(req.params["id"]!, 10);
  const startedAt = Date.now();

  try {
    // 1. Load campaign
    const campRows = await db.execute(sql`
      SELECT id, name, channel, body, audience_filter, status
      FROM marketing_campaigns
      WHERE id = ${id} AND org_id = ${orgId}
    `);
    const camp = (campRows as { rows: Record<string, unknown>[] }).rows[0];
    if (!camp) { res.status(404).json({ error: "Campaña no encontrada" }); return; }
    if (camp["status"] === "sending") {
      res.status(400).json({ error: "Esta campaña ya se está enviando" }); return;
    }
    if (!camp["body"]) {
      res.status(400).json({ error: "La campaña no tiene mensaje configurado" }); return;
    }

    const channel        = String(camp["channel"] ?? "whatsapp");
    const messageBody    = String(camp["body"]);
    const audienceFilter = String(camp["audience_filter"] ?? "all");
    const campName       = String(camp["name"]);

    // 2. Mark as "sending" immediately
    await db.execute(sql`
      UPDATE marketing_campaigns
      SET status = 'sending', sent_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `);

    // Respond early so the UI sees the "sending" state right away
    // (we keep processing asynchronously)
    res.json({ ok: true, queued: true, message: "Campaña en proceso de envío" });

    // 3. Build audience
    let audienceClients: { id: number; name: string; phone: string | null; email: string | null }[];
    if (audienceFilter === "all") {
      audienceClients = await db
        .select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, email: clientsTable.email })
        .from(clientsTable)
        .where(eq(clientsTable.orgId, orgId));
    } else {
      const statusMap: Record<string, string[]> = {
        active:   ["active", "client"],
        leads:    ["lead"],
        inactive: ["inactive"],
      };
      const statuses = statusMap[audienceFilter] ?? [];
      audienceClients = statuses.length > 0
        ? await db
            .select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, email: clientsTable.email })
            .from(clientsTable)
            .where(and(eq(clientsTable.orgId, orgId), inArray(clientsTable.status, statuses)))
        : [];
    }

    // 4. WhatsApp send loop
    let sentCount  = 0;
    let failCount  = 0;
    let skipCount  = 0;

    if (channel === "whatsapp" || channel === "both") {
      const creds = await getWhatsAppCreds(orgId);
      if (!creds) {
        await db.execute(sql`
          UPDATE marketing_campaigns
          SET status = 'error', updated_at = NOW(),
              send_report = ${JSON.stringify({ error: "WhatsApp no configurado", sentCount: 0, failCount: 0, skipCount: audienceClients.length })}
          WHERE id = ${id} AND org_id = ${orgId}
        `);
        console.error(`[Campaign ${id}] ❌ No WhatsApp credentials found`);
        return;
      }

      // Dedup by normalised phone
      const seen = new Set<string>();
      const recipients = audienceClients.filter(c => {
        if (!c.phone || c.phone.trim().length < 4) return false;
        const { normalized, valid } = normalizePhone(c.phone);
        if (!valid) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });

      console.info(`[Campaign ${id}] Launching "${campName}" → ${recipients.length} recipients (${audienceClients.length - recipients.length} skipped/deduped)`);
      skipCount = audienceClients.length - recipients.length;

      for (const client of recipients) {
        const result = await sendWhatsAppMessage(
          creds.phoneNumberId,
          creds.accessToken,
          client.phone!,
          messageBody,
        );

        const { normalized } = normalizePhone(client.phone!);
        const logStatus = result.ok ? "sent" : "failed";

        // Insert per-recipient log
        try {
          await db.execute(sql`
            INSERT INTO campaign_send_logs
              (campaign_id, org_id, client_id, client_name, phone_raw, phone_normalized,
               status, message_id, error_message, meta_http_status, meta_response, sent_at)
            VALUES
              (${id}, ${orgId}, ${client.id}, ${client.name}, ${client.phone}, ${normalized},
               ${logStatus}, ${result.messageId ?? null}, ${result.error ?? null},
               ${result.httpStatus}, ${result.rawResponse.slice(0, 2000)}, NOW())
          `);
        } catch (logErr) {
          console.error(`[Campaign ${id}] Failed to insert log for ${client.name}:`, logErr);
        }

        if (result.ok) {
          sentCount++;
          console.info(`[Campaign ${id}] ✅ ${client.name} (${normalized}) — msgId: ${result.messageId}`);
        } else {
          failCount++;
          console.warn(`[Campaign ${id}] ❌ ${client.name} (${normalized}) — ${result.error} [HTTP ${result.httpStatus}]`);
          console.warn(`[Campaign ${id}]    Raw: ${result.rawResponse.slice(0, 300)}`);
        }

        await new Promise(r => setTimeout(r, 150));
      }

      logIntegrationEvent({
        orgId,
        integrationSlug: "whatsapp",
        direction:       "outbound",
        eventType:       "campaign_sent",
        status:          failCount === 0 ? "processed" : "error",
        summary:         `Campaña "${campName}": ${sentCount} ok, ${failCount} fallidos, ${skipCount} sin teléfono`,
      });
    }

    // 5. Determine final status
    let finalStatus: string;
    if (sentCount > 0 && failCount === 0) {
      finalStatus = "sent";
    } else if (sentCount > 0 && failCount > 0) {
      finalStatus = "sent_with_errors";
    } else if (sentCount === 0 && failCount > 0) {
      finalStatus = "error";
    } else {
      // No recipients with valid phones
      finalStatus = "error";
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const report = {
      sentCount, failCount, skipCount,
      total:      sentCount + failCount + skipCount,
      elapsedSec: elapsed,
      finishedAt: new Date().toISOString(),
    };

    await db.execute(sql`
      UPDATE marketing_campaigns
      SET status       = ${finalStatus},
          sent_count   = ${sentCount},
          failed_count = ${failCount},
          send_report  = ${JSON.stringify(report)},
          updated_at   = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `);

    console.info(`[Campaign ${id}] Done — status=${finalStatus} sent=${sentCount} failed=${failCount} skip=${skipCount} ${elapsed}s`);

  } catch (err) {
    console.error(`[Campaign ${id}] Launch error:`, err);
    // Best-effort status update to "error"
    try {
      await db.execute(sql`
        UPDATE marketing_campaigns
        SET status = 'error', updated_at = NOW(),
            send_report = ${JSON.stringify({ error: String(err) })}
        WHERE id = ${id} AND org_id = ${orgId}
      `);
    } catch { /* ignore */ }
  }
});

// ── POST /api/marketing/campaigns/:id/test-send ─────────────────────────────
// Sends exactly ONE message to the provided phone using the same engine as
// the real launch — useful for verifying credentials + message format.
marketingRouter.post("/campaigns/:id/test-send", requirePermission("workspace.edit"), async (req, res) => {
  const orgId = req.orgId!;
  const id    = parseInt(req.params["id"]!, 10);
  const { phone } = req.body as { phone?: string };

  if (!phone?.trim()) {
    res.status(400).json({ error: "phone es obligatorio" }); return;
  }

  try {
    // Load campaign body
    const campRows = await db.execute(sql`
      SELECT body, name FROM marketing_campaigns
      WHERE id = ${id} AND org_id = ${orgId}
    `);
    const camp = (campRows as { rows: Record<string, unknown>[] }).rows[0];
    if (!camp) { res.status(404).json({ error: "Campaña no encontrada" }); return; }
    if (!camp["body"]) { res.status(400).json({ error: "La campaña no tiene mensaje" }); return; }

    const creds = await getWhatsAppCreds(orgId);
    if (!creds) {
      res.status(400).json({
        ok: false,
        error: "WhatsApp no configurado. Conéctalo en Integraciones → WhatsApp Business.",
      });
      return;
    }

    const { normalized, valid, reason } = normalizePhone(phone.trim());
    if (!valid) {
      res.status(400).json({ ok: false, error: reason }); return;
    }

    const testBody = `🧪 [MENSAJE DE PRUEBA]\n\n${String(camp["body"])}`;
    const result   = await sendWhatsAppMessage(creds.phoneNumberId, creds.accessToken, phone, testBody);

    // Log the test send
    logIntegrationEvent({
      orgId,
      integrationSlug: "whatsapp",
      direction:       "outbound",
      eventType:       result.ok ? "test_send_ok" : "test_send_failed",
      status:          result.ok ? "processed" : "error",
      summary:         `Test campaña "${String(camp["name"])}" → +${normalized}: ${result.ok ? "ok" : result.error}`,
    });

    res.json({
      ok:          result.ok,
      messageId:   result.messageId,
      normalized,
      httpStatus:  result.httpStatus,
      rawResponse: result.rawResponse,
      error:       result.error,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/marketing/campaigns/:id/report ─────────────────────────────────
marketingRouter.get("/campaigns/:id/report", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id    = parseInt(req.params["id"]!, 10);

    const [campRows, logRows] = await Promise.all([
      db.execute(sql`
        SELECT id, name, status, channel, body, audience_filter,
               sent_count, failed_count, send_report, sent_at, created_at
        FROM marketing_campaigns
        WHERE id = ${id} AND org_id = ${orgId}
      `),
      db.execute(sql`
        SELECT id, client_id, client_name, phone_raw, phone_normalized,
               status, message_id, error_message, meta_http_status, sent_at
        FROM campaign_send_logs
        WHERE campaign_id = ${id}
        ORDER BY sent_at ASC
      `),
    ]);

    const campaign = (campRows as { rows: unknown[] }).rows[0];
    if (!campaign) { res.status(404).json({ error: "Campaña no encontrada" }); return; }

    const logs = (logRows as { rows: unknown[] }).rows;
    res.json({ ok: true, campaign, logs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/audience ─────────────────────────────────────────────
marketingRouter.get("/audience", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const clients = await db
      .select({
        id:        clientsTable.id,
        name:      clientsTable.name,
        email:     clientsTable.email,
        phone:     clientsTable.phone,
        company:   clientsTable.company,
        status:    clientsTable.status,
        tags:      clientsTable.tags,
        leadScore: clientsTable.leadScore,
        createdAt: clientsTable.createdAt,
      })
      .from(clientsTable)
      .where(eq(clientsTable.orgId, orgId))
      .orderBy(desc(clientsTable.createdAt));

    const total    = clients.length;
    const active   = clients.filter(c => c.status === "active" || c.status === "client").length;
    const leads    = clients.filter(c => c.status === "lead").length;
    const inactive = clients.filter(c => c.status === "inactive").length;

    res.json({
      ok: true,
      clients,
      segments: [
        { id: "all",      name: "Todos los contactos", count: total    },
        { id: "active",   name: "Clientes activos",    count: active   },
        { id: "leads",    name: "Leads",               count: leads    },
        { id: "inactive", name: "Inactivos",           count: inactive },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/analytics ────────────────────────────────────────────
marketingRouter.get("/analytics", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;

    const [agg, monthly] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(sent_count), 0)                                                     AS total_sent,
          COALESCE(SUM(opened_count), 0)                                                   AS total_opened,
          COALESCE(SUM(clicked_count), 0)                                                  AS total_clicked,
          COUNT(*) FILTER (WHERE status IN ('active','sending'))                           AS active_campaigns,
          COUNT(*) FILTER (WHERE status = 'draft')                                        AS draft_campaigns,
          COUNT(*) FILTER (WHERE status = 'paused')                                       AS paused_campaigns,
          COUNT(*) FILTER (WHERE status IN ('sent','sent_with_errors','completed','error')) AS completed_campaigns,
          COUNT(*)                                                                          AS total_campaigns
        FROM marketing_campaigns WHERE org_id = ${orgId}
      `),
      db.execute(sql`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM')  AS month,
          COALESCE(SUM(sent_count), 0)    AS sent,
          COALESCE(SUM(opened_count), 0)  AS opened,
          COALESCE(SUM(clicked_count), 0) AS clicked
        FROM marketing_campaigns
        WHERE org_id = ${orgId}
        GROUP BY month ORDER BY month DESC LIMIT 6
      `),
    ]);

    const a = (agg as { rows: Array<Record<string, string>> }).rows[0] ?? {};
    const totalSent    = Number(a["total_sent"]    ?? 0);
    const totalOpened  = Number(a["total_opened"]  ?? 0);
    const totalClicked = Number(a["total_clicked"] ?? 0);

    res.json({
      ok: true,
      overview: {
        totalSent,
        totalOpened,
        totalClicked,
        openRate:           totalSent > 0 ? +(totalOpened  / totalSent * 100).toFixed(1) : 0,
        clickRate:          totalSent > 0 ? +(totalClicked / totalSent * 100).toFixed(1) : 0,
        activeCampaigns:    Number(a["active_campaigns"]    ?? 0),
        draftCampaigns:     Number(a["draft_campaigns"]     ?? 0),
        pausedCampaigns:    Number(a["paused_campaigns"]    ?? 0),
        completedCampaigns: Number(a["completed_campaigns"] ?? 0),
        totalCampaigns:     Number(a["total_campaigns"]     ?? 0),
      },
      monthly: [...(monthly as { rows: unknown[] }).rows].reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/marketing/summary ───────────────────────────────────────────────
marketingRouter.get("/summary", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [clientCount, stats] = await Promise.all([
      db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.orgId, orgId)),
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('active','sending')) AS active,
          COUNT(*) FILTER (WHERE status = 'draft')              AS draft,
          COUNT(*)                                              AS total,
          COALESCE(SUM(sent_count), 0)                         AS sent,
          COALESCE(SUM(opened_count), 0)                       AS opened,
          COALESCE(SUM(clicked_count), 0)                      AS clicked
        FROM marketing_campaigns WHERE org_id = ${orgId}
      `),
    ]);
    const s = (stats as { rows: Array<Record<string, string>> }).rows[0] ?? {};
    res.json({
      ok: true,
      contacts:  Number(clientCount[0]?.count ?? 0),
      campaigns: { active: Number(s["active"] ?? 0), draft: Number(s["draft"] ?? 0), total: Number(s["total"] ?? 0) },
      messages:  { sent: Number(s["sent"] ?? 0), opened: Number(s["opened"] ?? 0), clicked: Number(s["clicked"] ?? 0) },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
