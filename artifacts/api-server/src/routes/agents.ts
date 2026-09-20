/**
 * Fábrica de Agentes IA — API (módulo ai_agents): definiciones y versiones,
 * simulación gratuita, pruebas/ejecución con IA real vía AI Gateway,
 * confirmación de acciones, créditos y agente por defecto.
 * Todo se filtra por req.orgId; la autorización se recalcula en el backend.
 * NO conecta canales: Telegram/WhatsApp siguen con su lógica actual.
 */
import { Router, type Request, type Response } from "express";
import { agentConfigSchema } from "@workspace/db";
import { hasPermission, requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { listSkills } from "../skills";
import {
  AgentError, createAgent, getAgentDetail, listAgents, publishAgent, readConfig, resolveRunTarget, restoreVersion,
  saveDraft, transitionAgent, updateAgentMeta, type AgentTransition,
} from "../agents/agentService";
import { resolveToolAccess } from "../agents/authorization";
import { loadKnowledge } from "../agents/knowledge";
import { simulateAgent, SIMULATION_SCENARIOS } from "../agents/simulator";
import { confirmAgentAction, defaultConfirmDeps, defaultRunnerDeps, type RunActor } from "../agents/agentRunner";
import { defaultLiveRunDeps, executeRun, IDEMPOTENCY_KEY_PATTERN, LiveRunRejection } from "../agents/liveRunService";
import { makeAudit, type LiveAuditActor } from "../agents/liveAudit";
import { clearDefaultAgent, isDefaultKey, listDefaults, setDefaultAgent } from "../agents/defaultAgents";
import { listLedger, getAvailable } from "../credits/creditService";
import { getDashboard } from "../credits/reporting";
import { getAgentUsage } from "../agents/usageService";
import { toApiError } from "../ai-gateway/apiErrors";
import { ensurePricingLoaded } from "../ai-gateway/pricingService";
import { buildToolCatalog, listKnowledgeCatalog, loadModelCatalog } from "../agents/catalogService";
import { TOOL_REGISTRY } from "../agents/toolRegistry";
import { previewEffectiveAccess } from "../agents/effectiveAccess";
import { stripTechnical } from "../credits/customerView";
import { listPacks } from "../credits/packService";

export const agentsRouter = Router();

function actorOf(req: Request): RunActor {
  return {
    orgId: req.orgId!, userId: req.userId!, userClerkId: req.clerkUserId!,
    orgRole: req.effectiveRole ?? req.orgRole ?? "none", platformRole: req.platformRole ?? null,
  };
}

/** Modo técnico/admin: tokens y costes técnicos solo con ?technical=1 y permiso de edición de agentes. */
function technicalView(req: Request): boolean {
  return req.query["technical"] === "1" && (req.isSuperAdmin === true || hasPermission(req, "agents.write"));
}

function agentId(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Estado HTTP y cuerpo de un error de la Fábrica. Una sola traducción para las rutas y para el registro de auditoría. */
function errorToHttp(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof LiveRunRejection) return { status: err.status, body: { status: err.code, message: err.message, ...err.extra } };
  if (err instanceof AgentError) {
    return { status: err.status, body: { error: err.message, problems: err.problems, ...(err.details.length ? { problemDetails: err.details } : {}) } };
  }
  // Controlled failures of a paid operation (INSUFFICIENT_CREDITS, limits, budget,
  // provider…): a structured status, never a generic 500, and nothing was charged.
  const structured = toApiError(err);
  if (structured) return { status: structured.http, body: structured.body as Record<string, unknown> };
  if (err && typeof err === "object" && "issues" in err) {
    return { status: 400, body: { error: "Configuración no válida.", issues: (err as { issues: unknown }).issues } };
  }
  return { status: 500, body: { error: String(err instanceof Error ? err.message : err) } };
}

function fail(res: Response, err: unknown) {
  const { status, body } = errorToHttp(err);
  if (err instanceof LiveRunRejection && typeof err.extra["retryAfterSeconds"] === "number") res.setHeader("Retry-After", String(err.extra["retryAfterSeconds"]));
  res.status(status).json(body);
}

/** Motivo estable de un error de ejecución para la auditoría. */
function failureReason(err: unknown): { status: number; reason: string } {
  const { status, body } = errorToHttp(err);
  const code = typeof body["status"] === "string" ? String(body["status"]).toLowerCase() : null;
  const reason = code ?? (err instanceof AgentError ? (status === 404 ? "agent_not_found" : status === 409 ? "agent_state" : "invalid_agent") : "internal_error");
  return { status, reason };
}

const auditActorOf = (req: Request): LiveAuditActor => ({
  clerkId: req.clerkUserId!, userId: req.userId!, orgId: req.orgId!, role: req.effectiveRole ?? req.orgRole ?? "none",
});
const auditSink = (req: Request) => makeAudit({ ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined });

/** LIVE exige agents.execute (agents.read solo ve y simula; agents.write edita y prueba). Deja constancia del rechazo. */
async function denyIfCannotExecute(req: Request, res: Response, agent: number | null, mode: "live"): Promise<boolean> {
  if (hasPermission(req, "agents.execute")) return false;
  await auditSink(req)({ action: "agent_run_denied", actor: auditActorOf(req), agentId: agent, mode, success: false, reason: "permission_denied", details: { permission: "agents.execute", endpoint: `${req.method} ${req.path}` } });
  res.status(403).json({
    error: "permission_denied",
    message: "Ejecutar agentes en LIVE requiere el permiso agents.execute. Contacta con tu administrador.",
    permission: "agents.execute",
  });
  return true;
}

function audit(req: Request, action: string, id: number | string, extra: Record<string, unknown> = {}) {
  void logAudit({
    actorClerkId: req.clerkUserId!, action, resource: "ai_agent", resourceId: id, orgId: req.orgId,
    details: { actorType: "user", ...extra }, req,
  });
}

agentsRouter.get("/", requirePermission("agents.read"), async (req, res) => {
  try { res.json(await listAgents(req.orgId!)); } catch (err) { fail(res, err); }
});

agentsRouter.post("/", requirePermission("agents.write"), async (req, res) => {
  try {
    const { name, description, avatarUrl, config } = req.body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name es requerido" }); return; }
    const partial = config === undefined ? undefined : agentConfigSchema.partial().parse(config);
    const created = await createAgent(req.orgId!, req.clerkUserId ?? null, {
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
      config: partial,
    });
    audit(req, "ai_agent_created", created.agent.id, { name: created.agent.name });
    res.status(201).json(created);
  } catch (err) { fail(res, err); }
});

// ── Rutas fijas (van antes de /:id) ──────────────────────────────────────────

agentsRouter.get("/scenarios", requirePermission("agents.read"), (_req, res) => { res.json(SIMULATION_SCENARIOS); });

// ── Catálogos de solo lectura (fuentes existentes; ver agents/catalogService.ts) ─────────────────────
// Son descriptivos: estar en el catálogo no da acceso a nada. El acceso efectivo de un agente a una tool lo calcula
// resolveToolAccess en cada ejecución. Solo agents.read (sin exigir permisos de CRM ni de ai.*).

// Tools que un agente puede declarar: TOOL_REGISTRY ∩ Skill Engine. Global (código), igual para todos los workspaces.
agentsRouter.get("/catalog/tools", requirePermission("agents.read"), (_req, res) => {
  try { res.json(buildToolCatalog(TOOL_REGISTRY, listSkills())); } catch (err) { fail(res, err); }
});

// Providers implementados y modelos con precio resoluble (getPricingReport: ai_model_pricing vigente + valores heredados).
// Sin precios, claves ni variables de entorno.
agentsRouter.get("/catalog/models", requirePermission("agents.read"), async (_req, res) => {
  try {
    res.json(await loadModelCatalog());
  } catch (err) { fail(res, err); }
});

// Knowledge del workspace activo, solo id/título/categoría (nunca el contenido). No reutiliza GET /api/knowledge-base porque
// ese endpoint exige el módulo knowledge_base y el permiso ai.read (el runtime del agente no exige ninguno de los dos) y
// devuelve los documentos completos.
agentsRouter.get("/catalog/knowledge", requirePermission("agents.read"), async (req, res) => {
  try {
    // SUPER_ADMIN pasa el permiso pero NO obtiene datos de otros workspaces: sin workspace activo no hay catálogo.
    if (!req.orgId) { res.status(400).json({ error: "no_org_context", message: "Selecciona un workspace para ver su conocimiento." }); return; }
    res.json(await listKnowledgeCatalog(req.orgId));
  } catch (err) { fail(res, err); }
});

// Panel de créditos del workspace: saldo, incluidos, consumo, por agente/modelo/funcionalidad, series y alertas.
agentsRouter.get("/credits", requirePermission("agents.read"), async (req, res) => {
  try { res.json(await getDashboard(req.orgId!, new Date(), { technical: technicalView(req) })); } catch (err) { fail(res, err); }
});

// Catálogo de packs de OmniCredits extra (solo catálogo: la compra no está integrada con ningún pago).
agentsRouter.get("/credits/packs", requirePermission("agents.read"), async (_req, res) => {
  try { res.json(await listPacks({ activeOnly: true })); } catch (err) { fail(res, err); }
});

agentsRouter.get("/credits/balance", requirePermission("agents.read"), async (req, res) => {
  try { res.json(await getAvailable(req.orgId!)); } catch (err) { fail(res, err); }
});

agentsRouter.get("/credits/ledger", requirePermission("agents.read"), async (req, res) => {
  try {
    const agent = Number(req.query["agentId"]);
    const rows = await listLedger(req.orgId!, {
      limit: req.query["limit"] ? Number(req.query["limit"]) : undefined,
      agentId: Number.isInteger(agent) && agent > 0 ? agent : undefined,
    });
    res.json(technicalView(req) ? rows : stripTechnical(rows));
  } catch (err) { fail(res, err); }
});

agentsRouter.get("/defaults", requirePermission("agents.read"), async (req, res) => {
  try { res.json(await listDefaults(req.orgId!)); } catch (err) { fail(res, err); }
});

agentsRouter.put("/defaults/:channel", requirePermission("agents.publish"), async (req, res) => {
  try {
    const channel = String(req.params["channel"]);
    const agentId = Number((req.body as { agentId?: unknown }).agentId);
    if (!isDefaultKey(channel) || !Number.isInteger(agentId) || agentId <= 0) { res.status(400).json({ error: "canal o agentId no válidos" }); return; }
    const row = await setDefaultAgent(req.orgId!, channel, agentId, req.clerkUserId ?? null);
    audit(req, "ai_agent_default_set", agentId, { channel });
    res.json(row);
  } catch (err) { fail(res, err); }
});

agentsRouter.delete("/defaults/:channel", requirePermission("agents.publish"), async (req, res) => {
  try {
    const channel = String(req.params["channel"]);
    if (!isDefaultKey(channel)) { res.status(400).json({ error: "canal no válido" }); return; }
    const removed = await clearDefaultAgent(req.orgId!, channel);
    if (removed) audit(req, "ai_agent_default_cleared", channel);
    res.json({ ok: true, removed });
  } catch (err) { fail(res, err); }
});

agentsRouter.get("/:id", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    res.json(await getAgentDetail(req.orgId!, id));
  } catch (err) { fail(res, err); }
});

