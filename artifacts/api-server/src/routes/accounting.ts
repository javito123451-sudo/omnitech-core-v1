import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, invoiceItemsTable, paymentsTable,
  creditNotesTable, expensesTable, clientsTable, quotesTable, quoteItemsTable,
} from "@workspace/db";
import { eq, and, desc, count, sum, sql, gte, or, ilike } from "drizzle-orm";
import { logAudit } from "../utils/auditLogger";
import { generateInvoicePdf } from "../utils/pdf-invoice";
import { requirePermission } from "../middlewares/permissions";
import {
  createInvoiceCore,
  registerPaymentCore,
  verifyClientOrg,
  verifyInvoiceOrg,
  type CreateInvoiceInput,
  type RegisterPaymentInput,
} from "../services/accounting";

export const accountingRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotals(items: { quantity: number; unitPrice: number }[], taxRate: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = parseFloat(((subtotal * taxRate) / 100).toFixed(2));
  const total = parseFloat((subtotal + taxAmount).toFixed(2));
  return { subtotal: parseFloat(subtotal.toFixed(2)), taxAmount, total };
}

async function nextInvoiceNumber(orgId: number): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ count: count() })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.orgId, orgId),
      gte(invoicesTable.createdAt, new Date(`${year}-01-01`)),
    ));
  const seq = String((Number(row?.count ?? 0) + 1)).padStart(4, "0");
  return `F${year}-${seq}`;
}

async function nextCreditNoteNumber(orgId: number): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ count: count() })
    .from(creditNotesTable)
    .where(and(
      eq(creditNotesTable.orgId, orgId),
      gte(creditNotesTable.createdAt, new Date(`${year}-01-01`)),
    ));
  const seq = String((Number(row?.count ?? 0) + 1)).padStart(4, "0");
  return `NC${year}-${seq}`;
}

function checkRole(
  req: import("express").Request,
  res: import("express").Response,
  allowed: string[],
): boolean {
  const role = req.orgRole ?? "member";
  if (!allowed.includes(role)) {
    res.status(403).json({ error: "Sin permisos para esta acción" });
    return false;
  }
  return true;
}

async function enrichInvoice(inv: typeof invoicesTable.$inferSelect) {
  const items = await db
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, inv.id))
    .orderBy(invoiceItemsTable.orderIndex);

  const client = inv.clientId
    ? await db.select({ id: clientsTable.id, name: clientsTable.name, company: clientsTable.company, email: clientsTable.email, phone: clientsTable.phone })
        .from(clientsTable).where(eq(clientsTable.id, inv.clientId)).then(r => r[0] ?? null)
    : null;

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.invoiceId, inv.id))
    .orderBy(desc(paymentsTable.paidAt));

  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return {
    ...inv,
    subtotal:  parseFloat(String(inv.subtotal)),
    taxRate:   parseFloat(String(inv.taxRate)),
    taxAmount: parseFloat(String(inv.taxAmount)),
    total:     parseFloat(String(inv.total)),
    items: items.map(i => ({
      ...i,
      quantity:  parseFloat(String(i.quantity)),
      unitPrice: parseFloat(String(i.unitPrice)),
      total:     parseFloat(String(i.total)),
    })),
    client,
    payments,
    totalPaid,
    balance: parseFloat(String(inv.total)) - totalPaid,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/invoices
accountingRouter.get("/invoices", requirePermission("accounting.read"), async (req, res) => {
  const orgId   = req.orgId!;
  const limit   = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset  = Number(req.query["offset"] ?? 0);
  const status  = req.query["status"]  as string | undefined;
  const search  = req.query["search"]  as string | undefined;
  const clientId = req.query["clientId"] as string | undefined;

  const conditions = [eq(invoicesTable.orgId, orgId)];
  if (status && status !== "all") conditions.push(eq(invoicesTable.status, status));
  if (clientId) conditions.push(eq(invoicesTable.clientId, Number(clientId)));

  const where = and(...conditions);

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      currency: invoicesTable.currency,
      subtotal: invoicesTable.subtotal,
      taxRate: invoicesTable.taxRate,
      taxAmount: invoicesTable.taxAmount,
      total: invoicesTable.total,
      dueDate: invoicesTable.dueDate,
      paidAt: invoicesTable.paidAt,
      createdAt: invoicesTable.createdAt,
      clientId: invoicesTable.clientId,
      clientName: clientsTable.name,
      clientCompany: clientsTable.company,
    })
    .from(invoicesTable)
    .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
    .where(
      search
        ? and(where, or(
            ilike(invoicesTable.invoiceNumber, `%${search}%`),
            ilike(clientsTable.name, `%${search}%`),
          ))
        : where,
    )
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Count query must mirror the search filter so pagination totals are accurate
  const countWhere = search
    ? and(where, or(
        ilike(invoicesTable.invoiceNumber, `%${search}%`),
        ilike(clientsTable.name, `%${search}%`),
      ))
    : where;

  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(invoicesTable)
    .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
    .where(countWhere);

  res.json({
    invoices: rows.map(r => ({
      ...r,
      subtotal:  parseFloat(String(r.subtotal)),
      taxRate:   parseFloat(String(r.taxRate)),
      taxAmount: parseFloat(String(r.taxAmount)),
      total:     parseFloat(String(r.total)),
    })),
    total: Number(totalCount),
    limit,
    offset,
  });
});

