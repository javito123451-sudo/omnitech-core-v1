import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  b2bDiagnosticLeadsTable,
  clientsTable,
  organizationsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendApprovedWhatsAppTemplate } from "../utils/approvedWhatsAppTemplates";

// Captación pública B2B de info.omnitech-core.com.
// El workspace receptor se configura exclusivamente en el servidor mediante
// PUBLIC_B2B_LEADS_ORG_ID; nunca se acepta orgId desde el navegador.
export const publicDiagnosticLeadCaptureRouter = Router();

publicDiagnosticLeadCaptureRouter.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    const empresa = typeof body.empresa === "string" ? body.empresa.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const necesidad = typeof body.necesidad === "string" ? body.necesidad.trim() : "";
    const telefono = typeof body.telefono === "string" && body.telefono.trim()
      ? body.telefono.trim()
      : null;
    const consentimientoWhatsapp = body.consentimientoWhatsapp === true;

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

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "invalid_email", message: "El email no parece válido." });
      return;
    }

    if (nombre.length > 200 || empresa.length > 200 || email.length > 200) {
      res.status(400).json({ error: "field_too_long", message: "nombre/empresa/email demasiado largos." });
      return;
    }
    if (necesidad.length > 5000 || (telefono && telefono.length > 50)) {
      res.status(400).json({ error: "field_too_long", message: "La necesidad o el teléfono son demasiado largos." });
      return;
    }

    const configuredOrgId = process.env.PUBLIC_B2B_LEADS_ORG_ID;
    const orgId = configuredOrgId ? Number(configuredOrgId) : NaN;
    if (!Number.isSafeInteger(orgId) || orgId <= 0) {
      logger.error("[publicDiagnosticLeadCapture] PUBLIC_B2B_LEADS_ORG_ID no está configurado correctamente");
      res.status(503).json({
        error: "lead_destination_not_configured",
        message: "La captación no está disponible temporalmente.",
      });
      return;
    }

    if (consentimientoWhatsapp && !telefono) {
      res.status(400).json({ error: "phone_required_for_whatsapp_consent", message: "Indica un móvil para recibir mensajes por WhatsApp." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(and(eq(organizationsTable.id, orgId), eq(organizationsTable.status, "active")))
        .limit(1);

      if (!org) throw new Error("PUBLIC_B2B_LEADS_ORG_ID no corresponde a un workspace activo");

      // Guardar también el registro original de diagnóstico y mantener un único
      // prospecto CRM por email y fuente para evitar duplicados por reenvíos.
      const [diagnostic] = await tx
        .insert(b2bDiagnosticLeadsTable)
        .values({ nombre, empresa, email, telefono, necesidad, status: "open" })
        .returning({ id: b2bDiagnosticLeadsTable.id });

      const [existingClient] = await tx
        .select({ id: clientsTable.id, notes: clientsTable.notes })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.orgId, orgId),
          eq(clientsTable.email, email),
          eq(clientsTable.fuenteLead, "info.omnitech-core.com"),
        ))
        .limit(1);

      let clientId: number;
      if (existingClient) {
        const [updated] = await tx
          .update(clientsTable)
          .set({
            name: nombre,
            company: empresa,
            phone: telefono,
            companyEmail: email,
            companyPhone: telefono,
            contactPerson: nombre,
            dolorPrincipal: necesidad,
            observaciones: necesidad,
            notes: consentimientoWhatsapp ? `${existingClient.notes ?? ""}\n[WHATSAPP_OPT_IN]`.trim() : existingClient.notes,
            status: "lead",
            commercialStatus: "prospecto",
            updatedAt: new Date(),
          })
          .where(eq(clientsTable.id, existingClient.id))
          .returning({ id: clientsTable.id });
        clientId = updated.id;
      } else {
        const [created] = await tx
          .insert(clientsTable)
          .values({
            orgId,
            name: nombre,
            email,
            phone: telefono,
            company: empresa,
            companyEmail: email,
            companyPhone: telefono,
            contactPerson: nombre,
            status: "lead",
            commercialStatus: "prospecto",
            fuenteLead: "info.omnitech-core.com",
            dolorPrincipal: necesidad,
            observaciones: necesidad,
            notes: `Captado desde el formulario público de diagnóstico de info.omnitech-core.com${consentimientoWhatsapp ? "\n[WHATSAPP_OPT_IN]" : ""}`,
          })
          .returning({ id: clientsTable.id });
        clientId = created.id;
      }

      return { diagnosticId: diagnostic.id, clientId };
    });

    logger.info(
      { leadId: result.diagnosticId, clientId: result.clientId, orgId, empresa },
      "[publicDiagnosticLeadCapture] lead B2B guardado como prospecto en CRM",
    );

    let whatsapp = "not_requested";
    if (telefono && consentimientoWhatsapp) {
      try {
        const sent = await sendApprovedWhatsAppTemplate(orgId, telefono, "lead_welcome", [nombre, empresa]);
        whatsapp = sent ? "sent" : "not_sent";
      } catch (error) {
        whatsapp = "not_sent";
        logger.warn({ err: error, clientId: result.clientId }, "[publicDiagnosticLeadCapture] WhatsApp welcome failed");
      }
    }

    res.status(201).json({
      id: result.diagnosticId,
      clientId: result.clientId,
      status: "prospecto",
      whatsapp,
    });
  } catch (err) {
    logger.error({ err }, "[publicDiagnosticLeadCapture] error al crear lead B2B");
    res.status(500).json({
      error: "internal_error",
      message: "No se pudo registrar la solicitud. Inténtalo de nuevo.",
    });
  }
});
