// ═══════════════════════════════════════════════════════════════════════════
// Ava V2 — Omni Marketing Hub skills
// These skills create drafts and list campaigns only. Sending is deliberately
// left behind the explicit Marketing Hub launch action.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

type DbRows<T> = { rows: T[] };

async function createMarketingCampaign(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const name = String(params["name"] ?? "").trim();
  if (!name) return JSON.stringify({ error: "Se necesita un nombre para la campaña." });

  const channel = String(params["channel"] ?? "email").toLowerCase();
  if (!["email", "whatsapp", "sms"].includes(channel)) {
    return JSON.stringify({ error: "El canal debe ser email, whatsapp o sms." });
  }

  const subject = params["subject"] ? String(params["subject"]).trim() : null;
  const body = params["body"] ? String(params["body"]).trim() : null;
  const audienceFilter = String(params["audience_filter"] ?? "all").trim() || "all";

  const result = await db.execute(sql`
    INSERT INTO marketing_campaigns
      (org_id, name, status, channel, subject, body, audience_filter, created_by, created_at, updated_at)
    VALUES
      (${orgId}, ${name}, 'draft', ${channel}, ${subject}, ${body},
       ${audienceFilter}, ${context.user?.id ?? null}, NOW(), NOW())
    RETURNING id, name, status, channel, subject, body, audience_filter, created_at
  `);
  const campaign = (result as DbRows<Record<string, unknown>>).rows[0];
  if (!campaign) return JSON.stringify({ error: "No se pudo guardar el borrador de campaña." });

  return JSON.stringify({
    success: true,
    campaign,
    message: `Borrador de campaña #${campaign["id"]} creado correctamente.`,
    requiresContent: !body,
    launchRequiresExplicitConfirmation: true,
  });
}

async function listMarketingCampaigns(
  _params: Record<string, unknown>,
  orgId: number,
  _context: SkillContext,
): Promise<string> {
  const result = await db.execute(sql`
    SELECT id, name, status, channel, subject, audience_filter, sent_count,
           failed_count, created_at, scheduled_at, sent_at
    FROM marketing_campaigns
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  const campaigns = (result as DbRows<Record<string, unknown>>).rows;
  return JSON.stringify({ total: campaigns.length, campaigns });
}

export const createMarketingCampaignSkill: SkillDefinition = {
  id: "create_marketing_campaign",
  name: "Crear borrador de campaña de marketing",
  description: "Crea un borrador en Omni Marketing Hub. No envía mensajes ni lanza campañas.",
  params: [
    { name: "name", type: "string", description: "Nombre de la campaña", required: true },
    { name: "channel", type: "string", description: "Canal: email, whatsapp o sms", default: "email" },
    { name: "subject", type: "string", description: "Asunto de la campaña (email)", required: false },
    { name: "body", type: "string", description: "Contenido del mensaje", required: false },
    { name: "audience_filter", type: "string", description: "Filtro de audiencia; por defecto all", default: "all" },
  ],
  execute: createMarketingCampaign,
};

export const listMarketingCampaignsSkill: SkillDefinition = {
  id: "list_marketing_campaigns",
  name: "Consultar campañas de marketing",
  description: "Lista las últimas campañas de Omni Marketing Hub de la organización actual.",
  params: [],
  execute: listMarketingCampaigns,
};