// GET /api/accounting/invoices/:id
accountingRouter.get("/invoices/:id", requirePermission("accounting.read"), async (req, res) => {
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const [inv] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.orgId, orgId)));
  if (!inv) { res.status(404).json({ error: "Factura no encontrada" }); return; }
  res.json(await enrichInvoice(inv));
});

// POST /api/accounting/invoices
accountingRouter.post("/invoices", requirePermission("accounting.write"), async (req, res) => {
  const orgId = req.orgId!;
  const { clientId, quoteId, currency = "EUR", taxRate = 21, notes, dueDate, items = [] } = req.body as {
    clientId?: number; quoteId?: number; currency?: string; taxRate?: number;
    notes?: string; dueDate?: string;
    items: { description: string; quantity: number; unitPrice: number }[];
  };

  if (!items.length) { res.status(400).json({ error: "Se requiere al menos un ítem" }); return; }
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;

  // Validate referenced IDs belong to this org before any insert
  if (clientId) {
    const ok = await verifyClientOrg(clientId, orgId);
    if (!ok) { res.status(403).json({ error: "Cliente no pertenece a esta organización" }); return; }
  }
  if (quoteId) {
    const [qt] = await db.select({ id: quotesTable.id }).from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
    if (!qt) { res.status(403).json({ error: "Presupuesto no pertenece a esta organización" }); return; }
  }

  const { invoice, invoiceNumber, total } = await createInvoiceCore({
    orgId, clientId, quoteId, currency, taxRate, notes, dueDate, items,
  });

  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_created", resource: "invoice", resourceId: invoice.id, orgId, details: { invoiceNumber, total }, req });
  res.status(201).json(invoice);
});

// PATCH /api/accounting/invoices/:id
accountingRouter.patch("/invoices/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const { status, notes, dueDate, currency, taxRate, items } = req.body as {
    status?: string; notes?: string; dueDate?: string; currency?: string; taxRate?: number;
    items?: { description: string; quantity: number; unitPrice: number }[];
  };

  const [existing] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.orgId, orgId)));
  if (!existing) { res.status(404).json({ error: "Factura no encontrada" }); return; }

  const updateData: Partial<typeof invoicesTable.$inferInsert> = {};
  if (status)   updateData.status  = status;
  if (notes !== undefined) updateData.notes = notes;
  if (dueDate)  updateData.dueDate = new Date(dueDate);
  if (currency) updateData.currency = currency;

  if (status === "paid" && !existing.paidAt) {
    updateData.paidAt = new Date();
  }

  if (items?.length) {
    const effectiveTaxRate = taxRate ?? parseFloat(String(existing.taxRate));
    const effectiveCurrency = currency ?? existing.currency;
    const { subtotal, taxAmount, total } = calcTotals(items, effectiveTaxRate);
    updateData.subtotal  = String(subtotal);
    updateData.taxRate   = String(effectiveTaxRate);
    updateData.taxAmount = String(taxAmount);
    updateData.total     = String(total);
    updateData.currency  = effectiveCurrency;

    await db.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
    await db.insert(invoiceItemsTable).values(
      items.map((item, idx) => ({
        invoiceId: id, description: item.description,
        quantity:  String(item.quantity), unitPrice: String(item.unitPrice),
        total:     String(parseFloat((item.quantity * item.unitPrice).toFixed(2))),
        orderIndex: idx,
      })),
    );
  }

  updateData.updatedAt = new Date();
  await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id));

  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_updated", resource: "invoice", resourceId: id, orgId, details: { status, items: items?.length }, req });
  const [updated] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  res.json(await enrichInvoice(updated!));
});

// PATCH /api/accounting/invoices/:id/status — spec-correct status-only alias
accountingRouter.patch("/invoices/:id/status", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const { status } = req.body as { status: string };
  if (!status) { res.status(400).json({ error: "status requerido" }); return; }

  const [existing] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.orgId, orgId)));
  if (!existing) { res.status(404).json({ error: "Factura no encontrada" }); return; }

  const upd: Partial<typeof invoicesTable.$inferInsert> = { status, updatedAt: new Date() };
  if (status === "paid" && !existing.paidAt) upd.paidAt = new Date();

  await db.update(invoicesTable).set(upd).where(eq(invoicesTable.id, id));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_status_updated", resource: "invoice", resourceId: id, orgId, details: { status }, req });
  const [updated] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  res.json(await enrichInvoice(updated!));
});

