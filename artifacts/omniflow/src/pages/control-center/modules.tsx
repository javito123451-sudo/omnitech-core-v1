import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { Puzzle, Loader2, CheckCircle2, XCircle, Building2, LayoutGrid, List } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ModuleCatalog { slug: string; name: string; description: string; alwaysOn?: boolean; }
interface OrgModules {
  org: { id: number; name: string; status?: string };
  modules: Array<ModuleCatalog & { isEnabled: boolean; configId: number | null }>;
}
interface ModulesResponse { catalog: ModuleCatalog[]; orgs: OrgModules[]; }

type View = "byOrg" | "byModule";

const MODULE_ICONS: Record<string, string> = {
  crm: "🏢", whatsapp: "💬", omni_import_ai: "🤖", omni_docs: "📄",
  omni_security: "🔒", omni_marketing: "📣", analytics: "📊", automations: "⚡", ai_agents: "🧠",
};
const MODULE_COLORS: Record<string, string> = {
  crm: "from-blue-600 to-cyan-600", whatsapp: "from-green-600 to-teal-600",
  omni_import_ai: "from-violet-600 to-purple-600", omni_docs: "from-amber-600 to-orange-600",
  omni_security: "from-red-600 to-pink-600", omni_marketing: "from-pink-600 to-rose-600",
  analytics: "from-indigo-600 to-blue-600", automations: "from-yellow-600 to-amber-600",
  ai_agents: "from-fuchsia-600 to-violet-600",
};

