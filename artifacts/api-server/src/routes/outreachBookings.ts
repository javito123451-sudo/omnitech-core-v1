/**
 * OmniSeller Fase 8 — Booking desde OmniSeller (Calendar/Booking).
 *
 * Ruta propia, montada junto al resto de infraestructura de Outreach/
 * OmniSeller (mismo criterio que routes/outreachFollowup.ts). Mismo módulo
 * (requireModule("omni_seller"), aplicado en routes/index.ts) y mismos
 * permisos que Missions/Follow-ups — omniseller.write, SIN permisos nuevos
 * (Fase 8 punto 4). El sistema de appointments tradicional (routes/
 * appointments.ts) conserva sus propios permisos calendar.* sin ningún
 * cambio — esta es una capacidad NUEVA y aparte, no una sustitución.
 *
 * orgId siempre sale de req.orgId (resuelto por requireAuth/resolveOrg más
 * arriba en la cadena) — nunca del body (Fase 8 punto 6).
 */
import { Router } from "express";
import type { Request } from "express";
import { requirePermission } from "../middlewares/permissions";
import { logAudit } from "../utils/auditLogger";
import { createAppointmentFromOmniSeller } from "../outreach/booking/omniSellerBooking";

export const outreachBookingsRouter = Router();

// POST /api/outreach/bookings — crea una cita de invitado anclada a un
// lead_contact (y, opcionalmente, a la mission que lo originó), reutilizando
// el flujo de guest booking ya existente en appointmentSkills.ts.
outreachBookingsRouter.post("/", requirePermission("omniseller.write"), async (req: Request, res) => {
  const orgId = req.orgId!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const leadContactId = Number(body["leadContactId"]);
  if (!leadContactId || !Number.isFinite(leadContactId)) {
    res.status(400).json({ error: "leadContactId es obligatorio" });
    return;
  }
  let missionId: number | null = null;
  if (body["missionId"] != null) {
    missionId = Number(body["missionId"]);
    if (!Number.isFinite(missionId)) {
      res.status(400).json({ error: "missionId debe ser numérico" });
      return;
    }
  }
  const date = typeof body["date"] === "string" ? body["date"] as string : "";
  const startTime = typeof body["startTime"] === "string" ? body["startTime"] as string : "";
  if (!date || !startTime) {
    res.status(400).json({ error: "date (YYYY-MM-DD) y startTime (HH:MM) son obligatorios" });
    return;
  }

  const result = await createAppointmentFromOmniSeller({
    orgId,
    leadContactId,
    missionId,
    date,
    startTime,
    durationMinutes: body["durationMinutes"] != null ? Number(body["durationMinutes"]) : undefined,
    title:           typeof body["title"]       === "string" ? body["title"]       as string : undefined,
    description:     typeof body["description"] === "string" ? body["description"] as string : undefined,
    location:        typeof body["location"]    === "string" ? body["location"]    as string : undefined,
    type:            typeof body["type"]        === "string" ? body["type"]        as string : undefined,
    guestName:       typeof body["guestName"]  === "string" ? body["guestName"]  as string : undefined,
    guestPhone:      typeof body["guestPhone"] === "string" ? body["guestPhone"] as string : undefined,
    guestEmail:      typeof body["guestEmail"] === "string" ? body["guestEmail"] as string : undefined,
  });

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      lead_contact_not_found: 404,
      mission_not_found:      404,
      invalid_date:           400,
      invalid_duration:       400,
      missing_guest_name:     400,
      insert_failed:          500,
    };
    res.status(statusByReason[result.reason] ?? 400).json({ error: result.reason, message: result.error });
    return;
  }

  // Auditoría específica de "booking iniciado desde OmniSeller" (Fase 8 punto
  // 8) — se añade AL LADO del log de actividad ya existente en
  // insertAppointmentWithVerification (activityTable, sin tocar), nunca en
  // sustitución. No se crea tabla ni taxonomía nueva: se reutiliza
  // auditLogsTable/logAudit, igual que el resto de OmniSeller.
  await logAudit({
    actorClerkId: req.clerkUserId ?? "unknown",
    action: "appointment.booked_from_omniseller",
    resource: "appointment",
    resourceId: result.appointment.id,
    orgId,
    details: {
      leadContactId,
      missionId: missionId ?? null,
      appointmentId: result.appointment.id,
    },
    req,
  });

  res.status(201).json(result.appointment);
});
