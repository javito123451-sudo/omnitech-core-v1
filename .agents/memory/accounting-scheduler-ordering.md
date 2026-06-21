---
name: Accounting scheduler ordering
description: Recurring invoice scheduler must start after DB migrations finish — table created in FIX-H.
---

The `startRecurringInvoiceScheduler()` call must be chained after `runStartupMigrations()` resolves, not called in parallel with it. The `recurring_invoices` table is created in FIX-H (a startup migration), so calling the scheduler before FIX-H runs causes a "relation does not exist" error on the startup probe run.

**Why:** `runStartupMigrations()` is fire-and-forget (`.catch(() => {})`). If you call `startRecurringInvoiceScheduler()` on the next line, Node.js starts both concurrently — the scheduler's immediate probe runs before the migration creates the table.

**How to apply:** Chain it with `.finally()`:
```ts
runStartupMigrations()
  .catch(() => {})
  .finally(() => { startRecurringInvoiceScheduler(); });
```
Any future scheduler that depends on a table created in a FIX-* migration must follow the same pattern.
