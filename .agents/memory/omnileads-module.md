---
name: OmniLeads AI module
description: Architecture and gotchas for the omni_leads prospecting module (FIX-W)
---

# OmniLeads AI (omni_leads)

**Route**: `/leads` | **Slug**: `omni_leads` | **Plan**: `scale`

## Architecture

- **Backend**: `artifacts/api-server/src/routes/leads.ts` — single file, all routes inline
- **Frontend**: `artifacts/omniflow/src/pages/leads.tsx` — single file, 5 sub-components
- **Schema**: `lib/db/src/schema/leads.ts` — 4 tables

## Tables (FIX-W)

- `lead_searches` — search queries
- `lead_results` — found companies (from Google Places)
- `lead_analysis` — AI scoring + 11 digital signals per company
- `lead_messages` — AI-generated proposals

## Key gotchas

**organizationsTable location**: It is in `./organizations.ts`, NOT `./platform-admin.ts`. Using the wrong import breaks the esbuild.

**clients INSERT**: The clients table has no `address` or `created_by` columns. Address goes in `notes`. Columns for INSERT: `org_id, name, phone, email, notes, status, created_at, updated_at`.

**Google Places API key**: Env var `GOOGLE_PLACES_API_KEY` required. If missing, search returns 500 with a clear message. Architecture is pluggable via `searchGooglePlaces()` helper.

**Score logic**: High score (65+) = few digital signals = HIGH opportunity (company needs digital services). Low score = many signals = LOW opportunity.

**Bulk analyze**: Fire-and-forget async — responds immediately, results update via 6s refetch polling on the frontend.

## Plan activation

Added `omni_leads` and `omni_ads` to `scale` plan in `auth.ts`. Module seeded in `module_configs` for all existing orgs via direct SQL.

**Why:** omni_ads was also missing from scale plan list — both added together.

## Pendiente para próxima actualización (2026-08-20)

`omni_leads` ya aparece en el catálogo de módulos del panel admin (arreglado en
commit `d7fea9a` — antes no estaba, ver `module-system.md`), pero el módulo
todavía **no puede recabar información real** hasta que se resuelvan 3 cosas:

1. **`GOOGLE_PLACES_API_KEY` sin configurar** — bloqueante. `POST /leads/search`
   falla de inmediato con "GOOGLE_PLACES_API_KEY no está configurada" (ver
   `leads.ts` línea ~144). Se necesita una API key de Google Cloud con **Places
   API** habilitada (Text Search + Place Details) y facturación activa en ese
   proyecto de GCP (Google la exige aunque el uso caiga en la capa gratuita).
   Se añade como env var en el servicio `omnitech-core-api` de Render.
2. **`OPENAI_API_KEY`** — no bloqueante (hay fallback heurístico en
   `analyzeWebsite()` si falla), pero sin ella el análisis de oportunidad
   comercial (score/resumen/mejoras) no usa IA real.
3. **Activar el módulo `omni_leads`** para el workspace en Control Center →
   Módulos — sin esto el backend devuelve 403 antes de llegar a cualquier
   endpoint (`requireModule("omni_leads")` en `routes/index.ts`).

Con la API key de Google puesta y el módulo activo, alcanza con sector + ciudad
(radio y máximo de resultados opcionales) para lanzar una búsqueda real.