// Coste estimado por ejecución, consumo acumulado y del periodo, ejecuciones y coste por modelo.
agentsRouter.get("/:id/usage", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    await ensurePricingLoaded();
    const usage = await getAgentUsage(req.orgId!, id);
    res.json(technicalView(req) ? usage : stripTechnical(usage));
  } catch (err) { fail(res, err); }
});

// Acceso efectivo (SOLO LECTURA): qué podría hacer el agente para el usuario AUTENTICADO. No ejecuta tools, no usa IA ni créditos,
// no audita ejecuciones. No admite elegir otro usuario ni workspace: todo sale del contexto autenticado.
agentsRouter.get("/:id/effective-access", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    if (!req.orgId) { res.status(400).json({ error: "no_org_context", message: "Selecciona un workspace." }); return; }
    res.json(await previewEffectiveAccess({ orgId: req.orgId, orgRole: req.effectiveRole ?? req.orgRole ?? "none", platformRole: req.platformRole ?? null }, id));
  } catch (err) { fail(res, err); }
});

/** Lee un presupuesto opcional: undefined = no tocar, null = sin tope, número = entero >= 0. */
function budgetValue(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

function budgetPatch(b: Record<string, unknown>) {
  const monthly = budgetValue(b["monthlyBudget"] ?? b["monthlyCreditLimit"]);
  const daily = budgetValue(b["dailyBudget"] ?? b["dailyCreditLimit"]);
  const perExecution = budgetValue(b["perExecutionBudget"] ?? b["perExecutionCreditLimit"]);
  return {
    ...(monthly !== undefined ? { monthlyCreditLimit: monthly } : {}),
    ...(daily !== undefined ? { dailyCreditLimit: daily } : {}),
    ...(perExecution !== undefined ? { perExecutionCreditLimit: perExecution } : {}),
  };
}

agentsRouter.patch("/:id", requirePermission("agents.write"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    const b = req.body as Record<string, unknown>;
    const updated = await updateAgentMeta(req.orgId!, id, {
      ...(typeof b["name"] === "string" && b["name"].trim() ? { name: b["name"].trim() } : {}),
      ...(b["description"] !== undefined ? { description: b["description"] === null ? null : String(b["description"]) } : {}),
      ...(b["avatarUrl"] !== undefined ? { avatarUrl: b["avatarUrl"] === null ? null : String(b["avatarUrl"]) } : {}),
      ...(b["limits"] && typeof b["limits"] === "object" ? { limits: b["limits"] as Record<string, unknown> } : {}),
      // Presupuestos del agente (créditos). Se aceptan como monthlyBudget/dailyBudget/perExecutionBudget o con el nombre de columna.
      ...budgetPatch(b),
    });
    audit(req, "ai_agent_updated", id);
    res.json(updated);
  } catch (err) { fail(res, err); }
});

