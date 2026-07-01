/**
 * Recurring Invoice Scheduler
 * Runs every 15 minutes. Finds active recurring templates whose next_run_at
 * has passed, generates a real invoice, then advances next_run_at.
 */
import cron from "node-cron";
import { db } from "@workspace/db";
import { invoicesTable, invoiceItemsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let started = false;

// ── Date helpers ──────────────────────────────────────────────────────────────
function advanceDate(base: Date, frequency: string): Date {
  const next = new Date(base);
  switch (frequency) {
    case "weekly":    next.setDate(next.getDate() + 7);  break;
    case "bimonthly": next.setDate(next.getDate() + 14); break;
    case "quarterly": next.setMonth(next.getMonth() + 3); break;
    case "yearly":    next.setFullYear(next.getFullYear() + 1); break;
    case "monthly":
    default:          next.setMonth(next.getMonth() + 1); break;
  }
  return next;
}

// ── Invoice number helper (isolated copy to avoid circular import) ────────────
async function nextInvoiceNumber(orgId: number): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM invoices
    WHERE org_id = ${orgId} AND created_at >= ${`${year}-01-01`}::timestamp
  `) as unknown as { rows: Array<{ cnt: number }> };
  const seq = String(((row as unknown as { rows: Array<{ cnt: number }> }).rows?.[0]?.cnt ?? 0) + 1).padStart(4, "0");
  return `F${year}-${seq}`;
}

interface RecurringRow {
  id: number;
  org_id: number;
  client_id: number | null;
  description: string;
  frequency: string;
  currency: string;
  tax_rate: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  send_on_create: boolean;
  next_run_at: string;
}

async function processDueTemplates(): Promise<void> {
  const result = await db.execute(sql`
    SELECT id, org_id, client_id, description, frequency, currency, tax_rate, items, send_on_create, next_run_at
    FROM recurring_invoices
    WHERE is_active = TRUE AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    LIMIT 50
  `);
  const rows = (result as { rows: RecurringRow[] }).rows;
  if (!rows.length) return;

  logger.info(`[RecurringInvoices] Processing ${rows.length} due template(s)…`);

  for (const tmpl of rows) {
    try {
      const taxRate = parseFloat(tmpl.tax_rate ?? "21");
      const items   = Array.isArray(tmpl.items) ? tmpl.items : JSON.parse(String(tmpl.items) || "[]");
      const subtotal = items.reduce((s: number, i: { quantity: number; unitPrice: number }) =>
        s + (Number(i.quantity) * Number(i.unitPrice)), 0);
      const taxAmount = parseFloat(((subtotal * taxRate) / 100).toFixed(2));
      const total     = parseFloat((subtotal + taxAmount).toFixed(2));

      const invoiceNumber = await nextInvoiceNumber(tmpl.org_id);
      const status = tmpl.send_on_create ? "sent" : "draft";

      // Calculate due date (30 days from today)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const [inv] = await db.insert(invoicesTable).values({
        orgId:              tmpl.org_id,
        clientId:           tmpl.client_id,
        invoiceNumber,
        status,
        currency:           tmpl.currency,
        subtotal:           String(parseFloat(subtotal.toFixed(2))),
        taxRate:            String(taxRate),
        taxAmount:          String(taxAmount),
        total:              String(total),
        notes:              `Generada automáticamente desde plantilla recurrente: ${tmpl.description}`,
        dueDate,
        recurringInvoiceId: tmpl.id,
      }).returning();

      if (inv && items.length) {
        await db.insert(invoiceItemsTable).values(
          items.map((item: { description: string; quantity: number; unitPrice: number }, idx: number) => ({
            invoiceId:   inv.id,
            description: item.description,
            quantity:    String(Number(item.quantity)),
            unitPrice:   String(Number(item.unitPrice)),
            total:       String(parseFloat((Number(item.quantity) * Number(item.unitPrice)).toFixed(2))),
            orderIndex:  idx,
          }))
        );
      }

      const nextRunAt = advanceDate(new Date(tmpl.next_run_at), tmpl.frequency);

      await db.execute(sql`
        UPDATE recurring_invoices
        SET last_run_at = NOW(), next_run_at = ${nextRunAt.toISOString()}, updated_at = NOW()
        WHERE id = ${tmpl.id}
      `);

      logger.info(`[RecurringInvoices] ✅ Generated ${invoiceNumber} (org=${tmpl.org_id}, template=${tmpl.id})`);
    } catch (err) {
      logger.error({ err, templateId: tmpl.id }, "[RecurringInvoices] ❌ Failed to generate invoice");
    }
  }
}

export function startRecurringInvoiceScheduler(): void {
  if (started) return;
  started = true;

  // Run at startup to catch any missed windows
  processDueTemplates().catch(err =>
    logger.error({ err }, "[RecurringInvoices] startup run failed")
  );

  // Then every 15 minutes
  cron.schedule("*/15 * * * *", () => {
    processDueTemplates().catch(err =>
      logger.error({ err }, "[RecurringInvoices] scheduled run failed")
    );
  });

  logger.info("[RecurringInvoices] Scheduler started (every 15 min)");
}
