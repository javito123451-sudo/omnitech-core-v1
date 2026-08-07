/**
 * VeriFactu — API routes
 *
 * Toda la lógica de cadena de hashes, XML, QR y envío a AEAT vive en el
 * servidor (verifactuService.ts → @workspace/connector-core). Estas rutas
 * son una capa fina: autenticación/permisos (ya reutilizados de requireAuth
 * global + requirePermission), llamada al servicio, auditoría, respuesta.
 * El frontend NUNCA calcula el hash — solo consume esta API.
 */
import { Router } from "express";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import {
  generateVerifactuRecord,
  submitVerifactuRecord,
  getVerifactuRecord,
  listVerifactuRecords,
  checkVerifactuHealth,
  InvoiceNotFoundError,
} from "../services/verifactuService";
import { InvoiceNotFoundForChainError } from "../services/verifactuChainStore";

export const verifactuRouter = Router();

// ── GET /api/verifactu/health ──────────────────────────────────────────────
verifactuRouter.get("/health", requirePermission("tax.read"), async (req, res) => {
  try {
    const health = await checkVerifactuHealth(req.orgId!);
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/verifactu/records ─────────────────────────────────────────────
verifactuRouter.get("/records", requirePermission("tax.read"), async (req, res) => {
  try {
    const records = await listVerifactuRecords(req.orgId!);
    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/verifactu/invoices/:invoiceId ─────────────────────────────────
verifactuRouter.get("/invoices/:invoiceId", requirePermission("tax.read"), async (req, res) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isFinite(invoiceId)) return res.status(400).json({ error: "invoiceId inválido" });

    const record = await getVerifactuRecord(req.orgId!, invoiceId);
    if (!record) return res.status(404).json({ error: "Este invoice todavía no tiene registro VeriFactu" });
    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /api/verifactu/invoices/:invoiceId/generate ───────────────────────
verifactuRouter.post("/invoices/:invoiceId/generate", requirePermission("tax.write"), async (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isFinite(invoiceId)) return res.status(400).json({ error: "invoiceId inválido" });
  const orgId = req.orgId!;

  try {
    const result = await generateVerifactuRecord(orgId, invoiceId);

    await logAudit({
      actorClerkId: req.clerkUserId ?? "system",
      action: "verifactu.record.generate",
      resource: "invoice",
      resourceId: invoiceId,
      orgId,
      details: { success: result.success, hash: (result.output as { hash?: string } | undefined)?.hash },
      severity: result.success ? "info" : "warning",
      req,
    });

    if (!result.success) return res.status(422).json({ error: result.error, errorCode: result.errorCode });
    res.json(result.output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit({
      actorClerkId: req.clerkUserId ?? "system",
      action: "verifactu.record.generate",
      resource: "invoice",
      resourceId: invoiceId,
      orgId,
      details: { success: false, error: message },
      severity: "critical",
      req,
    });

    if (err instanceof InvoiceNotFoundError) return res.status(404).json({ error: message });
    res.status(500).json({ error: message });
  }
});

// ── POST /api/verifactu/invoices/:invoiceId/submit ──────────────────────────
verifactuRouter.post("/invoices/:invoiceId/submit", requirePermission("tax.write"), async (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isFinite(invoiceId)) return res.status(400).json({ error: "invoiceId inválido" });
  const orgId = req.orgId!;

  try {
    const result = await submitVerifactuRecord(orgId, invoiceId);

    await logAudit({
      actorClerkId: req.clerkUserId ?? "system",
      action: "verifactu.record.submit",
      resource: "invoice",
      resourceId: invoiceId,
      orgId,
      details: { success: result.success, output: result.output },
      severity: result.success ? "info" : "warning",
      req,
    });

    if (!result.success) return res.status(422).json({ error: result.error, errorCode: result.errorCode });
    res.json(result.output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit({
      actorClerkId: req.clerkUserId ?? "system",
      action: "verifactu.record.submit",
      resource: "invoice",
      resourceId: invoiceId,
      orgId,
      details: { success: false, error: message },
      severity: "critical",
      req,
    });

    if (err instanceof InvoiceNotFoundError) return res.status(404).json({ error: message });
    if (err instanceof InvoiceNotFoundForChainError) return res.status(409).json({ error: message });
    res.status(500).json({ error: message });
  }
});
