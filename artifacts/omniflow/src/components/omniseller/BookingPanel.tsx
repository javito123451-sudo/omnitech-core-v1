/**
 * OmniSeller Fase 13 — Panel "Booking".
 *
 * Conecta exclusivamente con POST /api/outreach/bookings (routes/
 * outreachBookings.ts, Fase 8), que a su vez reutiliza el guest booking ya
 * existente en appointmentSkills.ts (clientId siempre null, guestName/
 * guestPhone/guestEmail). No se construye disponibilidad, calendario,
 * recursos ni buffers — el formulario solo pide los campos que el endpoint
 * realmente admite.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, CalendarPlus, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ContactWithLeadContext, OmniSellerAppointment } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function BookingPanel({
  missionId, canWrite, contacts,
}: {
  missionId: number; canWrite: boolean; contacts: ContactWithLeadContext[];
}) {
  const { toast } = useToast();
  const [contactId, setContactId] = useState<number | "">("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [created, setCreated] = useState<OmniSellerAppointment | null>(null);

  const contact = contacts.find(c => c.id === contactId) ?? null;

  function onSelectContact(v: string) {
    const c = contacts.find(x => x.id === Number(v)) ?? null;
    setContactId(c ? c.id : "");
    setGuestName(c?.name ?? "");
    setGuestPhone(c?.phone ?? "");
    setGuestEmail(c?.email ?? "");
    setCreated(null);
  }

  const mut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/outreach/bookings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadContactId: contactId,
          missionId,
          date,
          startTime,
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          guestName: guestName || undefined,
          guestPhone: guestPhone || undefined,
          guestEmail: guestEmail || undefined,
        }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "No se pudo crear la cita");
        return d as OmniSellerAppointment;
      }),
    onSuccess: (d) => { setCreated(d); toast({ title: "Cita creada" }); },
    onError: (err: Error) => toast({ title: "No se pudo crear la cita", description: err.message, variant: "destructive" }),
  });

  const canSubmit = !!contactId && !!date && !!startTime;

  return (
    <div className="space-y-4" data-testid="booking-panel">
      <div>
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><CalendarPlus size={14} className="text-violet-400" /> Booking</h3>
        <p className="text-slate-500 text-xs mt-0.5">
          Cita de invitado (sin cliente CRM) anclada a un contacto encontrado — 0 créditos. Sin comprobación de disponibilidad ni calendario externo.
        </p>
      </div>

      {contacts.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8 text-center" data-testid="booking-no-contacts">
          <p className="text-slate-400 text-sm">Todavía no hay contactos encontrados en esta sesión.</p>
          <p className="text-slate-600 text-xs mt-1">Ve a la pestaña Prospectos y pulsa "Buscar contactos" sobre un prospecto.</p>
        </div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <div>
            <Label className="text-slate-400">Contacto *</Label>
            <Select value={contactId === "" ? undefined : String(contactId)} onValueChange={onSelectContact}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1" data-testid="booking-contact-select">
                <SelectValue placeholder="Elige un contacto" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name ?? "Sin nombre"} — {c.leadName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-400">Fecha *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" data-testid="booking-date" />
            </div>
            <div>
              <Label className="text-slate-400">Hora *</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" data-testid="booking-time" />
            </div>
          </div>
          <div>
            <Label className="text-slate-400">Duración (minutos)</Label>
            <Input type="number" min={1} value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1 max-w-[140px]" />
          </div>

          {contact && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-white/[0.06]">
              <div>
                <Label className="text-slate-400">Nombre del invitado</Label>
                <Input value={guestName} onChange={e => setGuestName(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-400">Teléfono</Label>
                <Input value={guestPhone} onChange={e => setGuestPhone(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-400">Email</Label>
                <Input value={guestEmail} onChange={e => setGuestEmail(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
          )}

          <Button
            onClick={() => mut.mutate()} disabled={!canWrite || !canSubmit || mut.isPending}
            className="bg-violet-600 hover:bg-violet-700" data-testid="create-booking-btn"
          >
            {mut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <CalendarPlus size={16} className="mr-2" />}
            Crear cita
          </Button>

          {created && (
            <p className="text-emerald-400 text-sm flex items-center gap-1.5" data-testid="booking-created"><CheckCircle2 size={16} /> Cita creada (id {created.id}) — 0 créditos.</p>
          )}
          {mut.isError && (
            <p className="text-red-400 text-sm flex items-center gap-1.5"><AlertCircle size={16} /> {(mut.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}
