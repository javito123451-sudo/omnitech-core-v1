// Omni Review Bot — API REST (/api/review/*).
// Cadena: requireAuth → resolveOrg → resolvePermissions (montadas en routes/index.ts)
//         → requireReviewModule (fail-closed) → requirePermission por endpoint.
// El orgId sale SIEMPRE de req (contexto verificado), nunca de URL/query/cuerpo.
import { Router, type IRouter, type Request, type Response } from "express";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { orgOf, requireReviewModule } from "./access";
import { archiveLocation, createLocation, getLocation, listLocations, updateLocation, ReviewInputError } from "./locations";
import { getOverview } from "./overview";
import { parseId, parseObject, ValidationError } from "./validate";

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
