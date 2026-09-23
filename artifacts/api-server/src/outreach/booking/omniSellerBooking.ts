/**
 * OmniSeller Fase 8 — Booking bridge (Calendar/Booking).
 *
 * Puente MÍNIMO entre OmniSeller y el sistema de citas ya existente —
 * decisión aprobada explícitamente (Fase 7 auditoría + Fase 8 mandato,
 * punto 5): REUTILIZAR > EXTENDER > CREAR. Este archivo NO reimplementa
 * nada de appointmentSkills.ts — llama a `insertAppointmentWithVerification`
 * (la misma función, con la misma validación CRM-003, que usa
 * `createAppointment` para WhatsApp/Telegram/chat) y usa el mismo camino de
 * "guest booking" (clientId null + guestName/guestPhone/guestEmail) que ya
 * está probado en `guestAppointments.integration.test.ts`.
 *
 * NO se construye ningún motor de disponibilidad aquí (Fase 7 §5/§18: no
 * existe ninguno en todo el repo) — la cita se crea con el startTime/endTime
 * que se le pase, sin comprobar huecos ni conflictos. Esto es una limitación
 * conocida y documentada, no un descuido.
 *
 * Multi-tenancy (Fase 8 punto 6): orgId SIEMPRE viene del contexto
 * autenticado de la request (nunca del body) — ver routes/outreachBookings.ts.
 * `leadContactId` y, si se pasa, `missionId` se validan aquí explícitamente
 * contra esa misma orgId antes de tocar nada — un lead_contact o una mission
 * de otra organización se rechaza con un error claro, nunca se ignora en
 * silencio ni se usa "igualmente".
 */
import { db, leadContactsTable, missionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  insertAppointmentWithVerification,
  madridLocalToUTC,
  type AppointmentRow,
} from "../../skills/appointmentSkills";

export interface CreateOmniSellerBookingInput {
  orgId: number;
  leadContactId: number;
  missionId?: number | null;
  /** YYYY-MM-DD, hora local de Madrid (mismo formato que el skill conversacional). */
  date: string;
  /** HH:MM, hora local de Madrid. */
  startTime: string;
  durationMinutes?: number;
  title?: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  /** Si se omiten, se resuelven desde el lead_contact (punto 5 del mandato). */
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
}

export type CreateOmniSellerBookingResult =
  | { ok: true; appointment: AppointmentRow }
  | { ok: false; reason: "lead_contact_not_found" | "mission_not_found" | "invalid_date" | "invalid_duration" | "missing_guest_name" | "insert_failed"; error: string };

export async function createAppointmentFromOmniSeller(
  input: CreateOmniSellerBookingInput,
): Promise<CreateOmniSellerBookingResult> {
  // ── Multi-tenancy: leadContactId (obligatorio) y missionId (opcional)
  // deben pertenecer a la MISMA orgId que la request autenticada. Nunca se
  // confía en que el caller ya lo haya comprobado.
  const [contact] = await db.select().from(leadContactsTable)
    .where(and(eq(leadContactsTable.id, input.leadContactId), eq(leadContactsTable.orgId, input.orgId)));
  if (!contact) {
    return { ok: false, reason: "lead_contact_not_found", error: `lead_contact ${input.leadContactId} no existe en esta organización.` };
  }

  if (input.missionId != null) {
    const [mission] = await db.select().from(missionsTable)
      .where(and(eq(missionsTable.id, input.missionId), eq(missionsTable.orgId, input.orgId)));
    if (!mission) {
      return { ok: false, reason: "mission_not_found", error: `mission ${input.missionId} no existe en esta organización.` };
    }
  }

  const [y, mo, d] = input.date.split("-").map(Number);
  if (!y || !mo || !d) {
    return { ok: false, reason: "invalid_date", error: `Formato de fecha inválido: "${input.date}". Usa YYYY-MM-DD.` };
  }
  const normalizedTime = input.startTime.slice(0, 5);
  const startTime = madridLocalToUTC(input.date, normalizedTime);

  // Fase 10 (auditoría — Parte 8, validación de entrada del booking):
  // hallazgo — durationMinutes no se validaba en absoluto. Un valor
  // negativo producía una cita con endTime ANTES que startTime (nunca
  // rechazada); un valor no numérico (NaN, tras un Number(body[...]) fallido
  // en la ruta) o cero tampoco se rechazaban, y llegaban tal cual hasta el
  // INSERT. Se rechaza aquí explícitamente cualquier duración que no sea un
  // número finito y estrictamente positivo — sin límite superior arbitrario
  // (no hay ninguna razón de negocio aprobada para imponer uno en esta
  // fase; documentar, no inventar).
  const durationMinutes = input.durationMinutes ?? 60;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return {
      ok: false, reason: "invalid_duration",
      error: `durationMinutes debe ser un número positivo (recibido: ${String(input.durationMinutes)}).`,
    };
  }
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  // Resolver nombre/teléfono/email: preferir lo que pasó el caller;
  // si no, rellenar desde el lead_contact (punto 5 del mandato).
  const guestName  = (input.guestName  ?? contact.name  ?? "").trim();
  const guestPhone = input.guestPhone  ?? contact.phone ?? null;
  const guestEmail = input.guestEmail  ?? contact.email ?? null;

  if (!guestName) {
    return {
      ok: false, reason: "missing_guest_name",
      error: "No se pudo resolver un nombre para la cita (ni guestName explícito ni lead_contact.name).",
    };
  }

  const result = await insertAppointmentWithVerification({
    orgId:         input.orgId,
    clientId:      null, // OmniSeller siempre reserva vía guest booking — nunca crea/busca un client del CRM.
    guestName,
    guestPhone,
    guestEmail,
    leadContactId: input.leadContactId,
    missionId:     input.missionId ?? null,
    title:         input.title ?? "Cita (OmniSeller)",
    description:   input.description ?? null,
    location:      input.location ?? null,
    type:          input.type ?? "meeting",
    startTime,
    endTime,
    displayName:   guestName,
    activityNote:  " (invitado vía OmniSeller)",
  });

  if (!result.success) {
    return { ok: false, reason: "insert_failed", error: result.error };
  }
  return { ok: true, appointment: result.appointment };
}
