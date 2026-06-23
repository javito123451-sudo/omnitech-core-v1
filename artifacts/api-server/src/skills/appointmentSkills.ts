// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Appointment Skills (CRM fuente de verdad)
//  Unified implementation: used by web, WhatsApp, Telegram, internal
// ═══════════════════════════════════════════════════════════════════════════

import {
  db, clientsTable, appointmentsTable, activityTable,
} from "@workspace/db";
import { eq, and, asc, desc, gte, lt, inArray, ilike } from "drizzle-orm";
import type { SkillDefinition, SkillContext } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Timezone helpers (Europe/Madrid)
// ═══════════════════════════════════════════════════════════════════════════

export function madridLocalToUTC(dateStr: string, timeStr: string): Date {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const [h,  m_]     = timeStr.split(":").map(Number);
  const probe = new Date(Date.UTC(yr!, mo! - 1, dy!, h!, m_!, 0));
  const fmt   = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts  = fmt.formatToParts(probe);
  const mh     = parseInt(parts.find(p => p.type === "hour")!.value,   10);
  const mmVal  = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMin = (h! * 60 + m_!) - (mh * 60 + mmVal);
  return new Date(probe.getTime() + shiftMin * 60_000);
}

export function apptTimeDisplay(d: Date): string {
  return d.toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function apptDateDisplay(d: Date): string {
  return d.toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

export function getMadridDayBounds(offsetDays: number): { start: Date; end: Date } {
  const now = new Date();
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, 0, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts = fmt.formatToParts(base);
  const yr = parseInt(parts.find(p => p.type === "year")!.value, 10);
  const mo = parseInt(parts.find(p => p.type === "month")!.value, 10);
  const dy = parseInt(parts.find(p => p.type === "day")!.value, 10);
  const h  = parseInt(parts.find(p => p.type === "hour")!.value, 10);
  const m  = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMs = base.getTime() - Date.UTC(yr, mo - 1, dy, h, m, 0);
  const start = new Date(Date.UTC(yr, mo - 1, dy, 0, 0, 0) - shiftMs);
  const end   = new Date(Date.UTC(yr, mo - 1, dy, 23, 59, 59, 999) - shiftMs);
  return { start, end };
}

export function getMadridWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = getMadridDayBounds(mondayOffset).start;
  const end   = getMadridDayBounds(mondayOffset + 6).end;
  return { start, end };
}

export function getMadridMonthStart(): Date {
  const now = new Date();
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts = fmt.formatToParts(base);
  const yr = parseInt(parts.find(p => p.type === "year")!.value, 10);
  const mo = parseInt(parts.find(p => p.type === "month")!.value, 10);
  const dy = parseInt(parts.find(p => p.type === "day")!.value, 10);
  const h  = parseInt(parts.find(p => p.type === "hour")!.value, 10);
  const m  = parseInt(parts.find(p => p.type === "minute")!.value, 10);
  const shiftMs = base.getTime() - Date.UTC(yr, mo - 1, dy, h, m, 0);
  return new Date(Date.UTC(yr, mo - 1, dy, 0, 0, 0) - shiftMs);
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill: createAppointment
// ═══════════════════════════════════════════════════════════════════════════

async function createAppointment(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const title           = String(params["title"]            ?? "Cita");
  const dateStr         = String(params["date"]             ?? "");
  const startTimeStr    = String(params["start_time"]       ?? "10:00");
  const durationMinutes = Number(params["duration_minutes"] ?? 60);
  const description     = params["description"] ? String(params["description"]) : null;
  const location        = params["location"]    ? String(params["location"])    : null;
  const apptType        = String(params["type"]  ?? "meeting");
  const clientNameArg   = String(params["client_name"] ?? "");

  if (!dateStr) {
    return JSON.stringify({ error: "Falta la fecha de la cita (formato YYYY-MM-DD)." });
  }

  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!y || !mo || !d) {
    return JSON.stringify({ error: `Formato de fecha inválido: "${dateStr}". Usa YYYY-MM-DD.` });
  }
  const normalizedTime = startTimeStr.slice(0, 5);
  const startTime = madridLocalToUTC(dateStr, normalizedTime);
  const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);

  // Resolve client: prefer context client, then search by name, then fail
  let resolvedClient = context.client ?? null;
  if (!resolvedClient && clientNameArg) {
    const matched = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.name, `%${clientNameArg}%`)))
      .limit(5);
    if (matched.length > 0) resolvedClient = matched[0]!;
  }
  if (!resolvedClient) {
    return JSON.stringify({ error: "No se pudo identificar el cliente. Proporciona client_name o inicia desde un canal vinculado." });
  }

  const [appointment] = await db.insert(appointmentsTable).values({
    orgId,
    clientId:    resolvedClient.id,
    title,
    description,
    startTime,
    endTime,
    status:      "pending",
    type:        apptType,
    location,
    reminder:    false,
  }).returning();

  // CRM-003: DB READ-BACK VALIDATION
  if (!appointment) {
    return JSON.stringify({ error: "Error al crear la cita: la inserción no devolvió registro." });
  }
  const [saved] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, appointment.id), eq(appointmentsTable.orgId, orgId)));
  if (!saved || Math.abs(saved.startTime.getTime() - startTime.getTime()) > 60_000) {
    return JSON.stringify({ error: "Error de validación: la cita no se pudo verificar en la base de datos." });
  }

  const localDate = apptDateDisplay(saved.startTime);
  const localTime = apptTimeDisplay(saved.startTime);

  await db.insert(activityTable).values({
    orgId,
    type:        "appointment_scheduled",
    description: `Cita "${title}" agendada con ${resolvedClient.name} para el ${localDate} a las ${localTime}`,
    clientName:  resolvedClient.name,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:       true,
    dbVerified:    true,
    appointmentId: saved.id,
    clientName:    resolvedClient.name,
    title,
    date:          localDate,
    time:          localTime,
    duration:      durationMinutes,
    status:        "pending",
    type:          apptType,
    description,
    location,
    message:       `Cita #${saved.id} creada correctamente para ${resolvedClient.name} el ${localDate} a las ${localTime}.`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill: rescheduleAppointment
// ═══════════════════════════════════════════════════════════════════════════

async function rescheduleAppointment(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const appointmentIdArg = params["appointment_id"] ? Number(params["appointment_id"]) : null;
  const newDateStr       = String(params["new_date"]       ?? "");
  const newStartTimeStr  = String(params["new_start_time"] ?? "10:00");
  const durationArg      = params["duration_minutes"] != null ? Number(params["duration_minutes"]) : null;

  if (!newDateStr || !newStartTimeStr) {
    return JSON.stringify({ error: "Se necesitan new_date y new_start_time." });
  }

  // Resolve appointment
  let existing: typeof appointmentsTable.$inferSelect | undefined;
  if (appointmentIdArg) {
    [existing] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
  } else if (context.client) {
    const now = new Date();
    const candidates = await db.select().from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.orgId, orgId),
        eq(appointmentsTable.clientId, context.client.id),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
        gte(appointmentsTable.startTime, now),
      ))
      .orderBy(asc(appointmentsTable.startTime))
      .limit(1);
    existing = candidates[0];
    if (!existing) {
      const all = await db.select().from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.orgId, orgId),
          eq(appointmentsTable.clientId, context.client.id),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
        ))
        .orderBy(asc(appointmentsTable.startTime))
        .limit(1);
      existing = all[0];
    }
  }

  if (!existing) {
    return JSON.stringify({ error: "No se encontró ninguna cita activa (pending/confirmed) para reprogramar." });
  }
  if (existing.status === "rescheduled" || existing.status === "cancelled") {
    return JSON.stringify({ error: `La cita #${existing.id} ya está "${existing.status}" y no se puede reprogramar.` });
  }

  const [y, mo, d] = newDateStr.split("-").map(Number);
  if (!y || !mo || !d) {
    return JSON.stringify({ error: `Fecha inválida: "${newDateStr}". Usa formato YYYY-MM-DD.` });
  }
  const normalizedNewTime = newStartTimeStr.slice(0, 5);
  const newStartTime = madridLocalToUTC(newDateStr, normalizedNewTime);
  const existingDur = Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60_000);
  const effectiveDur = durationArg ?? existingDur;
  const newEndTime = new Date(newStartTime.getTime() + effectiveDur * 60_000);

  // Step 1: mark old as rescheduled
  await db.update(appointmentsTable)
    .set({ status: "rescheduled" })
    .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

  // CRM-003: DB read-back validation — confirm old appointment was updated
  const [oldVerified] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
  if (!oldVerified || oldVerified.status !== "rescheduled") {
    return JSON.stringify({
      error: `Error al marcar la cita original #${existing.id} como reprogramada. Estado actual: ${oldVerified?.status ?? "desconocido"}. No se creó la nueva cita.`,
    });
  }

  // Step 2: create new appointment
  const [newAppt] = await db.insert(appointmentsTable).values({
    orgId,
    clientId:    existing.clientId,
    title:       existing.title,
    description: existing.description ?? undefined,
    type:        existing.type        ?? undefined,
    location:    existing.location    ?? undefined,
    tags:        existing.tags        ?? undefined,
    startTime:   newStartTime,
    endTime:     newEndTime,
    status:      "pending",
    reminder:    existing.reminder,
  }).returning();

  if (!newAppt) {
    await db.update(appointmentsTable)
      .set({ status: existing.status })
      .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
    return JSON.stringify({ error: "Error al crear la nueva cita. Se restauró la cita original." });
  }

  // DB read-back validation
  const [verified] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, newAppt.id), eq(appointmentsTable.orgId, orgId)));
  if (!verified || Math.abs(verified.startTime.getTime() - newStartTime.getTime()) > 60_000) {
    return JSON.stringify({ error: "Error de validación: la nueva cita no se creó correctamente en la base de datos." });
  }

  const localDate = apptDateDisplay(verified.startTime);
  const localTime = apptTimeDisplay(verified.startTime);

  await db.insert(activityTable).values({
    orgId,
    type:        "appointment_rescheduled",
    description: `Cita #${existing.id} "${existing.title}" marcada como reprogramada → nueva cita #${newAppt.id}: ${localDate} a las ${localTime}`,
    clientName:  null,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:          true,
    dbVerified:       true,
    oldAppointmentId: existing.id,
    newAppointmentId: newAppt.id,
    title:            existing.title,
    newDate:          localDate,
    newTime:          localTime,
    duration:         effectiveDur,
    status:           "pending",
    message:          `Tu cita ha sido reprogramada para ${localDate} a las ${localTime}.`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill: cancelAppointment
// ═══════════════════════════════════════════════════════════════════════════

async function cancelAppointment(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const appointmentIdArg = params["appointment_id"] ? Number(params["appointment_id"]) : null;
  const reason           = params["reason"] ? String(params["reason"]) : null;

  let existing: typeof appointmentsTable.$inferSelect | undefined;
  if (appointmentIdArg) {
    [existing] = await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, appointmentIdArg), eq(appointmentsTable.orgId, orgId)));
  } else if (context.client) {
    const now = new Date();
    const candidates = await db.select().from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.orgId, orgId),
        eq(appointmentsTable.clientId, context.client.id),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
        gte(appointmentsTable.startTime, now),
      ))
      .orderBy(asc(appointmentsTable.startTime))
      .limit(1);
    existing = candidates[0];
    if (!existing) {
      const all = await db.select().from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.orgId, orgId),
          eq(appointmentsTable.clientId, context.client.id),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
        ))
        .orderBy(asc(appointmentsTable.startTime))
        .limit(1);
      existing = all[0];
    }
  }

  if (!existing) {
    return JSON.stringify({ error: "No se encontró ninguna cita activa (pending/confirmed) para cancelar." });
  }
  if (existing.status === "cancelled") {
    return JSON.stringify({ error: `La cita #${existing.id} "${existing.title}" ya estaba cancelada.` });
  }

  await db.update(appointmentsTable)
    .set({ status: "cancelled" })
    .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));

  const [verified] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, existing.id), eq(appointmentsTable.orgId, orgId)));
  if (!verified || verified.status !== "cancelled") {
    return JSON.stringify({ error: "Error de validación: no se pudo confirmar la cancelación en la base de datos." });
  }

  const cancelledDate = apptDateDisplay(existing.startTime);
  const cancelledTime = apptTimeDisplay(existing.startTime);

  await db.insert(activityTable).values({
    orgId,
    type:        "appointment_cancelled",
    description: `Cita #${existing.id} "${existing.title}" (${cancelledDate} ${cancelledTime}) cancelada${reason ? `: ${reason}` : ""}`,
    clientName:  context.client?.name ?? null,
  }).catch(() => {/* non-critical */});

  return JSON.stringify({
    success:       true,
    dbVerified:    true,
    appointmentId: existing.id,
    title:         existing.title,
    cancelledDate,
    cancelledTime,
    status:        "cancelled",
    reason,
    message:       "Tu cita ha sido cancelada correctamente.",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill: getAppointments
// ═══════════════════════════════════════════════════════════════════════════

async function getAppointments(
  params: Record<string, unknown>,
  orgId: number,
  context: SkillContext,
): Promise<string> {
  const dateFilter   = String(params["date_filter"]   ?? "all");
  const statusFilter = String(params["status_filter"] ?? "active");
  const limit        = Math.min(Number(params["limit"] ?? 20), 50);
  const now          = new Date();

  let dateCondition: ReturnType<typeof and> | undefined;
  if (dateFilter === "today") {
    const { start, end } = getMadridDayBounds(0);
    dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
  } else if (dateFilter === "tomorrow") {
    const { start, end } = getMadridDayBounds(1);
    dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
  } else if (dateFilter === "this_week") {
    const { start, end } = getMadridWeekBounds();
    dateCondition = and(gte(appointmentsTable.startTime, start), lt(appointmentsTable.startTime, end));
  } else if (dateFilter === "upcoming") {
    dateCondition = gte(appointmentsTable.startTime, now);
  } else if (dateFilter === "past") {
    dateCondition = lt(appointmentsTable.startTime, now);
  }

  const activeStatuses = ["pending", "confirmed"];
  const statusCondition =
    statusFilter === "all"    ? undefined :
    statusFilter === "active" ? inArray(appointmentsTable.status, activeStatuses) :
    eq(appointmentsTable.status, statusFilter);

  const conditions = [
    eq(appointmentsTable.orgId, orgId),
    dateCondition,
    statusCondition,
  ].filter(Boolean);

  const orderDir = dateFilter === "past" ? desc(appointmentsTable.startTime) : asc(appointmentsTable.startTime);

  const rows = await db
    .select({
      id:            appointmentsTable.id,
      title:         appointmentsTable.title,
      description:   appointmentsTable.description,
      startTime:     appointmentsTable.startTime,
      endTime:       appointmentsTable.endTime,
      status:        appointmentsTable.status,
      type:          appointmentsTable.type,
      location:      appointmentsTable.location,
      clientId:      appointmentsTable.clientId,
      clientName:    clientsTable.name,
      clientCompany: clientsTable.company,
    })
    .from(appointmentsTable)
    .leftJoin(clientsTable, eq(appointmentsTable.clientId, clientsTable.id))
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions as Parameters<typeof and>))
    .orderBy(orderDir)
    .limit(limit);

  // If client context provided, filter to that client only
  const filtered = context.client
    ? rows.filter(r => r.clientId === context.client!.id)
    : rows;

  return JSON.stringify({
    total: filtered.length,
    date_filter: dateFilter,
    queried_at: now.toISOString(),
    appointments: filtered.map(r => ({
      id:            r.id,
      title:         r.title,
      description:   r.description ?? null,
      startTime:     r.startTime.toISOString(),
      endTime:       r.endTime.toISOString(),
      status:        r.status,
      statusLabel:   { pending: "⏳ Pendiente", confirmed: "✅ Confirmada", completed: "✔️ Completada", cancelled: "❌ Cancelada" }[r.status] ?? r.status,
      type:          r.type ?? null,
      location:      r.location ?? null,
      clientName:    r.clientName ?? null,
      clientCompany: r.clientCompany ?? null,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill definitions
// ═══════════════════════════════════════════════════════════════════════════

export const createAppointmentSkill: SkillDefinition = {
  id: "create_appointment",
  name: "Crear Cita",
  description: "Crea una nueva cita en el CRM para un cliente. Requiere fecha, hora y cliente.",
  params: [
    { name: "client_name", type: "string", description: "Nombre del cliente (o usar contexto del canal)", required: false },
    { name: "title", type: "string", description: "Título de la cita", default: "Cita" },
    { name: "date", type: "date", description: "Fecha (YYYY-MM-DD)", required: true },
    { name: "start_time", type: "time", description: "Hora de inicio (HH:MM)", default: "10:00" },
    { name: "duration_minutes", type: "number", description: "Duración en minutos", default: 60 },
    { name: "description", type: "string", description: "Descripción opcional", required: false },
    { name: "location", type: "string", description: "Ubicación opcional", required: false },
    { name: "type", type: "string", description: "Tipo: meeting, call, demo, etc.", default: "meeting" },
  ],
  execute: createAppointment,
};

export const rescheduleAppointmentSkill: SkillDefinition = {
  id: "reschedule_appointment",
  name: "Reprogramar Cita",
  description: "Marca una cita como reprogramada y crea una nueva con fecha/hora diferente.",
  params: [
    { name: "appointment_id", type: "number", description: "ID de la cita (o se usa el cliente del contexto)", required: false },
    { name: "new_date", type: "date", description: "Nueva fecha (YYYY-MM-DD)", required: true },
    { name: "new_start_time", type: "time", description: "Nueva hora (HH:MM)", default: "10:00" },
    { name: "duration_minutes", type: "number", description: "Nueva duración (si no se usa la original)", required: false },
  ],
  execute: rescheduleAppointment,
};

export const cancelAppointmentSkill: SkillDefinition = {
  id: "cancel_appointment",
  name: "Cancelar Cita",
  description: "Cancela una cita activa. Se puede especificar ID o se usa el cliente del contexto.",
  params: [
    { name: "appointment_id", type: "number", description: "ID de la cita", required: false },
    { name: "reason", type: "string", description: "Motivo de la cancelación", required: false },
  ],
  execute: cancelAppointment,
};

export const getAppointmentsSkill: SkillDefinition = {
  id: "get_appointments",
  name: "Consultar Citas",
  description: "Consulta citas del CRM. Puede filtrar por fecha, estado y cliente.",
  params: [
    { name: "date_filter", type: "string", description: "today, tomorrow, this_week, upcoming, past, all", default: "all" },
    { name: "status_filter", type: "string", description: "active, pending, confirmed, all", default: "active" },
    { name: "limit", type: "number", description: "Máximo de resultados", default: 20 },
  ],
  execute: getAppointments,
};
