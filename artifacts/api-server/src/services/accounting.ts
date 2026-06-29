// ═══════════════════════════════════════════════════════════════════════════
//  Accounting Service — Shared business logic
//  Used by both REST endpoints (with HTTP guards) and Ava V2 skills (with
//  module + role gating in executeCrmTool). Both layers must add their
//  own audit trail (logAudit with req for endpoints, logAuditSystem for
//  skills).
// ═══════════════════════════════════════════════════════════════════════════

import {
  db,
  invoicesTable,
  invoiceItemsTable,
  paymentsTable,
  clientsTable,
} from "@workspace/db";
import { eq, and, gte, count, sum } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────

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
    .orderBy(paymentsTable.paidAt);

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

// ── Create Invoice (core — no guards, no audit) ──────────────────────────

export interface CreateInvoiceInput {
  orgId: number;
  clientId?: number | null;
  quoteId?: number | null;
  currency?: string;
  taxRate?: number;
  notes?: string | null;
  dueDate?: string | null;
  items: { description: string; quantity: number; unitPrice: number }[];
}

export interface CreatedInvoiceResult {
  invoice: ReturnType<typeof enrichInvoice> extends Promise<infer T> ? T : never;
  invoiceNumber: string;
  total: number;
}

export async function createInvoiceCore(input: CreateInvoiceInput): Promise<CreatedInvoiceResult> {
  const { orgId, clientId, quoteId, currency = "EUR", taxRate = 21, notes, dueDate, items } = input;
  const { subtotal, taxAmount, total } = calcTotals(items, taxRate);
  const invoiceNumber = await nextInvoiceNumber(orgId);

  const [inv] = await db.insert(invoicesTable).values({
    orgId,
    clientId: clientId ?? null,
    quoteId: quoteId ?? null,
    invoiceNumber,
    status: "draft",
    currency,
    subtotal: String(subtotal),
    taxRate: String(taxRate),
    taxAmount: String(taxAmount),
    total: String(total),
    notes: notes ?? null,
    dueDate: dueDate ? new Date(dueDate) : null,
  }).returning();

  await db.insert(invoiceItemsTable).values(
    items.map((item, idx) => ({
      invoiceId: inv!.id,
      description: item.description,
      quantity:  String(item.quantity),
      unitPrice: String(item.unitPrice),
      total:     String(parseFloat((item.quantity * item.unitPrice).toFixed(2))),
      orderIndex: idx,
    })),
  );

  const enriched = await enrichInvoice(inv!);
  return { invoice: enriched, invoiceNumber, total };
}

// ── Register Payment (core — no guards, no audit) ──────────────────────────

export interface RegisterPaymentInput {
  orgId: number;
  invoiceId?: number | null;
  clientId?: number | null;
  amount: number;
  currency?: string;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  paidAt?: string | null;
}

export interface RegisteredPaymentResult {
  payment: typeof paymentsTable.$inferSelect;
  invoiceStatus: string;
  invoiceId?: number;
  totalPaid: number;
  balance: number;
}

export async function registerPaymentCore(input: RegisterPaymentInput): Promise<RegisteredPaymentResult> {
  const { orgId, invoiceId, clientId, amount, currency = "EUR", method = "transfer", reference, notes, paidAt } = input;

  const [payment] = await db.insert(paymentsTable).values({
    orgId,
    invoiceId: invoiceId ?? null,
    clientId: clientId ?? null,
    amount: String(amount),
    currency,
    method,
    reference: reference ?? null,
    notes: notes ?? null,
    paidAt: paidAt ? new Date(paidAt) : new Date(),
  }).returning();

  // Auto-advance invoice status
  let newStatus = "draft";
  let totalPaid = 0;
  let balance = 0;
  if (invoiceId) {
    const [inv] = await db.select().from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.orgId, orgId)));
    if (inv) {
      const [{ totalPaidAgg }] = await db
        .select({ totalPaidAgg: sum(paymentsTable.amount) })
        .from(paymentsTable)
        .where(eq(paymentsTable.invoiceId, invoiceId));
      totalPaid = parseFloat(String(totalPaidAgg ?? 0));
      const invTotal = parseFloat(String(inv.total));
      balance = Math.max(0, invTotal - totalPaid);

      if (totalPaid >= invTotal) {
        await db.update(invoicesTable)
          .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
          .where(eq(invoicesTable.id, invoiceId));
        newStatus = "paid";
      } else if (totalPaid > 0) {
        await db.update(invoicesTable)
          .set({ status: "partial", updatedAt: new Date() })
          .where(eq(invoicesTable.id, invoiceId));
        newStatus = "partial";
      } else {
        newStatus = inv.status;
      }
    }
  }

  return { payment: payment!, invoiceStatus: newStatus, invoiceId, totalPaid, balance };
}

// ── Validate ownership (orgId must match) ────────────────────────────────

export async function verifyClientOrg(clientId: number, orgId: number): Promise<boolean> {
  const [cl] = await db.select({ id: clientsTable.id }).from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.orgId, orgId)));
  return !!cl;
}

export async function verifyInvoiceOrg(invoiceId: number, orgId: number): Promise<boolean> {
  const [inv] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.orgId, orgId)));
  return !!inv;
}
