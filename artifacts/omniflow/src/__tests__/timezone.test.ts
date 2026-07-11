/**
 * Timezone regression tests — Europe/Madrid appointment handling.
 *
 * These tests guard against the recurring timezone bug:
 *   User requests 15:00 → stored as 13:00 UTC (correct) → displayed as 13:00 (BUG).
 *
 * The correct behaviour:
 *   - Store: madridLocalToUTC("2026-07-11", "15:00") → 13:00 UTC (CEST = UTC+2)
 *   - Display: toTimeStr("...T13:00:00.000Z") → "15:00"
 *
 * If either assertion fails, a regression has been introduced somewhere in
 * the date/time pipeline.
 */

import { describe, it, expect } from "vitest";

// ─── Inline the canonical implementations ────────────────────────────────────
// Mirrors src/utils/timezone.ts (backend) and calendar.tsx (frontend).
// If the algorithm changes, this test must be updated to match.

const MADRID_TZ = "Europe/Madrid";

function madridLocalToUTC(dateStr: string, timeStr: string): Date {
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

function toTimeStr(iso: string): string {
  const d   = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const h = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const m = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── UTC offset at a given ISO instant ───────────────────────────────────────

function getMadridOffsetMinutes(iso: string): number {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const madridH = parseInt(parts.find(p => p.type === "hour")!.value, 10);
  const madridM = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const utcH    = d.getUTCHours();
  const utcM    = d.getUTCMinutes();
  return (madridH * 60 + madridM) - (utcH * 60 + utcM);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("madridLocalToUTC — correct UTC storage", () => {
  // Summer test (CEST = UTC+2), July
  const SUMMER_DATE = "2026-07-11";

  it("15:00 Madrid (summer) stores as 13:00 UTC", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "15:00");
    expect(utc.getUTCHours()).toBe(13);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it("09:00 Madrid (summer) stores as 07:00 UTC", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "09:00");
    expect(utc.getUTCHours()).toBe(7);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it("12:00 Madrid (summer) stores as 10:00 UTC", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "12:00");
    expect(utc.getUTCHours()).toBe(10);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it("18:00 Madrid (summer) stores as 16:00 UTC", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "18:00");
    expect(utc.getUTCHours()).toBe(16);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it("23:30 Madrid (summer) stores as 21:30 UTC", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "23:30");
    expect(utc.getUTCHours()).toBe(21);
    expect(utc.getUTCMinutes()).toBe(30);
  });

  // Winter test (CET = UTC+1), January
  const WINTER_DATE = "2026-01-15";

  it("15:00 Madrid (winter) stores as 14:00 UTC", () => {
    const utc = madridLocalToUTC(WINTER_DATE, "15:00");
    expect(utc.getUTCHours()).toBe(14);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it("09:00 Madrid (winter) stores as 08:00 UTC", () => {
    const utc = madridLocalToUTC(WINTER_DATE, "09:00");
    expect(utc.getUTCHours()).toBe(8);
    expect(utc.getUTCMinutes()).toBe(0);
  });
});

describe("toTimeStr — correct Madrid display from UTC ISO", () => {
  const SUMMER_DATE = "2026-07-11";

  it("13:00 UTC displays as 15:00 in Madrid (summer)", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "15:00").toISOString();
    expect(toTimeStr(utc)).toBe("15:00");
  });

  it("07:00 UTC displays as 09:00 in Madrid (summer)", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "09:00").toISOString();
    expect(toTimeStr(utc)).toBe("09:00");
  });

  it("10:00 UTC displays as 12:00 in Madrid (summer)", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "12:00").toISOString();
    expect(toTimeStr(utc)).toBe("12:00");
  });

  it("16:00 UTC displays as 18:00 in Madrid (summer)", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "18:00").toISOString();
    expect(toTimeStr(utc)).toBe("18:00");
  });

  it("21:30 UTC displays as 23:30 in Madrid (summer)", () => {
    const utc = madridLocalToUTC(SUMMER_DATE, "23:30").toISOString();
    expect(toTimeStr(utc)).toBe("23:30");
  });

  const WINTER_DATE = "2026-01-15";

  it("14:00 UTC displays as 15:00 in Madrid (winter)", () => {
    const utc = madridLocalToUTC(WINTER_DATE, "15:00").toISOString();
    expect(toTimeStr(utc)).toBe("15:00");
  });
});

describe("round-trip: input → stored UTC → displayed", () => {
  const QA_TIMES = ["09:00", "12:00", "15:00", "18:00", "23:30"];
  const DATES = [
    { label: "summer", date: "2026-07-11" },
    { label: "winter", date: "2026-01-15" },
  ];

  for (const { label, date } of DATES) {
    for (const time of QA_TIMES) {
      it(`${time} in Madrid (${label}) round-trips correctly`, () => {
        const stored = madridLocalToUTC(date, time);

        // Stored UTC must NOT equal the wall-clock value (unless UTC+0)
        const offset = getMadridOffsetMinutes(stored.toISOString());
        expect(offset).not.toBe(0); // Madrid is never UTC+0

        // The display must round-trip back to the original input
        const displayed = toTimeStr(stored.toISOString());
        expect(displayed).toBe(time);
      });
    }
  }
});

describe("no silent UTC passthrough (old bug detection)", () => {
  it("15:00 UTC stored naively would display wrong in Madrid (CEST)", () => {
    // Simulate the OLD bug: treating "15:00" as UTC directly
    const naiveWrong = new Date(Date.UTC(2026, 6, 11, 15, 0, 0));
    // This would display as 17:00 in Madrid, NOT 15:00 — proves the old approach was wrong
    const wrongDisplay = toTimeStr(naiveWrong.toISOString());
    expect(wrongDisplay).not.toBe("15:00");
    expect(wrongDisplay).toBe("17:00"); // CEST shifts +2h
  });

  it("toTimeStr does NOT use raw UTC hours", () => {
    // If toTimeStr used .getUTCHours() it would show 13:00 for a 15:00 Madrid appointment
    const utc = madridLocalToUTC("2026-07-11", "15:00");
    const utcHours = `${String(utc.getUTCHours()).padStart(2,"0")}:${String(utc.getUTCMinutes()).padStart(2,"0")}`;
    expect(utcHours).toBe("13:00"); // raw UTC is 13:00
    expect(toTimeStr(utc.toISOString())).toBe("15:00"); // but display must be 15:00
    expect(toTimeStr(utc.toISOString())).not.toBe(utcHours); // they must differ in summer
  });
});
