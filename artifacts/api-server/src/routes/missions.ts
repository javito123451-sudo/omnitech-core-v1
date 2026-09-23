/**
 * Missions — OmniSeller Fase 1 + Fase 2.
 *
 * Fase 1: crear, listar y ver el detalle de una Mission. La Mission orquesta
 * el trabajo de prospección; el registro real de cada prospecto sigue
 * viviendo en lead_results (routes/leads.ts).
 *
 * Fase 2: orquesta Hunter (ya existente, POST /api/leads/search?missionId=…)
 * → Researcher → Scorer (runLeadAnalysis, reutilizado de routes/leads.ts) a
 * través de POST /:id/research, sin duplicar ningún motor.
 *
 * Namespace propio de permisos (omniseller.read/omniseller.write, ver
 * middlewares/permissions.ts) y módulo propio (requireModule("omni_seller"),
 * aplicado en routes/index.ts al montar este router) — decisión de
 * arquitectura aprobada explícitamente, independiente de los permisos
 * leads.* y del módulo omni_leads, que siguen gobernando OmniLeads sin
 * cambios.
 */
import { Router } from "express";
import type { Request } from "express";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadAnalysisTable, leadContactsTable, leadMessagesTable,
  outreachSuppressionsTable, auditLogsTable, MISSION_STATUSES, OUTREACH_SUPPRESSION_REASONS,
} from "@workspace/db";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { reserveCredits, settleCredits, releaseHold, InsufficientCreditsError } from "../credits/creditService";
import { runLeadAnalysis } from "./leads";
import { findContactsForLead } from "../contactFinder";
import { OUTREACH_CHANNELS, checkContactAndChannel, isSuppressed, isCooldownActive } from "../outreach/outreachGuard";
import { dbConfirmationStore } from "../outreach/confirmationStore";
import { assertMissionOpen, confirmAndSendMessage } from "../outreach/outreachService";

export const missionsRouter = Router();

// OmniSeller Fase 2 — coste PROVISIONAL en créditos de investigar+puntuar un
// prospecto dentro de una Mission (Researcher + Scorer, ambos ya existentes
// en routes/leads.ts). No es precio comercial definitivo — igual que
// SEARCH_CREDIT_COST en leads.ts, se fija de verdad en Fase 9. El análisis
// "suelto" de OmniLeads (fuera de una Mission) sigue sin cobrar créditos,
// exactamente como ya funcionaba antes de esta fase.
const RESEARCH_CREDIT_COST = 1;

interface MissionSummary {
  searchesCount: number;
  totalProspects: number;
  analyzed: number;
  highOpportunity: number;
  mediumOpportunity: number;
  lowOpportunity: number;
}

const EMPTY_SUMMARY: MissionSummary = {
  searchesCount: 0, totalProspects: 0, analyzed: 0,
  highOpportunity: 0, mediumOpportunity: 0, lowOpportunity: 0,
};

async function getMissionSummaries(orgId: number, missionIds: number[]): Promise<Map<number, MissionSummary>> {
  const summaries = new Map<number, MissionSummary>();
  if (missionIds.length === 0) return summaries;

  const rows = await db
    .select({
      missionId:  leadSearchesTable.missionId,
      searches:   sql<number>`count(*)::int`,
      prospects:  sql<number>`coalesce(sum(${leadSearchesTable.totalFound}), 0)::int`,
    })
    .from(leadSearchesTable)
    .where(and(
      eq(leadSearchesTable.orgId, orgId),
      inArray(leadSearchesTable.missionId, missionIds),
    ))
    .groupBy(leadSearchesTable.missionId);

  for (const row of rows) {
    if (row.missionId == null) continue;
    summaries.set(row.missionId, { ...EMPTY_SUMMARY, searchesCount: Number(row.searches), totalProspects: Number(row.prospects) });
  }

  // Trazabilidad mission → lead_result → lead_analysis → score: no hace
  // falta ninguna columna nueva, basta con el join que ya existe
  // (lead_results.search_id → lead_searches.mission_id).
  const analysisRows = await db
    .select({
      missionId: leadSearchesTable.missionId,
      analyzed:  sql<number>`count(*) filter (where ${leadResultsTable.status} = 'analyzed')::int`,
      high:      sql<number>`count(*) filter (where ${leadAnalysisTable.opportunity} = 'alta')::int`,
      mid:       sql<number>`count(*) filter (where ${leadAnalysisTable.opportunity} = 'media')::int`,
      low:       sql<number>`count(*) filter (where ${leadAnalysisTable.opportunity} = 'baja')::int`,
    })
    .from(leadResultsTable)
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .leftJoin(leadAnalysisTable, and(
      eq(leadAnalysisTable.resultId, leadResultsTable.id),
      eq(leadAnalysisTable.orgId, leadResultsTable.orgId),
    ))
    .where(and(
      eq(leadResultsTable.orgId, orgId),
      inArray(leadSearchesTable.missionId, missionIds),
    ))
    .groupBy(leadSearchesTable.missionId);

  for (const row of analysisRows) {
    if (row.missionId == null) continue;
    const current = summaries.get(row.missionId) ?? { ...EMPTY_SUMMARY };
    summaries.set(row.missionId, {
      ...current,
      analyzed:          Number(row.analyzed),
      highOpportunity:   Number(row.high),
      mediumOpportunity: Number(row.mid),
      lowOpportunity:    Number(row.low),
    });
  }

  return summaries;
}

