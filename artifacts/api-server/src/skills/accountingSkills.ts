// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Accounting Skills
//  Invoice, payment, and financial summary actions
// ═══════════════════════════════════════════════════════════════════════════

import {
  db,
  clientsTable,
  invoicesTable,
  invoiceItemsTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, inArray, sum, count, gte, sql } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function findClient(
  orgId: number,
  clientName: string,
  context: SkillContext,
) {
  if (context.client) {
    const [c] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), eq(clientsTable.id, context.client.id)));
    return c ?? undefined;
  }
  const matched = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
    .limit(5);
  return matched[0];
}

// ── create_invoice ──────────────────────────────────────────────────────────

async function createInvoice(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const clientName = String(params["client_name"] ?? "");
  const rawItems = (params["items"] as { description: string; quantity: number; unit_price: number }[]) ?? [];
  const taxRate = Number(params["tax_rate"] ?? 21);
  const notes = params["notes"] ? String(params["notes"]) : null;
  const dueDateStr = params["due_date"] ? String(params["due_date"]) : null;

  if (!clientName || rawItems.length === 0) {
    return JSON.stringify({ error: "Se necesita client_name y al menos un ítem." });
  }

  const client = await findClient(orgId, clientName, context);
  if (!client) {
    return JSON.stringify({ error: `No encontré el cliente "${clientName}".` });
  }

  const lineItems = rawItems.map((item, idx) => ({
    description: item.description,
    quantity: Number(item.quantity) || 1,
    unitPrice: Number(item.unit_price) || 0,
    total: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
    orderIndex: idx,
  }));
  const subtotal = lineItems.reduce((acc, i) => acc + i.total, 0);
  const taxAmount = parseFloat(((subtotal * taxRate) / 100).toFixed(2));
  const total = parseFloat((subtotal + taxAmount).toFixed(2));

  const year = new Date().getFullYear();
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), gte(invoicesTable.createdAt, new Date(`${year}-01-01`))));
  const invoiceNumber = `F${year}-${String(Number(cnt ?? 0) + 1).padStart(4, "0")}`;

  const [inv] = await db
    .insert(invoicesTable)
    .values({
      orgId,
      clientId: client.id,
      invoiceNumber,
      status: "draft",
      currency: "EUR",
      subtotal: String(subtotal),
      taxRate: String(taxRate),
      taxAmount: String(taxAmount),
      total: String(total),
      notes,
      dueDate: dueDateStr ? new Date(dueDateStr) : null,
    })
    .returning();

  if (!inv) {
    return JSON.stringify({ error: "Error al crear la factura en la base de datos." });
  }

  await db.insert(invoiceItemsTable).values(
    lineItems.map((item) => ({
      invoiceId: inv.id,
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      total: String(parseFloat(item.total.toFixed(2))),
      orderIndex: item.orderIndex,
    })),
  );

  return JSON.stringify({
    success: true,
    dbVerified: true,
    invoiceId: inv.id,
    invoiceNumber,
    clientName: client.name,
    clientCompany: client.company ?? null,
    total,
    taxRate,
    taxAmount,
    subtotal,
    status: "draft",
    items: lineItems.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: parseFloat(i.total.toFixed(2)),
    })),
    message: `Factura ${invoiceNumber} creada en borrador para ${client.name} — ${fmt(total)}.`,
  });
}

// ── get_invoice ───────────────────────────────────────────────────────────

