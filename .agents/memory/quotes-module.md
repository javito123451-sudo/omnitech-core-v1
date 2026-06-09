---
name: Quotes module
description: Full quotes/presupuestos module implementation details and gotchas
---

## Tables
- `quotes`: id, orgId, clientId, title, description, status, subtotal, taxRate, total, validUntil, notes, quoteNumber, createdAt
- `quote_items`: id, quoteId, description, quantity, unitPrice, total, orderIndex

## API
- `GET/POST/PATCH/DELETE /api/quotes` — CRUD
- `PATCH /api/quotes/:id/status` — change status
- `GET /api/quotes/:id/pdf` — streaming PDF download (pdfkit, externalized in esbuild)

## Frontend
- `/quotes` route, sidebar item with FileText icon
- List + filter + create/edit/view modals + PDF download button

## AI tool
- `create_quote` in chat.ts — fuzzy client search, DB insert, activity log
- Emits SSE event `quote_created` after successful creation

## Gotcha
- pdfkit and fontkit must be externalized in build.mjs or esbuild crashes at runtime due to @swc/helpers

**Why:** fontkit uses dynamic requires that esbuild can't bundle safely.
