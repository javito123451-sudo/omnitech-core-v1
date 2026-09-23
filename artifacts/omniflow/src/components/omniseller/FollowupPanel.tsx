/**
 * OmniSeller Fase 13 — Panel "Follow-up".
 *
 * Solo visualiza y permite cancelar — la cadencia (followupEngine.ts) y el
 * motor de secuencias (followupService.ts) siguen viviendo exclusivamente
 * en backend, sin ninguna lógica duplicada aquí.
 *
 * Reutiliza:
 *  - GET  /api/outreach/followups?missionId=...   (routes/outreachFollowup.ts)
 *  - POST /api/outreach/followups/:id/cancel
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarClock, Ban, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FollowupRow } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  scheduled:            { label: "Programado",   cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  due:                  { label: "Vencido",       cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  processing:           { label: "Procesando",    cls: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  pending_confirmation: { label: "Pend. confirmación", cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  sent:                 { label: "Enviado",       cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  skipped:              { label: "Omitido",       cls: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  cancelled:            { label: "Cancelado",     cls: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  failed:                { label: "Fallido",       cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  blocked:              { label: "Bloqueado",     cls: "bg-red-500/20 text-red-400 border-red-500/30" },
};
const TERMINAL = new Set(["cancelled", "sent", "failed"]);

export function FollowupPanel({ missionId, canWrite }: { missionId: number; canWrite: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery<FollowupRow[]>({
    queryKey: ["missionFollowups", missionId],
    queryFn: () => authFetch(`${BASE}/api/outreach/followups?missionId=${missionId}`).then(r => r.json()),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) =>
      authFetch(`${BASE}/api/outreach/followups/${id}/cancel`, { method: "POST" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "No se pudo cancelar");
        return d as { leadMessageId: number; cancelledCount: number };
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["missionFollowups", missionId] });
      toast({ title: `Secuencia cancelada (${d.cancelledCount} intento(s))` });
    },
    onError: (err: Error) => toast({ title: "No se pudo cancelar la secuencia", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="followup-panel">
      <div>
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Repeat size={14} className="text-violet-400" /> Follow-up</h3>
        <p className="text-slate-500 text-xs mt-0.5">Secuencias automáticas de seguimiento sobre mensajes ya enviados — la cadencia la decide el backend.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-violet-400" /></div>
      ) : isError ? (
        <p className="text-red-400 text-sm">No se pudieron cargar las secuencias de Follow-up.</p>
      ) : !data || data.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8 text-center" data-testid="followup-empty">
          <CalendarClock size={24} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">Todavía no hay secuencias de Follow-up para esta misión.</p>
          <p className="text-slate-600 text-xs mt-1">Se crean automáticamente tras un envío de Outreach confirmado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(f => {
            const s = STATUS_LABEL[f.status] ?? { label: f.status, cls: "bg-slate-500/20 text-slate-400 border-slate-500/30" };
            return (
              <div key={f.id} className="flex items-center justify-between bg-white/[0.02] rounded-xl p-4" data-testid={`followup-row-${f.id}`}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-sm font-medium">Intento {f.attempt}/{f.maxAttempts}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${s.cls}`}>{s.label}</span>
                    <span className="text-slate-500 text-xs">{f.channel}</span>
                  </div>
                  <p className="text-slate-500 text-xs">
                    Próximo envío: {new Date(f.nextRunAt).toLocaleString("es-ES")}
                    {f.reason ? ` · ${f.reason}` : ""}
                  </p>
                </div>
                <Button
                  size="sm" variant="outline" className="border-white/10 text-slate-300 hover:text-white"
                  disabled={!canWrite || TERMINAL.has(f.status) || cancelMut.isPending}
                  onClick={() => cancelMut.mutate(f.id)}
                  data-testid={`cancel-followup-${f.id}`}
                >
                  {cancelMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Ban size={14} className="mr-1.5" />}
                  Cancelar
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
