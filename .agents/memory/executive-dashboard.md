---
name: Executive Intelligence Layer
description: Executive dashboard with forecast, risks, priorities, opportunities — route and architecture
---

## Backend
- Route: `GET /api/executive` → returns `{ kpis, forecast, risks, priorities, opportunities, insights }`
- File: `artifacts/api-server/src/routes/executive.ts`
- Pure SQL via Drizzle, no AI calls — fast (<50ms)
- Registered in `routes/index.ts` as `router.use("/executive", executiveRouter)`

## Frontend
- Page: `artifacts/omniflow/src/pages/executive.tsx`
- Route: `/executive` in App.tsx
- Nav item: `{ icon: Zap, label: "Intelligence", href: "/executive" }` in MainLayout.tsx
- Uses Recharts BarChart for monthly forecast (actual=blue, forecast=green)
- Auto-refresh every 60 seconds via React Query `refetchInterval`

## Gotcha: backtick syntax error
- Vite/Babel parser (babel-parser@7.29.3) fails with `Unterminated string constant` when a template literal `${...}` expression contains `.replace(".0","")` with double-quotes and `}` — even though it's valid JS.
- **Fix**: Use `if/return` block instead of inline ternary with template literal for number formatting functions.
- **Why**: Babel's template literal parser gets confused when `}` appears inside a double-quoted string within `${}`. Avoid string `.replace()` calls inside template expressions; extract to variable first.

## Data model used
- Clients: status (active/lead/inactive/churned), value (real, nullable)
- Quotes: status (draft/sent/accepted/rejected/expired), total (real), validUntil (timestamp nullable)
- Appointments: status (pending/confirmed/completed/cancelled), startTime
- Activity table: called `activity` (not `activity_log`)
