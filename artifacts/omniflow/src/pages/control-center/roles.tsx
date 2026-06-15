import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Shield, Crown, Users, Eye, UserCheck, Lock, Plus, Trash2, Loader2,
  CheckCircle2, XCircle, X, ChevronDown, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlatformRole {
  id: number; clerkUserId: string; role: string;
  displayName: string | null; email: string | null;
  notes: string | null; isActive: boolean;
  grantedBy: string | null; createdAt: string; updatedAt: string;
}

type Tab = "platform" | "matrix";

const ROLE_ICON: Record<string, React.ElementType> = {
  SUPER_ADMIN:    Crown,
  STAFF_OMNITECH: Shield,
  owner:          Crown,
  admin:          UserCheck,
  member:         Users,
  read_only:      Eye,
};

const ROLE_COLOR: Record<string, string> = {
  SUPER_ADMIN:    "bg-violet-500/20 text-violet-400 border-violet-500/30",
  STAFF_OMNITECH: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

const PERMISSION_MATRIX = [
  { action: "Ver clientes",             owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Crear clientes",           owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Editar clientes",          owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Eliminar clientes",        owner: true,  admin: true,  member: false, readonly: false },
  { action: "Ver presupuestos",         owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Crear presupuestos",       owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Editar presupuestos",      owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Eliminar presupuestos",    owner: true,  admin: true,  member: false, readonly: false },
  { action: "Generar PDF presupuesto",  owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Ver mensajes",             owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Enviar mensajes",          owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Ver citas",                owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Crear citas",              owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Editar citas",             owner: true,  admin: true,  member: true,  readonly: false },
  { action: "Usar Asistente IA",        owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Importar datos (IA)",      owner: true,  admin: true,  member: false, readonly: false },
  { action: "Gestionar miembros",       owner: true,  admin: true,  member: false, readonly: false },
  { action: "Invitar usuarios",         owner: true,  admin: true,  member: false, readonly: false },
  { action: "Config. integraciones",    owner: true,  admin: false, member: false, readonly: false },
  { action: "Ver estadísticas",         owner: true,  admin: true,  member: true,  readonly: true  },
  { action: "Cambiar plan/licencia",    owner: true,  admin: false, member: false, readonly: false },
];

function PermCell({ value, warn }: { value: boolean; warn?: boolean }) {
  if (value) return <CheckCircle2 size={16} className="text-emerald-400 mx-auto" />;
  return warn
    ? <AlertTriangle size={14} className="text-amber-400 mx-auto" />
    : <XCircle size={16} className="text-slate-700 mx-auto" />;
}

function AddRoleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [clerkUserId, setClerkUserId] = useState("");
  const [email, setEmail]             = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole]               = useState<"SUPER_ADMIN" | "STAFF_OMNITECH">("STAFF_OMNITECH");
  const [notes, setNotes]             = useState("");

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/platform-roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerkUserId: clerkUserId.trim(), email: email.trim() || undefined, displayName: displayName.trim() || undefined, role, notes: notes.trim() || undefined }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-platform-roles"] }); onClose(); },
  });

  const canSubmit = clerkUserId.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-violet-500/20 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Crown size={18} className="text-violet-400" />
            <h2 className="text-white font-semibold">Conceder Rol de Plataforma</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Rol a conceder</label>
            <div className="grid grid-cols-2 gap-2">
              {(["STAFF_OMNITECH", "SUPER_ADMIN"] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${role === r ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
                >
                  {r === "SUPER_ADMIN" ? "SUPER_ADMIN" : "STAFF"}
                </button>
              ))}
            </div>
            {role === "SUPER_ADMIN" && (
              <p className="text-amber-400 text-xs mt-2 flex items-center gap-1.5">
                <AlertTriangle size={11} /> SUPER_ADMIN tiene acceso total e irreversible a la plataforma
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Clerk User ID <span className="text-red-400">*</span></label>
            <input
              type="text" value={clerkUserId} onChange={e => setClerkUserId(e.target.value)}
              placeholder="user_xxxxxxxxxxxxxxxxxx"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm font-mono"
            />
            <p className="text-slate-600 text-xs mt-1">Visible en el Clerk Dashboard o en la tabla de Usuarios</p>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Email (opcional)</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="usuario@ejemplo.com"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Nombre visible (opcional)</label>
            <input
              type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="Nombre del administrador..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Notas internas (opcional)</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Motivo, contexto..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button
            onClick={() => mut.mutate()}
            disabled={!canSubmit || mut.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Conceder rol
          </button>
        </div>
      </div>
    </div>
  );
}

function RevokeModal({ role, onClose }: { role: PlatformRole; onClose: () => void }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/platform-roles/${role.clerkUserId}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-platform-roles"] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-red-500/20 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <Trash2 size={24} className="text-red-400" />
          <div>
            <h2 className="text-white font-semibold">Revocar acceso de plataforma</h2>
            <p className="text-slate-500 text-sm">{role.email ?? role.clerkUserId}</p>
          </div>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Esta persona <strong className="text-white">perderá acceso al Control Center inmediatamente</strong>. Puedes concederlo de nuevo en cualquier momento.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Revocar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RolesPage() {
  const [tab, setTab]           = useState<Tab>("platform");
  const [showAdd, setShowAdd]   = useState(false);
  const [revokeRole, setRevoke] = useState<PlatformRole | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: roles = [], isLoading } = useQuery<PlatformRole[]>({
    queryKey: ["cc-platform-roles"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/platform-roles`).then(r => r.json()),
  });

  const activeRoles   = roles.filter(r => r.isActive);
  const inactiveRoles = roles.filter(r => !r.isActive);
  const superAdmins   = activeRoles.filter(r => r.role === "SUPER_ADMIN");
  const staff         = activeRoles.filter(r => r.role === "STAFF_OMNITECH");

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "platform", label: "Roles de Plataforma", icon: Crown  },
    { id: "matrix",   label: "Matriz de Permisos",  icon: Shield },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {showAdd && <AddRoleModal onClose={() => setShowAdd(false)} />}
      {revokeRole && <RevokeModal role={revokeRole} onClose={() => setRevoke(null)} />}

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Shield size={24} className="text-violet-400" /> Roles y Permisos
          </h1>
          <p className="text-slate-500 mt-1">
            {superAdmins.length} super admin{superAdmins.length !== 1 ? "s" : ""} · {staff.length} staff activos
          </p>
        </div>
        {tab === "platform" && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-all"
          >
            <Plus size={16} /> Conceder rol
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06] mb-8 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Platform Roles ── */}
      {tab === "platform" && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-violet-600/10 border border-violet-500/20 rounded-2xl p-5">
              <Crown size={20} className="text-violet-400 mb-2" />
              <p className="text-3xl font-bold text-violet-400">{superAdmins.length}</p>
              <p className="text-slate-400 text-sm mt-1">SUPER_ADMIN</p>
              <p className="text-slate-600 text-xs">Acceso total · Todas las acciones</p>
            </div>
            <div className="bg-pink-600/10 border border-pink-500/20 rounded-2xl p-5">
              <Shield size={20} className="text-pink-400 mb-2" />
              <p className="text-3xl font-bold text-pink-400">{staff.length}</p>
              <p className="text-slate-400 text-sm mt-1">STAFF_OMNITECH</p>
              <p className="text-slate-600 text-xs">Acceso de lectura · Soporte</p>
            </div>
            <div className="bg-slate-500/10 border border-slate-500/20 rounded-2xl p-5">
              <Lock size={20} className="text-slate-400 mb-2" />
              <p className="text-3xl font-bold text-slate-400">{inactiveRoles.length}</p>
              <p className="text-slate-400 text-sm mt-1">Revocados</p>
              <p className="text-slate-600 text-xs">Sin acceso actualmente</p>
            </div>
          </div>

          {/* Active roles table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
          ) : (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06]">
                <p className="text-white font-semibold text-sm">Administradores Activos</p>
                <p className="text-slate-500 text-xs mt-0.5">Usuarios con acceso al Control Center</p>
              </div>
              {activeRoles.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  <Crown size={36} className="mx-auto mb-3 opacity-30" />
                  <p>Sin administradores configurados</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {activeRoles.map(r => {
                    const RIcon = ROLE_ICON[r.role] ?? Shield;
                    const style = ROLE_COLOR[r.role] ?? ROLE_COLOR.STAFF_OMNITECH;
                    return (
                      <div key={r.id} className="px-6 py-4 flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold uppercase border ${style}`}>
                          <RIcon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-white font-medium text-sm">{r.displayName ?? r.email ?? r.clerkUserId}</p>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${style}`}>{r.role}</span>
                          </div>
                          {r.email && r.displayName && <p className="text-slate-500 text-xs">{r.email}</p>}
                          <div className="flex items-center gap-3 mt-0.5">
                            <p className="text-slate-600 text-xs font-mono">{r.clerkUserId.slice(0, 20)}…</p>
                            {r.notes && <p className="text-slate-600 text-xs italic">"{r.notes}"</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 text-right">
                          <div className="text-xs text-slate-600">
                            <p>Concedido {new Date(r.createdAt).toLocaleDateString("es-ES")}</p>
                            {r.grantedBy && <p className="text-slate-700 font-mono">{r.grantedBy.slice(0, 12)}…</p>}
                          </div>
                          <button
                            title="Revocar acceso"
                            onClick={() => setRevoke(r)}
                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Revoked roles (collapsed) */}
          {inactiveRoles.length > 0 && (
            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden opacity-60">
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="w-full px-6 py-4 flex items-center justify-between"
              >
                <p className="text-slate-400 text-sm">Roles Revocados ({inactiveRoles.length})</p>
                <ChevronDown size={16} className={`text-slate-500 transition-transform ${showInactive ? "rotate-180" : ""}`} />
              </button>
              {showInactive && (
                <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                  {inactiveRoles.map(r => (
                    <div key={r.id} className="px-6 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/30 flex items-center justify-center">
                        <Shield size={14} className="text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-500 text-sm">{r.email ?? r.clerkUserId}</p>
                        <p className="text-slate-700 text-xs">{r.role} · Revocado</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Diff between SUPER_ADMIN and STAFF */}
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-white font-semibold mb-4 text-sm">Diferencias entre SUPER_ADMIN y STAFF_OMNITECH</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { role: "SUPER_ADMIN", color: "text-violet-400", border: "border-violet-500/20", items: [
                  "✅ Suspender / activar workspaces",
                  "✅ Eliminar workspaces",
                  "✅ Suspender / activar usuarios",
                  "✅ Conceder / revocar roles de plataforma",
                  "✅ Ver todos los datos (workspaces, usuarios, audit)",
                  "✅ Gestionar presupuestos IA",
                  "✅ Gestionar módulos y licencias",
                ] },
                { role: "STAFF_OMNITECH", color: "text-pink-400", border: "border-pink-500/20", items: [
                  "✅ Ver todos los workspaces y usuarios",
                  "✅ Ver audit logs y diagnósticos",
                  "✅ Ver consumo IA y budgets",
                  "✅ Gestionar módulos y licencias",
                  "❌ NO puede suspender workspaces/usuarios",
                  "❌ NO puede eliminar workspaces",
                  "❌ NO puede conceder roles de plataforma",
                ] },
              ].map(col => (
                <div key={col.role} className={`bg-white/[0.02] border ${col.border} rounded-xl p-4`}>
                  <p className={`font-mono font-semibold text-sm ${col.color} mb-3`}>{col.role}</p>
                  <div className="space-y-1.5">
                    {col.items.map(item => (
                      <p key={item} className="text-xs text-slate-400">{item}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Permission Matrix ── */}
      {tab === "matrix" && (
        <div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-300 text-sm">
              Esta matriz refleja el diseño objetivo. Actualmente <strong>read_only y member no tienen enforcement en el backend</strong> para operaciones de escritura. Pendiente implementar <code className="text-amber-400">requireWrite</code> middleware (SEC-02).
            </p>
          </div>

          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4 w-64">Acción</th>
                    {[
                      { label: "Owner",     color: "text-amber-400",   icon: Crown      },
                      { label: "Admin",     color: "text-blue-400",    icon: UserCheck  },
                      { label: "Member",    color: "text-slate-300",   icon: Users      },
                      { label: "Read Only", color: "text-slate-400",   icon: Eye        },
                    ].map(col => (
                      <th key={col.label} className="text-center text-xs font-semibold uppercase tracking-wider px-4 py-4">
                        <div className="flex flex-col items-center gap-1">
                          <col.icon size={16} className={col.color} />
                          <span className={col.color}>{col.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MATRIX.map((row, i) => (
                    <tr key={row.action} className={`border-b border-white/[0.03] ${i % 2 === 0 ? "" : "bg-white/[0.01]"} hover:bg-white/[0.02]`}>
                      <td className="px-6 py-3 text-slate-300 text-sm">{row.action}</td>
                      <td className="px-4 py-3 text-center"><PermCell value={row.owner}    /></td>
                      <td className="px-4 py-3 text-center"><PermCell value={row.admin}    /></td>
                      <td className="px-4 py-3 text-center"><PermCell value={row.member}   warn={!row.member} /></td>
                      <td className="px-4 py-3 text-center"><PermCell value={row.readonly} warn={!row.readonly} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-white/[0.06] flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Permitido</span>
              <span className="flex items-center gap-1.5"><XCircle size={12} className="text-slate-700" /> Denegado (objetivo)</span>
              <span className="flex items-center gap-1.5"><AlertTriangle size={12} className="text-amber-400" /> Denegado (sin enforcement aún)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
