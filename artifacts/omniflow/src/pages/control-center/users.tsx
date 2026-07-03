import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Users, Search, Shield, Building2, Crown, Loader2, UserX, UserCheck2,
  ChevronDown, X, AlertTriangle, CheckCircle2, Plus, Trash2, Filter,
} from "lucide-react";
import { PortalDropdown, PortalDropdownItem } from "@/components/ui/PortalDropdown";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgEntry { orgId: number; orgName: string | null; orgRole: string; isSuspended: boolean }
interface PlatformUser {
  id: number; clerkId: string; email: string; name: string | null;
  status: string; suspendedAt: string | null; suspendedReason: string | null;
  orgs: OrgEntry[];
  orgId: number | null; orgName: string | null; orgRole: string | null;
  platformRole: string | null; createdAt: string;
}

type Tab = "all" | "admins";

const ROLE_COLORS: Record<string, string> = {
  owner:          "bg-amber-500/20 text-amber-400",
  admin:          "bg-blue-500/20 text-blue-400",
  manager:        "bg-cyan-500/20 text-cyan-400",
  member:         "bg-slate-500/20 text-slate-300",
  client:         "bg-emerald-500/20 text-emerald-400",
  guest:          "bg-slate-600/20 text-slate-500",
  read_only:      "bg-slate-600/20 text-slate-400",
  vendedor:       "bg-orange-500/20 text-orange-400",
  SUPER_ADMIN:    "bg-violet-500/20 text-violet-400",
  STAFF_OMNITECH: "bg-pink-500/20 text-pink-400",
};
const WORKSPACE_ROLES = ["owner", "admin", "manager", "member", "client", "guest", "read_only", "vendedor"] as const;

function RoleDropdown({ user, onSuccess }: { user: PlatformUser; onSuccess: () => void }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: ({ role }: { role: string }) => authFetch(`${BASE}/api/control-center/users/${user.clerkId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: user.orgId, role }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-users"] }); onSuccess(); },
  });
  if (!user.orgId || !user.orgRole) return <span className="text-slate-600 text-sm">—</span>;
  return (
    <PortalDropdown
      align="left"
      trigger={
        <button
          className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize flex items-center gap-1.5 ${ROLE_COLORS[user.orgRole] ?? ROLE_COLORS.member}`}>
          {user.orgRole} <ChevronDown size={11} />
        </button>
      }
    >
      {WORKSPACE_ROLES.map(r => (
        <button
          key={r}
          disabled={r === user.orgRole || mut.isPending}
          onClick={() => mut.mutate({ role: r })}
          className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-all capitalize ${
            r === user.orgRole ? "text-white bg-violet-600/20 cursor-default" : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          {r}
        </button>
      ))}
    </PortalDropdown>
  );
}