// POST /api/missions
missionsRouter.post("/", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;
  const {
    name, objective, sector, location, searchCriteria,
    targetProspectCount, creditBudget, providerConfig,
  } = req.body as {
    name: string; objective?: string; sector?: string; location?: string;
    searchCriteria?: Record<string, unknown>; targetProspectCount?: number;
    creditBudget?: number; providerConfig?: Record<string, unknown>;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name es requerido" });
    return;
  }

  try {
    const [mission] = await db.insert(missionsTable).values({
      orgId,
      name: name.trim(),
      objective: objective?.trim() || null,
      sector: sector?.trim() || null,
      location: location?.trim() || null,
      searchCriteria: searchCriteria ?? null,
      targetProspectCount: targetProspectCount != null ? Number(targetProspectCount) : null,
      // numeric column — drizzle espera string para "numeric"
      creditBudget: creditBudget != null ? String(creditBudget) : null,
      providerConfig: providerConfig ?? null,
      ownerId: userId,
      createdBy: userId,
      status: "active",
    }).returning();

    await logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action:       "missions.create",
      resource:     "mission",
      resourceId:   mission.id,
      orgId,
      details:      { name: mission.name, sector: mission.sector, location: mission.location },
      req,
    });

    res.status(201).json(mission);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/missions
missionsRouter.get("/", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId = req.orgId!;
  try {
    const missions = await db
      .select()
      .from(missionsTable)
      .where(eq(missionsTable.orgId, orgId))
      .orderBy(desc(missionsTable.createdAt));

    const summaries = await getMissionSummaries(orgId, missions.map(m => m.id));

    res.json(missions.map(m => ({
      ...m,
      summary: summaries.get(m.id) ?? EMPTY_SUMMARY,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/missions/:id
missionsRouter.get("/:id", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const missionId = Number(req.params.id);
  // Fase 11 (auditoría — Parte 7): un :id no numérico (NaN) llegaba tal cual
  // al SELECT y Postgres lo rechazaba con una excepción — el catch de abajo
  // la convertía en un 500 que filtraba el texto crudo de la consulta SQL.
  if (!Number.isFinite(missionId)) { res.status(400).json({ error: "id inválido" }); return; }

  try {
    const [mission] = await db
      .select()
      .from(missionsTable)
      .where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));

    if (!mission) {
      res.status(404).json({ error: "No encontrada" });
      return;
    }

    const searches = await db
      .select()
      .from(leadSearchesTable)
      .where(and(eq(leadSearchesTable.orgId, orgId), eq(leadSearchesTable.missionId, missionId)))
      .orderBy(desc(leadSearchesTable.createdAt))
      .limit(50);

    const summaries = await getMissionSummaries(orgId, [missionId]);

    res.json({
      ...mission,
      searches,
      summary: summaries.get(missionId) ?? EMPTY_SUMMARY,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/missions/:id/research — OmniSeller Fase 2.
//
// Orquesta Researcher + Scorer (runLeadAnalysis, reutilizado de
// routes/leads.ts — mismo motor que ya usa OmniLeads, sin duplicarlo) sobre
// los lead_results "new" que el Hunter (POST /api/leads/search?missionId=…,
// ya existente desde Fase 1) haya encontrado para esta Mission.
//
// Créditos: reserve → ejecución → settle por CADA prospecto (referencia
// estable "missions:research:<resultId>", igual de idempotente que
// "leads:search:<searchId>" en Fase 1); si un prospecto falla se libera su
// hold (releaseHold) y se revierte su status a 'new' para poder reintentarlo
// más tarde — el resto del batch continúa. Si no hay saldo para ni un solo
// prospecto, no se intenta ninguno (mismo saldo para todos, mismo resultado).
missionsRouter.post("/:id/research", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const userId    = req.userId!;
  const missionId = Number(req.params.id);
  if (!Number.isFinite(missionId)) { res.status(400).json({ error: "id inválido" }); return; }
  const { ids: rawIds, limit = 10 } = (req.body ?? {}) as { ids?: unknown; limit?: number };
  // Fase 11 (auditoría — Parte 7): `ids`, si se pasa, viene del body de un
  // caller externo — nunca se asumía que sus elementos fueran realmente
  // numéricos. Un elemento no numérico llegaba tal cual hasta el
  // inArray(...) de más abajo y Postgres lo rechazaba con una excepción sin
  // capturar en este handler. Se filtra aquí a enteros finitos; un elemento
  // inválido simplemente se ignora (nunca crashea la petición completa).
  const ids = Array.isArray(rawIds) ? rawIds.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : undefined;

  const [mission] = await db
    .select({ id: missionsTable.id, status: missionsTable.status })
    .from(missionsTable)
    .where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));
  if (!mission) { res.status(404).json({ error: "No encontrada" }); return; }
  // Mismo estado bloqueante que ya respeta el Hunter (POST /leads/search) —
  // una misión cerrada no admite nuevo trabajo, ni de captación ni de research.
  if (mission.status === "completed" || mission.status === "cancelled") {
    res.status(409).json({ error: `La misión está en estado "${mission.status}" y no admite investigación` });
    return;
  }

  const safeLimit = Math.min(10, Math.max(1, Number(limit) || 10));

  // Solo lead_results en estado 'new' que pertenecen a búsquedas de ESTA
  // misión y de ESTA organización — nunca cruza ni org ni misión, aunque el
  // caller pase ids explícitos de otra parte.
  const baseWhere = and(
    eq(leadResultsTable.orgId, orgId),
    eq(leadSearchesTable.missionId, missionId),
    eq(leadResultsTable.status, "new"),
    Array.isArray(ids) && ids.length > 0 ? inArray(leadResultsTable.id, ids) : undefined,
  );
  const candidates = await db
    .select({ id: leadResultsTable.id })
    .from(leadResultsTable)
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(baseWhere)
    .orderBy(leadResultsTable.createdAt)
    .limit(safeLimit);
  const candidateIds = candidates.map(c => c.id);

  if (candidateIds.length === 0) {
    res.json({ missionId, requested: 0, analyzed: 0, failed: 0, notAttempted: 0, creditsSpent: 0 });
    return;
  }

  let analyzed = 0;
  let failed   = 0;
  let creditsSpent = 0;
  let insufficientCredits = false;

  for (const resultId of candidateIds) {
    const reference = `missions:research:${resultId}`;

    try {
      await reserveCredits({ orgId, credits: RESEARCH_CREDIT_COST, reference, userClerkId: req.clerkUserId ?? null });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        // Sin saldo — el resto del batch tampoco podría pagarse (mismo
        // balance). Paramos aquí en vez de intentar uno a uno para nada.
        insufficientCredits = true;
        break;
      }
      failed++;
      continue;
    }

    try {
      const analysis = await runLeadAnalysis(orgId, userId, resultId);
      if (!analysis) throw new Error(`lead_result ${resultId} no encontrado durante el research`);
      await settleCredits({
        orgId, reference, credits: RESEARCH_CREDIT_COST, userClerkId: req.clerkUserId ?? null,
        metadata: { missionId, resultId },
      }).catch(() => {}); // el settle nunca debe tumbar un análisis que ya tuvo éxito
      analyzed++;
      creditsSpent += RESEARCH_CREDIT_COST;
    } catch (err) {
      await releaseHold(orgId, reference).catch(() => {});
      await db.update(leadResultsTable)
        .set({ status: "new", updatedAt: new Date() })
        .where(and(eq(leadResultsTable.id, resultId), eq(leadResultsTable.orgId, orgId)))
        .catch(() => {});
      failed++;
    }
  }

  const notAttempted = candidateIds.length - analyzed - failed;

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown",
    action:       "missions.research",
    resource:     "mission",
    resourceId:   missionId,
    orgId,
    details:      { requested: candidateIds.length, analyzed, failed, notAttempted, creditsSpent, insufficientCredits },
    req,
  });

  const body = { missionId, requested: candidateIds.length, analyzed, failed, notAttempted, creditsSpent };
  if (insufficientCredits && analyzed === 0 && failed === 0) {
    res.status(402).json({ ...body, error: "Créditos insuficientes para investigar estos prospectos" });
    return;
  }
  res.json(body);
});

// POST /api/missions/:id/contacts/find — OmniSeller Fase 3 (Contact Finder).
//
// Delega en contactFinder/contactFinderService.ts (findContactsForLead), que
// resuelve el proveedor configurado para la organización (ninguno elegido
// como definitivo todavía — arquitectura de adaptadores, ver informe de
// Fase 3), aplica OmniCredits reserve→ejecución→settle SOLO si hay
// proveedor configurado, y persiste los contactos con deduplicación. Esta
// ruta solo valida pertenencia (misión de esta org, no cerrada; lead_result
// de ESTA misión) y traduce el resultado del servicio a HTTP — ninguna
// lógica de proveedor vive aquí.
missionsRouter.post("/:id/contacts/find", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const missionId = Number(req.params.id);
  if (!Number.isFinite(missionId)) { res.status(400).json({ error: "id inválido" }); return; }
  const { leadResultId } = (req.body ?? {}) as { leadResultId?: number };

  if (!leadResultId || !Number.isFinite(Number(leadResultId))) {
    res.status(400).json({ error: "leadResultId es obligatorio" });
    return;
  }

  const [mission] = await db
    .select({ id: missionsTable.id, status: missionsTable.status, providerConfig: missionsTable.providerConfig })
    .from(missionsTable)
    .where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));
  if (!mission) { res.status(404).json({ error: "No encontrada" }); return; }
  if (mission.status === "completed" || mission.status === "cancelled") {
    res.status(409).json({ error: `La misión está en estado "${mission.status}" y no admite Contact Finder` });
    return;
  }

  // El lead_result debe pertenecer a ESTA misión y ESTA organización — un
  // id de otra misión (u otra org) no encuentra fila en este join y cae en
  // el mismo 404 que "no encontrada", sin distinguir el motivo (no se filtra
  // información sobre la existencia de recursos de otra org/misión).
  const [leadResult] = await db
    .select({ id: leadResultsTable.id, name: leadResultsTable.name, website: leadResultsTable.website, sector: leadResultsTable.sector })
    .from(leadResultsTable)
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(and(
      eq(leadResultsTable.id, Number(leadResultId)),
      eq(leadResultsTable.orgId, orgId),
      eq(leadSearchesTable.missionId, missionId),
    ));
  if (!leadResult) { res.status(404).json({ error: "El prospecto no pertenece a esta misión" }); return; }

  const result = await findContactsForLead({
    orgId,
    userClerkId: req.clerkUserId ?? null,
    missionId,
    leadResult,
    missionProviderConfig: mission.providerConfig,
  });

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown",
    action:       "missions.contacts.find",
    resource:     "mission",
    resourceId:   missionId,
    orgId,
    details:      { leadResultId: leadResult.id, status: result.status, provider: result.provider ?? null, contactsSaved: result.contacts.length, creditsSpent: result.creditsSpent ?? 0 },
    req,
  });

  if (result.status === "provider_not_configured") {
    res.status(409).json({ error: "provider_not_configured", detail: "No hay un proveedor de Contact Finder configurado para esta organización" });
    return;
  }
  if (result.status === "insufficient_credits") {
    res.status(402).json({ error: "Créditos insuficientes para buscar contactos", creditsRequired: result.creditsRequired });
    return;
  }
  if (result.status === "provider_error") {
    res.status(502).json({ error: "El proveedor de Contact Finder falló", detail: result.error });
    return;
  }

  res.json({
    missionId,
    leadResultId: leadResult.id,
    provider: result.provider ?? null,
    contactsFound: result.contacts.length,
    creditsSpent: result.creditsSpent ?? 0,
    contacts: result.contacts.map(c => ({
      id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone,
      linkedinUrl: c.linkedinUrl, status: c.status, confidence: c.confidence,
    })),
  });
});

