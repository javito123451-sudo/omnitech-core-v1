/**
 * OmniTax — Fiscal Engine & API Routes
 *
 * Fase 1: Motor fiscal interno (España), calendario, simuladores, health score,
 *         documentos, recordatorios. Sin presentación oficial.
 */

import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  taxObligationsTable, taxCalculationsTable, taxDocumentsTable,
  taxRemindersTable, taxHealthScoreTable,
  invoicesTable, expensesTable, clientsTable,
} from "@workspace/db";
import { eq, and, desc, count, sum, gte, lte, sql } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";

export const taxRouter = Router();

const BASE = process.env.API_BASE_PATH ?? "";

// ── Document upload config (FIX-AO) ─────────────────────────────────────────
// Files are stored as base64 directly in tax_documents.file_data — no external
// object storage (S3/R2) required. Fine for the volume of fiscal documents a
// single SMB org generates; can be migrated to a bucket later without any
// change to the frontend contract (same download endpoint).
const TAX_DOC_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

const taxDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB, matches frontend copy
  fileFilter(_req, file, cb) {
    if (TAX_DOC_ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}. Se aceptan PDF, Excel, CSV e imágenes.`));
  },
});

function taxDocExt(filename: string): string {
  return (filename.split(".").pop() ?? "").toLowerCase();
}

function taxDocMimeForExt(ext: string): string {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}

// ── Helper: detectar tipo de contribuyente ─────────────────────────────────────────────────────────────────────────────────────────

function detectContributorType(orgName: string): "autonomo" | "sociedad" | "profesional" | "comunidad" {
  const n = orgName.toLowerCase();
  if (n.includes("sl") || n.includes("srl") || n.includes("sa")) return "sociedad";
  if (n.includes("comunidad")) return "comunidad";
  if (n.includes("profesional")) return "profesional";
  return "autonomo";
}

// ── GET /api/tax/dashboard ────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/dashboard", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = new Date().getFullYear();

    // — Obligaciones —
    const obligations = await db.select()
      .from(taxObligationsTable)
      .where(eq(taxObligationsTable.orgId, orgId))
      .orderBy(taxObligationsTable.dueDate);

    const pending = obligations.filter(o => o.status === "pending").length;
    const preparing = obligations.filter(o => o.status === "preparing").length;
    const ready = obligations.filter(o => o.status === "ready").length;
    const filed = obligations.filter(o => o.status === "filed").length;

    // — Ingresos y gastos del año —
    const startOfYear = new Date(`${year}-01-01`);
    const incomeRows = await db.select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, startOfYear),
      ));
    const expenseRows = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, startOfYear),
      ));

    const totalIncome = Number(incomeRows[0]?.total ?? 0);
    const totalExpenses = Number(expenseRows[0]?.total ?? 0);
    const benefit = totalIncome - totalExpenses;

    // — Último health score —
    const [latestHealth] = await db.select()
      .from(taxHealthScoreTable)
      .where(eq(taxHealthScoreTable.orgId, orgId))
      .orderBy(desc(taxHealthScoreTable.createdAt))
      .limit(1);

    // — Documentos —
    const docCount = await db.select({ count: count() })
      .from(taxDocumentsTable)
      .where(eq(taxDocumentsTable.orgId, orgId));

    // — Próxima obligación —
    const now = new Date();
    const nextObligation = obligations
      .filter(o => new Date(o.dueDate) > now)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

    res.json({
      year,
      obligations: { total: obligations.length, pending, preparing, ready, filed },
      financials: { totalIncome, totalExpenses, benefit },
      healthScore: latestHealth ? {
        score: latestHealth.score,
        compliance: latestHealth.complianceScore,
        accuracy: latestHealth.accuracyScore,
        documents: latestHealth.documentScore,
        timeliness: latestHealth.timelinessScore,
      } : null,
      documents: { total: Number(docCount[0]?.count ?? 0) },
      nextObligation: nextObligation ? {
        id: nextObligation.id,
        name: nextObligation.name,
        dueDate: nextObligation.dueDate,
        taxType: nextObligation.taxType,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/obligations ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/obligations", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = Number(req.query.year ?? new Date().getFullYear());
    const status = req.query.status as string | undefined;

    let conditions = and(
      eq(taxObligationsTable.orgId, orgId),
      eq(taxObligationsTable.year, year),
    );
    if (status) {
      conditions = and(conditions, eq(taxObligationsTable.status, status));
    }

    const rows = await db.select()
      .from(taxObligationsTable)
      .where(conditions)
      .orderBy(taxObligationsTable.dueDate);

    res.json(rows.map(r => ({
      ...r,
      dueDate: r.dueDate.toISOString(),
      completedAt: r.completedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/tax/obligations ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.post("/obligations", requirePermission("tax.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { name, description, taxType, period, month, quarter, year, dueDate, status } = req.body;

    const [row] = await db.insert(taxObligationsTable).values({
      orgId, name, description, taxType, period, month, quarter, year,
      dueDate: new Date(dueDate), status: status || "pending",
    }).returning();

    logAudit({ req, action: "tax_obligation_created", resource: "tax_obligation", resourceId: String(row.id), result: "success" });

    res.json({ ...row, dueDate: row.dueDate.toISOString(), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/tax/obligations/:id ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.patch("/obligations/:id", requirePermission("tax.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = Number(req.params.id);
    const { status, completedAt } = req.body;

    const [row] = await db.update(taxObligationsTable)
      .set({
        ...(status && { status }),
        ...(completedAt && { completedAt: new Date(completedAt) }),
        updatedAt: new Date(),
      })
      .where(and(eq(taxObligationsTable.id, id), eq(taxObligationsTable.orgId, orgId)))
      .returning();

    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ...row, dueDate: row.dueDate.toISOString(), updatedAt: row.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/simulator/iva ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/simulator/iva", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = Number(req.query.year ?? new Date().getFullYear());
    const quarter = Number(req.query.quarter ?? Math.ceil((new Date().getMonth() + 1) / 3));

    // Rango del trimestre
    const qMonths = [(quarter - 1) * 3 + 1, (quarter - 1) * 3 + 3];
    const startQ = new Date(`${year}-${String(qMonths[0]).padStart(2, "0")}-01`);
    const endQ = new Date(year, qMonths[1], 0);

    // IVA repercutido (ventas con IVA)
    const invoicesQ = await db.select({
      total: sum(invoicesTable.total),
      taxAmount: sum(invoicesTable.taxAmount),
    })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, startQ),
        lte(invoicesTable.createdAt, endQ),
      ));

    // IVA soportado (gastos con IVA estimado al 21%)
    const expensesQ = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, startQ),
        lte(expensesTable.createdAt, endQ),
      ));

    const ivaRepercutido = Number(invoicesQ[0]?.taxAmount ?? 0);
    const totalExpenses = Number(expensesQ[0]?.total ?? 0);
    const ivaSoportado = totalExpenses * 0.21; // estimado al 21%
    const ivaResultado = ivaRepercutido - ivaSoportado;

    // Trimestre anterior para comparativa
    const prevQ = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
    const prevStart = new Date(`${prevQ.year}-${String((prevQ.quarter - 1) * 3 + 1).padStart(2, "0")}-01`);
    const prevEnd = new Date(prevQ.year, prevQ.quarter * 3, 0);

    const prevInv = await db.select({ taxAmount: sum(invoicesTable.taxAmount) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, prevStart),
        lte(invoicesTable.createdAt, prevEnd),
      ));
    const prevExp = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, prevStart),
        lte(expensesTable.createdAt, prevEnd),
      ));
    const prevIvaRepercutido = Number(prevInv[0]?.taxAmount ?? 0);
    const prevIvaSoportado = Number(prevExp[0]?.total ?? 0) * 0.21;
    const prevResultado = prevIvaRepercutido - prevIvaSoportado;

    // Persistir cálculo
    await db.insert(taxCalculationsTable).values({
      orgId, taxType: "iva", year, quarter,
      ivaRepercutido, ivaSoportado, ivaResultado,
      totalIncome: Number(invoicesQ[0]?.total ?? 0),
      totalExpenses,
    }).onConflictDoNothing(); // útil si hay PK compuesta en futuro

    res.json({
      year, quarter,
      ivaRepercutido: Math.round(ivaRepercutido * 100) / 100,
      ivaSoportado: Math.round(ivaSoportado * 100) / 100,
      resultado: Math.round(ivaResultado * 100) / 100,
      aPagar: ivaResultado > 0 ? Math.round(ivaResultado * 100) / 100 : 0,
      aDevolver: ivaResultado < 0 ? Math.round(Math.abs(ivaResultado) * 100) / 100 : 0,
      comparativa: {
        anterior: Math.round(prevResultado * 100) / 100,
        variacion: prevResultado !== 0
          ? Math.round(((ivaResultado - prevResultado) / Math.abs(prevResultado)) * 100)
          : 0,
      },
      nota: "Cálculo orientativo basado en facturas y gastos registrados. No constituye declaración oficial.",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/simulator/irpf ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/simulator/irpf", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = Number(req.query.year ?? new Date().getFullYear());
    const quarter = Number(req.query.quarter ?? Math.ceil((new Date().getMonth() + 1) / 3));

    const qMonths = [(quarter - 1) * 3 + 1, (quarter - 1) * 3 + 3];
    const startQ = new Date(`${year}-${String(qMonths[0]).padStart(2, "0")}-01`);
    const endQ = new Date(year, qMonths[1], 0);

    const incomeQ = await db.select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, startQ),
        lte(invoicesTable.createdAt, endQ),
      ));
    const expenseQ = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, startQ),
        lte(expensesTable.createdAt, endQ),
      ));

    const ingresos = Number(incomeQ[0]?.total ?? 0);
    const gastos = Number(expenseQ[0]?.total ?? 0);
    const beneficio = ingresos - gastos;

    // Estimación IRPF autónomo (simplificada: 20% sobre beneficio)
    const irpfEstimate = beneficio * 0.20;
    const retenciones = 0; // TODO: leer desde facturas si hay retenciones
    const irpfBase = Math.max(beneficio, 0);

    // Trimestre anterior
    const prevQ = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
    const prevStart = new Date(`${prevQ.year}-${String((prevQ.quarter - 1) * 3 + 1).padStart(2, "0")}-01`);
    const prevEnd = new Date(prevQ.year, prevQ.quarter * 3, 0);

    const prevIncome = await db.select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, prevStart),
        lte(invoicesTable.createdAt, prevEnd),
      ));
    const prevExpense = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, prevStart),
        lte(expensesTable.createdAt, prevEnd),
      ));
    const prevBeneficio = Number(prevIncome[0]?.total ?? 0) - Number(prevExpense[0]?.total ?? 0);
    const prevEstimate = Math.max(prevBeneficio, 0) * 0.20;

    await db.insert(taxCalculationsTable).values({
      orgId, taxType: "irpf", year, quarter,
      totalIncome: ingresos, totalExpenses: gastos,
      irpfRetenciones: retenciones, irpfBase, irpfEstimate,
    }).onConflictDoNothing();

    res.json({
      year, quarter,
      ingresos: Math.round(ingresos * 100) / 100,
      gastos: Math.round(gastos * 100) / 100,
      beneficio: Math.round(beneficio * 100) / 100,
      retenciones: Math.round(retenciones * 100) / 100,
      baseImponible: Math.round(irpfBase * 100) / 100,
      pagoEstimado: Math.round(irpfEstimate * 100) / 100,
      comparativa: {
        anterior: Math.round(prevEstimate * 100) / 100,
        variacion: prevEstimate !== 0
          ? Math.round(((irpfEstimate - prevEstimate) / Math.abs(prevEstimate)) * 100)
          : 0,
      },
      nota: "Simulación orientativa para autónomos (estimación 20% sobre beneficio). No constituye declaración oficial.",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/simulator/renta ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/simulator/renta", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = Number(req.query.year ?? new Date().getFullYear() - 1); // Año anterior por defecto

    const startY = new Date(`${year}-01-01`);
    const endY = new Date(`${year}-12-31`);

    const incomeQ = await db.select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, startY),
        lte(invoicesTable.createdAt, endY),
      ));
    const expenseQ = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, startY),
        lte(expensesTable.createdAt, endY),
      ));

    const ingresos = Number(incomeQ[0]?.total ?? 0);
    const gastos = Number(expenseQ[0]?.total ?? 0);
    const beneficio = ingresos - gastos;

    // Tramos IRPF simplificados (España 2025)
    const base = Math.max(beneficio, 0);
    let tipoEfectivo = 0;
    if (base <= 12450) tipoEfectivo = 19;
    else if (base <= 20200) tipoEfectivo = 24;
    else if (base <= 35200) tipoEfectivo = 30;
    else if (base <= 60000) tipoEfectivo = 37;
    else tipoEfectivo = 45;

    const cuotaIntegra = base * (tipoEfectivo / 100);
    const minimoTributacion = base * 0.02; // mínimo del 2%
    const pagoEstimado = Math.max(cuotaIntegra, minimoTributacion);

    // Año anterior para comparativa
    const prevYear = year - 1;
    const prevStart = new Date(`${prevYear}-01-01`);
    const prevEnd = new Date(`${prevYear}-12-31`);

    const prevIncome = await db.select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.orgId, orgId),
        gte(invoicesTable.createdAt, prevStart),
        lte(invoicesTable.createdAt, prevEnd),
      ));
    const prevExpense = await db.select({ total: sum(expensesTable.amount) })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, orgId),
        gte(expensesTable.createdAt, prevStart),
        lte(expensesTable.createdAt, prevEnd),
      ));
    const prevBeneficio = Number(prevIncome[0]?.total ?? 0) - Number(prevExpense[0]?.total ?? 0);
    const prevPago = Math.max(prevBeneficio, 0) * (tipoEfectivo / 100);

    await db.insert(taxCalculationsTable).values({
      orgId, taxType: "renta", year, quarter: null, month: null,
      totalIncome: ingresos, totalExpenses: gastos,
      rentaBeneficio: beneficio, rentaBase: base, rentaEstimate: pagoEstimado,
    }).onConflictDoNothing();

    res.json({
      year,
      borrador: true,
      ingresos: Math.round(ingresos * 100) / 100,
      gastos: Math.round(gastos * 100) / 100,
      beneficio: Math.round(beneficio * 100) / 100,
      baseImponible: Math.round(base * 100) / 100,
      tipoEfectivo,
      cuotaIntegra: Math.round(cuotaIntegra * 100) / 100,
      pagoEstimado: Math.round(pagoEstimado * 100) / 100,
      comparativa: {
        anterior: Math.round(prevPago * 100) / 100,
        variacion: prevPago !== 0
          ? Math.round(((pagoEstimado - prevPago) / Math.abs(prevPago)) * 100)
          : 0,
      },
      advertencia: "Este documento es una SIMULACIÓN y NO constituye una declaración oficial de la renta. Consulte con su gestor antes de presentar.",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/health-score ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/health-score", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;

    // — Calcular score en tiempo real —
    const totalObligations = await db.select({ count: count() })
      .from(taxObligationsTable)
      .where(eq(taxObligationsTable.orgId, orgId));
    const filedObligations = await db.select({ count: count() })
      .from(taxObligationsTable)
      .where(and(
        eq(taxObligationsTable.orgId, orgId),
        eq(taxObligationsTable.status, "filed"),
      ));
    const total = Number(totalObligations[0]?.count ?? 1);
    const filed = Number(filedObligations[0]?.count ?? 0);
    const complianceScore = Math.round((filed / Math.max(total, 1)) * 100);

    const docCount = await db.select({ count: count() })
      .from(taxDocumentsTable)
      .where(eq(taxDocumentsTable.orgId, orgId));
    const docScore = Math.min(Number(docCount[0]?.count ?? 0) * 2, 100); // 1 doc = 2 puntos, max 100

    const pendingObligations = await db.select({ count: count() })
      .from(taxObligationsTable)
      .where(and(
        eq(taxObligationsTable.orgId, orgId),
        eq(taxObligationsTable.status, "pending"),
        lte(taxObligationsTable.dueDate, new Date()),
      ));
    const overdue = Number(pendingObligations[0]?.count ?? 0);
    const timelinessScore = Math.max(100 - overdue * 10, 0);

    const accuracyScore = 85; // Placeholder — en futuro validar cálculos vs datos reales

    const score = Math.round((complianceScore + accuracyScore + docScore + timelinessScore) / 4);

    const recommendations: string[] = [];
    if (overdue > 0) recommendations.push(`Tienes ${overdue} obligaciones fiscales vencidas pendientes.`);
    if (docScore < 50) recommendations.push("Sube más documentación fiscal para mejorar tu puntuación.");
    if (complianceScore < 80) recommendations.push("Presenta las declaraciones pendientes antes de las fechas límite.");
    if (recommendations.length === 0) recommendations.push("Tu situación fiscal es buena. ¡Sigue así!");

    // Persistir
    const [health] = await db.insert(taxHealthScoreTable).values({
      orgId, score, complianceScore, accuracyScore, documentScore: docScore, timelinessScore,
      recommendations: JSON.stringify(recommendations),
      snapshot: JSON.stringify({ totalObligations: total, filedObligations: filed, overdue, documentCount: Number(docCount[0]?.count ?? 0) }),
    }).returning();

    res.json({
      score,
      breakdown: { compliance: complianceScore, accuracy: accuracyScore, documents: docScore, timeliness: timelinessScore },
      recommendations,
      snapshot: { totalObligations: total, filedObligations: filed, overdue, documentCount: Number(docCount[0]?.count ?? 0) },
      updatedAt: health.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/documents ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/documents", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const category = req.query.category as string | undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;

    let conditions = eq(taxDocumentsTable.orgId, orgId);
    if (category) conditions = and(conditions, eq(taxDocumentsTable.category, category));
    if (year) conditions = and(conditions, eq(taxDocumentsTable.fiscalYear, year));

    const rows = await db.select()
      .from(taxDocumentsTable)
      .where(conditions)
      .orderBy(desc(taxDocumentsTable.createdAt));

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/tax/documents ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.post("/documents", requirePermission("tax.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { name, fileType, fileUrl, fileSize, category, fiscalYear, quarter } = req.body;

    const [row] = await db.insert(taxDocumentsTable).values({
      orgId, name, fileType, fileUrl, fileSize, category, fiscalYear, quarter,
    }).returning();

    logAudit({ req, action: "tax_document_uploaded", resource: "tax_document", resourceId: String(row.id), result: "success" });

    res.json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/tax/documents/upload — FIX-AO: real file upload (base64 in DB) ──────────
// Connects the "Arrastra archivos aquí" placeholder to an actual working upload.
// No external bucket needed: the file content is stored as base64 in
// tax_documents.file_data. Download is served back via GET /documents/:id/file.
taxRouter.post("/documents/upload", requirePermission("tax.write"), taxDocUpload.single("file"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No se ha enviado ningún archivo" }); return; }

    const category   = (req.body?.category as string | undefined) || "other";
    const fiscalYear = req.body?.fiscalYear ? Number(req.body.fiscalYear) : new Date().getFullYear();
    const quarter    = req.body?.quarter ? Number(req.body.quarter) : null;

    const ext = taxDocExt(file.originalname);
    const base64 = file.buffer.toString("base64");

    const insertResult = await db.execute(sql`
      INSERT INTO tax_documents (org_id, name, file_type, file_size, file_data, category, fiscal_year, quarter, status)
      VALUES (${orgId}, ${file.originalname}, ${ext}, ${file.size}, ${base64}, ${category}, ${fiscalYear}, ${quarter}, 'pending')
      RETURNING id, org_id, name, file_type, file_size, category, fiscal_year, quarter, status, created_at
    `) as unknown as { rows: Array<{ id: number; created_at: string }> };

    const inserted = insertResult.rows[0];

    await logAudit({
      actorClerkId: req.clerkUserId ?? "unknown",
      action: "tax_document_uploaded",
      resource: "tax_document",
      resourceId: inserted?.id,
      orgId,
      details: { name: file.originalname, category, fileSize: file.size },
      req,
    });

    res.status(201).json({
      id: inserted?.id,
      name: file.originalname,
      fileType: ext,
      fileSize: file.size,
      category,
      fiscalYear,
      quarter,
      status: "pending",
      createdAt: inserted?.created_at ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error("[TaxDocuments][upload] error:", String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "No se pudo subir el documento" });
  }
});

// ── GET /api/tax/documents/:id/file — serve stored file back ──────────────────────────
taxRouter.get("/documents/:id/file", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = Number(req.params.id);

    const rows = await db.execute(sql`
      SELECT name, file_type, file_data FROM tax_documents
      WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `) as unknown as { rows: Array<{ name: string; file_type: string; file_data: string | null }> };

    const doc = rows.rows[0];
    if (!doc || !doc.file_data) { res.status(404).json({ error: "Documento no encontrado" }); return; }

    const buffer = Buffer.from(doc.file_data, "base64");
    res.setHeader("Content-Type", taxDocMimeForExt(doc.file_type));
    res.setHeader("Content-Disposition", `inline; filename="${doc.name}"`);
    res.end(buffer);
  } catch (err) {
    console.error("[TaxDocuments][download] error:", String(err));
    res.status(500).json({ error: "No se pudo descargar el documento" });
  }
});

// ── GET /api/tax/reminders ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/reminders", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const now = new Date();
    const upcoming = await db.select()
      .from(taxRemindersTable)
      .where(and(
        eq(taxRemindersTable.orgId, orgId),
        gte(taxRemindersTable.remindAt, now),
        // Not dismissed
        sql`${taxRemindersTable.dismissedAt} IS NULL`,
      ))
      .orderBy(taxRemindersTable.remindAt);

    res.json(upcoming.map(r => ({
      ...r,
      remindAt: r.remindAt.toISOString(),
      sentAt: r.sentAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/tax/reminders ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.post("/reminders", requirePermission("tax.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { title, message, remindAt, obligationId, notifyEmail, notifyWhatsApp, notifyTelegram, notifyInApp } = req.body;

    const [row] = await db.insert(taxRemindersTable).values({
      orgId, title, message, obligationId,
      remindAt: new Date(remindAt),
      notifyEmail: notifyEmail ?? true,
      notifyWhatsApp: notifyWhatsApp ?? false,
      notifyTelegram: notifyTelegram ?? false,
      notifyInApp: notifyInApp ?? true,
    }).returning();

    res.json({ ...row, remindAt: row.remindAt.toISOString(), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/tax/reminders/:id/dismiss ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.post("/reminders/:id/dismiss", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id = Number(req.params.id);

    const [row] = await db.update(taxRemindersTable)
      .set({ dismissedAt: new Date() })
      .where(and(eq(taxRemindersTable.id, id), eq(taxRemindersTable.orgId, orgId)))
      .returning();

    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/tax/calculations ─────────────────────0──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

taxRouter.get("/calculations", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const year = Number(req.query.year ?? new Date().getFullYear());

    const rows = await db.select()
      .from(taxCalculationsTable)
      .where(and(
        eq(taxCalculationsTable.orgId, orgId),
        eq(taxCalculationsTable.year, year),
      ))
      .orderBy(taxCalculationsTable.taxType, taxCalculationsTable.quarter);

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});


// ── GET /api/tax/verifactu ──────────────────────────────────────────────────────────────
// Lists invoices for this org with their Verifactu registration status.
taxRouter.get("/verifactu", requirePermission("tax.read"), async (req, res) => {
  try {
    const orgId = req.orgId!;

    const rows = await db.execute(sql`
      SELECT id, invoice_number, status, total, currency, created_at,
             verifactu_hash, verifactu_hash_anterior, verifactu_qr_url, verifactu_registered_at
      FROM invoices
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `);
    const invoices = (rows as { rows: any[] }).rows;

    const registered = invoices.filter(i => i.verifactu_registered_at !== null);
    const pending     = invoices.filter(i => i.verifactu_registered_at === null);

    res.json({
      total: invoices.length,
      registeredCount: registered.length,
      pendingCount: pending.length,
      invoices: invoices.map(i => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        status: i.status,
        total: i.total,
        currency: i.currency,
        createdAt: i.created_at,
        verifactuHash: i.verifactu_hash,
        verifactuHashAnterior: i.verifactu_hash_anterior,
        verifactuQrUrl: i.verifactu_qr_url,
        verifactuRegisteredAt: i.verifactu_registered_at,
      })),
    });
  } catch (err) {
    console.error("[Verifactu] GET /verifactu error:", String(err));
    res.status(500).json({ error: "No se pudo cargar el estado de Verifactu" });
  }
});

// ── POST /api/tax/verifactu/register/:invoiceId ─────────────────────────────────────────
// Computes the chained SHA-256 hash for this invoice (chained to the previous
// registered invoice in the org), builds the AEAT QR validation URL, and
// stores the result. Idempotent-ish: re-registering overwrites with a fresh
// hash chained to whatever is currently last (safe for a single-writer flow).
taxRouter.post("/verifactu/register/:invoiceId", requirePermission("tax.write"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isInteger(invoiceId)) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }

    const invRows = await db.execute(sql`
      SELECT id, invoice_number, total, status
      FROM invoices
      WHERE id = ${invoiceId} AND org_id = ${orgId}
      LIMIT 1
    `);
    const invoice = (invRows as { rows: any[] }).rows[0];
    if (!invoice) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }
    if (invoice.status === "draft") {
      return res.status(400).json({ error: "No se puede registrar en Verifactu una factura en borrador. Emítela primero." });
    }

    // Find the last chained hash for this org (chain integrity requires strict order).
    const prevRows = await db.execute(sql`
      SELECT verifactu_hash
      FROM invoices
      WHERE org_id = ${orgId} AND verifactu_registered_at IS NOT NULL
      ORDER BY verifactu_registered_at DESC
      LIMIT 1
    `);
    const prevHash = (prevRows as { rows: Array<{ verifactu_hash: string }> }).rows[0]?.verifactu_hash ?? "";

    const orgRows = await db.execute(sql`
      SELECT tax_id, legal_name, name FROM organizations WHERE id = ${orgId} LIMIT 1
    `);
    const org = (orgRows as { rows: any[] }).rows[0];
    const nif = org?.tax_id ?? "";

    const timestamp = new Date().toISOString();
    const payload = `${invoice.invoice_number}|${invoice.total}|${nif}|${prevHash}|${timestamp}`;

    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(payload).digest("hex").toUpperCase();

    const qrUrl = `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR` +
      `?nif=${encodeURIComponent(nif)}` +
      `&num=${encodeURIComponent(invoice.invoice_number)}` +
      `&importe=${encodeURIComponent(invoice.total)}` +
      `&hash=${encodeURIComponent(hash)}`;

    await db.execute(sql`
      UPDATE invoices
      SET verifactu_hash = ${hash},
          verifactu_hash_anterior = ${prevHash},
          verifactu_qr_url = ${qrUrl},
          verifactu_registered_at = NOW()
      WHERE id = ${invoiceId} AND org_id = ${orgId}
    `);

    await logAudit({
      actorClerkId: req.clerkUserId!,
      action: "verifactu_invoice_registered",
      resource: "invoice",
      resourceId: invoiceId,
      orgId,
      details: { invoiceNumber: invoice.invoice_number, hash },
      req,
    });

    res.json({
      success: true,
      invoiceId,
      verifactuHash: hash,
      verifactuHashAnterior: prevHash,
      verifactuQrUrl: qrUrl,
    });
  } catch (err) {
    console.error("[Verifactu] POST /verifactu/register error:", String(err));
    res.status(500).json({ error: "No se pudo registrar la factura en Verifactu" });
  }
});
