---
name: A Medida module
description: Public lead-capture landing at /a-medida + its own toggleable admin module (a_medida), architected for a future standalone spin-off
---

# A Medida (a_medida)

**Public landing**: `/a-medida` (no auth) | **Admin panel**: `/a-medida-panel` (auth + module gate) | **Slug**: `a_medida`

## Why it exists

The user has a standalone landing page ("montaje de cocinas/muebles, portes y
mudanzas") that needs to live at `hogar.omnitech-core.com` — which turned out to be
the **same domain** as the main OmniTech CRM frontend, not a separate marketing
site. Rather than standing up separate hosting, the landing was embedded directly
into the existing OmniTech frontend app as a public route.

The user's longer-term intent is to potentially sell this as a **separate product**
later, reusing OmniTech's auth system. Until then it's built as an independent,
toggleable module inside OmniTech — isolated enough to be split out later without
having to disentangle it from OmniLeads or the rest of the CRM.

## Architecture

### Public landing (`/a-medida`)
- `artifacts/omniflow/src/pages/amedidaLandingHtml.ts` — exports `AMEDIDA_LANDING_HTML`, the full standalone landing page (HTML/CSS/JS) as a template-literal string. `API_URL` points to `https://omnitech-core-api.onrender.com/api/leads-public`.
- `artifacts/omniflow/src/pages/AMedidaLandingPage.tsx` — renders `<iframe srcDoc={AMEDIDA_LANDING_HTML} .../>` (full-viewport, no border). The iframe+srcDoc pattern isolates the landing's CSS/JS from the rest of the SPA — no class collisions, no bundler involvement for the landing's own script.
- Route registered in `App.tsx` **outside** any `ProtectedRoute`/`MainLayout` wrapper — it's public.

### Public submission endpoint
- `POST /api/leads-public` (`artifacts/api-server/src/routes/publicLeadCapture.ts`, pre-existing, unauthenticated) inserts into the `leads` table (`lib/db/src/schema/leadCapture.ts`). This table has **no `org_id`** — submissions aren't tied to any workspace.
- Rate-limited 20 req/min/IP.
- CORS: `app.ts` global CORS middleware was rewritten to dynamically exempt any request whose path starts with `/api/leads-public` (`origin: true`, no credentials) **before** falling through to the normal strict `ALLOWED_ORIGINS` allowlist used by the authenticated app. This was done as a route-scoped exemption rather than editing the `ALLOWED_ORIGINS` env var directly, since that var can't be read back through the Render MCP tool (merge-overwrite only) and blindly rewriting it risked breaking the production frontend's own CORS access.

### Admin panel module (`a_medida`)
Until this module was built, submitted leads had **no read path at all** — grepping
for `leadsTable`/`leadCapture` outside `publicLeadCapture.ts` returned nothing.

- `artifacts/api-server/src/routes/aMedidaLeads.ts` — `GET /` (filtered/paginated list: status, category, search) + `PATCH /:id` (status change, audit-logged). Deliberately does **not** filter by org — the underlying table has none. Gated only by module + permission, not by workspace.
- Mounted at `/api/a-medida-leads` in `routes/index.ts`, behind `requireModule("a_medida")`.
- Permissions: `a_medida.read` / `a_medida.write` added to `Permission` union + `PERMISSIONS_BY_ROLE` in `middlewares/permissions.ts` (owner/admin/manager/member/vendedor get both; `read_only` gets read only).
- Frontend: `artifacts/omniflow/src/pages/amedida-panel.tsx` — react-query list + status-change mutation, filters, card list. Route `/a-medida-panel` wrapped in `ProtectedRoute` + `MainLayout` + `ModuleGuard moduleKey="a_medida"`.
- Nav entries added in `MainLayout.tsx` (Truck icon), module label added in `ModuleGuard.tsx`'s `MODULE_LABELS`.
- Added to the admin `CATALOG` in `control-center.ts` (see `d7fea9a-catalog-fix.md` for why that's a separate list from `ALL_MODULE_SLUGS`) and to `ALL_MODULE_SLUGS` in `auth.ts`.

## Deliberate scope limits (as requested)

Only list + status-change functionality for now — no editing, no assignment, no
notifications. Kept intentionally decoupled from OmniLeads (`routes/leads.ts` /
`lead_results` table) even though both are "leads" conceptually: different data
domain, different owner intent (this one may become a separate paid product).

## If this gets spun out as a separate product later

The seams to cut are already in place: the `leads` table has no `org_id` (already
workspace-agnostic), the router (`aMedidaLeads.ts`) is a single self-contained
file, and the module can simply be toggled off in OmniTech once the standalone
version exists. Auth would need to be decided at that point (reuse OmniTech's
Clerk-based auth vs. a fresh system) — not yet decided, flagged here for when that
conversation happens.