// GET /api/missions/:id/contacts — OmniSeller Fase 14 (cierre de Gap 1,
// detectado en el informe de Fase 13).
//
// Fase 13 dejó documentado que no existía ningún GET para volver a listar
// los lead_contacts ya encontrados por Contact Finder tras recargar la
// página — la UI solo tenía la respuesta síncrona de POST .../contacts/find,
// cacheada en memoria durante la sesión. Auditoría de Fase 14 (grep
// exhaustivo de leadContactsTable en todo el backend): ningún router,
// service o repositorio expone ya esta lectura — se necesitaba, en efecto,
// un endpoint nuevo (no una integración con algo existente).
//
// Cambio mínimo: una sola ruta de solo lectura, mismo permiso
// (omniseller.read, sin permisos nuevos), mismo patrón de pertenencia que
// el resto de este router (mission de esta org → lead_searches de esta
// mission → lead_results de esas búsquedas → lead_contacts de esos
// resultados) y el índice que la tabla YA tenía desde Fase 3
// (lead_contacts_lead_result_id_idx) — 0 migraciones. Devuelve TODOS los
// contactos de la misión de una vez (no por lead_result individual) para
// que el frontend pueda reconstruir su estado tras un reload con una sola
// llamada, igual que ya hace con los prospectos.
missionsRouter.get("/:id/contacts", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const missionId = Number(req.params.id);
  if (!Number.isFinite(missionId)) { res.status(400).json({ error: "id inválido" }); return; }

  const [mission] = await db
    .select({ id: missionsTable.id })
    .from(missionsTable)
    .where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));
  if (!mission) { res.status(404).json({ error: "No encontrada" }); return; }

  const rows = await db
    .select({
      id: leadContactsTable.id, leadResultId: leadContactsTable.leadResultId,
      name: leadContactsTable.name, role: leadContactsTable.role, email: leadContactsTable.email,
      phone: leadContactsTable.phone, linkedinUrl: leadContactsTable.linkedinUrl,
      status: leadContactsTable.status, confidence: leadContactsTable.confidence,
      provider: leadContactsTable.provider,
    })
    .from(leadContactsTable)
    .innerJoin(leadResultsTable, eq(leadContactsTable.leadResultId, leadResultsTable.id))
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(and(eq(leadContactsTable.orgId, orgId), eq(leadSearchesTable.missionId, missionId)))
    .orderBy(desc(leadContactsTable.createdAt));

  res.json({ missionId, contacts: rows });
});

