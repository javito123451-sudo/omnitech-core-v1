import { Router } from "express";
import { db, leadsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// ── Captación pública de leads ────────────────────────────────────────────────
// Formulario web (montaje de cocinas, muebles, portes y mudanzas).
// Sin auth a propósito: lo llama la landing directamente desde el navegador
// del visitante, antes de que exista ninguna sesión.
//
// Montado en un prefijo propio ("/leads-public", ver routes/index.ts) en vez
// de compartir "/leads" con el router interno de OmniLeads (routes/leads.ts,
// prospección vía Google Places, con auth + requireModule) — mismo patrón que
// /accounting-public vs /accounting. Prefijo distinto y explícito, sin
// depender del orden de montaje de dos router.use() sobre el mismo path.
export const publicLeadCaptureRouter = Router();

const VALID_CATEGORIES = new Set([
  "cocinas",
  "muebles",
  "portes",
  "mudanzas",
]);

publicLeadCaptureRouter.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const zone = typeof body.zone === "string" ? body.zone.trim() : "";
    const contactPhone = typeof body.contactPhone === "string" ? body.contactPhone.trim() : "";
    const timing = typeof body.timing === "string" && body.timing.trim() ? body.timing.trim() : null;

    const missing: string[] = [];
    if (!category) missing.push("category");
    if (!description) missing.push("description");
    if (!zone) missing.push("zone");
    if (!contactPhone) missing.push("contactPhone");

    if (missing.length > 0) {
      res.status(400).json({
        error: "missing_fields",
        message: `Faltan campos obligatorios: ${missing.join(", ")}`,
        missing,
      });
      return;
    }

    // Validación ligera del teléfono — no bloqueamos por formatos internacionales,
    // solo filtramos ruido evidente (menos de 6 dígitos).
    const phoneDigits = contactPhone.replace(/\D/g, "");
    if (phoneDigits.length < 6) {
      res.status(400).json({
        error: "invalid_contact_phone",
        message: "El teléfono de contacto no parece válido.",
      });
      return;
    }

    if (category.length > 200 || zone.length > 200) {
      res.status(400).json({ error: "field_too_long", message: "category/zone demasiado largos." });
      return;
    }
    if (description.length > 5000) {
      res.status(400).json({ error: "field_too_long", message: "description demasiado larga." });
      return;
    }

    // category no está restringida a VALID_CATEGORIES por constraint de BD (texto libre,
    // por si la landing añade nuevas líneas de negocio) — pero lo registramos si no
    // coincide con el catálogo conocido, para poder revisarlo.
    if (!VALID_CATEGORIES.has(category.toLowerCase())) {
      logger.warn({ category }, "[publicLeadCapture] categoría fuera del catálogo conocido — se acepta igualmente");
    }

    const [lead] = await db
      .insert(leadsTable)
      .values({
        category,
        description,
        zone,
        timing,
        contactPhone,
        status: "open",
      })
      .returning({ id: leadsTable.id });

    logger.info({ leadId: lead.id, category, zone }, "[publicLeadCapture] nuevo lead recibido");

    res.status(201).json({ id: lead.id, status: "open" });
  } catch (err) {
    logger.error({ err }, "[publicLeadCapture] error al crear lead");
    res.status(500).json({ error: "internal_error", message: "No se pudo registrar el lead. Inténtalo de nuevo." });
  }
});
