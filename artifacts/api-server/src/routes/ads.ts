import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { getAdsAiProvider } from "../ai/adsAiProvider";
import { logger } from "../lib/logger";

export const adsRouter = Router();

function dbRows<T>(r: unknown): T[] {
  return (r as { rows: T[] }).rows;
}

// ── GET /api/ads/summary ──────────────────────────────────────────────────────
adsRouter.get("/summary", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [stats, recent] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*)                                    AS total,
          COUNT(*) FILTER (WHERE status = 'active')   AS active,
          COUNT(*) FILTER (WHERE status = 'draft')    AS draft,
          COUNT(*) FILTER (WHERE status = 'paused')   AS paused,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COALESCE(SUM(impressions), 0)               AS total_impressions,
          COALESCE(SUM(clicks), 0)                    AS total_clicks,
          COALESCE(SUM(leads), 0)                     AS total_leads,
          COALESCE(SUM(conversions), 0)               AS total_conversions,
          COALESCE(SUM(spend), 0)                     AS total_spend
        FROM ads_campaigns WHERE org_id = ${orgId}
      `),
      db.execute(sql`
        SELECT id, name, status, platforms, goal, budget, impressions, clicks, leads, roi, created_at
        FROM ads_campaigns WHERE org_id = ${orgId}
        ORDER BY created_at DESC LIMIT 6
      `),
    ]);
    const s = dbRows<Record<string, string>>(stats)[0] ?? {};
    res.json({
      ok: true,
      stats: {
        total:            Number(s["total"]            ?? 0),
        active:           Number(s["active"]           ?? 0),
        draft:            Number(s["draft"]            ?? 0),
        paused:           Number(s["paused"]           ?? 0),
        completed:        Number(s["completed"]        ?? 0),
        totalImpressions: Number(s["total_impressions"] ?? 0),
        totalClicks:      Number(s["total_clicks"]     ?? 0),
        totalLeads:       Number(s["total_leads"]      ?? 0),
        totalConversions: Number(s["total_conversions"] ?? 0),
        totalSpend:       Number(s["total_spend"]      ?? 0),
      },
      recent: dbRows(recent),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/ads/campaigns ────────────────────────────────────────────────────
adsRouter.get("/campaigns", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.execute(sql`
      SELECT id, org_id, name, status, business_name, business_type, product,
             target_audience, goal, budget, platforms, ai_content,
             impressions, clicks, leads, conversions, roi, spend,
             created_by, scheduled_at, launched_at, created_at, updated_at
      FROM ads_campaigns WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `);
    res.json({ ok: true, campaigns: dbRows(rows) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/ads/campaigns ───────────────────────────────────────────────────
adsRouter.post("/campaigns", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { name, businessName, businessType, product, targetAudience, goal, budget, platforms } = req.body as {
      name?: string; businessName?: string; businessType?: string; product?: string;
      targetAudience?: string; goal?: string; budget?: number; platforms?: string[];
    };
    if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

    const result = await db.execute(sql`
      INSERT INTO ads_campaigns
        (org_id, name, status, business_name, business_type, product, target_audience,
         goal, budget, platforms, created_by, created_at, updated_at)
      VALUES
        (${orgId}, ${name.trim()}, 'draft',
         ${businessName ?? null}, ${businessType ?? null}, ${product ?? null},
         ${targetAudience ?? null}, ${goal ?? null}, ${budget ?? null},
         ${JSON.stringify(platforms ?? [])}::jsonb,
         ${req.clerkUserId ?? null}, NOW(), NOW())
      RETURNING *
    `);
    res.status(201).json({ ok: true, campaign: dbRows(result)[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/ads/campaigns/:id ────────────────────────────────────────────────
adsRouter.get("/campaigns/:id", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    const rows = await db.execute(sql`
      SELECT * FROM ads_campaigns WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `);
    const campaign = dbRows(rows)[0];
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ ok: true, campaign });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/ads/campaigns/:id ──────────────────────────────────────────────
adsRouter.patch("/campaigns/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    const body = req.body as Record<string, unknown>;
    const { name, status, businessName, businessType, product, targetAudience,
            goal, budget, platforms, impressions, clicks, leads, conversions, roi, spend } = body;

    const VALID_STATUSES = ["draft", "active", "paused", "completed", "archived"];
    if (status && !VALID_STATUSES.includes(status as string)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }

    const safe = (v: unknown) => String(v).replace(/'/g, "''");
    const parts: string[] = ["updated_at = NOW()"];
    if (name           !== undefined) parts.push(`name = '${safe(name)}'`);
    if (status         !== undefined) {
      parts.push(`status = '${safe(status)}'`);
      if (status === "active") parts.push("launched_at = NOW()");
    }
    if (businessName   !== undefined) parts.push(`business_name   = ${businessName   ? `'${safe(businessName)}'`   : "NULL"}`);
    if (businessType   !== undefined) parts.push(`business_type   = ${businessType   ? `'${safe(businessType)}'`   : "NULL"}`);
    if (product        !== undefined) parts.push(`product         = ${product        ? `'${safe(product)}'`        : "NULL"}`);
    if (targetAudience !== undefined) parts.push(`target_audience = ${targetAudience ? `'${safe(targetAudience)}'` : "NULL"}`);
    if (goal           !== undefined) parts.push(`goal            = ${goal           ? `'${safe(goal)}'`           : "NULL"}`);
    if (budget         !== undefined) parts.push(`budget          = ${Number(budget)}`);
    if (platforms      !== undefined) parts.push(`platforms       = '${JSON.stringify(platforms).replace(/'/g, "''")}'::jsonb`);
    if (impressions    !== undefined) parts.push(`impressions     = ${Number(impressions)}`);
    if (clicks         !== undefined) parts.push(`clicks          = ${Number(clicks)}`);
    if (leads          !== undefined) parts.push(`leads           = ${Number(leads)}`);
    if (conversions    !== undefined) parts.push(`conversions     = ${Number(conversions)}`);
    if (roi            !== undefined) parts.push(`roi             = ${Number(roi)}`);
    if (spend          !== undefined) parts.push(`spend           = ${Number(spend)}`);

    const result = await db.execute(
      sql.raw(`UPDATE ads_campaigns SET ${parts.join(", ")} WHERE id = ${id} AND org_id = ${orgId} RETURNING *`)
    );
    const updated = dbRows(result)[0];
    if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ ok: true, campaign: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/ads/campaigns/:id ─────────────────────────────────────────────
