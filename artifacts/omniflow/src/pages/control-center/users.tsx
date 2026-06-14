import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { Users, Search, Shield, Building2, Crown, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlatformUser {
  id: number;
  clerkId: string;
  email: string;
  orgId: number | null;
  orgName: string | null;
  orgRole: string | null;
  platformRole: string | null;
  status: string;
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner:         "bg-amber-500/20 text-amber-400",
  admin:         "bg-blue-500/20 text-blue-400",
  member:        "bg-slate-500/20 text-slate-300",
  SUPER_ADMIN:   "bg-violet-500/20 text-violet-400",
  STAFF_OMNITECH:"bg-pink-500/20 text-pink-400",
};

export default function UsersPage() {
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery<PlatformUser[]>({
    queryKey: ["cc-users"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/users`).then(r => r.json()),
  });

  const filtered = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.orgName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-violet-400" /> User Management
          </h1>
          <p className="text-slate-500 mt-1">{users.length} usuarios en la plataforma</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por email o workspace..."
          className="w-full bg-[#0d0e1e] border border-white/[0.06] rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
        />
      </div>

      {/* User List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["Usuario", "Workspace", "Rol CRM", "Rol Plataforma", "Estado", "Creado"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold uppercase">
                        {u.email.charAt(0)}
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{u.email}</p>
                        <p className="text-slate-600 text-xs font-mono">{u.clerkId.slice(0, 18)}…</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {u.orgName ? (
                      <span className="flex items-center gap-1.5 text-slate-400 text-sm">
                        <Building2 size={14} /> {u.orgName}
                      </span>
                    ) : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {u.orgRole ? (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[u.orgRole] ?? ROLE_COLORS.member}`}>
                        {u.orgRole}
                      </span>
                    ) : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {u.platformRole ? (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit ${ROLE_COLORS[u.platformRole]}`}>
                        {u.platformRole === "SUPER_ADMIN" ? <Crown size={11} /> : <Shield size={11} />}
                        {u.platformRole}
                      </span>
                    ) : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Activo
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-slate-500 text-xs">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString("es-ES") : "—"}
                    </span>
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
