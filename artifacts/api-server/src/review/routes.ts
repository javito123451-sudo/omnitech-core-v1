// Omni Review Bot — API REST (/api/review/*).
// Cadena: requireAuth → resolveOrg → resolvePermissions (montadas en routes/index.ts)
//         → requireReviewModule (fail-closed) → requirePermission por endpoint.
// El orgId sale SIEMPRE de req (contexto verificado), nunca de URL/query/cuerpo.
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { orgOf, requireReviewModule } from "./access";
import { archiveLocation, createLocation, getLocation, listLocations, updateLocation, ReviewInputError } from "./locations";
import { getOverview } from "./overview";
import { parseId, parseObject, ValidationError } from "./validate";
import { ImportFileError, MAX_IMPORT_BYTES, parseContactsFile } from "./importParse";
import { importContacts, ImportInputError } from "./importer";
import { getContact, getImport, listContacts, listImports } from "./contacts";
import { eraseContact, listConsents, unsubscribeContact } from "./consent";
import { createTemplate, getTemplate, listTemplates, updateTemplate } from "./templates";
import {
  audiencePreview, campaignResults, cancelCampaign, CampaignError, createCampaign, duplicateCampaign, getCampaign, launchCampaign, listCampaignMessages,
  listCampaigns, pauseCampaign, resumeCampaign, retryFailed, updateCampaign, type CampaignInput,
} from "./engine/campaigns";

export const reviewRouter: IRouter = Router();
reviewRouter.use(requireReviewModule);

const locationSpec = {
  name: { type: "string", min: 1, max: 200, required: true },
  address: { type: "string", max: 500, nullable: true },
  googlePlaceId: { type: "string", max: 255, nullable: true },
} as const;

