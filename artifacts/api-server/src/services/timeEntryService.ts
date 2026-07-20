import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function dbRows<T>(r: unknown): T[] {
  return (r as { rows: T[] }).rows;
}

export interface TimeEntryRow {
  id: number;
  worker_id: number;
  worker_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  break_minutes: number;
  total_minutes: number | null;
  overtime_minutes: number;
  notes: string | null;
  method: string;
  status: string;
  incident_count: number;
}

export interface ListEntriesOpts {
  orgId: number;
  workerId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Single source of truth for time entries across:
 *   - Dashboard (recentEntries)
 *   - Historial tab (/entries endpoint)
 *   - Future: exports, reports, AIE handlers
 *
 * All optional filters default to null so Postgres never receives ""::date.
 * incident_count = count of OPEN (unresolved) incidents linked to each entry.
 */
export async function listTimeEntries(opts: ListEntriesOpts): Promise<TimeEntryRow[]> {
  const wId   = opts.workerId ?? null;
  const dFrom = opts.dateFrom ?? null;
  const dTo   = opts.dateTo   ?? null;
  const st    = opts.status   ?? null;
  const srch  = opts.search   ? `%${opts.search}%` : null;
  const lim   = Math.min(Math.max(opts.limit  ?? 50, 1), 200);
  const off   = Math.max(opts.offset ?? 0, 0);

  return dbRows<TimeEntryRow>(await db.execute(sql`
    SELECT
      te.id,
      te.worker_id,
      tw.name             AS worker_name,
      te.clock_in_at,
      te.clock_out_at,
      te.break_minutes,
      te.total_minutes,
      te.overtime_minutes,
      te.notes,
      te.method,
      te.status,
      COUNT(ti.id)::int   AS incident_count
    FROM time_entries te
    JOIN  time_workers   tw ON tw.id = te.worker_id
    LEFT JOIN time_incidents ti
          ON ti.entry_id = te.id
         AND ti.resolved_at IS NULL
    WHERE te.org_id = ${opts.orgId}
      AND (${wId}::integer IS NULL OR te.worker_id = ${wId}::integer)
      AND (${dFrom}::date  IS NULL OR te.clock_in_at >= ${dFrom}::date)
      AND (${dTo}::date    IS NULL OR te.clock_in_at <  (${dTo}::date + INTERVAL '1 day'))
      AND (${st}::text     IS NULL OR te.status = ${st}::text)
      AND (${srch}::text   IS NULL OR tw.name ILIKE ${srch}::text)
    GROUP BY te.id, tw.name
    ORDER BY te.clock_in_at DESC
    LIMIT ${lim} OFFSET ${off}
  `));
}
