---
name: Timezone handling — Europe/Madrid
description: Convention and implementation for storing UTC + displaying Europe/Madrid across the full appointment flow.
---

## Convention

- **Rule 1 — Storage:** All timestamps stored as **real UTC** in PostgreSQL (`timestamp without time zone` on a UTC-session server = raw UTC value).
- **Rule 2 — Display:** All timestamps shown in **Europe/Madrid** (CET = UTC+1 in winter, CEST = UTC+2 in summer).
- **Rule 3 — Input:** User/AI-supplied times ("15:00") are always interpreted as Madrid local before storage.

## madridLocalToUTC — probe technique

Used in telegram.ts, chat.ts (backend) and calendar.tsx (frontend, named `madridLocalToUTCFE`).

```typescript
function madridLocalToUTC(dateStr: string, timeStr: string): Date {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const [h, m_]      = timeStr.split(":").map(Number);
  const probe = new Date(Date.UTC(yr!, mo! - 1, dy!, h!, m_!, 0));
  const fmt   = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts   = fmt.formatToParts(probe);
  const mh      = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const mmVal   = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMin = (h! * 60 + m_!) - (mh * 60 + mmVal);
  return new Date(probe.getTime() + shiftMin * 60_000);
}
```

Example (June, CEST = UTC+2): "15:00 Madrid" → probe=15:00 UTC → Madrid shows 17:00 → shift=−120 min → **13:00 UTC stored**.

## Display helpers (backend — telegram.ts)

```typescript
function apptTimeDisplay(d: Date): string {
  return d.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
}
function apptDateDisplay(d: Date): string {
  return d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
```

## Frontend (calendar.tsx)

- `getMadridHM(iso)` — returns `{ h, m }` in Madrid TZ via Intl.DateTimeFormat.
- `toTimeStr(iso)` — uses getMadridHM.
- `toDateStr(iso)` — uses `toLocaleDateString("en-CA", { timeZone: MADRID_TZ })` → "YYYY-MM-DD".
- `toISO(date, time)` — calls `madridLocalToUTCFE` → returns real UTC ISO.
- `apptTopPx(iso)` — uses getMadridHM for pixel positioning.
- `nowMinuteOffset()` — uses getMadridHM on current time.

## Why the old code was wrong

Old code: `new Date(Date.UTC(y, mo-1, d, h, m, 0))` treated "15:00 Madrid" as UTC 15:00 = Madrid 17:00.
Old display: `.toISOString().slice(11,16)` showed UTC 15:00 as "15:00" — appeared correct but was semantically wrong.
Frontend: `format(parseISO(iso), "HH:mm")` used local browser TZ — correct in Madrid browser but wrong in UTC Replit dev.

## Existing data note

Appointments created before this fix have "wall-clock stored as UTC" (e.g., user said "10:00", stored as 10:00 UTC = 12:00 Madrid). These display shifted by +2h with the new display helpers. New appointments are stored and displayed correctly.

## Canonical source

`artifacts/api-server/src/utils/timezone.ts` — single definition of `madridLocalToUTC`, `apptTimeDisplay`, `apptDateDisplay`, `getMadridDayBounds`.
- `appointmentSkills.ts`: re-exports from timezone.ts (authoritative).
- `chat.ts`, `telegram.ts`: local copies (annotated with "CANONICAL SOURCE" comment). Keep identical. Update timezone.ts first when changing.
- Frontend `calendar.tsx`: `madridLocalToUTCFE` and `getMadridHM` defined locally (no frontend import from api-server).

## Display bug (recurring — fixed)

Root cause: `format(parseISO(iso), "HH:mm")` from date-fns uses **runtime/browser TZ**. In Replit dev (UTC), this shows UTC time (13:00) instead of Madrid time (15:00).
Fix: ALWAYS use `toTimeStr(iso)` for any time display in calendar.tsx. It calls `getMadridHM` which uses `Intl.DateTimeFormat Europe/Madrid`.

Affected locations fixed:
- Week card compact badge, week card time range
- Copy-details text, detail drawer time range
- AI panel summary time, AI panel date+time string
- Day/agenda list start + end time
- Month/other view time list

Drag-and-drop also fixed:
- `handleDropOnTimeSlot`: `setHours` (browser TZ) → `madridLocalToUTCFE` (explicit Madrid)
- `handleDropOnDay`: `getHours(parseISO())` (browser TZ) → `getMadridHM` (explicit Madrid)

Reschedule confirmation in chat.ts: `.toISOString().slice(11,16)` (UTC) → `toLocaleTimeString({timeZone:"Europe/Madrid"})`.

## Regression test

`artifacts/omniflow/src/__tests__/timezone.test.ts` — 22 round-trip tests across summer/winter + bug detection.
Tests all QA times (09:00, 12:00, 15:00, 18:00, 23:30) in both summer and winter.
All 33 tests pass.

## TZ logs added

- `[TZ create_appointment]` in telegram.ts and chat.ts: logs hora_recibida, tz, utc_stored, madrid_display.
- `[TZ calendar]` in calendar.tsx: logs on form save and on rendering.