export default function ModulesPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("byOrg");
  const [selectedMod, setSelectedMod] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ModulesResponse>({
    queryKey: ["cc-modules"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/modules`).then(r => r.json()),
  });

  const toggleMut = useMutation({
    mutationFn: ({ orgId, moduleSlug, isEnabled }: { orgId: number; moduleSlug: string; isEnabled: boolean }) =>
      authFetch(`${BASE}/api/control-center/modules`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, moduleSlug, isEnabled }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cc-modules"] }),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
  );

  const catalog = data?.catalog ?? [];
  const orgs    = data?.orgs    ?? [];

  const moduleStats = catalog.map(mod => {
    const enabledOrgs = orgs.filter(o => {
      const m = o.modules.find(mm => mm.slug === mod.slug);
      return m ? m.isEnabled : mod.slug === "crm";
    });
    return { ...mod, enabledCount: enabledOrgs.length, totalCount: orgs.length, enabledOrgs };
  });

  const activeMod = moduleStats.find(m => m.slug === selectedMod);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Puzzle size={24} className="text-violet-400" /> Gestión de Módulos
          </h1>
          <p className="text-slate-500 mt-1">{catalog.length} módulos · {orgs.length} workspaces</p>
        </div>
        {/* View toggle */}
        <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
          <button onClick={() => setView("byOrg")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === "byOrg" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
            <List size={14} /> Por Workspace
          </button>
          <button onClick={() => setView("byModule")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === "byModule" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
            <LayoutGrid size={14} /> Por Módulo
          </button>
        </div>
      </div>

      {/* Module catalog summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-10">
        {moduleStats.map(mod => (
          <button
            key={mod.slug}
            onClick={() => { setSelectedMod(mod.slug === selectedMod ? null : mod.slug); setView("byModule"); }}
            className={`bg-[#0d0e1e] border rounded-2xl p-4 text-left hover:border-white/10 transition-all ${selectedMod === mod.slug ? "border-violet-500/40" : "border-white/[0.06]"}`}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${MODULE_COLORS[mod.slug] ?? "from-slate-600 to-slate-700"} flex items-center justify-center text-xl mb-2.5`}>
              {MODULE_ICONS[mod.slug] ?? "📦"}
            </div>
            <p className="text-white font-medium text-xs leading-tight mb-1">{mod.name}</p>
            <p className="text-slate-500 text-xs">{mod.enabledCount}/{mod.totalCount} activo{mod.enabledCount !== 1 ? "s" : ""}</p>
            <div className="mt-2 w-full bg-white/5 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${MODULE_COLORS[mod.slug] ?? "from-slate-500 to-slate-600"}`}
                style={{ width: `${mod.totalCount > 0 ? (mod.enabledCount / mod.totalCount) * 100 : 0}%` }}
              />
            </div>
          </button>
        ))}
      </div>

      {/* ── View: By Module ── */}
      {view === "byModule" && (
        <div>
          {activeMod ? (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${MODULE_COLORS[activeMod.slug] ?? "from-slate-600 to-slate-700"} flex items-center justify-center text-xl`}>
                  {MODULE_ICONS[activeMod.slug] ?? "📦"}
                </div>
                <div>
                  <h2 className="text-white font-semibold">{activeMod.name}</h2>
                  <p className="text-slate-500 text-sm">{activeMod.description}</p>
                </div>
                <span className="ml-auto text-slate-500 text-sm">
                  {activeMod.enabledCount}/{activeMod.totalCount} workspaces activos
                </span>
              </div>
              <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {["Workspace", "Estado del módulo"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map(({ org, modules }) => {
                      const modEntry = modules.find(m => m.slug === activeMod.slug);
                      const isEnabled = modEntry ? modEntry.isEnabled : activeMod.slug === "crm";
                      const alwaysOn  = activeMod.alwaysOn || activeMod.slug === "crm";
                      return (
                        <tr key={org.id} className={`border-b border-white/[0.04] hover:bg-white/[0.02] ${org.status === "suspended" ? "opacity-50" : ""}`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-violet-600/20 flex items-center justify-center">
                                <Building2 size={13} className="text-violet-400" />
                              </div>
                              <div>
                                <p className="text-white text-sm font-medium">{org.name}</p>
                                {org.status === "suspended" && <p className="text-amber-400 text-xs">Suspendido</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {alwaysOn ? (
                              <span className="text-xs text-slate-500">Siempre activo</span>
                            ) : (
                              <button
                                onClick={() => toggleMut.mutate({ orgId: org.id, moduleSlug: activeMod.slug, isEnabled: !isEnabled })}
                                disabled={toggleMut.isPending}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isEnabled ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20" : "bg-slate-500/10 border border-slate-500/20 text-slate-400 hover:bg-white/10"}`}
                              >
                                {isEnabled ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                {isEnabled ? "Activo — desactivar" : "Inactivo — activar"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-slate-500">
              <Puzzle size={40} className="mx-auto mb-3 opacity-30" />
              <p>Selecciona un módulo de arriba para ver qué workspaces lo tienen activo</p>
            </div>
          )}
        </div>
      )}

      {/* ── View: By Org ── */}
      {view === "byOrg" && (
        <div>
          <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
            <Building2 size={15} className="text-violet-400" /> Configuración por Workspace
          </h2>
          {orgs.map(({ org, modules }) => (
            <div key={org.id} className={`bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden mb-4 ${org.status === "suspended" ? "opacity-60" : ""}`}>
              <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
                  <Building2 size={15} className="text-violet-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold text-sm">{org.name}</p>
                  {org.status === "suspended" && <p className="text-amber-400 text-xs">Suspendido</p>}
                </div>
                <span className="text-xs text-slate-500">{modules.filter(m => m.isEnabled).length}/{modules.length} activos</span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {modules.map(mod => (
                  <div key={mod.slug} className="flex items-center gap-3 bg-white/[0.02] rounded-xl px-4 py-3">
                    <span className="text-lg flex-shrink-0">{MODULE_ICONS[mod.slug] ?? "📦"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{mod.name}</p>
                    </div>
                    {mod.alwaysOn || mod.slug === "crm" ? (
                      <span className="text-slate-600 text-xs flex-shrink-0">Siempre</span>
                    ) : (
                      <button
                        onClick={() => toggleMut.mutate({ orgId: org.id, moduleSlug: mod.slug, isEnabled: !mod.isEnabled })}
                        disabled={toggleMut.isPending}
                        className="flex-shrink-0"
                      >
                        {mod.isEnabled
                          ? <CheckCircle2 size={20} className="text-emerald-400 hover:text-emerald-300 transition-colors" />
                          : <XCircle     size={20} className="text-slate-600 hover:text-slate-400 transition-colors" />
                        }
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {orgs.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Building2 size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay workspaces</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