/** Drizzle envuelve los errores de pg: el SQLSTATE puede venir en err.cause.code. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

function bad(res: Response, err: unknown): boolean {
  if (err instanceof ValidationError) { res.status(400).json({ error: "invalid_input", issues: err.issues }); return true; }
  if (err instanceof CampaignError) { res.status(err.status).json({ error: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) }); return true; }
  if (err instanceof ReviewInputError) { res.status(400).json({ error: "invalid_input", field: err.field, message: err.message }); return true; }
  return false;
}
const audit = (req: Request, action: string, resourceId: number, details?: Record<string, unknown>) =>
  logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action, resource: "review_location", resourceId, orgId: orgOf(req), details, req });

reviewRouter.get("/overview", requirePermission("review.read"), async (req, res) => {
  res.json(await getOverview(orgOf(req)));
});

reviewRouter.get("/locations", requirePermission("review.read"), async (req, res) => {
  res.json({ locations: await listLocations(orgOf(req)) });
});

reviewRouter.post("/locations", requirePermission("review.write"), async (req, res) => {
  try {
    const body = parseObject<{ name: string; address?: string | null; googlePlaceId?: string | null }>(req.body, locationSpec);
    const loc = await createLocation(orgOf(req), body);
    await audit(req, "review.location_created", loc.id, { name: loc.name });
    res.status(201).json({ location: loc });
  } catch (err) {
    if (bad(res, err)) return;
    if (pgCode(err) === "23505") { res.status(409).json({ error: "duplicate_place_id", message: "Ya existe un establecimiento con ese Place ID en este workspace." }); return; }
    throw err;
  }
});

reviewRouter.patch("/locations/:id", requirePermission("review.write"), async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
    const body = parseObject<{ name?: string; address?: string | null; googlePlaceId?: string | null }>(req.body, locationSpec, { partial: true });
    const loc = await updateLocation(orgOf(req), id, body);
    if (!loc) { res.status(404).json({ error: "not_found" }); return; }
    await audit(req, "review.location_updated", id, { fields: Object.keys(body) });
    res.json({ location: loc });
  } catch (err) {
    if (bad(res, err)) return;
    if (pgCode(err) === "23505") { res.status(409).json({ error: "duplicate_place_id" }); return; }
    throw err;
  }
});

reviewRouter.get("/locations/:id", requirePermission("review.read"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const loc = await getLocation(orgOf(req), id);
  if (!loc) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ location: loc });
});

reviewRouter.delete("/locations/:id", requirePermission("review.write"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const ok = await archiveLocation(orgOf(req), id);
  if (!ok) { res.status(404).json({ error: "not_found" }); return; }
  await audit(req, "review.location_archived", id);
  res.status(204).end();
});

// ── Contactos e importaciones ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 10 } });

function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: "file_too_large", message: `El archivo supera ${MAX_IMPORT_BYTES / 1024 / 1024} MB.` }); return; }
    res.status(400).json({ error: "invalid_upload", message: "No se pudo procesar la subida." });
  });
}

reviewRouter.post("/imports", requirePermission("review.write"), uploadSingle, async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "file_required", message: "Adjunta un archivo .csv o .xlsx en el campo «file»." }); return; }
  const f = req.body as Record<string, unknown>;
  const str = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : undefined);
  const rawLoc = str("locationId");
  let locationId: number | null = null;
  if (rawLoc !== undefined && rawLoc !== "") {
    locationId = parseId(rawLoc);
    if (locationId === null) { res.status(400).json({ error: "invalid_input", field: "locationId" }); return; }
  }
  try {
    // El campo orgId del formulario, si lo hubiera, se ignora: la empresa sale del contexto.
    const { source, parsed } = await parseContactsFile(file.originalname, file.buffer);
    const result = await importContacts({
      orgId: orgOf(req), userId: req.userId ?? null, fileName: file.originalname, source, locationId,
      legalBasis: str("legalBasis") ?? "", legalBasisNote: str("legalBasisNote") ?? null, headers: parsed.headers, rows: parsed.rows,
    });
    await logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action: "review.contacts_imported", resource: "review_import", resourceId: result.batchId, orgId: orgOf(req),
      details: { fileName: file.originalname, total: result.totalRows, imported: result.imported, invalid: result.invalid, duplicates: result.duplicates, suppressed: result.suppressed, legalBasis: str("legalBasis") }, req });
    res.status(201).json({ import: result });
  } catch (err) {
    if (err instanceof ImportInputError) { res.status(err.status).json({ error: err.code, message: err.message }); return; }
    if (err instanceof ImportFileError) { res.status(err.code === "unsupported" ? 415 : err.code === "too_many_rows" ? 413 : 400).json({ error: `file_${err.code}`, message: err.message }); return; }
    throw err;
  }
});

reviewRouter.get("/imports", requirePermission("review.read"), async (req, res) => {
  res.json({ imports: await listImports(orgOf(req)) });
});

reviewRouter.get("/imports/:id", requirePermission("review.read"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const row = await getImport(orgOf(req), id);
  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ import: row });
});

const asInt = (v: unknown) => (typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : undefined);
reviewRouter.get("/contacts", requirePermission("review.read"), async (req, res) => {
  const q = req.query;
  res.json(await listContacts(orgOf(req), {
    status: typeof q["status"] === "string" ? q["status"] : undefined, q: typeof q["q"] === "string" ? q["q"] : undefined,
    limit: asInt(q["limit"]), offset: asInt(q["offset"]),
  }));
});

reviewRouter.get("/contacts/:id", requirePermission("review.read"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const contact = await getContact(orgOf(req), id);
  if (!contact) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ contact, consents: await listConsents(orgOf(req), id) });
});

reviewRouter.post("/contacts/:id/unsubscribe", requirePermission("review.write"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const ok = await unsubscribeContact(orgOf(req), id, { source: "omni_review", createdBy: req.userId ?? null });
  if (!ok) { res.status(404).json({ error: "not_found" }); return; }
  await logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action: "review.contact_unsubscribed", resource: "review_contact", resourceId: id, orgId: orgOf(req), req });
  res.status(204).end();
});

// Supresión de datos (art. 17 RGPD): irreversible → exige review.admin.
reviewRouter.post("/contacts/:id/erase", requirePermission("review.admin"), async (req, res) => {
  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const ok = await eraseContact(orgOf(req), id, { createdBy: req.userId ?? null });
  if (!ok) { res.status(404).json({ error: "not_found" }); return; }
  await logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action: "review.contact_erased", resource: "review_contact", resourceId: id, orgId: orgOf(req), severity: "warning", req });
  res.status(204).end();
});

// ── Plantillas ───────────────────────────────────────────────────────────────
const templateSpec = {
  channel: { type: "string", min: 1, max: 20, required: true }, name: { type: "string", min: 1, max: 200, required: true },
  subject: { type: "string", max: 300, nullable: true }, body: { type: "string", min: 1, max: 5000, required: true },
  waTemplateName: { type: "string", max: 512, nullable: true }, waLanguage: { type: "string", max: 10, nullable: true },
} as const;
type TemplateBody = { channel: string; name: string; subject?: string | null; body: string; waTemplateName?: string | null; waLanguage?: string | null };

reviewRouter.get("/templates", requirePermission("review.read"), async (req, res) => { res.json({ templates: await listTemplates(orgOf(req)) }); });
reviewRouter.get("/templates/:id", requirePermission("review.read"), async (req, res) => {
  const id = parseId(req.params["id"]); if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
  const t = await getTemplate(orgOf(req), id); if (!t) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ template: t });
});
reviewRouter.post("/templates", requirePermission("review.write"), async (req, res) => {
  try {
    const t = await createTemplate(orgOf(req), req.userId ?? null, parseObject<TemplateBody>(req.body, templateSpec));
    await logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action: "review.template_created", resource: "review_template", resourceId: t.id, orgId: orgOf(req), req });
    res.status(201).json({ template: t });
  } catch (err) { if (!bad(res, err)) throw err; }
});
reviewRouter.put("/templates/:id", requirePermission("review.write"), async (req, res) => {
  try {
    const id = parseId(req.params["id"]); if (id === null) { res.status(400).json({ error: "invalid_input" }); return; }
    const t = await updateTemplate(orgOf(req), id, parseObject<TemplateBody>(req.body, templateSpec));
    if (!t) { res.status(404).json({ error: "not_found" }); return; }
    await logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action: "review.template_updated", resource: "review_template", resourceId: id, orgId: orgOf(req), req });
    res.json({ template: t });
  } catch (err) { if (!bad(res, err)) throw err; }
});

// ── Campañas ─────────────────────────────────────────────────────────────────
const CAMPAIGN_KEYS = ["name", "locationId", "templateId", "channel", "scheduleAt", "sendWindow", "ratePerMinute", "maxReminders", "reminderAfterDays", "audienceFilter"];
function campaignInput(body: unknown): CampaignInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError([{ path: "", message: "Se esperaba un objeto JSON" }]);
  const b = body as Record<string, unknown>;
  const issues = Object.keys(b).filter((k) => !CAMPAIGN_KEYS.includes(k)).map((k) => ({ path: k, message: "Campo no permitido" }));
  const num = (k: string) => { if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "number") issues.push({ path: k, message: "Debe ser un número" }); };
  ["locationId", "templateId", "ratePerMinute", "maxReminders", "reminderAfterDays"].forEach(num);
  for (const k of ["name", "channel", "scheduleAt"]) if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") issues.push({ path: k, message: "Debe ser texto" });
  if (issues.length) throw new ValidationError(issues);
  return b as CampaignInput;
}
const campaignId = (req: Request, res: Response): number | null => { const id = parseId(req.params["id"]); if (id === null) res.status(400).json({ error: "invalid_input" }); return id; };
const auditCampaign = (req: Request, action: string, id: number, details?: Record<string, unknown>) =>
  logAudit({ actorClerkId: req.clerkUserId ?? "unknown", action, resource: "review_campaign", resourceId: id, orgId: orgOf(req), details, req });

reviewRouter.get("/campaigns", requirePermission("review.read"), async (req, res) => { res.json({ campaigns: await listCampaigns(orgOf(req)) }); });
reviewRouter.post("/campaigns", requirePermission("review.write"), async (req, res) => {
  try {
    const c = await createCampaign(orgOf(req), req.userId ?? null, campaignInput(req.body));
    await auditCampaign(req, "review.campaign_created", c.id, { name: c.name, channel: c.channel });
    res.status(201).json({ campaign: c });
  } catch (err) { if (!bad(res, err)) throw err; }
});
reviewRouter.get("/campaigns/:id", requirePermission("review.read"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  const c = await getCampaign(orgOf(req), id); if (!c) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ campaign: c });
});
reviewRouter.put("/campaigns/:id", requirePermission("review.write"), async (req, res) => {
  try {
    const id = campaignId(req, res); if (id === null) return;
    const c = await updateCampaign(orgOf(req), id, campaignInput(req.body)); if (!c) { res.status(404).json({ error: "not_found" }); return; }
    await auditCampaign(req, "review.campaign_updated", id);
    res.json({ campaign: c });
  } catch (err) { if (!bad(res, err)) throw err; }
});
reviewRouter.post("/campaigns/:id/duplicate", requirePermission("review.write"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  const c = await duplicateCampaign(orgOf(req), id, req.userId ?? null); if (!c) { res.status(404).json({ error: "not_found" }); return; }
  await auditCampaign(req, "review.campaign_duplicated", c.id, { from: id });
  res.status(201).json({ campaign: c });
});
reviewRouter.get("/campaigns/:id/audience", requirePermission("review.read"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  const p = await audiencePreview(orgOf(req), id); if (!p) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ audience: p });
});
reviewRouter.post("/campaigns/:id/launch", requirePermission("review.write"), async (req, res) => {
  try {
    const id = campaignId(req, res); if (id === null) return;
    const r = await launchCampaign(orgOf(req), id); if (!r) { res.status(404).json({ error: "not_found" }); return; }
    await auditCampaign(req, "review.campaign_launched", id, { enqueued: r.enqueued, status: r.status });
    res.json({ launch: r });
  } catch (err) { if (!bad(res, err)) throw err; }
});
for (const [path, fn, action] of [["pause", pauseCampaign, "paused"], ["resume", resumeCampaign, "resumed"], ["cancel", cancelCampaign, "cancelled"]] as const) {
  reviewRouter.post(`/campaigns/:id/${path}`, requirePermission("review.write"), async (req, res) => {
    const id = campaignId(req, res); if (id === null) return;
    const c = await fn(orgOf(req), id);
    if (!c) { res.status(409).json({ error: "invalid_state", message: "La campaña no existe o su estado no permite esta acción." }); return; }
    await auditCampaign(req, `review.campaign_${action}`, id);
    res.json({ campaign: c });
  });
}
reviewRouter.get("/campaigns/:id/results", requirePermission("review.read"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  const r = await campaignResults(orgOf(req), id); if (!r) { res.status(404).json({ error: "not_found" }); return; }
  res.json(r);
});
reviewRouter.get("/campaigns/:id/messages", requirePermission("review.read"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  if (!(await getCampaign(orgOf(req), id))) { res.status(404).json({ error: "not_found" }); return; }
  const q = req.query;
  res.json(await listCampaignMessages(orgOf(req), id, { status: typeof q["status"] === "string" ? q["status"] : undefined, limit: asInt(q["limit"]), offset: asInt(q["offset"]) }));
});
reviewRouter.post("/campaigns/:id/retry-failed", requirePermission("review.write"), async (req, res) => {
  const id = campaignId(req, res); if (id === null) return;
  if (!(await getCampaign(orgOf(req), id))) { res.status(404).json({ error: "not_found" }); return; }
  const n = await retryFailed(orgOf(req), id);
  await auditCampaign(req, "review.campaign_retry_failed", id, { requeued: n });
  res.json({ requeued: n });
});