agentsRouter.put("/:id/draft", requirePermission("agents.write"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    const { config, notes } = req.body as { config?: unknown; notes?: string | null };
    const saved = await saveDraft(req.orgId!, id, req.clerkUserId ?? null, (config ?? {}) as object, notes);
    audit(req, "ai_agent_draft_saved", id, { versionNumber: saved.versionNumber });
    res.json(saved);
  } catch (err) { fail(res, err); }
});

agentsRouter.post("/:id/versions/:versionId/restore", requirePermission("agents.write"), async (req, res) => {
  try {
    const id = agentId(req);
    const versionId = Number(req.params["versionId"]);
    if (!id || !Number.isInteger(versionId)) { res.status(400).json({ error: "id no válido" }); return; }
    const saved = await restoreVersion(req.orgId!, id, versionId, req.clerkUserId ?? null);
    audit(req, "ai_agent_version_restored", id, { fromVersionId: versionId, draftVersionNumber: saved.versionNumber });
    res.json(saved);
  } catch (err) { fail(res, err); }
});

agentsRouter.post("/:id/publish", requirePermission("agents.publish"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    const result = await publishAgent(req.orgId!, id, new Set(listSkills().map((s) => s.id)));
    audit(req, "ai_agent_published", id, { versionNumber: result.publishedVersionNumber });
    res.json(result);
  } catch (err) { fail(res, err); }
});

