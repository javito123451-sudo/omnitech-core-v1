import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Mail, Search, Loader2, Send, Link2, CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type InvStatus = "pending" | "accepted" | "expired";

interface Invitation {
  id: number;
  orgId: number;
  orgName: string;
  email: string;
  role: string;
  status: InvStatus;
  sendFailed: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  lastSentAt: string | null;
  lastSendError: string | null;
}

const STATUS_LABEL: Record<InvStatus, string> = {
  pending: "Pendiente", accepted: "Aceptada", expired: "Caducada",
};
const STATUS_STYLE: Record<InvStatus, string> = {
  pending:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  accepted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  expired:  "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const STATUS_ICON: Record<InvStatus, React.ElementType> = {
  pending: Clock, accepted: CheckCircle2, expired: XCircle,
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function InvitationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const initialOrg = new URLSearchParams(window.location.search).get("org") ?? "";
  const [q, setQ] = useState("");
  const [orgId, setOrgId] = useState(initialOrg);
  const [status, setStatus] = useState("");

  const { data: workspaces = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["cc-workspaces-lite"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/control-center/workspaces`);
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.workspaces ?? []);
      return list.map((w: { id: number; name: string }) => ({ id: w.id, name: w.name }));
    },
  });

  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);

  const { data, isLoading, isError } = useQuery<{ invitations: Invitation[] }>({
    queryKey: ["cc-invitations", orgId, q, status],
    queryFn: async () => {
      const r = await authFetch(`${BASE}/api/control-center/invitations?${params.toString()}`);
      if (!r.ok) throw new Error("No se pudieron cargar las invitaciones");
      return r.json();
    },
  });
  const invitations = data?.invitations ?? [];

  const resendMut = useMutation({
    mutationFn: async (inv: Invitation) => {
      const r = await authFetch(`${BASE}/api/control-center/invitations/${inv.id}/resend`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Error al reenviar");
      return j as { emailSent: boolean; emailError: string | null; acceptUrl: string; renewed: boolean; message: string };
    },
    onSuccess: async (res, inv) => {
      qc.invalidateQueries({ queryKey: ["cc-invitations"] });
      if (res.emailSent) {
        toast({ title: res.renewed ? "Invitación renovada y reenviada" : "Invitación reenviada", description: `Email enviado a ${inv.email}.` });
      } else {
        const copied = await copyText(res.acceptUrl);
        toast({
          title: "El email NO se pudo enviar",
          description: `${res.emailError ?? "Error del proveedor"}. ${copied ? "He copiado el enlace al portapapeles: pásaselo por WhatsApp." : "Usa «Copiar enlace»."}`,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => toast({ title: "Error al reenviar", description: e.message, variant: "destructive" }),
  });

  const linkMut = useMutation({
    mutationFn: async (inv: Invitation) => {
      const r = await authFetch(`${BASE}/api/control-center/invitations/${inv.id}/link`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo obtener el enlace");
      return j as { acceptUrl: string };
    },
    onSuccess: async (res) => {
      const copied = await copyText(res.acceptUrl);
      toast(copied
        ? { title: "Enlace copiado", description: "Pégalo en un mensaje al usuario. Es de un solo uso y caduca en la fecha indicada." }
        : { title: "No se pudo copiar automáticamente", description: res.acceptUrl });
    },
    onError: (e: Error) => toast({ title: "Enlace no disponible", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Mail className="w-6 h-6 text-violet-400" />
        <h1 className="text-xl font-bold text-white">Invitaciones</h1>
      </div>
      <p className="text-sm text-slate-400 mb-5">
        Todas las invitaciones enviadas a la plataforma. Si el email falla, copia el enlace y pásaselo al usuario.
      </p>

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por email…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <select value={orgId} onChange={e => setOrgId(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
          <option value="">Todos los workspaces</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
          <option value="">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="accepted">Aceptadas</option>
          <option value="expired">Caducadas</option>
        </select>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-violet-400" /></div>}
      {isError && <p className="text-red-400 text-sm py-8 text-center">No se pudieron cargar las invitaciones.</p>}
      {!isLoading && !isError && invitations.length === 0 && (
        <p className="text-slate-500 text-sm py-12 text-center">No hay invitaciones con estos filtros.</p>
      )}

      <div className="space-y-3">
        {invitations.map(inv => {
          const Icon = STATUS_ICON[inv.status];
          const canAct = inv.status !== "accepted";
          return (
            <div key={inv.id} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-medium truncate">{inv.email}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{inv.orgName} · rol {inv.role}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLE[inv.status]}`}>
                  <Icon size={12} /> {STATUS_LABEL[inv.status]}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                <div><p className="text-slate-500">Creada</p><p className="text-slate-200">{fmt(inv.createdAt)}</p></div>
                <div><p className="text-slate-500">Último envío</p><p className="text-slate-200">{inv.lastSentAt ? fmt(inv.lastSentAt) : "Sin registro"}</p></div>
                <div><p className="text-slate-500">Caduca</p><p className="text-slate-200">{fmt(inv.expiresAt)}</p></div>
                <div><p className="text-slate-500">Aceptada</p><p className="text-slate-200">{fmt(inv.acceptedAt)}</p></div>
              </div>

              {inv.sendFailed && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>El último envío del email falló: {inv.lastSendError}</span>
                </div>
              )}

              {canAct && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => resendMut.mutate(inv)}
                    disabled={resendMut.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {resendMut.isPending && resendMut.variables?.id === inv.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {inv.status === "expired" ? "Renovar y reenviar" : "Reenviar"}
                  </button>
                  {inv.status === "pending" && (
                    <button
                      onClick={() => linkMut.mutate(inv)}
                      disabled={linkMut.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white text-xs font-medium disabled:opacity-50"
                    >
                      <Link2 size={12} /> Copiar enlace
                    </button>
                  )}
                </div>
              )}
              {inv.status === "accepted" && (
                <p className="mt-3 text-xs text-slate-500">Ya aceptada: el usuario debe entrar con su cuenta existente.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
