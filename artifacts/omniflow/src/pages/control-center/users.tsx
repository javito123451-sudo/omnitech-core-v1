import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Users, Search, Shield, Building2, Crown, Loader2, UserX, UserCheck2,
  ChevronDown, X, AlertTriangle, CheckCircle2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgEntry { orgId: number; orgName: string | null; orgRole: string; isSuspended: boolean }
interface PlatformUser {
  id: number; clerkId: string; email: string; name: string | null;
  status: string; suspendedAt: string | null; suspendedReason: string | null;
  orgs: OrgEntry[];
  orgId: number | null; orgName: string | null; orgRole: string | null;
  platformRole: string | null; createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner:          "bg-amber-500/20 text-amber-400",
  admin:          "bg-blue-500/20 text-blue-400",
  member:         "bg-slate-500/20 text-slate-300",
  read_only:      "bg-slate-600/20 text-slate-400",
  SUPER_ADMIN:    "bg-violet-500/20 text-violet-400",
  STAFF_OMNITECH: "bg-pink-500/20 text-pink-400",
};
const CRM_ROLES = ["owner", "admin", "member", "read_only"] as const;

function RoleDropdown({ user, onSuccess }: { user: PlatformUser; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: ({ role }: { role: string }) => authFetch(`${BASE}/api/control-center/users/${user.clerkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: user.orgId, role }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-users"] }); setOpen(false); onSuccess(); },
  });

  if (!user.orgId || !user.orgRole) return <span className="text-slate-600 text-sm">—</span>;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize flex items-center gap-1.5 ${ROLE_COLORS[user.orgRole] ?? ROLE_COLORS.member}`}
      >
        {user.orgRole}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-40 bg-[#0d0e1e] border border-white/10 rounded-xl p-1 shadow-2xl min-w-[140px]">
            {CRM_ROLES.map(r => (
              <button
                key={r}
                disabled={r === user.orgRole || mut.isPending}
                onClick={() => mut.mutate({ role: r })}
                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-all capitalize flex items-center gap-2 ${r === user.orgRole ? "text-white bg-violet-600/20 cursor-default" : "text-slate-400 hover:text-white hover:bg-white/5"}`}
              >
                {mut.isPending && r !== user.orgRole ? <Loader2 size={11} className="animate-spin" /> : null}
                {r}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SuspendUserModal({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const isActive = user.status === "active";

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/users/${user.clerkId}/${isActive ? "suspend" : "activate"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-users"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-[#0d0e1e] border rounded-2xl p-6 w-full max-w-md ${isActive ? "border-red-500/20" : "border-emerald-500/20"}`}>
        <div className="flex items-center gap-3 mb-4">
          {isActive ? <UserX size={28} className="text-red-400" /> : <UserCheck2 size={28} className="text-emerald-400" />}
          <div>
            <h2 className="text-white font-semibold">{isActive ? "Suspender usuario" : "Activar usuario"}</h2>
            <p className="text-slate-500 text-sm">{user.email}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        {isActive ? (
          <>
            <p className="text-slate-400 text-sm mb-4">
              El usuario <strong className="text-white">perderá acceso inmediatamente</strong> al CRM.
            </p>
            <label className="block text-xs text-slate-500 mb-1.5">Motivo (opcional)</label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Describe el motivo..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-red-500 mb-4"
            />
          </>
        ) : (
          <p className="text-slate-400 text-sm mb-6">
            Se restaurará el acceso del usuario al CRM.
            {user.suspendedReason && <span className="block mt-2 text-xs text-slate-500">Motivo de suspensión: "{user.suspendedReason}"</span>}
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 ${isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : isActive ? <UserX size={15} /> : <UserCheck2 size={15} />}
            {isActive ? "Suspender" : "Activar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch]       = useState("");
  const [suspendUser, setSuspend] = useState<PlatformUser | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const { data: users = [], isLoading } = useQuery<PlatformUser[]>({
    queryKey: ["cc-users"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/users`).then(r => r.json()),
  });

  const filtered = users.filter(u =>
    !search ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.orgName?.toLowerCase().includes(search.toLowerCase()) ||
    u.name?.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount    = users.filter(u => u.status === "active").length;
  const suspendedCount = users.filter(u => u.status === "suspended").length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl text-sm shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}

      {suspendUser && <SuspendUserModal user={suspendUser} onClose={() => setSuspend(null)} />}

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-violet-400" /> User Management
          </h1>
          <p className="text-slate-500 mt-1">
            {activeCount} activos
            {suspendedCount > 0 && <span className="text-red-400 ml-2">· {suspendedCount} suspendidos</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle size={13} className="text-amber-400" />
          Los cambios de rol son inmediatos
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por email, nombre o workspace..."
          className="w-full bg-[#0d0e1e] border border-white/[0.06] rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["Usuario", "Workspace", "Rol CRM", "Rol Plataforma", "Estado", "Creado", "Acciones"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className={`border-b border-white/[0.04] transition-colors ${u.status === "suspended" ? "bg-red-500/[0.02] hover:bg-red-500/[0.03]" : "hover:bg-white/[0.02]"}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase ${u.status === "suspended" ? "bg-red-600/30 ring-1 ring-red-500/30" : "bg-gradient-to-br from-violet-600 to-blue-600"}`}>
                        {(u.name ?? u.email).charAt(0)}
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{u.name ?? u.email}</p>
                        {u.name && <p className="text-slate-500 text-xs">{u.email}</p>}
                        <p className="text-slate-600 text-xs font-mono">{u.clerkId.slice(0, 16)}…</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {u.orgName
                      ? <span className="flex items-center gap-1.5 text-slate-400 text-sm"><Building2 size={14} /> {u.orgName}</span>
                      : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <RoleDropdown user={u} onSuccess={() => showToast("Rol actualizado")} />
                  </td>
                  <td className="px-5 py-4">
                    {u.platformRole
                      ? <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit ${ROLE_COLORS[u.platformRole] ?? ROLE_COLORS.member}`}>
                          {u.platformRole === "SUPER_ADMIN" ? <Crown size={11} /> : <Shield size={11} />}
                          {u.platformRole}
                        </span>
                      : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {u.status === "suspended"
                      ? <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full w-fit">
                          <UserX size={11} /> Suspendido
                        </span>
                      : <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Activo
                        </span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-slate-500 text-xs">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString("es-ES") : "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      title={u.status === "active" ? "Suspender usuario" : "Activar usuario"}
                      onClick={() => setSuspend(u)}
                      className={`p-1.5 rounded-lg transition-all ${u.status === "active" ? "text-slate-500 hover:text-red-400 hover:bg-red-500/10" : "text-red-400 hover:text-emerald-400 hover:bg-emerald-500/10"}`}
                    >
                      {u.status === "active" ? <UserX size={15} /> : <UserCheck2 size={15} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>No se encontraron usuarios</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
