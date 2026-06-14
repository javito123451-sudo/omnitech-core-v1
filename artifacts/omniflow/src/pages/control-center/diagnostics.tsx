import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  CheckCircle2, XCircle, AlertTriangle, Shield, Users, Building2,
  Crown, UserCheck, Eye, Loader2, RefreshCw, Database, Lock,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DiagnosticsData {
  users: Array<{
    id: number; email: string; clerkId: string;
    crmRole: string | null; orgName: string | null;
    platformRole: string | null; createdAt: string;
  }>;
  orgs: Array<{ id: number; name: string; slug: string; plan: string; memberCount: number }>;
  roleCatalog: Array<{ role: string; scope: string; description: string; priority: number }>;
  crmRolesInUse: string[];
  platformRolesInUse: string[];
  controlCenterEnabled: boolean;
  routesEnabled: string[];
}

const SCOPE_COLOR: Record<string, string> = {
  platform: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  org:      "bg-blue-500/20 text-blue-400 border-blue-500/30",
  client:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const ROLE_ICON: Record<string, React.ElementType> = {
  SUPER_ADMIN:   Shield,
  STAFF_OMNITECH:Shield,
  owner:         Crown,
  admin:         UserCheck,
  member:        Users,
  read_only:     Eye,
  CLIENT:        UserCheck,
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2">
        <Icon size={16} className="text-violet-400" />
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<DiagnosticsData>({
    queryKey: ["cc-diagnostics"],
    queryFn: () => authFetch(`${BASE}/api/control-center/diagnostics`).then(r => r.json()),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <Loader2 size={36} className="animate-spin text-violet-400 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Auditando sistema de roles…</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allRoles = ["SUPER_ADMIN", "owner", "admin", "member", "CLIENT"];
  const existingRoles = new Set([...data.crmRolesInUse, ...data.platformRolesInUse]);
  const catalogRoles  = new Set(data.roleCatalog.map(r => r.role));

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Database size={24} className="text-violet-400" /> Diagnóstico del Sistema de Roles
          </h1>
          <p className="text-slate-500 mt-1">Auditoría completa de permisos y estructura RBAC</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      {/* Quick Status Banner */}
      <div className={`rounded-2xl border p-5 mb-8 flex items-start gap-4 ${data.controlCenterEnabled ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
        {data.controlCenterEnabled
          ? <CheckCircle2 size={28} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={28} className="text-red-400 flex-shrink-0 mt-0.5" />
        }
        <div>
          <p className={`font-semibold text-lg ${data.controlCenterEnabled ? "text-emerald-300" : "text-red-300"}`}>
            {data.controlCenterEnabled ? "✅ Control Center HABILITADO" : "❌ Control Center NO disponible"}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {data.controlCenterEnabled
              ? `Rol SUPER_ADMIN detectado — acceso completo a ${data.routesEnabled.length} rutas protegidas`
              : "No se detectó rol SUPER_ADMIN activo en la plataforma"
            }
          </p>
          {data.controlCenterEnabled && (
            <div className="flex flex-wrap gap-2 mt-3">
              {data.routesEnabled.map(route => (
                <span key={route} className="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/20 font-mono">
                  {route}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Role Catalog */}
        <SectionCard title="Catálogo de Roles RBAC" icon={Shield}>
          <div className="space-y-2">
            {data.roleCatalog.map(r => {
              const Icon   = ROLE_ICON[r.role] ?? Shield;
              const inUse  = existingRoles.has(r.role);
              return (
                <div key={r.role} className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${SCOPE_COLOR[r.scope] ?? "bg-slate-500/20 text-slate-400"}`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-medium font-mono">{r.role}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SCOPE_COLOR[r.scope] ?? ""}`}>{r.scope}</span>
                    </div>
                    <p className="text-slate-500 text-xs truncate">{r.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusPill ok={true}     label="Definido" />
                    {inUse && <StatusPill ok={true} label="En uso" />}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Role Existence Check */}
        <SectionCard title="Verificación de Existencia de Roles" icon={Lock}>
          <div className="space-y-3">
            {[
              { role: "SUPER_ADMIN",  label: "SUPER_ADMIN (Plataforma)",   check: data.platformRolesInUse.includes("SUPER_ADMIN") || catalogRoles.has("SUPER_ADMIN") },
              { role: "owner",        label: "OWNER (Organización)",        check: data.crmRolesInUse.includes("owner") || catalogRoles.has("owner") },
              { role: "admin",        label: "ADMIN (Organización)",        check: catalogRoles.has("admin") },
              { role: "member",       label: "MEMBER (Organización)",       check: data.crmRolesInUse.includes("member") || catalogRoles.has("member") },
              { role: "CLIENT",       label: "CLIENT (Cliente externo)",    check: catalogRoles.has("CLIENT") },
            ].map(item => (
              <div key={item.role} className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <span className="text-white font-mono text-sm">{item.label}</span>
                <StatusPill ok={item.check} label={item.check ? "Existe" : "No encontrado"} />
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-400" />
              Sistema RBAC completo definido en <code className="text-violet-400">role_catalog</code>
            </p>
          </div>
        </SectionCard>
      </div>

      {/* Users Detail */}
      <SectionCard title="Roles por Usuario" icon={Users}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["Usuario", "Org / Workspace", "Rol CRM", "Rol Plataforma", "Control Center"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.users.filter(u => u.email !== "unknown@example.com").map(u => {
                const hasSuperAdmin = u.platformRole === "SUPER_ADMIN" || u.platformRole === "STAFF_OMNITECH";
                const CrmIcon = ROLE_ICON[u.crmRole ?? ""] ?? Users;
                return (
                  <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.01]">
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold uppercase flex-shrink-0">
                          {u.email.charAt(0)}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{u.email}</p>
                          <p className="text-slate-600 text-xs font-mono">{u.clerkId.slice(0, 16)}…</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      {u.orgName
                        ? <span className="flex items-center gap-1.5 text-slate-400 text-sm"><Building2 size={13} />{u.orgName}</span>
                        : <span className="text-slate-600 text-sm">—</span>
                      }
                    </td>
                    <td className="py-4 pr-4">
                      {u.crmRole
                        ? <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${SCOPE_COLOR.org}`}>
                            <CrmIcon size={11} /> {u.crmRole}
                          </span>
                        : <span className="text-slate-600 text-sm">—</span>
                      }
                    </td>
                    <td className="py-4 pr-4">
                      {u.platformRole
                        ? <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${SCOPE_COLOR.platform}`}>
                            <Shield size={11} /> {u.platformRole}
                          </span>
                        : <span className="text-slate-600 text-sm">—</span>
                      }
                    </td>
                    <td className="py-4">
                      <StatusPill ok={hasSuperAdmin} label={hasSuperAdmin ? "Habilitado" : "Sin acceso"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Organizations */}
      <div className="mt-6">
        <SectionCard title="Workspaces / Organizaciones" icon={Building2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.orgs.map(org => (
              <div key={org.id} className="flex items-center gap-3 p-4 bg-white/[0.02] rounded-xl border border-white/[0.04]">
                <div className="w-9 h-9 rounded-xl bg-violet-600/20 flex items-center justify-center flex-shrink-0">
                  <Building2 size={16} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{org.name}</p>
                  <p className="text-slate-500 text-xs">{org.memberCount} miembro{org.memberCount !== 1 ? "s" : ""} · Plan: {org.plan}</p>
                </div>
                <span className="text-xs text-slate-600 font-mono">#{org.id}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
