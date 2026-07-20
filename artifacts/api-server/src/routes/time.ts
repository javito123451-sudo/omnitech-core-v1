import { Router } from "express";
import { db }     from "@workspace/db";
import { sql }    from "drizzle-orm";
import { emitAieEvent, EVENT_TYPES } from "../aie";
import { listTimeEntries } from "../services/timeEntryService";

export const timeRouter = Router();

function dbRows<T>(r: unknown): T[] {
  return (r as { rows: T[] }).rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.get("/dashboard", async (req, res) => {
  const orgId = req.orgId!;
  try {
    const [workers, todayEntries, openEntries, pendingTTO, incidents] =
      await Promise.all([
        dbRows<{ total: number }>(await db.execute(sql`
          SELECT COUNT(*) AS total FROM time_workers WHERE org_id=${orgId} AND is_active=true
        `)),
        dbRows<{ total: number }>(await db.execute(sql`
          SELECT COUNT(*) AS total FROM time_entries
          WHERE org_id=${orgId} AND DATE(clock_in_at AT TIME ZONE 'Europe/Madrid')=CURRENT_DATE
        `)),
        dbRows<{ total: number }>(await db.execute(sql`
          SELECT COUNT(*) AS total FROM time_entries WHERE org_id=${orgId} AND status='open'
        `)),
        dbRows<{ total: number }>(await db.execute(sql`
          SELECT COUNT(*) AS total FROM time_off_requests WHERE org_id=${orgId} AND status='pending'
        `)),
        dbRows<{ total: number }>(await db.execute(sql`
          SELECT COUNT(*) AS total FROM time_incidents WHERE org_id=${orgId} AND resolved_at IS NULL
        `)),
      ]);

    const recentRows = await listTimeEntries({ orgId, limit: 10 });

    res.json({
      totalWorkers:     Number(workers[0]?.total ?? 0),
      todayEntries:     Number(todayEntries[0]?.total ?? 0),
      openEntries:      Number(openEntries[0]?.total ?? 0),
      pendingTimeOff:   Number(pendingTTO[0]?.total ?? 0),
      openIncidents:    Number(incidents[0]?.total ?? 0),
      recentEntries:    recentRows,
    });
  } catch (err) {
    console.error("[time/dashboard]", err);
    res.status(500).json({ error: "Error al cargar el dashboard" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKERS
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.get("/workers", async (req, res) => {
  const orgId = req.orgId!;
  try {
    const rows = dbRows<{
      id: number; name: string; position: string | null;
      weekly_hours: number; hourly_rate: number | null; is_active: boolean;
      user_id: number | null; created_at: string;
    }>(await db.execute(sql`
      SELECT id, name, position, weekly_hours, hourly_rate, is_active, user_id, created_at
      FROM time_workers WHERE org_id=${orgId} ORDER BY name
    `));
    res.json(rows);
  } catch (err) {
    console.error("[time/workers GET]", err);
    res.status(500).json({ error: "Error al listar trabajadores" });
  }
});

timeRouter.post("/workers", async (req, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId;
  const { name, position, weekly_hours = 40, hourly_rate, user_id } = req.body as {
    name: string; position?: string; weekly_hours?: number;
    hourly_rate?: number; user_id?: number;
  };
  if (!name?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
  try {
    const rows = dbRows<{ id: number }>(await db.execute(sql`
      INSERT INTO time_workers (org_id, name, position, weekly_hours, hourly_rate, user_id)
      VALUES (${orgId}, ${name.trim()}, ${position ?? null}, ${weekly_hours}, ${hourly_rate ?? null}, ${user_id ?? null})
      RETURNING id
    `));
    res.status(201).json({ id: rows[0]!.id });
  } catch (err) {
    console.error("[time/workers POST]", err);
    res.status(500).json({ error: "Error al crear trabajador" });
  }
});

timeRouter.get("/workers/:id", async (req, res) => {
  const orgId    = req.orgId!;
  const workerId = Number(req.params.id);
  try {
    const rows = dbRows<{ id: number; name: string; position: string | null; weekly_hours: number; hourly_rate: number | null; is_active: boolean; user_id: number | null }>(
      await db.execute(sql`
        SELECT id, name, position, weekly_hours, hourly_rate, is_active, user_id
        FROM time_workers WHERE id=${workerId} AND org_id=${orgId}
      `)
    );
    if (!rows.length) return res.status(404).json({ error: "Trabajador no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener trabajador" });
  }
});

timeRouter.patch("/workers/:id", async (req, res) => {
  const orgId    = req.orgId!;
  const workerId = Number(req.params.id);
  const { name, position, weekly_hours, hourly_rate, is_active } = req.body as {
    name?: string; position?: string; weekly_hours?: number;
    hourly_rate?: number; is_active?: boolean;
  };
  try {
    await db.execute(sql`
      UPDATE time_workers SET
        name         = COALESCE(${name ?? null}, name),
        position     = COALESCE(${position ?? null}, position),
        weekly_hours = COALESCE(${weekly_hours ?? null}, weekly_hours),
        hourly_rate  = COALESCE(${hourly_rate ?? null}, hourly_rate),
        is_active    = COALESCE(${is_active ?? null}, is_active)
      WHERE id=${workerId} AND org_id=${orgId}
    `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar trabajador" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLOCK IN / OUT
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.post("/clock-in", async (req, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId;
  const { worker_id, notes, method = "manual" } = req.body as {
    worker_id: number; notes?: string; method?: string;
  };
  if (!worker_id) return res.status(400).json({ error: "worker_id es obligatorio" });

  try {
    // Check worker belongs to org
    const wRows = dbRows<{ id: number; name: string }>(await db.execute(sql`
      SELECT id, name FROM time_workers WHERE id=${worker_id} AND org_id=${orgId} AND is_active=true
    `));
    if (!wRows.length) return res.status(404).json({ error: "Trabajador no encontrado o inactivo" });

    // Check for existing open entry
    const openRows = dbRows<{ id: number }>(await db.execute(sql`
      SELECT id FROM time_entries WHERE worker_id=${worker_id} AND org_id=${orgId} AND status='open' LIMIT 1
    `));
    if (openRows.length) return res.status(409).json({ error: "El trabajador ya tiene un fichaje abierto" });

    const entryRows = dbRows<{ id: number }>(await db.execute(sql`
      INSERT INTO time_entries (org_id, worker_id, clock_in_at, notes, method, status)
      VALUES (${orgId}, ${worker_id}, NOW(), ${notes ?? null}, ${method}, 'open')
      RETURNING id
    `));
    const entryId = entryRows[0]!.id;

    void emitAieEvent({
      type:    EVENT_TYPES.TIME_CLOCK_IN,
      orgId,
      userId,
      source:  "time",
      payload: { entryId, workerId: worker_id, workerName: wRows[0]!.name, method },
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ id: entryId });
  } catch (err) {
    console.error("[time/clock-in]", err);
    res.status(500).json({ error: "Error al fichar entrada" });
  }
});

timeRouter.post("/clock-out", async (req, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId;
  const { worker_id, notes, break_minutes = 0 } = req.body as {
    worker_id: number; notes?: string; break_minutes?: number;
  };
  if (!worker_id) return res.status(400).json({ error: "worker_id es obligatorio" });

  try {
    const openRows = dbRows<{ id: number; clock_in_at: string; weekly_hours: number }>(
      await db.execute(sql`
        SELECT te.id, te.clock_in_at, tw.weekly_hours
        FROM time_entries te
        JOIN time_workers tw ON tw.id=te.worker_id
        WHERE te.worker_id=${worker_id} AND te.org_id=${orgId} AND te.status='open'
        ORDER BY te.clock_in_at DESC LIMIT 1
      `)
    );
    if (!openRows.length) return res.status(404).json({ error: "No hay fichaje abierto para este trabajador" });

    const entry       = openRows[0]!;
    const clockIn     = new Date(entry.clock_in_at);
    const now         = new Date();
    const totalMs     = now.getTime() - clockIn.getTime();
    const totalMin    = Math.floor(totalMs / 60000) - Number(break_minutes);
    const dailyMax    = (Number(entry.weekly_hours) / 5) * 60;
    const overtimeMin = Math.max(0, totalMin - dailyMax);

    await db.execute(sql`
      UPDATE time_entries SET
        clock_out_at    = NOW(),
        break_minutes   = ${break_minutes},
        total_minutes   = ${totalMin},
        overtime_minutes= ${overtimeMin},
        notes           = COALESCE(${notes ?? null}, notes),
        status          = 'closed'
      WHERE id=${entry.id}
    `);

    void emitAieEvent({
      type:    EVENT_TYPES.TIME_CLOCK_OUT,
      orgId,
      userId,
      source:  "time",
      payload: { entryId: entry.id, workerId: worker_id, totalMinutes: totalMin, overtimeMinutes: overtimeMin },
      timestamp: new Date().toISOString(),
    });

    if (overtimeMin > 30) {
      void emitAieEvent({
        type:    EVENT_TYPES.TIME_OVERTIME_DETECTED,
        orgId,
        userId,
        source:  "time",
        payload: { entryId: entry.id, workerId: worker_id, overtimeMinutes: overtimeMin },
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ id: entry.id, totalMinutes: totalMin, overtimeMinutes: overtimeMin });
  } catch (err) {
    console.error("[time/clock-out]", err);
    res.status(500).json({ error: "Error al fichar salida" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTRIES
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.get("/entries", async (req, res) => {
  const orgId = req.orgId!;
  const { worker_id, date_from, date_to, status, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
  try {
    const rows = await listTimeEntries({
      orgId,
      workerId: worker_id ? Number(worker_id) : null,
      dateFrom: date_from || null,
      dateTo:   date_to   || null,
      status:   status    || null,
      search:   search    || null,
      limit:    Number(limit)  || 50,
      offset:   Number(offset) || 0,
    });
    res.json(rows);
  } catch (err) {
    console.error("[time/entries GET]", err);
    res.status(500).json({ error: "Error al listar fichajes" });
  }
});

timeRouter.patch("/entries/:id", async (req, res) => {
  const orgId   = req.orgId!;
  const entryId = Number(req.params.id);
  const { clock_in_at, clock_out_at, break_minutes, notes, status } = req.body as {
    clock_in_at?: string; clock_out_at?: string; break_minutes?: number;
    notes?: string; status?: string;
  };
  try {
    await db.execute(sql`
      UPDATE time_entries SET
        clock_in_at   = COALESCE(${clock_in_at ?? null}::timestamptz, clock_in_at),
        clock_out_at  = COALESCE(${clock_out_at ?? null}::timestamptz, clock_out_at),
        break_minutes = COALESCE(${break_minutes ?? null}, break_minutes),
        notes         = COALESCE(${notes ?? null}, notes),
        status        = COALESCE(${status ?? null}, status)
      WHERE id=${entryId} AND org_id=${orgId}
    `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar fichaje" });
  }
});

timeRouter.delete("/entries/:id", async (req, res) => {
  const orgId   = req.orgId!;
  const entryId = Number(req.params.id);
  try {
    await db.execute(sql`
      DELETE FROM time_entries WHERE id=${entryId} AND org_id=${orgId}
    `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar fichaje" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENTS
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.get("/incidents", async (req, res) => {
  const orgId = req.orgId!;
  const { worker_id, resolved } = req.query as Record<string, string>;
  try {
    const rows = dbRows<{
      id: number; worker_id: number; worker_name: string; entry_id: number | null;
      type: string; severity: string; description: string | null;
      auto_detected: boolean; resolved_at: string | null; created_at: string;
    }>(await db.execute(sql`
      SELECT ti.id, ti.worker_id, tw.name AS worker_name, ti.entry_id,
             ti.type, ti.severity, ti.description, ti.auto_detected,
             ti.resolved_at, ti.created_at
      FROM time_incidents ti
      JOIN time_workers tw ON tw.id=ti.worker_id
      WHERE ti.org_id=${orgId}
        AND (${worker_id ?? null}::integer IS NULL OR ti.worker_id=${Number(worker_id ?? 0)})
        AND (${resolved ?? null} IS NULL OR
             CASE WHEN ${resolved ?? ""} = 'true' THEN ti.resolved_at IS NOT NULL
                  ELSE ti.resolved_at IS NULL END)
      ORDER BY ti.created_at DESC LIMIT 100
    `));
    res.json(rows);
  } catch (err) {
    console.error("[time/incidents GET]", err);
    res.status(500).json({ error: "Error al listar incidencias" });
  }
});

timeRouter.post("/incidents", async (req, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId;
  const { worker_id, entry_id, type, severity = "medium", description } = req.body as {
    worker_id: number; entry_id?: number; type: string; severity?: string; description?: string;
  };
  if (!worker_id || !type) return res.status(400).json({ error: "worker_id y type son obligatorios" });
  try {
    const rows = dbRows<{ id: number }>(await db.execute(sql`
      INSERT INTO time_incidents (org_id, worker_id, entry_id, type, severity, description, auto_detected)
      VALUES (${orgId}, ${worker_id}, ${entry_id ?? null}, ${type}, ${severity}, ${description ?? null}, false)
      RETURNING id
    `));

    void emitAieEvent({
      type:    EVENT_TYPES.TIME_INCIDENT_CREATED,
      orgId,
      userId,
      source:  "time",
      payload: { incidentId: rows[0]!.id, workerId: worker_id, type, severity, autoDetected: false },
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ id: rows[0]!.id });
  } catch (err) {
    res.status(500).json({ error: "Error al crear incidencia" });
  }
});

timeRouter.patch("/incidents/:id/resolve", async (req, res) => {
  const orgId      = req.orgId!;
  const incidentId = Number(req.params.id);
  try {
    await db.execute(sql`
      UPDATE time_incidents SET resolved_at=NOW()
      WHERE id=${incidentId} AND org_id=${orgId} AND resolved_at IS NULL
    `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al resolver incidencia" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TIME OFF REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

timeRouter.get("/time-off", async (req, res) => {
  const orgId = req.orgId!;
  const { worker_id, status } = req.query as Record<string, string>;
  try {
    const rows = dbRows<{
      id: number; worker_id: number; worker_name: string;
      type: string; start_date: string; end_date: string; days: number;
      reason: string | null; status: string; created_at: string;
    }>(await db.execute(sql`
      SELECT tor.id, tor.worker_id, tw.name AS worker_name,
             tor.type, tor.start_date, tor.end_date, tor.days,
             tor.reason, tor.status, tor.created_at
      FROM time_off_requests tor
      JOIN time_workers tw ON tw.id=tor.worker_id
      WHERE tor.org_id=${orgId}
        AND (${worker_id ?? null}::integer IS NULL OR tor.worker_id=${Number(worker_id ?? 0)})
        AND (${status ?? null} IS NULL OR tor.status=${status ?? ""})
      ORDER BY tor.created_at DESC LIMIT 100
    `));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al listar solicitudes" });
  }
});

timeRouter.post("/time-off", async (req, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId;
  const { worker_id, type = "vacation", start_date, end_date, reason } = req.body as {
    worker_id: number; type?: string; start_date: string; end_date: string; reason?: string;
  };
  if (!worker_id || !start_date || !end_date)
    return res.status(400).json({ error: "worker_id, start_date y end_date son obligatorios" });
  try {
    const d1   = new Date(start_date);
    const d2   = new Date(end_date);
    const days = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / 86400000) + 1);

    const rows = dbRows<{ id: number }>(await db.execute(sql`
      INSERT INTO time_off_requests (org_id, worker_id, type, start_date, end_date, days, reason)
      VALUES (${orgId}, ${worker_id}, ${type}, ${start_date}::date, ${end_date}::date, ${days}, ${reason ?? null})
      RETURNING id
    `));

    void emitAieEvent({
      type:    EVENT_TYPES.TIME_OFF_REQUESTED,
      orgId,
      userId,
      source:  "time",
      payload: { requestId: rows[0]!.id, workerId: worker_id, type, startDate: start_date, endDate: end_date, days },
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ id: rows[0]!.id });
  } catch (err) {
    res.status(500).json({ error: "Error al crear solicitud" });
  }
});

timeRouter.patch("/time-off/:id/review", async (req, res) => {
  const orgId     = req.orgId!;
  const userId    = req.userId;
  const requestId = Number(req.params.id);
  const { status } = req.body as { status: "approved" | "rejected" };
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "status debe ser 'approved' o 'rejected'" });
  try {
    await db.execute(sql`
      UPDATE time_off_requests SET
        status      = ${status},
        reviewed_by = ${userId ?? null},
        reviewed_at = NOW()
      WHERE id=${requestId} AND org_id=${orgId}
    `);

    void emitAieEvent({
      type:    status === "approved" ? EVENT_TYPES.TIME_OFF_APPROVED : EVENT_TYPES.TIME_OFF_REJECTED,
      orgId,
      userId,
      source:  "time",
      payload: { requestId, reviewedBy: userId },
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al revisar solicitud" });
  }
});
