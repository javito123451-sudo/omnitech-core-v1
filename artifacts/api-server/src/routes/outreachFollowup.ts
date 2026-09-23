/**
 * OmniSeller Fase 6 — Gestión de secuencias de Follow-up.
 *
 * Ruta propia (punto 19 del mandato), independiente de routes/missions.ts,
 * montada junto al resto de infraestructura de Outreach (mismo criterio que
 * routes/outreachWebhooks.ts, aunque esta SÍ requiere sesión — no es un
 * webhook público). Mismo módulo (requireModule("omni_seller"), montado en
 * routes/index.ts) y mismos permisos que Missions — omniseller.read/write,
 * SIN permisos nuevos.
 *
 * Multi-tenancy (punto 21): toda operación valida la cadena
 * mission → lead_result → lead_contact → lead_message → followup dentro de
 * la MISMA organización — nunca se confía en un id del caller sin
 * verificar pertenencia (assertOwnedChain / el propio WHERE org_id= en cada
 * consulta).
 */
import { Router } from "express";
import type { Request } from "express";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import {
  OUTREACH_FOLLOWUP_AUDIT, cancelFollowupSequence, getFollowupById, getFollowupSequence,
  listFollowups, loadAnchorMessage, scheduleFollowupSequence,
} from "../outreach/followup/followupService";

export const outreachFollowupRouter = Router();

// POST /api/outreach/followups — activa la secuencia (punto 6: aprobación
// de la SECUENCIA, una sola vez) sobre un lead_message ya "sent".
outreachFollowupRouter.post("/", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const { leadMessageId } = (req.body ?? {}) as { leadMessageId?: number };

  if (!leadMessageId || !Number.isFinite(Number(leadMessageId))) {
    res.status(400).json({ error: "leadMessageId es obligatorio" });
    return;
  }

  const result = await scheduleFollowupSequence({ orgId, leadMessageId: Number(leadMessageId) });

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      not_found: 404, not_sent: 409, no_contact: 409, already_scheduled: 409,
    };
    res.status(statusByReason[result.reason] ?? 400).json({ error: result.reason });
    return;
  }

  // Punto 20 — la aprobación de la secuencia queda auditada explícitamente,
  // además del alta del propio intento 1.
  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: OUTREACH_FOLLOWUP_AUDIT.approved,
    resource: "lead_message", resourceId: leadMessageId, orgId,
    details: { followupId: result.followup.id }, req,
  });
  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: OUTREACH_FOLLOWUP_AUDIT.scheduled,
    resource: "outreach_followup", resourceId: result.followup.id, orgId,
    details: { leadMessageId, attempt: 1, nextRunAt: result.followup.nextRunAt }, req,
  });

  res.status(201).json(result.followup);
});

// GET /api/outreach/followups — lista, filtrable por missionId/status.
outreachFollowupRouter.get("/", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const { missionId, status } = req.query as { missionId?: string; status?: string };
  const rows = await listFollowups(orgId, {
    missionId: missionId ? Number(missionId) : undefined,
    status: status || undefined,
  });
  res.json(rows);
});

// GET /api/outreach/followups/message/:leadMessageId — la secuencia completa (intentos 1..N) de un mensaje ancla.
outreachFollowupRouter.get("/message/:leadMessageId", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const leadMessageId = Number(req.params.leadMessageId);
  // Fase 11 (auditoría — Parte 7): un :leadMessageId no numérico llegaba tal
  // cual al SELECT y Postgres lo rechazaba con una excepción sin capturar.
  if (!Number.isFinite(leadMessageId)) { res.status(400).json({ error: "leadMessageId inválido" }); return; }

  const anchor = await loadAnchorMessage(orgId, leadMessageId);
  if (!anchor) { res.status(404).json({ error: "No encontrado" }); return; }

  const rows = await getFollowupSequence(orgId, leadMessageId);
  res.json({ leadMessageId, sequence: rows });
});

// GET /api/outreach/followups/:id
outreachFollowupRouter.get("/:id", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const id = Number(req.params.id);
  // Fase 11 (auditoría — Parte 7): mismo guard que en el resto de rutas de
  // OmniSeller — un :id no numérico crasheaba sin capturar contra Postgres.
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const row = await getFollowupById(orgId, id);
  if (!row) { res.status(404).json({ error: "No encontrado" }); return; }
  res.json(row);
});

// POST /api/outreach/followups/:id/cancel — desactiva la secuencia completa (punto 19).
outreachFollowupRouter.post("/:id/cancel", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const row = await getFollowupById(orgId, id);
  if (!row) { res.status(404).json({ error: "No encontrado" }); return; }

  const cancelledCount = await cancelFollowupSequence({
    orgId, leadMessageId: row.leadMessageId, reason: "cancelled_by_user",
  });

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: OUTREACH_FOLLOWUP_AUDIT.cancelled,
    resource: "outreach_followup", resourceId: row.id, orgId,
    details: { leadMessageId: row.leadMessageId, cancelledCount, reason: "cancelled_by_user" }, req,
  });

  res.json({ leadMessageId: row.leadMessageId, cancelledCount });
});
