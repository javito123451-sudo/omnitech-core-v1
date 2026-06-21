---
name: Omni Accounting Suite
description: Full accounting module — tables, API, PDF, frontend. Module slug omni_accounting.
---

# Omni Accounting Suite

## Tables (created via startupMigrations FIX-D)
- `invoices` — header: org_id, client_id, quote_id, invoice_number, status, currency, subtotal/tax/total, due_date, paid_at
- `invoice_items` — lines: invoice_id, description, quantity, unit_price, total, order_index  
- `accounting_payments` — payments: org_id, invoice_id, client_id, amount, currency, method, reference, paid_at
- `credit_notes` — NC: org_id, invoice_id, note_number, amount, reason, status
- `expenses` — org_id, category, description, amount, vendor, expense_date, tax_deductible

## API (`/api/accounting`, requireModule("omni_accounting"))
- `invoices` — full CRUD + GET /:id/pdf + POST /quotes/:id/to-invoice
- `payments` — GET/POST/DELETE; auto-marks invoice paid/partial when totalPaid >= total
- `credit-notes` — GET/POST/PATCH (status: issued→applied→cancelled)
- `expenses` — GET/POST/PATCH/DELETE with category filter
- `summary` — KPIs + 6-month chart data for dashboard

## PDF
- `utils/pdf-invoice.ts` — mirrors pdf-quote.ts pattern, cyan color scheme, status-aware (green=paid, red=overdue)

## Frontend (`/accounting`, ModuleGuard omni_accounting)
- `pages/accounting/index.tsx` — tab controller (dashboard/invoices/payments/expenses/credit-notes)
- `pages/accounting/Dashboard.tsx` — KPI cards + recharts AreaChart (revenue vs expenses 6mo) + invoice status panel
- `pages/accounting/InvoicesList.tsx` — table with status filter, search, PDF download
- `pages/accounting/InvoiceModal.tsx` — create invoice form + quick "from quote" shortcut
- `pages/accounting/InvoiceDetail.tsx` — full detail: items, payments history, balance, status actions, register payment modal
- `pages/accounting/PaymentsList.tsx` — payments log table
- `pages/accounting/ExpensesList.tsx` — expenses with category filter + modal
- `pages/accounting/CreditNotesList.tsx` — credit notes with apply action

## Sidebar
- "Finanzas" group added in MainLayout.tsx with Receipt icon, moduleKey=omni_accounting
- moreItems entry for mobile drawer

**Why:** Module must be enabled per-org in Control Center > Modules before sidebar item appears.