// DELETE /api/accounting/invoices/:id
accountingRouter.delete("/invoices/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const [inv] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.orgId, orgId)));
  if (!inv) { res.status(404).json({ error: "Factura no encontrada" }); return; }
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_deleted", resource: "invoice", resourceId: id, orgId, severity: "warning", req });
  res.json({ ok: true });
});

// GET /api/accounting/invoices/:id/pdf
accountingRouter.get("/invoices/:id/pdf", requirePermission("accounting.read"), async (req, res) => {
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const [inv] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.orgId, orgId)));
  if (!inv) { res.status(404).json({ error: "Factura no encontrada" }); return; }

  const enriched = await enrichInvoice(inv);
  const pdfBuffer = await generateInvoicePdf({
    invoice: {
      id: enriched.id,
      invoiceNumber: enriched.invoiceNumber,
      status: enriched.status,
      currency: enriched.currency,
      subtotal: enriched.subtotal,
      taxRate:  enriched.taxRate,
      taxAmount:enriched.taxAmount,
      total:    enriched.total,
      notes:    enriched.notes ?? null,
      dueDate:  enriched.dueDate ? new Date(enriched.dueDate) : null,
      paidAt:   enriched.paidAt ? new Date(enriched.paidAt) : null,
      createdAt:new Date(enriched.createdAt),
    },
    client: enriched.client ? {
      name:    enriched.client.name,
      company: enriched.client.company ?? null,
      email:   enriched.client.email,
      phone:   enriched.client.phone ?? null,
    } : null,
    items: enriched.items,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="factura-${enriched.invoiceNumber}.pdf"`);
  res.end(pdfBuffer);
});

// POST /api/accounting/invoices/from-quote/:quoteId — convert approved quote to invoice (spec endpoint)
accountingRouter.post("/invoices/from-quote/:quoteId", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId   = req.orgId!;
  const quoteId = Number(req.params["quoteId"]);

  const [quote] = await db.select().from(quotesTable)
    .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
  if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
  if (quote.status !== "approved" && quote.status !== "accepted") {
    res.status(422).json({ error: "Solo se pueden convertir presupuestos aprobados (estado: aprobado)" }); return;
  }

  const quoteItems = await db.select().from(quoteItemsTable)
    .where(eq(quoteItemsTable.quoteId, quoteId))
    .orderBy(quoteItemsTable.orderIndex);

  const invoiceNumber = await nextInvoiceNumber(orgId);
  const taxRate = parseFloat(String(quote.taxRate ?? 21));
  const items = quoteItems.map(i => ({
    quantity:  parseFloat(String(i.quantity)),
    unitPrice: parseFloat(String(i.unitPrice)),
  }));
  const { subtotal, taxAmount, total } = calcTotals(items, taxRate);

  const [inv] = await db.insert(invoicesTable).values({
    orgId,
    clientId: quote.clientId ?? null,
    quoteId,
    invoiceNumber,
    status: "draft",
    currency: (quote as Record<string, unknown>)["currency"] as string ?? "EUR",
    subtotal: String(subtotal), taxRate: String(taxRate),
    taxAmount: String(taxAmount), total: String(total),
    notes: quote.notes ?? null,
  }).returning();

  await db.insert(invoiceItemsTable).values(
    quoteItems.map((item, idx) => ({
      invoiceId: inv!.id,
      description: item.description,
      quantity:  String(parseFloat(String(item.quantity))),
      unitPrice: String(parseFloat(String(item.unitPrice))),
      total:     String(parseFloat(String(item.total))),
      orderIndex: idx,
    })),
  );

  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_from_quote", resource: "invoice", resourceId: inv!.id, orgId, details: { quoteId, invoiceNumber }, req });
  res.status(201).json(await enrichInvoice(inv!));
});

// POST /api/accounting/quotes/:id/to-invoice — legacy alias; enforces same approval rules as primary endpoint
accountingRouter.post("/quotes/:id/to-invoice", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const quoteId = Number(req.params["id"]);

  const [quote] = await db.select().from(quotesTable)
    .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.orgId, orgId)));
  if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
  if (quote.status !== "approved" && quote.status !== "accepted") {
    res.status(422).json({ error: "Solo se pueden convertir presupuestos aprobados (estado: aprobado)" }); return;
  }

  const quoteItems = await db.select().from(quoteItemsTable)
    .where(eq(quoteItemsTable.quoteId, quoteId))
    .orderBy(quoteItemsTable.orderIndex);

  const invoiceNumber = await nextInvoiceNumber(orgId);
  const taxRate = parseFloat(String(quote.taxRate ?? 21));
  const items = quoteItems.map(i => ({
    quantity:  parseFloat(String(i.quantity)),
    unitPrice: parseFloat(String(i.unitPrice)),
  }));
  const { subtotal, taxAmount, total } = calcTotals(items, taxRate);

  const [inv] = await db.insert(invoicesTable).values({
    orgId,
    clientId: quote.clientId ?? null,
    quoteId,
    invoiceNumber,
    status: "draft",
    currency: (quote as Record<string, unknown>)["currency"] as string ?? "EUR",
    subtotal: String(subtotal), taxRate: String(taxRate),
    taxAmount: String(taxAmount), total: String(total),
    notes: quote.notes ?? null,
  }).returning();

  await db.insert(invoiceItemsTable).values(
    quoteItems.map((item, idx) => ({
      invoiceId: inv!.id,
      description: item.description,
      quantity:  String(parseFloat(String(item.quantity))),
      unitPrice: String(parseFloat(String(item.unitPrice))),
      total:     String(parseFloat(String(item.total))),
      orderIndex: idx,
    })),
  );

  await logAudit({ actorClerkId: req.clerkUserId!, action: "invoice_from_quote", resource: "invoice", resourceId: inv!.id, orgId, details: { quoteId, invoiceNumber }, req });
  res.status(201).json(await enrichInvoice(inv!));
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/payments
accountingRouter.get("/payments", requirePermission("accounting.read"), async (req, res) => {
  const orgId     = req.orgId!;
  const limit     = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset    = Number(req.query["offset"] ?? 0);
  const invoiceId = req.query["invoiceId"] ? Number(req.query["invoiceId"]) : null;
  const clientId  = req.query["clientId"]  ? Number(req.query["clientId"])  : null;

  const conditions = [eq(paymentsTable.orgId, orgId)];
  if (invoiceId) conditions.push(eq(paymentsTable.invoiceId, invoiceId));
  if (clientId)  conditions.push(eq(paymentsTable.clientId, clientId));
  const whereClause = and(...conditions);

  const rows = await db.select({
    id: paymentsTable.id,
    invoiceId: paymentsTable.invoiceId,
    invoiceNumber: invoicesTable.invoiceNumber,
    clientId: paymentsTable.clientId,
    clientName: clientsTable.name,
    amount: paymentsTable.amount,
    currency: paymentsTable.currency,
    method: paymentsTable.method,
    reference: paymentsTable.reference,
    notes: paymentsTable.notes,
    paidAt: paymentsTable.paidAt,
    createdAt: paymentsTable.createdAt,
  })
  .from(paymentsTable)
  .leftJoin(invoicesTable, and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.orgId, orgId)))
  .leftJoin(clientsTable, and(eq(paymentsTable.clientId, clientsTable.id), eq(clientsTable.orgId, orgId)))
  .where(whereClause)
  .orderBy(desc(paymentsTable.paidAt))
  .limit(limit)
  .offset(offset);

  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(paymentsTable)
    .where(whereClause);

  res.json({
    payments: rows.map(r => ({ ...r, amount: parseFloat(String(r.amount)) })),
    total: Number(totalCount), limit, offset,
  });
});

// POST /api/accounting/payments
accountingRouter.post("/payments", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const { invoiceId, clientId, amount, currency = "EUR", method = "transfer", reference, notes, paidAt } = req.body as {
    invoiceId?: number; clientId?: number; amount: number; currency?: string;
    method?: string; reference?: string; notes?: string; paidAt?: string;
  };

  if (!amount || amount <= 0) { res.status(400).json({ error: "Importe inválido" }); return; }

  // Validate ownership BEFORE any insert
  if (invoiceId) {
    const ok = await verifyInvoiceOrg(invoiceId, orgId);
    if (!ok) { res.status(403).json({ error: "Factura no pertenece a esta organización" }); return; }
  }
  if (clientId) {
    const ok = await verifyClientOrg(clientId, orgId);
    if (!ok) { res.status(403).json({ error: "Cliente no pertenece a esta organización" }); return; }
  }

  const { payment, invoiceStatus, totalPaid, balance } = await registerPaymentCore({
    orgId, invoiceId, clientId, amount, currency, method, reference, notes, paidAt,
  });

  await logAudit({ actorClerkId: req.clerkUserId!, action: "payment_registered", resource: "payment", resourceId: payment.id, orgId, details: { amount, method, invoiceId, invoiceStatus }, req });
  res.status(201).json({ ...payment, amount: parseFloat(String(payment.amount)), invoiceStatus, totalPaid, balance });
});

// DELETE /api/accounting/payments/:id
accountingRouter.delete("/payments/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  await db.delete(paymentsTable).where(and(eq(paymentsTable.id, id), eq(paymentsTable.orgId, orgId)));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "payment_deleted", resource: "payment", resourceId: id, orgId, severity: "warning", req });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT NOTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/credit-notes
accountingRouter.get("/credit-notes", requirePermission("accounting.read"), async (req, res) => {
  const orgId  = req.orgId!;
  const limit  = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);

  const rows = await db.select({
    id: creditNotesTable.id,
    noteNumber: creditNotesTable.noteNumber,
    invoiceId: creditNotesTable.invoiceId,
    invoiceNumber: invoicesTable.invoiceNumber,
    clientId: creditNotesTable.clientId,
    clientName: clientsTable.name,
    amount: creditNotesTable.amount,
    currency: creditNotesTable.currency,
    reason: creditNotesTable.reason,
    status: creditNotesTable.status,
    createdAt: creditNotesTable.createdAt,
  })
  .from(creditNotesTable)
  .leftJoin(invoicesTable, and(eq(creditNotesTable.invoiceId, invoicesTable.id), eq(invoicesTable.orgId, orgId)))
  .leftJoin(clientsTable, and(eq(creditNotesTable.clientId, clientsTable.id), eq(clientsTable.orgId, orgId)))
  .where(eq(creditNotesTable.orgId, orgId))
  .orderBy(desc(creditNotesTable.createdAt))
  .limit(limit)
  .offset(offset);

  const [{ total: totalCount }] = await db.select({ total: count() }).from(creditNotesTable).where(eq(creditNotesTable.orgId, orgId));
  res.json({
    creditNotes: rows.map(r => ({ ...r, amount: parseFloat(String(r.amount)) })),
    total: Number(totalCount), limit, offset,
  });
});

// POST /api/accounting/credit-notes
accountingRouter.post("/credit-notes", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const { invoiceId, clientId, amount, currency = "EUR", reason } = req.body as {
    invoiceId?: number; clientId?: number; amount: number; currency?: string; reason?: string;
  };

  if (!amount || amount <= 0) { res.status(400).json({ error: "Importe inválido" }); return; }

  // Require invoiceId — credit notes must always be tied to a paid invoice
  if (!invoiceId) {
    res.status(400).json({ error: "Se requiere invoiceId: las notas de crédito deben emitirse contra una factura pagada" }); return;
  }

  // Validate: invoice must belong to this org and be paid
  const [inv] = await db.select({ id: invoicesTable.id, status: invoicesTable.status, clientId: invoicesTable.clientId })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.orgId, orgId)));
  if (!inv) { res.status(404).json({ error: "Factura no encontrada" }); return; }
  if (inv.status !== "paid") {
    res.status(422).json({ error: "Solo se pueden emitir notas de crédito contra facturas pagadas" }); return;
  }

  // Derive clientId from invoice if not supplied; if supplied, validate ownership
  const resolvedClientId = clientId ?? inv.clientId ?? null;
  if (clientId && clientId !== inv.clientId) {
    const [cl] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
    if (!cl) { res.status(403).json({ error: "Cliente no pertenece a esta organización" }); return; }
  }

  const noteNumber = await nextCreditNoteNumber(orgId);

  const [note] = await db.insert(creditNotesTable).values({
    orgId, invoiceId, clientId: resolvedClientId,
    noteNumber, amount: String(amount), currency,
    reason: reason ?? null, status: "issued",
  }).returning();

  await logAudit({ actorClerkId: req.clerkUserId!, action: "credit_note_created", resource: "credit_note", resourceId: note!.id, orgId, details: { noteNumber, amount, invoiceId }, req });
  res.status(201).json({ ...note, amount: parseFloat(String(note!.amount)) });
});

// PATCH /api/accounting/credit-notes/:id
accountingRouter.patch("/credit-notes/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const { status } = req.body as { status?: string };
  const newStatus = status ?? "issued";
  await db.update(creditNotesTable).set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, orgId)));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "credit_note_updated", resource: "credit_note", resourceId: id, orgId, details: { status: newStatus }, req });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/expenses
accountingRouter.get("/expenses", requirePermission("accounting.read"), async (req, res) => {
  const orgId    = req.orgId!;
  const limit    = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset   = Number(req.query["offset"] ?? 0);
  const category = req.query["category"] as string | undefined;

  const conditions = [eq(expensesTable.orgId, orgId)];
  if (category && category !== "all") conditions.push(eq(expensesTable.category, category));

  const rows = await db.select().from(expensesTable)
    .where(and(...conditions))
    .orderBy(desc(expensesTable.expenseDate))
    .limit(limit)
    .offset(offset);

  const [{ total: totalCount }] = await db.select({ total: count() }).from(expensesTable).where(eq(expensesTable.orgId, orgId));
  res.json({
    expenses: rows.map(r => ({ ...r, amount: parseFloat(String(r.amount)) })),
    total: Number(totalCount), limit, offset,
  });
});

// POST /api/accounting/expenses
accountingRouter.post("/expenses", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const { category = "general", description, amount, currency = "EUR", vendor, expenseDate, receiptUrl, taxDeductible = false, taxRate = 0 } = req.body as {
    category?: string; description: string; amount: number; currency?: string;
    vendor?: string; expenseDate?: string; receiptUrl?: string; taxDeductible?: boolean; taxRate?: number;
  };

  if (!description?.trim()) { res.status(400).json({ error: "Descripción requerida" }); return; }
  if (!amount || amount <= 0) { res.status(400).json({ error: "Importe inválido" }); return; }

  const [exp] = await db.insert(expensesTable).values({
    orgId, category, description: description.trim(), amount: String(amount), currency,
    vendor: vendor ?? null, expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
    receiptUrl: receiptUrl ?? null, taxDeductible, taxRate: String(taxRate),
  }).returning();

  await logAudit({ actorClerkId: req.clerkUserId!, action: "expense_created", resource: "expense", resourceId: exp!.id, orgId, details: { category, amount, taxRate }, req });
  res.status(201).json({ ...exp, amount: parseFloat(String(exp!.amount)), taxRate: parseFloat(String(exp!.taxRate)) });
});

// PATCH /api/accounting/expenses/:id
accountingRouter.patch("/expenses/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const { category, description, amount, vendor, expenseDate, taxDeductible, taxRate } = req.body as {
    category?: string; description?: string; amount?: number; vendor?: string; expenseDate?: string; taxDeductible?: boolean; taxRate?: number;
  };

  const upd: Partial<typeof expensesTable.$inferInsert> = { updatedAt: new Date() };
  if (category)    upd.category    = category;
  if (description) upd.description = description;
  if (amount !== undefined) upd.amount = String(amount);
  if (vendor !== undefined) upd.vendor = vendor;
  if (expenseDate) upd.expenseDate = new Date(expenseDate);
  if (taxDeductible !== undefined) upd.taxDeductible = taxDeductible;
  if (taxRate !== undefined) upd.taxRate = String(taxRate);

  await db.update(expensesTable).set(upd).where(and(eq(expensesTable.id, id), eq(expensesTable.orgId, orgId)));
  res.json({ ok: true });
});

// DELETE /api/accounting/expenses/:id
accountingRouter.delete("/expenses/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  await db.delete(expensesTable).where(and(eq(expensesTable.id, id), eq(expensesTable.orgId, orgId)));
  await logAudit({ actorClerkId: req.clerkUserId!, action: "expense_deleted", resource: "expense", resourceId: id, orgId, severity: "warning", req });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY / DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/summary
accountingRouter.get("/summary", requirePermission("accounting.read"), async (req, res) => {
  const orgId = req.orgId!;
  const now   = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear  = new Date(now.getFullYear(), 0, 1);

  // Invoice counts by status
  const invoiceStats = await db
    .select({ status: invoicesTable.status, cnt: count(), total: sum(invoicesTable.total) })
    .from(invoicesTable)
    .where(eq(invoicesTable.orgId, orgId))
    .groupBy(invoicesTable.status);

  // Overdue invoices (sent/partial, past due date) — count + total
  const overdueRows = await db
    .select({ cnt: count(), total: sum(invoicesTable.total) })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.orgId, orgId),
      or(eq(invoicesTable.status, "sent"), eq(invoicesTable.status, "partial")),
      sql`${invoicesTable.dueDate} < NOW()`,
    ));
  const overdueCount = Number(overdueRows[0]?.cnt ?? 0);
  const overdueTotal = parseFloat(String(overdueRows[0]?.total ?? 0));

  // Pending quotes (draft / sent but not converted)
  const [{ pendingQuotesCount }] = await db.execute(sql`
    SELECT COUNT(*)::int AS "pendingQuotesCount"
    FROM quotes
    WHERE org_id = ${orgId} AND status IN ('draft','sent')
  `) as unknown as [{ pendingQuotesCount: number }];

  // Revenue this month/year (payments received)
  const [{ monthRevenue }] = await db
    .select({ monthRevenue: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, startOfMonth)));

  const [{ yearRevenue }] = await db
    .select({ yearRevenue: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, startOfYear)));

  // Expenses this month/year
  const [{ monthExpenses }] = await db
    .select({ monthExpenses: sum(expensesTable.amount) })
    .from(expensesTable)
    .where(and(eq(expensesTable.orgId, orgId), gte(expensesTable.expenseDate, startOfMonth)));

  const [{ yearExpenses }] = await db
    .select({ yearExpenses: sum(expensesTable.amount) })
    .from(expensesTable)
    .where(and(eq(expensesTable.orgId, orgId), gte(expensesTable.expenseDate, startOfYear)));

  // Monthly revenue / expenses last 6 months (for chart)
  const monthlyRevenue = await db.execute(sql`
    SELECT DATE_TRUNC('month', paid_at) AS month, SUM(amount)::numeric AS revenue
    FROM accounting_payments
    WHERE org_id = ${orgId} AND paid_at >= NOW() - INTERVAL '6 months'
    GROUP BY 1 ORDER BY 1
  `);

  const monthlyExpenses = await db.execute(sql`
    SELECT DATE_TRUNC('month', expense_date) AS month, SUM(amount)::numeric AS amount
    FROM expenses
    WHERE org_id = ${orgId} AND expense_date >= NOW() - INTERVAL '6 months'
    GROUP BY 1 ORDER BY 1
  `);

  // Pending invoices total (not yet paid)
  const pendingTotal = invoiceStats
    .filter(s => ["draft", "sent", "partial"].includes(s.status))
    .reduce((acc, s) => acc + parseFloat(String(s.total ?? 0)), 0);

  const statusMap = Object.fromEntries(invoiceStats.map(s => [
    s.status,
    { count: Number(s.cnt), total: parseFloat(String(s.total ?? 0)) },
  ]));

  // IVA repercutido = IVA charged on sales invoices (21% by default on taxAmount)
  const [{ ivaRepercutido }] = await db
    .select({ ivaRepercutido: sum(invoicesTable.taxAmount) })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), gte(invoicesTable.createdAt, startOfYear)));

  // IVA soportado = IVA paid on expenses with a tax_rate > 0 (use stored rate per expense)
  const [{ ivaSoportado }] = await db.execute(sql`
    SELECT COALESCE(SUM(amount * tax_rate / 100), 0)::numeric AS "ivaSoportado"
    FROM expenses
    WHERE org_id = ${orgId} AND tax_rate > 0 AND expense_date >= ${startOfYear}
  `) as unknown as [{ ivaSoportado: string }];

  // Tasa de cobro = paid invoices / total invoiced this year
  const totalInvoiced = invoiceStats.reduce((acc, s) => acc + parseFloat(String(s.total ?? 0)), 0);
  const totalPaid     = parseFloat(String(statusMap["paid"]?.total ?? 0));
  const tasaCobro     = totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0;

  res.json({
    invoices: statusMap,
    overdueCount,
    overdueTotal,
    pendingTotal,
    pendingQuotesCount: Number(pendingQuotesCount ?? 0),
    tasaCobro,
    ivaRepercutido: parseFloat(String(ivaRepercutido ?? 0)),
    ivaSoportado:   parseFloat(String(ivaSoportado  ?? 0)),
    revenue: {
      thisMonth: parseFloat(String(monthRevenue  ?? 0)),
      thisYear:  parseFloat(String(yearRevenue   ?? 0)),
    },
    expenses: {
      thisMonth: parseFloat(String(monthExpenses ?? 0)),
      thisYear:  parseFloat(String(yearExpenses  ?? 0)),
    },
    profit: {
      thisMonth: parseFloat(String(monthRevenue  ?? 0)) - parseFloat(String(monthExpenses ?? 0)),
      thisYear:  parseFloat(String(yearRevenue   ?? 0)) - parseFloat(String(yearExpenses  ?? 0)),
    },
    charts: {
      monthlyRevenue:  (monthlyRevenue  as { rows: { month: string; revenue: string }[] }).rows.map(r => ({
        month: r.month, revenue: parseFloat(r.revenue ?? "0"),
      })),
      monthlyExpenses: (monthlyExpenses as { rows: { month: string; amount: string }[] }).rows.map(r => ({
        month: r.month, amount: parseFloat(r.amount ?? "0"),
      })),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECURRING INVOICES
// ═══════════════════════════════════════════════════════════════════════════════

interface RecurringItem { description: string; quantity: number; unitPrice: number; }

function calcRecurringTotal(items: RecurringItem[], taxRate: number): number {
  const sub = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  return parseFloat((sub + sub * taxRate / 100).toFixed(2));
}

// GET /api/accounting/recurring
accountingRouter.get("/recurring", requirePermission("accounting.read"), async (req, res) => {
  const orgId  = req.orgId!;
  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);

  const rows = await db.execute(sql`
    SELECT
      r.id, r.org_id, r.client_id, r.description, r.frequency,
      r.currency, r.tax_rate, r.items, r.is_active, r.send_on_create,
      r.next_run_at, r.last_run_at, r.created_at,
      c.name AS client_name
    FROM recurring_invoices r
    LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
    WHERE r.org_id = ${orgId}
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as { rows: Array<{
    id: number; org_id: number; client_id: number | null; description: string;
    frequency: string; currency: string; tax_rate: string;
    items: RecurringItem[]; is_active: boolean; send_on_create: boolean;
    next_run_at: string; last_run_at: string | null; created_at: string;
    client_name: string | null;
  }> };

  const cntResult = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM recurring_invoices WHERE org_id = ${orgId}`);
  const cntRow = (cntResult as unknown as { rows: Array<{ cnt: number }> }).rows[0];
  const cnt = cntRow?.cnt ?? 0;

  res.json({
    recurring: rows.rows.map(r => {
      const items = Array.isArray(r.items) ? r.items : JSON.parse(String(r.items || "[]"));
      const taxRate = parseFloat(r.tax_rate ?? "21");
      return {
        id: r.id, orgId: r.org_id, clientId: r.client_id, clientName: r.client_name,
        description: r.description, frequency: r.frequency, currency: r.currency,
        taxRate, items, isActive: r.is_active, sendOnCreate: r.send_on_create,
        nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, createdAt: r.created_at,
        total: calcRecurringTotal(items, taxRate),
      };
    }),
    total: cnt ?? 0, limit, offset,
  });
});

// POST /api/accounting/recurring
accountingRouter.post("/recurring", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const {
    clientId, description, frequency = "monthly", currency = "EUR",
    taxRate = 21, items = [], sendOnCreate = false, nextRunAt,
  } = req.body as {
    clientId?: number; description: string; frequency?: string; currency?: string;
    taxRate?: number; items?: RecurringItem[]; sendOnCreate?: boolean; nextRunAt: string;
  };

  if (!description?.trim()) { res.status(400).json({ error: "Descripción requerida" }); return; }
  if (!nextRunAt) { res.status(400).json({ error: "next_run_at requerido" }); return; }

  if (clientId) {
    const [cl] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
    if (!cl) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  }

  await db.execute(sql`
    INSERT INTO recurring_invoices
      (org_id, client_id, description, frequency, currency, tax_rate, items, is_active, send_on_create, next_run_at)
    VALUES
      (${orgId}, ${clientId ?? null}, ${description.trim()}, ${frequency}, ${currency},
       ${taxRate}, ${JSON.stringify(items)}::jsonb, TRUE, ${sendOnCreate}, ${new Date(nextRunAt).toISOString()})
  `);

  await logAudit({ actorClerkId: req.clerkUserId!, action: "recurring_invoice_created", resource: "recurring_invoice", resourceId: 0, orgId, details: { description, frequency }, req });
  res.status(201).json({ ok: true });
});

// PATCH /api/accounting/recurring/:id — toggle active or update nextRunAt
accountingRouter.patch("/recurring/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin", "manager"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  const { isActive, nextRunAt } = req.body as { isActive?: boolean; nextRunAt?: string };

  const existing = await db.execute(sql`SELECT id FROM recurring_invoices WHERE id = ${id} AND org_id = ${orgId} LIMIT 1`) as unknown as { rows: unknown[] };
  if (!existing.rows.length) { res.status(404).json({ error: "No encontrado" }); return; }

  if (typeof isActive === "boolean") {
    await db.execute(sql`UPDATE recurring_invoices SET is_active = ${isActive}, updated_at = NOW() WHERE id = ${id} AND org_id = ${orgId}`);
  }
  if (nextRunAt) {
    await db.execute(sql`UPDATE recurring_invoices SET next_run_at = ${new Date(nextRunAt).toISOString()}, updated_at = NOW() WHERE id = ${id} AND org_id = ${orgId}`);
  }

  await logAudit({ actorClerkId: req.clerkUserId!, action: "recurring_invoice_updated", resource: "recurring_invoice", resourceId: id, orgId, details: { isActive, nextRunAt }, req });
  res.json({ ok: true });
});

// DELETE /api/accounting/recurring/:id
accountingRouter.delete("/recurring/:id", requirePermission("accounting.write"), async (req, res) => {
  if (!checkRole(req, res, ["owner", "admin"])) return;
  const orgId = req.orgId!;
  const id    = Number(req.params["id"]);
  await db.execute(sql`DELETE FROM recurring_invoices WHERE id = ${id} AND org_id = ${orgId}`);
  await logAudit({ actorClerkId: req.clerkUserId!, action: "recurring_invoice_deleted", resource: "recurring_invoice", resourceId: id, orgId, details: {}, req });
  res.json({ ok: true });
});