async function getInvoice(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const invoiceNumber = params["invoice_number"] ? String(params["invoice_number"]) : null;
  const invoiceId = params["invoice_id"] ? Number(params["invoice_id"]) : null;

  if (!invoiceNumber && !invoiceId) {
    return JSON.stringify({ error: "Se necesita invoice_number o invoice_id." });
  }

  const conditions = [eq(invoicesTable.orgId, orgId)];
  if (invoiceNumber) conditions.push(eq(invoicesTable.invoiceNumber, invoiceNumber));
  if (invoiceId) conditions.push(eq(invoicesTable.id, invoiceId));

  const [inv] = await db.select().from(invoicesTable).where(and(...conditions));
  if (!inv) return JSON.stringify({ error: "Factura no encontrada." });

  const items = await db
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, inv.id));
  const invPayments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.invoiceId, inv.id));
  const client = inv.clientId
    ? await db
        .select({ name: clientsTable.name, company: clientsTable.company })
        .from(clientsTable)
        .where(eq(clientsTable.id, inv.clientId))
        .then((r) => r[0] ?? null)
    : null;

  const totalPaid = invPayments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return JSON.stringify({
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    client: client?.name ?? null,
    company: client?.company ?? null,
    total: parseFloat(String(inv.total)),
    totalPaid,
    balance: parseFloat(String(inv.total)) - totalPaid,
    dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("es-ES") : null,
    paidAt: inv.paidAt ? new Date(inv.paidAt).toLocaleDateString("es-ES") : null,
    items: items.map((i) => ({
      description: i.description,
      quantity: parseFloat(String(i.quantity)),
      unitPrice: parseFloat(String(i.unitPrice)),
      total: parseFloat(String(i.total)),
    })),
  });
}

// ── list_pending_invoices ─────────────────────────────────────────────────

async function listPendingInvoices(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const includeOverdue = params["include_overdue"] === true;
  const limit = Math.min(Number(params["limit"] ?? 20), 50);

  const statusFilter = includeOverdue ? ["sent", "partial"] : ["draft", "sent", "partial"];

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      total: invoicesTable.total,
      dueDate: invoicesTable.dueDate,
      clientName: clientsTable.name,
    })
    .from(invoicesTable)
    .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
    .where(
      and(
        eq(invoicesTable.orgId, orgId),
        inArray(invoicesTable.status, statusFilter),
        ...(includeOverdue ? [sql`${invoicesTable.dueDate} < NOW()`] : []),
      ),
    )
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limit);

  const pendingTotal = rows.reduce((s, r) => s + parseFloat(String(r.total)), 0);

  return JSON.stringify({
    count: rows.length,
    pendingTotal: Math.round(pendingTotal * 100) / 100,
    invoices: rows.map((r) => ({
      invoiceNumber: r.invoiceNumber,
      client: r.clientName ?? "Sin cliente",
      total: parseFloat(String(r.total)),
      status: r.status,
      dueDate: r.dueDate ? new Date(r.dueDate).toLocaleDateString("es-ES") : null,
      overdue: r.dueDate ? new Date(r.dueDate) < new Date() : false,
    })),
    message:
      rows.length === 0
        ? "No hay facturas pendientes."
        : `Hay ${rows.length} factura${rows.length !== 1 ? "s" : ""} pendiente${rows.length !== 1 ? "s" : ""} por un total de ${fmt(pendingTotal)}.`,
  });
}

// ── register_payment ──────────────────────────────────────────────────────

async function registerPayment(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const invoiceNumber = String(params["invoice_number"] ?? "");
  const amount = Number(params["amount"] ?? 0);
  const method = String(params["method"] ?? "transfer");
  const reference = params["reference"] ? String(params["reference"]) : null;

  if (!invoiceNumber || amount <= 0) {
    return JSON.stringify({ error: "Se necesitan invoice_number y amount > 0." });
  }

  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.invoiceNumber, invoiceNumber), eq(invoicesTable.orgId, orgId)));
  if (!inv) return JSON.stringify({ error: `Factura "${invoiceNumber}" no encontrada.` });

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      orgId,
      invoiceId: inv.id,
      clientId: inv.clientId ?? null,
      amount: String(amount),
      currency: "EUR",
      method,
      reference,
      paidAt: new Date(),
    })
    .returning();

  const [{ totalPaid }] = await db
    .select({ totalPaid: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(eq(paymentsTable.invoiceId, inv.id));
  const paid = parseFloat(String(totalPaid ?? 0));
  const invTotal = parseFloat(String(inv.total));
  let newStatus = inv.status;

  if (paid >= invTotal) {
    await db
      .update(invoicesTable)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(invoicesTable.id, inv.id));
    newStatus = "paid";
  } else if (paid > 0) {
    await db
      .update(invoicesTable)
      .set({ status: "partial", updatedAt: new Date() })
      .where(eq(invoicesTable.id, inv.id));
    newStatus = "partial";
  }

  return JSON.stringify({
    success: true,
    paymentId: payment!.id,
    invoiceNumber,
    amount,
    paid,
    balance: Math.max(0, invTotal - paid),
    invoiceStatus: newStatus,
    message:
      newStatus === "paid"
        ? `Pago de ${fmt(amount)} registrado. La factura ${invoiceNumber} queda completamente pagada.`
        : `Pago parcial de ${fmt(amount)} registrado. Quedan ${fmt(invTotal - paid)} pendientes en ${invoiceNumber}.`,
  });
}