adsRouter.delete("/campaigns/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    await db.execute(sql`DELETE FROM ads_campaigns WHERE id = ${id} AND org_id = ${orgId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/ads/campaigns/:id/generate ─────────────────────────────────────
adsRouter.post("/campaigns/:id/generate", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);

    const rows = await db.execute(sql`
      SELECT * FROM ads_campaigns WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `);
    const campaign = dbRows<Record<string, unknown>>(rows)[0];
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const provider = getAdsAiProvider();
    logger.info({ campaignId: id, provider: provider.providerName }, "[AdsAI] Generating campaign content");

    let parsedPlatforms: string[] = [];
    try { parsedPlatforms = JSON.parse(String(campaign["platforms"] ?? "[]")) as string[]; } catch { /* ignore */ }

    const content = await provider.generateCampaignContent({
      businessName:   String(campaign["business_name"]   ?? ""),
      businessType:   String(campaign["business_type"]   ?? ""),
      product:        String(campaign["product"]         ?? ""),
      targetAudience: String(campaign["target_audience"] ?? ""),
      goal:           String(campaign["goal"]            ?? "awareness"),
      budget:         Number(campaign["budget"]          ?? 0),
      platforms:      parsedPlatforms,
    });

    const contentJson = JSON.stringify(content).replace(/'/g, "''");
    await db.execute(sql.raw(
      `UPDATE ads_campaigns SET ai_content = '${contentJson}'::jsonb, updated_at = NOW() WHERE id = ${id} AND org_id = ${orgId}`
    ));

    res.json({ ok: true, content, provider: provider.providerName });
  } catch (err) {
    logger.error({ err }, "[AdsAI] Generation failed");
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/ads/creatives ────────────────────────────────────────────────────
adsRouter.get("/creatives", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const campaignId = req.query["campaignId"] ? parseInt(String(req.query["campaignId"]), 10) : null;
    const rows = await db.execute(
      campaignId
        ? sql`SELECT * FROM ads_creatives WHERE org_id = ${orgId} AND campaign_id = ${campaignId} ORDER BY created_at DESC`
        : sql`SELECT * FROM ads_creatives WHERE org_id = ${orgId} ORDER BY created_at DESC`
    );
    res.json({ ok: true, creatives: dbRows(rows) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/ads/creatives ───────────────────────────────────────────────────
adsRouter.post("/creatives", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { campaignId, type, platform, title, content } = req.body as {
      campaignId?: number; type?: string; platform?: string; title?: string; content?: unknown;
    };
    if (!campaignId || !type) { res.status(400).json({ error: "campaignId and type required" }); return; }

    const safe     = (v: string) => v.replace(/'/g, "''");
    const titleSql = title    ? `'${safe(title)}'`                                       : "NULL";
    const platSql  = platform ? `'${safe(platform)}'`                                    : "NULL";
    const contSql  = `'${JSON.stringify(content ?? {}).replace(/'/g, "''")}'::jsonb`;

    const result = await db.execute(sql.raw(
      `INSERT INTO ads_creatives (campaign_id, org_id, type, platform, title, content, status, created_at, updated_at)
       VALUES (${campaignId}, ${orgId}, '${safe(type)}', ${platSql}, ${titleSql}, ${contSql}, 'draft', NOW(), NOW())
       RETURNING *`
    ));
    res.status(201).json({ ok: true, creative: dbRows(result)[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/ads/creatives/:id ──────────────────────────────────────────────
adsRouter.patch("/creatives/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    const { title, content, status, platform } = req.body as Record<string, unknown>;
    const VALID = ["draft", "ready", "published"];
    if (status && !VALID.includes(status as string)) { res.status(400).json({ error: "Invalid status" }); return; }

    const safe  = (v: unknown) => String(v).replace(/'/g, "''");
    const parts: string[] = ["updated_at = NOW()"];
    if (title    !== undefined) parts.push(`title    = '${safe(title)}'`);
    if (status   !== undefined) parts.push(`status   = '${safe(status)}'`);
    if (platform !== undefined) parts.push(`platform = ${platform ? `'${safe(platform)}'` : "NULL"}`);
    if (content  !== undefined) parts.push(`content  = '${JSON.stringify(content).replace(/'/g, "''")}'::jsonb`);

    const result = await db.execute(sql.raw(
      `UPDATE ads_creatives SET ${parts.join(", ")} WHERE id = ${id} AND org_id = ${orgId} RETURNING *`
    ));
    const updated = dbRows(result)[0];
    if (!updated) { res.status(404).json({ error: "Creative not found" }); return; }
    res.json({ ok: true, creative: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/ads/creatives/:id ─────────────────────────────────────────────
adsRouter.delete("/creatives/:id", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = parseInt(req.params["id"]!, 10);
    await db.execute(sql`DELETE FROM ads_creatives WHERE id = ${id} AND org_id = ${orgId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/ads/creatives/:id/generate ─────────────────────────────────────
// Stub preparado para integrar: OpenAI DALL-E, Google Veo, Runway, Luma,
// Pika, Kling, Hailuo, Minimax, Fal AI, Replicate mediante AICreativeService.
adsRouter.post("/creatives/:id/generate", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id    = parseInt(req.params["id"]!, 10);

    const rows = await db.execute(sql`
      SELECT * FROM ads_creatives WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `);
    const creative = dbRows<Record<string, unknown>>(rows)[0];
    if (!creative) { res.status(404).json({ error: "Creative not found" }); return; }

    const { provider, previewUrl, downloadUrl, thumbnail } = req.body as {
      provider?: string; previewUrl?: string; downloadUrl?: string; thumbnail?: string;
    };

    // Update with generation results (or mark as ready for mock)
    const safeStr  = (v: unknown) => v ? `'${String(v).replace(/'/g, "''")}'` : "NULL";
    const provName = safeStr(provider ?? "mock");
    const pUrl     = safeStr(previewUrl);
    const dUrl     = safeStr(downloadUrl);
    const thumb    = safeStr(thumbnail);

    const result = await db.execute(sql.raw(
      `UPDATE ads_creatives
       SET generation_status = 'done', status = 'ready',
           provider_name = ${provName}, preview_url = ${pUrl},
           download_url = ${dUrl}, thumbnail = ${thumb}, updated_at = NOW()
       WHERE id = ${id} AND org_id = ${orgId} RETURNING *`
    ));
    const updated = dbRows(result)[0];
    res.json({ ok: true, creative: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/ads/audience ─────────────────────────────────────────────────────
adsRouter.get("/audience", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.execute(sql`
      SELECT id, name, email, phone, company, status, tags,
             lead_score AS "leadScore", created_at AS "createdAt"
      FROM clients WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 300
    `);
    const clients = dbRows<Record<string, unknown>>(rows);
    const total    = clients.length;
    const active   = clients.filter(c => c["status"] === "active" || c["status"] === "client").length;
    const leads    = clients.filter(c => c["status"] === "lead").length;
    const inactive = clients.filter(c => c["status"] === "inactive").length;
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

// ── GET /api/ads/analytics ────────────────────────────────────────────────────
adsRouter.get("/analytics", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db.execute(sql`
      SELECT id, name, status, platforms, goal, budget, spend,
             impressions, clicks, leads, conversions, roi, launched_at, created_at
      FROM ads_campaigns WHERE org_id = ${orgId}
      ORDER BY impressions DESC
    `);
    const campaigns = dbRows<Record<string, unknown>>(rows);
    const totals = campaigns.reduce((acc, c) => ({
      impressions: acc.impressions + Number(c["impressions"] ?? 0),
      clicks:      acc.clicks      + Number(c["clicks"]      ?? 0),
      leads:       acc.leads       + Number(c["leads"]       ?? 0),
      conversions: acc.conversions + Number(c["conversions"] ?? 0),
      spend:       acc.spend       + Number(c["spend"]       ?? 0),
    }), { impressions: 0, clicks: 0, leads: 0, conversions: 0, spend: 0 });

    const ctr = totals.impressions > 0 ? +(totals.clicks / totals.impressions * 100).toFixed(2) : 0;
    const cvr = totals.clicks      > 0 ? +(totals.leads  / totals.clicks      * 100).toFixed(2) : 0;

    res.json({ ok: true, campaigns, totals: { ...totals, ctr, cvr } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