function SuspendUserModal({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const isActive = user.status === "active";
  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/users/${user.clerkId}/${isActive ? "suspend" : "activate"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
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
            <p className="text-slate-400 text-sm mb-4">El usuario <strong className="text-white">perderá acceso inmediatamente</strong>.</p>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (opcional)..." rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-red-500 mb-4" />
          </>
        ) : (
          <p className="text-slate-400 text-sm mb-6">
            Se restaurará el acceso del usuario.
            {user.suspendedReason && <span className="block mt-2 text-xs text-slate-500">Motivo: "{user.suspendedReason}"</span>}
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">Cancelar</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 ${isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : isActive ? <UserX size={15} /> : <UserCheck2 size={15} />}
            {isActive ? "Suspender" : "Activar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GrantRoleModal({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<"STAFF_OMNITECH" | "SUPER_ADMIN">("SUPER_ADMIN");
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [backendError, setBackendError] = useState<string | null>(null);
  const hasRole = !!user.platformRole;
  const isSuperAdmin = user.platformRole === "SUPER_ADMIN";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cc-users"] });
    qc.invalidateQueries({ queryKey: ["cc-platform-roles"] });
  };

  const grantMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/control-center/platform-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkUserId: user.clerkId, email: user.email, displayName: user.name ?? undefined, role }),
      }).then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message ?? data.error ?? "Error desconocido");
        return data;
      }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: Error) => setBackendError(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/control-center/platform-roles/${user.clerkId}`, { method: "DELETE" }).then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message ?? data.error ?? "Error desconocido");
        return data;
      }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: Error) => setBackendError(err.message),
  });

  const userLabel = user.name ?? user.email;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-violet-500/20 rounded-2xl p-6 w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Crown size={18} className="text-violet-400" />
            <h2 className="text-white font-semibold">
              {hasRole ? "Gestionar rol de plataforma" : "Promocionar a SUPER_ADMIN"}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        {/* User pill */}
        <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 mb-5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold uppercase">
            {userLabel.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{userLabel}</p>
            {user.name && <p className="text-slate-500 text-xs truncate">{user.email}</p>}
          </div>
          {user.platformRole && (
            <span className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${ROLE_COLORS[user.platformRole] ?? ROLE_COLORS.member}`}>
              {user.platformRole}
            </span>
          )}
        </div>

        {/* Backend error */}
        {backendError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
            <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-400 text-sm">{backendError}</p>
          </div>
        )}

        {/* ── Existing role: demote or upgrade ─────────────────── */}
        {hasRole ? (
          <>
            {isSuperAdmin ? (
              /* SUPER_ADMIN → demote flow */
              step === "select" ? (
                <>
                  <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 mb-5">
                    <p className="text-white text-sm font-medium flex items-center gap-2">
                      <Crown size={14} className="text-violet-400" /> SUPER_ADMIN activo
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Este usuario tiene acceso total al Control Center</p>
                  </div>
                  <p className="text-slate-400 text-sm mb-5">
                    ¿Quieres degradar a <strong className="text-white">{userLabel}</strong> eliminando su acceso al Control Center?
                  </p>
                  <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">
                      Cancelar
                    </button>
                    <button
                      onClick={() => { setBackendError(null); setStep("confirm"); }}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 hover:bg-red-600/30 text-red-400 text-sm font-medium flex items-center justify-center gap-2">
                      <Trash2 size={14} /> Degradar rol
                    </button>
                  </div>
                </>
              ) : (
                /* Confirmation step */
                <>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-5">
                    <p className="text-white text-sm font-semibold mb-1">⚠️ Confirmar degradación</p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      <strong className="text-white">{userLabel}</strong> perderá acceso inmediato al Control Center.
                      Si es el único SUPER_ADMIN, la operación será bloqueada por el sistema.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep("select")} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">
                      Atrás
                    </button>
                    <button
                      onClick={() => revokeMut.mutate()}
                      disabled={revokeMut.isPending}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center justify-center gap-2">
                      {revokeMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      Confirmar degradación
                    </button>
                  </div>
                </>
              )
            ) : (
              /* Non-SUPER_ADMIN platform role → promote to SUPER_ADMIN or revoke */
              step === "select" ? (
                <>
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5">
                    <p className="text-white text-sm font-medium">Rol actual: <span className="text-pink-400">{user.platformRole}</span></p>
                    <p className="text-slate-500 text-xs mt-1">Puedes promover a SUPER_ADMIN o revocar el acceso</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    <button
                      onClick={() => { setRole("SUPER_ADMIN"); setBackendError(null); setStep("confirm"); }}
                      className="px-4 py-2.5 rounded-xl border border-violet-500/40 bg-violet-600/10 text-violet-400 text-sm font-medium hover:bg-violet-600/20 flex items-center justify-center gap-1.5">
                      <Crown size={13} /> Promover a SUPER_ADMIN
                    </button>
                    <button
                      onClick={() => { setBackendError(null); revokeMut.mutate(); }}
                      disabled={revokeMut.isPending}
                      className="px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 flex items-center justify-center gap-1.5">
                      {revokeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={13} />} Revocar
                    </button>
                  </div>
                  <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">
                    Cancelar
                  </button>
                </>
              ) : (
                /* Confirm promote from STAFF → SUPER_ADMIN */
                <>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-5">
                    <p className="text-white text-sm font-semibold mb-1 flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-400" /> Promover a SUPER_ADMIN
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      <strong className="text-white">{userLabel}</strong> tendrá <strong className="text-white">acceso total</strong> al Control Center, incluyendo gestión de usuarios, módulos, licencias, seguridad y auditoría.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep("select")} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">
                      Atrás
                    </button>
                    <button
                      onClick={() => grantMut.mutate()}
                      disabled={grantMut.isPending}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center justify-center gap-2">
                      {grantMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                      Confirmar promoción
                    </button>
                  </div>
                </>
              )
            )}
          </>
        ) : (
          /* No platform role yet: select role → confirm */
          step === "select" ? (
            <>
              <p className="text-slate-400 text-sm mb-4">Asignar rol de plataforma a <strong className="text-white">{userLabel}</strong>:</p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {(["SUPER_ADMIN", "STAFF_OMNITECH"] as const).map(r => (
                  <button key={r} onClick={() => setRole(r)}
                    className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-1 ${
                      role === r ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 text-slate-400 hover:text-white hover:border-white/20"
                    }`}>
                    {r === "SUPER_ADMIN" ? <Crown size={16} /> : <Shield size={16} />}
                    {r === "SUPER_ADMIN" ? "SUPER_ADMIN" : "STAFF"}
                  </button>
                ))}
              </div>
              {role === "SUPER_ADMIN" && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-amber-300 text-xs">SUPER_ADMIN otorga acceso total e irrestricto al Control Center de la plataforma.</p>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">Cancelar</button>
                <button
                  onClick={() => { setBackendError(null); setStep("confirm"); }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center justify-center gap-2">
                  <Crown size={14} /> Continuar
                </button>
              </div>
            </>
          ) : (
            /* Final confirmation */
            <>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-5">
                <p className="text-white text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-400" />
                  {role === "SUPER_ADMIN" ? "Promover a SUPER_ADMIN" : "Asignar STAFF_OMNITECH"}
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  <strong className="text-white">{userLabel}</strong> recibirá el rol <strong className="text-white">{role}</strong>.
                  {role === "SUPER_ADMIN" && " Tendrá acceso total al Control Center de la plataforma."}
                  {" "}Esta acción queda registrada en Auditoría.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("select")} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">
                  Atrás
                </button>
                <button
                  onClick={() => grantMut.mutate()}
                  disabled={grantMut.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center justify-center gap-2">
                  {grantMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                  {role === "SUPER_ADMIN" ? "Promocionar" : "Asignar rol"}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch]       = useState("");
  const [tab, setTab]             = useState<Tab>("all");
  const [filterStatus, setStatus] = useState("all");
  const [suspendUser, setSuspend] = useState<PlatformUser | null>(null);
  const [roleUser, setRoleUser]   = useState<PlatformUser | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const { data: users = [], isLoading } = useQuery<PlatformUser[]>({
    queryKey: ["cc-users"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/users`).then(r => r.json()),
  });

  const displayUsers = users.filter(u => {
    const isAdmin = tab === "admins";
    if (isAdmin && !u.platformRole) return false;
    if (filterStatus !== "all" && u.status !== filterStatus) return false;
    if (!search) return true;
    return (
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.orgName?.toLowerCase().includes(search.toLowerCase()) ||
      u.name?.toLowerCase().includes(search.toLowerCase())
    );
  });

  const activeCount    = users.filter(u => u.status === "active").length;
  const suspendedCount = users.filter(u => u.status === "suspended").length;
  const adminCount     = users.filter(u => u.platformRole).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl text-sm shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
      {suspendUser && <SuspendUserModal user={suspendUser} onClose={() => setSuspend(null)} />}
      {roleUser    && <GrantRoleModal   user={roleUser}    onClose={() => setRoleUser(null)} />}

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-violet-400" /> Gestión de Usuarios
          </h1>
          <p className="text-slate-500 mt-1">
            {activeCount} activos
            {suspendedCount > 0 && <span className="text-red-400 ml-2">· {suspendedCount} suspendidos</span>}
            {adminCount > 0 && <span className="text-violet-400 ml-2">· {adminCount} con rol de plataforma</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle size={13} className="text-amber-400" />
          Los cambios de rol son inmediatos
        </div>
      </div>

      {/* Tabs + filters */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
          {([
            { id: "all",    label: `Todos (${users.length})` },
            { id: "admins", label: `Plataforma (${adminCount})` },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-2 py-1">
            <Filter size={12} className="text-slate-500" />
            <select value={filterStatus} onChange={e => setStatus(e.target.value)}
              className="bg-transparent text-slate-400 text-sm focus:outline-none">
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="suspended">Suspendidos</option>
            </select>
          </div>
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
                {["Usuario", "Workspace", "Rol Workspace", "Rol Plataforma", "Estado", "Creado", "Acciones"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayUsers.map(u => (
                <tr key={u.id} className={`border-b border-white/[0.04] transition-colors ${u.status === "suspended" ? "bg-red-500/[0.02] hover:bg-red-500/[0.03]" : "hover:bg-white/[0.02]"}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase ${u.status === "suspended" ? "bg-red-600/30 ring-1 ring-red-500/30" : "bg-gradient-to-br from-violet-600 to-blue-600"}`}>
                        {(u.name ?? u.email).charAt(0)}
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{u.name ?? u.email}</p>
                        {u.name && <p className="text-slate-500 text-xs">{u.email}</p>}
                        <p className="text-slate-600 text-xs font-mono">{u.clerkId.slice(0, 14)}…</p>
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
                  <td className="px-5 py-4 text-slate-500 text-xs">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString("es-ES") : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <button
                        title="Rol de plataforma"
                        onClick={() => setRoleUser(u)}
                        className={`p-1.5 rounded-lg transition-all ${u.platformRole ? "text-violet-400 hover:text-violet-300 hover:bg-violet-500/10" : "text-slate-500 hover:text-violet-400 hover:bg-violet-500/10"}`}
                      >
                        {u.platformRole ? <Crown size={14} /> : <Shield size={14} />}
                      </button>
                      <button
                        title={u.status === "active" ? "Suspender usuario" : "Activar usuario"}
                        onClick={() => setSuspend(u)}
                        className={`p-1.5 rounded-lg transition-all ${u.status === "active" ? "text-slate-500 hover:text-red-400 hover:bg-red-500/10" : "text-red-400 hover:text-emerald-400 hover:bg-emerald-500/10"}`}
                      >
                        {u.status === "active" ? <UserX size={15} /> : <UserCheck2 size={15} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayUsers.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>{tab === "admins" ? "Sin administradores de plataforma" : "No se encontraron usuarios"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
