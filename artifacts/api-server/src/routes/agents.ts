/**
 * Fábrica de Agentes IA — API de definiciones y versiones (módulo ai_agents).
 * Solo gestiona la CONFIGURACIÓN de los agentes; ejecutarlos (orquestador,
 * simulación, canales) es una fase posterior. Todo se filtra por req.orgId.
 */
import { Router, type Request, type Response } from "express";
import { agentConfigSchema } from "@workspace/db";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { listSkills } from "../skills";
import {
  AgentError, createAgent, getAgentDetail, listAgents, publishAgent, restoreVersion,
  saveDraft, transitionAgent, updateAgentMeta, type AgentTransition,
} from "../agents/agentService";

export const agentsRouter = Router();

function agentId(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(res: Response, err: unknown) {
  if (err instanceof AgentError) {
    res.status(err.status).json({ error: err.message, problems: err.problems });
    return;
  }
  if (err && typeof err === "object" && "issues" in err) {
    res.status(400).json({ error: "Configuración no válida.", issues: (err as { issues: unknown }).issues });
    return;
  }
  res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
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

agentsRouter.get("/:id", requirePermission("agents.read"), async (req, res) => {
  try {
    const id = agentId(req);
    if (!id) { res.status(400).json({ error: "id no válido" }); return; }
    res.json(await getAgentDetail(req.orgId!, id));
  } catch (err) { fail(res, err); }
});

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
      ...(b["monthlyCreditLimit"] !== undefined
        ? { monthlyCreditLimit: b["monthlyCreditLimit"] === null ? null : Math.max(0, Math.floor(Number(b["monthlyCreditLimit"]))) }
        : {}),
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
