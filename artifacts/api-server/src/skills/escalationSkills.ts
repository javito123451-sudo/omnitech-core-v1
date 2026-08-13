// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Escalation Skills
//  Lets AVA hand off to a human instead of inventing an answer when the
//  request doesn't fit any of the tools available on the current channel
//  (see getOpenAIFunctionsForChannel("customer") in skills/index.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { db, orgMembersTable } from "@workspace/db";
import { eq, and, inArray, asc, sql } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

async function escalateToHuman(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const reason  = params["reason"]  ? String(params["reason"]).trim()  : "";
  const summary = params["summary"] ? String(params["summary"]).trim() : "";

  if (!reason && !summary) {
    return JSON.stringify({ error: "Se requiere reason o summary para escalar a un humano." });
  }

  // Resolve who gets notified: the org's owner, falling back to an admin.
  // (org_members.role — not the platform-wide SUPER_ADMIN role, which is
  // OmniTech staff, not this customer's own team.)
  const [target] = await db
    .select({ userId: orgMembersTable.userId, role: orgMembersTable.role })
    .from(orgMembersTable)
    .where(and(
      eq(orgMembersTable.orgId, orgId),
      inArray(orgMembersTable.role, ["owner", "admin"]),
    ))
    .orderBy(sql`CASE WHEN ${orgMembersTable.role} = 'owner' THEN 0 ELSE 1 END`, asc(orgMembersTable.joinedAt))
    .limit(1);

  if (!target) {
    return JSON.stringify({
      error: "No se encontró un responsable (owner/admin) en el workspace para escalar. Pide al usuario que contacte directamente.",
    });
  }

  const channelLabel =
    context.channel === "whatsapp" ? "WhatsApp" :
    context.channel === "telegram" ? "Telegram" :
    context.channel ?? "desconocido";

  const contactLabel = context.client
    ? context.client.name
    : context.guestIdentity ?? "identidad desconocida";

  const body = [
    `Motivo: ${reason || "(no especificado)"}`,
    `Resumen: ${summary || "(no especificado)"}`,
    `Canal: ${channelLabel}`,
    `Contacto: ${contactLabel}`,
  ].join("\n");

  const title = "AVA necesita ayuda humana — WhatsApp/Telegram";

  // notifications table has no Drizzle schema yet (created via raw SQL in
  // FIX-AC) — same insert pattern already used by the notification.create
  // built-in action (action-engine/actions/builtins.ts).
  await db.execute(sql`
    INSERT INTO notifications
      (org_id, target_user_id, title, body, link, level, is_read, created_at)
    VALUES
      (${orgId}, ${target.userId}, ${title}, ${body}, ${null}, 'warning', false, NOW())
  `);

  return JSON.stringify({
    success: true,
    dbVerified: true,
    notifiedUserId: target.userId,
    message: "He avisado a nuestro equipo, en breve se pondrán en contacto contigo.",
  });
}

export const escalateToHumanSkill: SkillDefinition = {
  id: "escalate_to_human",
  name: "Escalar a Humano",
  description:
    "Avisa a un miembro del equipo (owner/admin del workspace) cuando el usuario pide algo que no se puede resolver con las herramientas disponibles en este canal. Úsalo en vez de inventar una respuesta.",
  params: [
    { name: "reason",  type: "string", description: "Motivo del escalado (qué necesita el usuario que no se puede resolver aquí)", required: true },
    { name: "summary", type: "string", description: "Resumen breve de la conversación / lo que pidió el usuario", required: true },
  ],
  execute: escalateToHuman,
};
