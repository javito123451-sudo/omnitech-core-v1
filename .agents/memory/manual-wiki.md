---
name: Manual wiki module
description: /manual wiki implementation — tables, routes, frontend, access control
---

# Manual Wiki Module

## DB Tables (created via direct SQL)
- `docs_pages`: slug (unique), title, chapter_order, content (markdown), is_published, updated_by_clerk_id, updated_by_email, current_version
- `docs_versions`: page_slug, version_number, content, author_clerk_id, author_email, change_note

## Backend
- Route file: `artifacts/api-server/src/routes/docs.ts`
- Registered in routes/index.ts AFTER `requireAuth, resolveOrg` middleware (docs uses requireAuth but NOT resolveOrg — docs are platform-wide, not org-scoped)
- Endpoints: GET /api/docs, GET /api/docs/search?q=, GET /api/docs/:slug, PUT /api/docs/:slug, GET /api/docs/:slug/versions, POST /api/docs/:slug/restore/:version
- Edit permission check: `req.platformRoles` includes SUPER_ADMIN or STAFF_OMNITECH

**Why:** docs are global documentation, not per-workspace — they don't need org isolation.

## Frontend
- Layout: `artifacts/omniflow/src/components/layout/ManualLayout.tsx` — fixed sidebar, search bar with debounce, dark/light mode toggle, breadcrumbs, edit button
- Pages: `artifacts/omniflow/src/pages/manual/index.tsx` (home grid), `artifacts/omniflow/src/pages/manual/chapter.tsx` (markdown render + editor + version history)
- Routes in App.tsx: /manual (ProtectedRoute), /manual/:slug (ProtectedRoute)
- Sidebar link added to MainLayout.tsx (Sistema group + moreItems) using `Library` icon from lucide-react
- Markdown rendered inline (no external lib) — custom parseMarkdown() in chapter.tsx handles h1-h6, lists, tables, blockquotes, code, bold, italic, checkboxes

## 13 Chapters Seeded
inicio, operaciones-diarias, control-center, crm, ava, omni-intent, citas, telegram, whatsapp, seguridad, auditoria, primer-cliente, roadmap — each with full content (introducción, objetivo, procedimientos, casos de uso, errores frecuentes, solución de incidencias, capturas placeholder, historial de cambios)