// GET /api/missions/:id/audit — OmniSeller Fase 16 (Trazabilidad).
//
// El único audit endpoint previo (GET /api/control-center/audit) sigue
// protegido por requireSuperAdmin y NO se toca esa protección — sigue
// siendo el audit trail de plataforma completo, para superadmins.
//
// Este endpoint es distinto: mínimo, read-only, aislado por org (orgId
// SIEMPRE de req.orgId, nunca de query/params), protegido por el permiso
// omniseller.read YA existente (no se crea ningún permiso nuevo), y
// reutiliza auditLogsTable/logAudit — la misma tabla que missions.ts,
// outreachBookings.ts y outreachFollowup.ts ya usan en cada acción
// relevante (missions.create, missions.research, missions.contacts.find,
// outreach.draft_created, outreach.confirmation_requested,
// outreach.send_succeeded/failed/blocked, appointment.booked_from_omniseller,
// outreach_followup.*). No se crea arquitectura de auditoría paralela ni
// tabla nueva.
//
// Filtro por misión: las acciones de Mission usan resource="mission" +
// resourceId=missionId directamente; las de Outreach/Booking guardan
// missionId dentro de `details` (jsonb) — se filtra con `details->>'missionId'`,
// sin migración ni índice nuevo (volumen por misión es bajo). No se
// devuelven ipAddress/userAgent — no aportan al operador y reducen la
// exposición de datos, tal como pide el mandato de Fase 16.
missionsRouter.get("/:id/audit", requirePermission("omniseller.read"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const missionId = Number(req.params.id);
  if (!Number.isFinite(missionId)) { res.status(400).json({ error: "id inválido" }); return; }

  const [mission] = await db
    .select({ id: missionsTable.id })
    .from(missionsTable)
    .where(and(eq(missionsTable.id, missionId), eq(missionsTable.orgId, orgId)));
  if (!mission) { res.status(404).json({ error: "No encontrada" }); return; }

  const rows = await db
    .select({
      id: auditLogsTable.id, action: auditLogsTable.action, resource: auditLogsTable.resource,
      resourceId: auditLogsTable.resourceId, actorEmail: auditLogsTable.actorEmail,
      details: auditLogsTable.details, severity: auditLogsTable.severity, createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.orgId, orgId),
      or(
        and(eq(auditLogsTable.resource, "mission"), eq(auditLogsTable.resourceId, String(missionId))),
        sql`${auditLogsTable.details} ->> 'missionId' = ${String(missionId)}`,
      ),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(200);

  res.json({ missionId, entries: rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// OmniSeller Fase 4 — Outreach controlado.
//
// Mission → Lead → Contact → Message(draft) → request-confirmation → confirm
// (confirmación humana + envío real, atómico) → Tracking.
//
// NINGÚN mensaje se envía sin: (a) un token de confirmación humana válido,
// de un solo uso, ligado a ESTE mensaje y a ESTA organización
// (outreach/confirmationStore.ts); (b) pasar la suppression list y el
// cooldown (outreach/outreachGuard.ts); (c) el kill switch de Outreach
// desactivado; (d) crédito reservado (outreach/outreachService.ts). El
// envío real reutiliza IntegrationManager.send() del Hub (Resend/WhatsApp
// Cloud API/Telegram, ya existentes) — este router nunca llama a un
// proveedor directamente.
// ═══════════════════════════════════════════════════════════════════════════

async function findMessageForMission(orgId: number, missionId: number, messageId: number) {
  const [row] = await db
    .select({
      id: leadMessagesTable.id, orgId: leadMessagesTable.orgId, resultId: leadMessagesTable.resultId,
      contactId: leadMessagesTable.contactId, channel: leadMessagesTable.channel, content: leadMessagesTable.content,
      status: leadMessagesTable.status, sendAttempts: leadMessagesTable.sendAttempts,
    })
    .from(leadMessagesTable)
    .innerJoin(leadResultsTable, eq(leadMessagesTable.resultId, leadResultsTable.id))
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(and(
      eq(leadMessagesTable.id, messageId), eq(leadMessagesTable.orgId, orgId), eq(leadSearchesTable.missionId, missionId),
    ));
  return row ?? null;
}

// POST /api/missions/:id/contacts/:contactId/messages — crea un DRAFT.
missionsRouter.post("/:id/contacts/:contactId/messages", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const userId    = req.userId!;
  const missionId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  // Fase 11 (auditoría — Parte 7): contactId no lo cubre assertMissionOpen
  // (solo valida missionId) — sin este guard, un :contactId no numérico
  // llegaba tal cual al SELECT de más abajo y crasheaba sin capturar.
  if (!Number.isFinite(contactId)) { res.status(400).json({ error: "contactId inválido" }); return; }
  const { channel, content } = (req.body ?? {}) as { channel?: string; content?: string };

  const missionCheck = await assertMissionOpen(orgId, missionId);
  if (!missionCheck.ok) { res.status(missionCheck.httpStatus).json({ error: missionCheck.error }); return; }

  if (!content || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content es obligatorio" });
    return;
  }
  if (!channel || !OUTREACH_CHANNELS.includes(channel as (typeof OUTREACH_CHANNELS)[number])) {
    res.status(400).json({ error: `channel debe ser uno de: ${OUTREACH_CHANNELS.join(", ")}` });
    return;
  }

  // El contacto debe pertenecer a ESTA org y a un lead_result de ESTA misión.
  const [contactRow] = await db
    .select({ id: leadContactsTable.id, leadResultId: leadContactsTable.leadResultId })
    .from(leadContactsTable)
    .innerJoin(leadResultsTable, eq(leadContactsTable.leadResultId, leadResultsTable.id))
    .innerJoin(leadSearchesTable, eq(leadResultsTable.searchId, leadSearchesTable.id))
    .where(and(
      eq(leadContactsTable.id, contactId), eq(leadContactsTable.orgId, orgId), eq(leadSearchesTable.missionId, missionId),
    ));
  if (!contactRow) { res.status(404).json({ error: "El contacto no pertenece a esta misión" }); return; }

  // Falla rápido si el contacto ya no puede recibir este canal (no bloquea
  // por suppression/cooldown todavía — eso se revalida en el momento del
  // envío, no al crear el borrador).
  const channelCheck = await checkContactAndChannel(orgId, contactRow.leadResultId, contactId, channel);
  if (!channelCheck.ok) { res.status(channelCheck.httpStatus).json({ error: channelCheck.reason, detail: channelCheck.detail }); return; }

  const [message] = await db.insert(leadMessagesTable).values({
    orgId, resultId: contactRow.leadResultId, contactId, channel, content: content.trim(), status: "draft", createdBy: userId,
  }).returning();

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: "outreach.draft_created", resource: "lead_message",
    resourceId: message!.id, orgId, details: { missionId, contactId, channel }, req,
  });

  res.status(201).json(message);
});

// POST /api/missions/:id/messages/:messageId/request-confirmation
missionsRouter.post("/:id/messages/:messageId/request-confirmation", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const userId    = req.userId!;
  const missionId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  // Fase 11 (auditoría — Parte 7): messageId no lo cubre assertMissionOpen.
  if (!Number.isFinite(messageId)) { res.status(400).json({ error: "messageId inválido" }); return; }

  const missionCheck = await assertMissionOpen(orgId, missionId);
  if (!missionCheck.ok) { res.status(missionCheck.httpStatus).json({ error: missionCheck.error }); return; }

  const message = await findMessageForMission(orgId, missionId, messageId);
  if (!message) { res.status(404).json({ error: "No encontrado" }); return; }
  if (message.status !== "draft") {
    res.status(409).json({ error: `El mensaje está en estado "${message.status}", no en "draft"` });
    return;
  }
  if (!message.contactId) { res.status(409).json({ error: "El mensaje no tiene un contacto asociado" }); return; }

  // Pre-check informativo — evita pedir una confirmación humana para un
  // envío que ya sabemos que se bloquearía. El chequeo AUTORITATIVO vuelve a
  // correr en el momento del envío real (outreachService.ts), por si el
  // estado cambia entre este paso y la confirmación.
  const channelCheck = await checkContactAndChannel(orgId, message.resultId, message.contactId, message.channel);
  if (!channelCheck.ok) {
    await db.update(leadMessagesTable).set({ status: "blocked", errorMessage: channelCheck.reason, updatedAt: new Date() })
      .where(and(eq(leadMessagesTable.id, messageId), eq(leadMessagesTable.orgId, orgId)));
    res.status(channelCheck.httpStatus).json({ error: channelCheck.reason, detail: channelCheck.detail });
    return;
  }
  if (await isSuppressed(orgId, message.channel as (typeof OUTREACH_CHANNELS)[number], channelCheck.destination)) {
    await db.update(leadMessagesTable).set({ status: "suppressed", updatedAt: new Date() })
      .where(and(eq(leadMessagesTable.id, messageId), eq(leadMessagesTable.orgId, orgId)));
    res.status(409).json({ error: "suppressed", detail: "El destino está en la suppression list" });
    return;
  }
  if (await isCooldownActive(orgId, message.contactId, message.channel, messageId)) {
    res.status(429).json({ error: "cooldown_active", detail: "Cooldown activo para este contacto y canal — inténtalo más tarde" });
    return;
  }

  await db.update(leadMessagesTable).set({ status: "pending_confirmation", updatedAt: new Date() })
    .where(and(eq(leadMessagesTable.id, messageId), eq(leadMessagesTable.orgId, orgId)));

  const { token, expiresAt } = await dbConfirmationStore.create({ orgId, leadMessageId: messageId, createdBy: userId });

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: "outreach.confirmation_requested", resource: "lead_message",
    resourceId: messageId, orgId, details: { missionId }, req,
  });

  res.json({ leadMessageId: messageId, confirmToken: token, expiresAt });
});

