// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL timezone utility — single source of truth for all date/time ops.
// Rule: store real UTC in DB, always display in Europe/Madrid (CET/CEST).
//
// All appointment creation paths MUST use madridLocalToUTC from here.
// All appointment display paths MUST use apptTimeDisplay / apptDateDisplay.
//
// Imported by: chat.ts, telegram.ts, appointmentSkills.ts
// DO NOT duplicate these functions in other files.
// ═══════════════════════════════════════════════════════════════════════════

const MADRID_TZ = "Europe/Madrid";

/**
 * Convert a date+time string expressed as Europe/Madrid local time → real UTC.
 *
 * Uses the "probe" technique: creates a UTC Date at the wall-clock value,
 * asks Intl.DateTimeFormat what Madrid shows for that instant, then shifts
 * by the difference.  DST is handled automatically.
 *
 * Example (summer, CEST = UTC+2):
 *   madridLocalToUTC("2026-07-11", "15:00") → Date at 13:00 UTC
 *
 * Example (winter, CET = UTC+1):
 *   madridLocalToUTC("2026-01-15", "15:00") → Date at 14:00 UTC
 */
export function madridLocalToUTC(dateStr: string, timeStr: string): Date {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const [h,  m_]     = timeStr.split(":").map(Number);
  const probe = new Date(Date.UTC(yr!, mo! - 1, dy!, h!, m_!, 0));
  const fmt   = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts    = fmt.formatToParts(probe);
  const mh       = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const mmVal    = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMin = (h! * 60 + m_!) - (mh * 60 + mmVal);
  return new Date(probe.getTime() + shiftMin * 60_000);
}

/** Format a Date as "HH:MM" in Europe/Madrid, regardless of runtime TZ. */
export function apptTimeDisplay(d: Date): string {
  return d.toLocaleTimeString("es-ES", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Format a Date as long weekday+date string in Europe/Madrid. */
export function apptDateDisplay(d: Date): string {
  return d.toLocaleDateString("es-ES", {
    timeZone: MADRID_TZ,
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/**
 * Get the UTC start/end of a calendar day expressed in Europe/Madrid timezone.
 * offsetDays=0 → today, offsetDays=1 → tomorrow, etc.
 */
export function getMadridDayBounds(offsetDays: number): { start: Date; end: Date } {
  const now  = new Date();
  const base = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, 0, 0, 0,
  ));
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts  = fmt.formatToParts(base);
  const yr     = parseInt(parts.find(p => p.type === "year")!.value,   10);
  const mo     = parseInt(parts.find(p => p.type === "month")!.value,  10);
  const dy     = parseInt(parts.find(p => p.type === "day")!.value,    10);
  const h      = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const m      = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMs = base.getTime() - Date.UTC(yr, mo - 1, dy, h, m, 0);
  return {
    start: new Date(Date.UTC(yr, mo - 1, dy,  0,  0,  0,   0) - shiftMs),
    end:   new Date(Date.UTC(yr, mo - 1, dy, 23, 59, 59, 999) - shiftMs),
  };
}
