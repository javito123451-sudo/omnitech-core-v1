import { Router } from "express";
import { db, b2bDiagnosticLeadsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// ── Captación pública de leads B2B ──────────────────────────────────────────────
// Formulario "Solicita tu diagnóstico" de info.omnitech-core.com (marketing
// del propio SaaS OmniTech Core). Sin auth a propósito, igual que
// publicLeadCapture.ts: lo llama la landing directamente desde el navegador
// del visitante, antes de que exista ninguna sesión.
//
// Montado en "/leads-public/diagnostico" (ver routes/index.ts) — bajo el
// mismo prefijo "/leads-public" que ./publicLeadCapture.ts para heredar el
// bypass de CORS de app.ts (cualquier origen, sin credentials) pensado para
// landings públicas en dominios que no controlamos de antemano.
export const publicDiagnosticLeadCaptureRouter = Router();

publicDiagnosticLeadCaptureRouter.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    const empresa = typeof body.empresa === "string" ? body.empresa.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const necesidad = typeof body.necesidad === "string" ? body.necesidad.trim() : "";
    const telefono = typeof body.telefono === "string" && body.telefono.trim() ? body.telefono.trim() : null;

    const missing: string[] = [];
    if (!nombre) missing.push("nombre");
    if (!empresa) missing.push("empresa");
    if (!email) missing.push("email");
    if (!necesidad) missing.push("necesidad");

    if (missing.length > 0) {
      res.status(400).json({
        error: "missing_fields",
        message: `Faltan campos obligatorios: ${missing.join(", ")}`,
        missing,
      });
      return;
    }

    // Validación ligera del email — no bloqueamos por formatos exóticos, solo
    // filtramos ruido evidente (sin @ o sin dominio).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: "invalid_email",
        message: "El email no parece válido.",
      });
      return;
    }

    if (nombre.length > 200 || empresa.length > 200 || email.length > 200) {
      res.status(400).json({ error: "field_too_long", message: "nombre/empresa/email demasiado largos." });
      return;
    }
    if (necesidad.length > 5000) {
      res.status(400).json({ error: "field_too_long", message: "necesidad demasiado larga." });
      return;
    }

    const [lead] = await db
      .insert(b2bDiagnosticLeadsTable)
      .values({
        nombre,
        empresa,
        email,
        telefono,
        necesidad,
        status: "open",
      })
      .returning({ id: b2bDiagnosticLeadsTable.id });

    logger.info({ leadId: lead.id, empresa }, "[publicDiagnosticLeadCapture] nuevo lead B2B recibido");

    res.status(201).json({ id: lead.id, status: "open" });
  } catch (err) {
    logger.error({ err }, "[publicDiagnosticLeadCapture] error al crear lead");
    res.status(500).json({ error: "internal_error", message: "No se pudo registrar la solicitud. Inténtalo de nuevo." });
  }
});