// POST /api/missions/:id/messages/:messageId/confirm — confirmación humana + envío real.
missionsRouter.post("/:id/messages/:messageId/confirm", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId     = req.orgId!;
  const userId    = req.userId!;
  const missionId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  // Fase 11 (auditoría — Parte 7): messageId no lo cubre assertMissionOpen.
  if (!Number.isFinite(messageId)) { res.status(400).json({ error: "messageId inválido" }); return; }
  const { confirmToken } = (req.body ?? {}) as { confirmToken?: string };

  if (!confirmToken || typeof confirmToken !== "string") {
    res.status(400).json({ error: "confirmToken es obligatorio" });
    return;
  }

  const missionCheck = await assertMissionOpen(orgId, missionId);
  if (!missionCheck.ok) { res.status(missionCheck.httpStatus).json({ error: missionCheck.error }); return; }

  const message = await findMessageForMission(orgId, missionId, messageId);
  if (!message) { res.status(404).json({ error: "No encontrado" }); return; }

  const result = await confirmAndSendMessage({ orgId, confirmToken, consumedBy: userId, leadMessageId: messageId });

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown",
    action: result.status === "sent" ? "outreach.send_succeeded"
      : result.status === "invalid_confirmation" ? "outreach.confirmation_invalid"
      : result.status === "provider_error" || result.status === "insufficient_credits" ? "outreach.send_failed"
      : "outreach.send_blocked",
    resource: "lead_message", resourceId: messageId, orgId,
    details: { missionId, result: result.status, detail: "detail" in result ? result.detail : undefined },
    severity: result.status === "sent" ? "info" : "warning",
    req,
  });

  if (result.status === "invalid_confirmation") { res.status(409).json({ error: "confirmation_invalid" }); return; }
  if (result.status === "sent") { res.json({ leadMessageId: messageId, status: "sent", externalMessageId: result.externalMessageId, creditsSpent: result.creditsSpent }); return; }
  if (result.status === "insufficient_credits") { res.status(402).json({ error: result.status, detail: result.detail }); return; }
  if (result.status === "provider_error") { res.status(502).json({ error: result.status, detail: result.detail }); return; }
  res.status(409).json({ error: result.status, detail: result.detail }); // blocked_kill_switch / blocked_suppressed / blocked_cooldown / blocked_contact / blocked_max_attempts
});