// ── get_client_debt ─────────────────────────────────────────────────────────

async function getClientDebt(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const clientName = String(params["client_name"] ?? "");
  if (!clientName) return JSON.stringify({ error: "Se necesita client_name." });

  const matched = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientName}%`)))
    .limit(3);
  if (matched.length === 0) return JSON.stringify({ error: `No encontré el cliente "${clientName}".` });
  const client = matched[0]!;

  const invoices = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      total: invoicesTable.total,
      status: invoicesTable.status,
      dueDate: invoicesTable.dueDate,
    })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.orgId, orgId),
        eq(invoicesTable.clientId, client.id),
        inArray(invoicesTable.status, ["draft", "sent", "partial"]),
      ),
    );

  const totalDebt = invoices.reduce((s, i) => s + parseFloat(String(i.total)), 0);

  return JSON.stringify({
    clientName: client.name,
    totalDebt,
    pendingInvoices: invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      total: parseFloat(String(i.total)),
      status: i.status,
      overdue: i.dueDate ? new Date(i.dueDate) < new Date() : false,
    })),
    message:
      invoices.length === 0
        ? `${client.name} no tiene facturas pendientes.`
        : `${client.name} tiene una deuda pendiente de ${fmt(totalDebt)} en ${invoices.length} factura${invoices.length !== 1 ? "s" : ""}.`,
  });
}

// ── get_monthly_income ────────────────────────────────────────────────────

async function getMonthlyIncome(
  params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const period = String(params["period"] ?? "this_month");
  const now = new Date();
  const startDate =
    period === "this_year"
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodLabel = period === "this_year" ? "este año" : "este mes";

  const [{ revenue }] = await db
    .select({ revenue: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, startDate)));

  const [expRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(amount),0)::numeric AS expenses
    FROM expenses
    WHERE org_id = ${orgId} AND expense_date >= ${startDate}
  `)) as unknown as [{ expenses: string }];

  const rev = parseFloat(String(revenue ?? 0));
  const exp = parseFloat(String(expRow?.expenses ?? 0));
  const profit = rev - exp;

  return JSON.stringify({
    period: periodLabel,
    revenue: rev,
    expenses: exp,
    profit,
    message: `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}: Ingresos ${fmt(rev)} · Gastos ${fmt(exp)} · Beneficio ${fmt(profit)}.`,
  });
}

// ── accounting_summary ─────────────────────────────────────────────────────