for (const action of ["pause", "resume", "unpublish", "archive"] as AgentTransition[]) {
  agentsRouter.post(`/:id/${action}`, requirePermission("agents.publish"), async (req, res) => {
    try {
      const id = agentId(req);
      if (!id) { res.status(400).json({ error: "id no válido" }); return; }
      const updated = await transitionAgent(req.orgId!, id, action);
      audit(req, `ai_agent_${action}`, id, { status: updated.status });
      res.json(updated);
    } catch (err) { fail(res, err); }
  });
}

// ── Simulación, ejecución y confirmación ─────────────────────────────────────

// SIMULATION: gratis. No llama a ningún proveedor, no gasta créditos, no ejecuta nada.
agentsRouter.post("/:id/simulate", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    const b = req.body as { message?: unknown; scenarioId?: unknown; versionId?: unknown };
    const scenario = SIMULATION_SCENARIOS.find((s) => s.id === b.scenarioId);
    const message = typeof b.message === "string" && b.message.trim() ? b.message.trim() : scenario?.message;
    if (!message) { res.status(400).json({ error: "Indica un message o un scenarioId válido." }); return; }

    const actor = actorOf(req);
    await ensurePricingLoaded(); // el coste estimado usa los precios vigentes
    const { agent, version } = await resolveRunTarget(actor.orgId, id, "testing", typeof b.versionId === "number" ? b.versionId : undefined);
    const config = readConfig(version);
    const access = await resolveToolAccess({ config, orgId: actor.orgId, orgRole: actor.orgRole, platformRole: actor.platformRole });
    const knowledge = await loadKnowledge(actor.orgId, config.knowledge);
    const plan = await defaultRunnerDeps.getOrgPlan(actor.orgId);

    const simulation = {
      ...simulateAgent({
        agent, versionNumber: version.versionNumber, config, message,
        readTools: access.read, actionTools: access.action, knowledge, routing: { plan },
      }),
      denied: access.denied,
    };
    // Solo se filtran los campos de coste/tokens de la estimación; los parámetros de la acción propuesta no se tocan.
    res.json(technicalView(req) ? simulation : { ...simulation, tokensEstimated: undefined, estimate: stripTechnical(simulation.estimate) });
  } catch (err) { fail(res, err); }
});

