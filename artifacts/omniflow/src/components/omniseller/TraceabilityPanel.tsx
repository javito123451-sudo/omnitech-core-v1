/**
 * OmniSeller Fase 16 — Panel "Trazabilidad".
 *
 * Solo lectura. Reutiliza EXACTAMENTE GET /api/missions/:id/audit
 * (routes/missions.ts, Fase 16), que a su vez reutiliza auditLogsTable
 * (misma tabla que ya escriben missions.ts/outreachBookings.ts/
 * outreachFollowup.ts en cada acción relevante) — ningún dato ni
 * arquitectura nueva. No sustituye ni expone el audit endpoint de
 * plataforma (GET /api/control-center/audit, requireSuperAdmin), que sigue
 * intacto para superadmins.
 */
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Loader2, History, AlertTriangle } from "lucide-react";
import type { AuditEntry } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SEVERITY_CLS: Record<string, string> = {
  info:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
  warning:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function TraceabilityPanel({ missionId }: { missionId: number }) {
  const { data, isLoading, isError } = useQuery<{ missionId: number; entries: AuditEntry[] }>({
    queryKey: ["missionAudit", missionId],
    queryFn: () => authFetch(`${BASE}/api/missions/${missionId}/audit`).then(r => r.json()),
  });

  return (
    <div className="space-y-4" data-testid="traceability-panel">
      <div>
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><History size={14} className="text-violet-400" /> Trazabilidad</h3>
        <p className="text-slate-500 text-xs mt-0.5">Historial de acciones registradas sobre esta misión — solo lectura.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-violet-400" /></div>
      ) : isError ? (
        <p className="text-red-400 text-sm flex items-center gap-1.5"><AlertTriangle size={16} /> No se pudo cargar la trazabilidad de esta misión.</p>
      ) : !data || data.entries.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8 text-center" data-testid="traceability-empty">
          <History size={24} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">Todavía no hay acciones registradas para esta misión.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.entries.map(e => (
            <div key={e.id} className="flex items-center justify-between bg-white/[0.02] rounded-xl p-4" data-testid={`audit-row-${e.id}`}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white text-sm font-medium">{e.action}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${SEVERITY_CLS[e.severity] ?? SEVERITY_CLS.info}`}>{e.severity}</span>
                </div>
                <p className="text-slate-500 text-xs">{e.actorEmail ?? "—"}</p>
              </div>
              <span className="text-slate-600 text-xs">{new Date(e.createdAt).toLocaleString("es-ES")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