async function accountingSummary(
  _params: Record<string, unknown>,
  orgId: number,
): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Pending totals
  const pendingRows = await db
    .select({ total: invoicesTable.total })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), inArray(invoicesTable.status, ["draft", "sent", "partial"])));
  const pendingTotal = pendingRows.reduce((s, r) => s + parseFloat(String(r.total)), 0);

  // Overdue count
  const [{ overdueCount }] = await db
    .select({ overdueCount: count() })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.orgId, orgId),
        inArray(invoicesTable.status, ["sent", "partial"]),
        sql`${invoicesTable.dueDate} < NOW()`,
      ),
    );

  // This month revenue
  const [{ monthRevenue }] = await db
    .select({ monthRevenue: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, monthStart)));

  // This year revenue
  const [{ yearRevenue }] = await db
    .select({ yearRevenue: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, orgId), gte(paymentsTable.paidAt, yearStart)));

  // Paid invoices count
  const [{ paidCount }] = await db
    .select({ paidCount: count() })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.orgId, orgId), eq(invoicesTable.status, "paid")));

  return JSON.stringify({
    pendingTotal: Math.round(pendingTotal * 100) / 100,
    overdueCount: Number(overdueCount ?? 0),
    thisMonthRevenue: parseFloat(String(monthRevenue ?? 0)),
    thisYearRevenue: parseFloat(String(yearRevenue ?? 0)),
    paidInvoicesCount: Number(paidCount ?? 0),
    message: `Resumen contable: ${fmt(pendingTotal)} pendientes · ${overdueCount ?? 0} vencidas · ${fmt(parseFloat(String(monthRevenue ?? 0)))} cobrado este mes · ${fmt(parseFloat(String(yearRevenue ?? 0)))} acumulado anual.`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skill exports
// ═══════════════════════════════════════════════════════════════════════════

export const createInvoiceSkill: SkillDefinition = {
  id: "create_invoice",
  name: "Crear Factura",
  description:
    "Crea una factura real en el módulo de contabilidad. " +
    "Úsala cuando el usuario diga 'crear factura', 'emitir factura', 'facturar a', etc.",
  params: [
    { name: "client_name", type: "string", description: "Nombre del cliente", required: true },
    { name: "items", type: "array", description: "Array de {description, quantity, unit_price}", required: true },
    { name: "tax_rate", type: "number", description: "Porcentaje de IVA", default: 21 },
    { name: "notes", type: "string", description: "Notas adicionales", required: false },
    { name: "due_date", type: "string", description: "Fecha de vencimiento YYYY-MM-DD", required: false },
  ],
  execute: createInvoice,
};

export const getInvoiceSkill: SkillDefinition = {
  id: "get_invoice",
  name: "Ver Factura",
  description: "Obtiene el detalle de una factura por número o ID.",
  params: [
    { name: "invoice_number", type: "string", description: "Número de factura ej: F2026-0001", required: false },
    { name: "invoice_id", type: "number", description: "ID numérico de la factura", required: false },
  ],
  execute: getInvoice,
};

export const listPendingInvoicesSkill: SkillDefinition = {
  id: "list_pending_invoices",
  name: "Facturas Pendientes",
  description: "Lista facturas pendientes de cobro. Úsala para '¿qué me deben?', '¿cuánto tengo por cobrar?'.",
  params: [
    { name: "include_overdue", type: "boolean", description: "Solo vencidas", default: false },
    { name: "limit", type: "number", description: "Máximo resultados", default: 20 },
  ],
  execute: listPendingInvoices,
};

export const registerPaymentSkill: SkillDefinition = {
  id: "register_payment",
  name: "Registrar Pago",
  description: "Registra un pago contra una factura existente. La marca como pagada automáticamente.",
  params: [
    { name: "invoice_number", type: "string", description: "Número de factura", required: true },
    { name: "amount", type: "number", description: "Importe recibido", required: true },
    { name: "method", type: "string", description: "transfer, card, cash, check, other", default: "transfer" },
    { name: "reference", type: "string", description: "Referencia bancaria", required: false },
  ],
  execute: registerPayment,
};

export const getClientDebtSkill: SkillDefinition = {
  id: "get_client_debt",
  name: "Deuda Cliente",
  description: "Obtiene la deuda pendiente de un cliente.",
  params: [
    { name: "client_name", type: "string", description: "Nombre del cliente", required: true },
  ],
  execute: getClientDebt,
};

export const getMonthlyIncomeSkill: SkillDefinition = {
  id: "get_monthly_income",
  name: "Ingresos Mensuales",
  description: "Resumen de ingresos, gastos y beneficio del mes o año actual.",
  params: [
    { name: "period", type: "string", description: "this_month o this_year", default: "this_month" },
  ],
  execute: getMonthlyIncome,
};

export const accountingSummarySkill: SkillDefinition = {
  id: "accounting_summary",
  name: "Resumen Contable",
  description:
    "Devuelve un resumen financiero: total pendiente, facturas vencidas, ingresos del mes, acumulado anual. " +
    "Úsala para '¿cómo van las cuentas?', 'resumen contable', 'balance financiero'.",
  params: [],
  execute: accountingSummary,
};
