import { Router } from "express";
import { db, clientsTable } from "@workspace/db";
import { eq, desc, count, sql, and, inArray, isNotNull } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { getWhatsAppCreds, logIntegrationEvent } from "../utils/integrationCreds";

export const marketingRouter = Router();

// ── Internal: send a single WhatsApp message via Meta Graph API ──────────────
async function sendWhatsAppTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const phone = to.replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Número de teléfono inválido" };

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
          to:   phone,
          type: "text",
          text: { body },
        }),
      },
    );
    const data = await r.json() as { messages?: { id: string }[]; error?: { message: string } };
    if (!r.ok) return { ok: false, error: data.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── GET /api/marketing/campaigns ────────────────────────────────────────────
marketingRouter.get("/campaigns", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.execute(sql`
      SELECT id, org_id, name, status, channel, subject, body, audience_filter,
             sent_count, opened_count, clicked_count, created_by,
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

    const VALID_STATUSES = ["draft", "active", "paused", "completed"];
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }

    // Build update parts safely
    const updates: string[] = [];
    if (name            !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
    if (channel         !== undefined) updates.push(`channel = '${channel.replace(/'/g, "''")}'`);
    if (subject         !== undefined) updates.push(`subject = ${subject ? `'${subject.replace(/'/g, "''")}'` : "NULL"}`);
    if (body            !== undefined) updates.push(`body = ${body ? `'${body.replace(/'/g, "''")}'` : "NULL"}`);
    if (audience_filter !== undefined) updates.push(`audience_filter = '${audience_filter.replace(/'/g, "''")}'`);
    if (status          !== undefined) {
      updates.push(`status = '${status}'`);
      if (status === "active") updates.push(`sent_at = NOW()`);
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
    await db.execute(sql`
      DELETE FROM marketing_campaigns WHERE id = ${id} AND org_id = ${orgId}
    `);
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

// ── POST /api/marketing/campaigns/:id/launch ─────────────────────────────────
// Sends messages to all matching recipients and updates sent_count + status.
marketingRouter.post("/campaigns/:id/launch", requirePermission("workspace.edit"), async (req, res) => {
  const orgId = req.orgId!;
  const id    = parseInt(req.params["id"]!, 10);

  try {
    // 1. Load campaign
    const campRows = await db.execute(sql`
      SELECT id, name, channel, body, audience_filter, status
      FROM marketing_campaigns
      WHERE id = ${id} AND org_id = ${orgId}
    `);
    const camp = (campRows as { rows: Record<string, unknown>[] }).rows[0];
    if (!camp) { res.status(404).json({ error: "Campaña no encontrada" }); return; }

    if (camp["status"] === "completed") {
      res.status(400).json({ error: "Esta campaña ya fue completada" }); return;
    }
    if (!camp["body"]) {
      res.status(400).json({ error: "La campaña no tiene mensaje configurado" }); return;
    }

    const channel        = String(camp["channel"] ?? "whatsapp");
    const messageBody    = String(camp["body"]);
    const audienceFilter = String(camp["audience_filter"] ?? "all");

    // 2. Mark as active immediately so UI shows correct state
    await db.execute(sql`
      UPDATE marketing_campaigns
      SET status = 'active', sent_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `);

    // 3. Build audience query
    let audienceClients: { id: number; name: string; phone: string | null; email: string | null }[];
    if (audienceFilter === "all") {
      audienceClients = await db
        .select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, email: clientsTable.email })
        .from(clientsTable)
        .where(eq(clientsTable.orgId, orgId));
    } else {
      // active = "active" or "client", leads = "lead", inactive = "inactive"
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

    // 4. Get WhatsApp credentials (same function used by chat)
    let sentCount  = 0;
    let failCount  = 0;
    const results: { phone: string; ok: boolean; messageId?: string; error?: string }[] = [];

    if (channel === "whatsapp" || channel === "both") {
      const creds = await getWhatsAppCreds(orgId);
      if (!creds) {
        // Revert to draft — no credentials
        await db.execute(sql`
          UPDATE marketing_campaigns
          SET status = 'draft', sent_at = NULL, updated_at = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
        `);
        res.status(400).json({
          error: "WhatsApp no configurado. Conéctalo en Integraciones antes de lanzar una campaña.",
        });
        return;
      }

      // 5. Send to each recipient with a phone number
      const recipients = audienceClients.filter(c => c.phone && c.phone.trim().length > 4);
      console.info(`[Campaign ${id}] Launching to ${recipients.length} recipients via WhatsApp`);

      for (const client of recipients) {
        const result = await sendWhatsAppTextMessage(
          creds.phoneNumberId,
          creds.accessToken,
          client.phone!,
          messageBody,
        );

        if (result.ok) {
          sentCount++;
          console.info(`[Campaign ${id}] ✅ Sent to ${client.name} (${client.phone}) — msgId: ${result.messageId}`);
        } else {
          failCount++;
          console.warn(`[Campaign ${id}] ❌ Failed for ${client.name} (${client.phone}): ${result.error}`);
        }

        results.push({ phone: client.phone!, ok: result.ok, messageId: result.messageId, error: result.error });

        // Small delay between sends to respect Meta rate limits
        await new Promise(r => setTimeout(r, 150));
      }

      logIntegrationEvent({
        orgId,
        integrationSlug: "whatsapp",
        direction:       "outbound",
        eventType:       "campaign_sent",
        status:          failCount === 0 ? "processed" : "error",
        summary:         `Campaña "${String(camp["name"])}" enviada: ${sentCount} ok, ${failCount} fallidos de ${recipients.length} destinatarios`,
      });
    }

    // 6. Finalize: update sent_count, mark completed
    await db.execute(sql`
      UPDATE marketing_campaigns
      SET status = 'completed',
          sent_count  = ${sentCount},
          updated_at  = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `);

    res.json({
      ok:        true,
      sentCount,
      failCount,
      total:     audienceClients.length,
      results,
    });
  } catch (err) {
    console.error(`[Campaign ${id}] Launch error:`, err);
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
          COALESCE(SUM(sent_count), 0)    AS total_sent,
          COALESCE(SUM(opened_count), 0)  AS total_opened,
          COALESCE(SUM(clicked_count), 0) AS total_clicked,
          COUNT(*) FILTER (WHERE status = 'active')    AS active_campaigns,
          COUNT(*) FILTER (WHERE status = 'draft')     AS draft_campaigns,
          COUNT(*) FILTER (WHERE status = 'paused')    AS paused_campaigns,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed_campaigns,
          COUNT(*) AS total_campaigns
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
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'draft')  AS draft,
          COUNT(*)                                  AS total,
          COALESCE(SUM(sent_count), 0)              AS sent,
          COALESCE(SUM(opened_count), 0)            AS opened,
          COALESCE(SUM(clicked_count), 0)           AS clicked
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