// POST /api/missions/outreach/suppressions — gestión manual de la suppression list (org-scoped, no ligada a una misión concreta).
missionsRouter.post("/outreach/suppressions", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;
  const { email, phone, channel, reason, source } = (req.body ?? {}) as {
    email?: string; phone?: string; channel?: string; reason?: string; source?: string;
  };

  if (!email && !phone) { res.status(400).json({ error: "email o phone es obligatorio" }); return; }
  if (!reason || !OUTREACH_SUPPRESSION_REASONS.includes(reason as (typeof OUTREACH_SUPPRESSION_REASONS)[number])) {
    res.status(400).json({ error: `reason debe ser uno de: ${OUTREACH_SUPPRESSION_REASONS.join(", ")}` });
    return;
  }
  if (channel && !OUTREACH_CHANNELS.includes(channel as (typeof OUTREACH_CHANNELS)[number])) {
    res.status(400).json({ error: `channel debe ser uno de: ${OUTREACH_CHANNELS.join(", ")} (u omitirse para todos)` });
    return;
  }

  const [row] = await db.insert(outreachSuppressionsTable).values({
    orgId, email: email ?? null, phone: phone ?? null, channel: channel ?? null, reason, source: source ?? "manual", createdBy: userId,
  }).returning();

  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown", action: "outreach.suppression_added", resource: "outreach_suppression",
    resourceId: row!.id, orgId, details: { email, phone, channel: channel ?? null, reason }, req,
  });

  res.status(201).json(row);
});

// Reexportado por si el frontend necesita validar valores de status permitidos.
export { MISSION_STATUSES };
