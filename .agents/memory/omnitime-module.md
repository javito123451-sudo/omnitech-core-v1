---
name: OmniTime Module
description: Full HR time-tracking module. Clock in/out, workers, incidents, time-off. Integrated with ACE+AIE from day one. Phase 3 of the intelligence architecture.
---

# OmniTime Module

## Module slug: `omni_time`
Available from: **professional plan and above** (all plan tiers that include ALL_SLUGS).

## DB tables (FIX-AD migration)
| Table | Purpose |
|---|---|
| `time_workers` | Employees tracked in this org (org_id, name, position, weekly_hours, hourly_rate, is_active) |
| `time_entries` | Clock-in/out records (worker_id, clock_in_at, clock_out_at, break_minutes, total_minutes, overtime_minutes, method, status) |
| `time_incidents` | Auto or manual incidents (worker_id, entry_id nullable, type, severity, auto_detected, resolved_at) |
| `time_off_requests` | Vacation/sick/personal requests (worker_id, type, start_date, end_date, days, status, reviewed_by) |

Indexes: idx_time_entries_worker, idx_time_entries_open (partial), idx_time_incidents_open (partial), idx_time_off_pending (partial)

## Backend API (src/routes/time.ts)
Mounted at: `router.use("/time", requireModule("omni_time"), timeRouter)`

| Endpoint | Purpose |
|---|---|
| GET /time/dashboard | Stats + recent entries |
| GET/POST /time/workers | List / create workers |
| GET/PATCH /time/workers/:id | Detail / update |
| POST /time/clock-in | Clock in — checks for open entry, emits TIME_CLOCK_IN |
| POST /time/clock-out | Clock out — calculates total/overtime, emits TIME_CLOCK_OUT + TIME_OVERTIME_DETECTED if >30min |
| GET /time/entries | List with filters (worker_id, date_from, date_to, status) |
| PATCH /time/entries/:id | Manual adjust |
| GET/POST /time/incidents | List / create (emits TIME_INCIDENT_CREATED) |
| PATCH /time/incidents/:id/resolve | Resolve incident |
| GET/POST /time/time-off | List / create request (emits TIME_OFF_REQUESTED) |
| PATCH /time/time-off/:id/review | Approve/reject (emits TIME_OFF_APPROVED / TIME_OFF_REJECTED) |

## AIE events emitted (built-in from day one)
- TIME_CLOCK_IN — every clock-in
- TIME_CLOCK_OUT — every clock-out
- TIME_OVERTIME_DETECTED — when overtime_minutes > 30 after clock-out
- TIME_INCIDENT_CREATED — manual incident creation
- TIME_OFF_REQUESTED — new time-off request
- TIME_OFF_APPROVED / TIME_OFF_REJECTED — after review

## Frontend (src/pages/time.tsx)
Route: `/time` (ModuleGuard moduleKey="omni_time")
Sidebar: "Trabajo" group → Clock icon → OmniTime
5 tabs:
- **Panel**: stat cards, quick clock-in/out, recent entries list
- **Trabajadores**: CRUD worker list + create form
- **Fichajes**: filterable table (worker, status, date range)
- **Incidencias**: open/resolved view, severity badges, resolve button, create form
- **Solicitudes**: time-off requests with approve/reject inline

## Automatic time calculation
Clock-out auto-computes:
- `total_minutes = elapsed_minutes - break_minutes`
- `overtime_minutes = max(0, total_minutes - daily_quota)`
- `daily_quota = (weekly_hours / 5) * 60`

## Next FIX letter: FIX-AE
