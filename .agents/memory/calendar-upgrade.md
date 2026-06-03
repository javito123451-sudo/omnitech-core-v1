---
name: Calendar premium upgrade
description: Details about the Omniflow calendar premium upgrade — new views, statuses, DB fields, AI endpoint, and drag-and-drop.
---

## What was built

- **3 views**: Week (time grid), Month (day cells), Day/Agenda (card list)
- **Status system**: `pending` (blue), `confirmed` (violet), `completed` (emerald), `cancelled` (red). Old values `scheduled`/`no_show` are mapped as fallbacks in STATUS_CFG for backward compat.
- **New DB columns** in `appointments` table: `reminder` (boolean, default false), `tags` (text, comma-separated), `location` (text)
- **AI endpoint**: `POST /api/calendar-ai` with actions: `create`, `summary`, `follow-up`, `suggest-time`. Route at `artifacts/api-server/src/routes/calendar-ai.ts`.
- **Drag & drop**: HTML5 drag API on week grid (drag appointment to new time/day); month grid supports drop to change day.
- **Dashboard Today widget**: Shows today's appointments, progress bar, next upcoming appointment countdown, reminder bell icons.
- **Extended type**: `ApptEx = Appointment & { reminder?, tags?, location?, clientCompany? }` used locally in calendar.tsx since API client type doesn't include all new fields.

## Key files
- `artifacts/omniflow/src/pages/calendar.tsx` — complete premium rewrite
- `artifacts/omniflow/src/pages/dashboard.tsx` — Today widget added
- `artifacts/api-server/src/routes/calendar-ai.ts` — AI endpoint
- `artifacts/api-server/src/routes/appointments.ts` — updated to handle new fields
- `lib/db/src/schema/appointments.ts` — reminder/tags/location columns
- `lib/api-spec/openapi.yaml` — updated spec with new fields + extended status enum

## Why ApptEx local type
The generated API client types don't include new fields until codegen runs AND the spec update is reflected. Rather than wait, we cast locally in calendar.tsx as `ApptEx` which adds the optional new fields. The API actually returns them in the response payload.

**How to apply:** If adding more calendar fields in the future, update `openapi.yaml`, run codegen, update `lib/db/src/schema/appointments.ts`, run `drizzle-kit push --force`, and update the `ApptEx` local type in `calendar.tsx`.