// TESTING / LIVE: IA real a través del AI Gateway (consume créditos).
//   simulate → agents.read · testing → agents.write · LIVE → agents.execute (permiso propio).
// Idempotency-Key (opcional): un reintento con la misma clave y el mismo contenido devuelve el resultado ya calculado sin volver
// a llamar al proveedor ni cobrar (ver agents/liveRunService.ts). LIVE tiene además límite de uso por usuario y por workspace.
agentsRouter.post("/:id/run", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    const b = req.body as { mode?: unknown; message?: unknown; history?: unknown; versionId?: unknown };
    const mode = b.mode === "live" ? "live" : b.mode === "testing" ? "testing" : null;
    if (!mode) { res.status(400).json({ error: "mode debe ser 'testing' o 'live'." }); return; }
    if (typeof b.message !== "string" || !b.message.trim()) { res.status(400).json({ error: "message es requerido" }); return; }
    if (mode === "live" && await denyIfCannotExecute(req, res, id, "live")) return;
    // Probar borradores con IA real es trabajo de quien edita agentes.
    if (mode === "testing" && !hasPermission(req, "agents.write")) {
      await auditSink(req)({ action: "agent_run_denied", actor: auditActorOf(req), agentId: id, mode: "testing", success: false, reason: "permission_denied", details: { permission: "agents.write" } });
      res.status(403).json({ error: "permission_denied", message: "Probar un agente con IA real requiere el permiso agents.write." });
      return;
    }

    const rawKey = req.header("idempotency-key");
    const idempotencyKey = rawKey === undefined ? null : rawKey.trim();
    if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      res.status(400).json({ error: "invalid_idempotency_key", message: "Idempotency-Key debe tener entre 8 y 128 caracteres: letras, números, . _ : -" });
      return;
    }

    const history = Array.isArray(b.history)
      ? (b.history as Array<{ role?: unknown; content?: unknown }>)
          .filter((m): m is { role: "user" | "assistant"; content: string } => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      : [];

    const outcome = await executeRun({
      actor: actorOf(req), agentId: id, mode, message: b.message.trim(), history,
      versionId: typeof b.versionId === "number" ? b.versionId : undefined, idempotencyKey,
    }, defaultLiveRunDeps(auditSink(req), failureReason));

    if (outcome.replayed) res.setHeader("Idempotent-Replayed", "true");
    const result = outcome.result;
    res.json(technicalView(req) ? result : { ...result, usage: stripTechnical(result.usage) });
  } catch (err) { fail(res, err); }
});

// Ejecuta una acción propuesta por el agente, solo con confirmación explícita y válida (agents.execute).
// La confirmación es persistente, atómica y de un solo uso; ver agents/proposalStore.ts.
agentsRouter.post("/:id/confirm", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    if (await denyIfCannotExecute(req, res, id, "live")) return;
    const { confirmToken, confirm } = req.body as { confirmToken?: unknown; confirm?: unknown };
    if (typeof confirmToken !== "string" || confirm !== true) {
      res.status(400).json({ error: "Se requiere confirmToken y confirm:true explícito." });
      return;
    }
    const done = await confirmAgentAction(actorOf(req), id, confirmToken, { ...defaultConfirmDeps, audit: auditSink(req) });
    res.json({ ok: true, ...done });
  } catch (err) { fail(res, err); }
});
