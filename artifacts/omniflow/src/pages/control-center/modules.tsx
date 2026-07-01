import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { useOrg } from "@/lib/orgContext";
import {
  Puzzle, Loader2, Building2, LayoutGrid, List,
  ShieldCheck, RefreshCw, Search,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
  omni_security: "🔒", omni_marketing: "📣", analytics: "📊",
  automations: "⚡", ai_agents: "🧠", integrations: "🔗",
};
const MODULE_COLORS: Record<string, string> = {
  crm: "from-blue-600 to-cyan-600", whatsapp: "from-green-600 to-teal-600",
  omni_import_ai: "from-violet-600 to-purple-600", omni_docs: "from-amber-600 to-orange-600",
  omni_security: "from-red-600 to-pink-600", omni_marketing: "from-pink-600 to-rose-600",
  analytics: "from-indigo-600 to-blue-600", automations: "from-yellow-600 to-amber-600",
  ai_agents: "from-fuchsia-600 to-violet-600", integrations: "from-cyan-600 to-sky-600",
};

function ModuleSwitch({
  slug, name, isEnabled, alwaysOn, isPending,
  onToggle,
}: {
  slug: string; name: string; isEnabled: boolean; alwaysOn: boolean;
  isPending: boolean; onToggle: () => void;
}) {
  if (alwaysOn) {
    return (
      <div className="flex items-center gap-2">
        <ShieldCheck size={13} className="text-violet-400 flex-shrink-0" />
        <span className="text-[11px] text-violet-400 font-medium">Siempre ON</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <Switch
        checked={isEnabled}
        onCheckedChange={onToggle}
        disabled={isPending}
        className={cn(
          "data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-slate-700",
          isPending && "opacity-60",
        )}
        aria-label={`${isEnabled ? "Desactivar" : "Activar"} ${name}`}
      />
      <span className={cn("text-xs font-medium transition-colors", isEnabled ? "text-emerald-400" : "text-slate-500")}>
        {isEnabled ? "Activo" : "Inactivo"}
      </span>
    </div>
  );
}

export default function ModulesPage() {
  const qc = useQueryClient();
  const { refetch: refetchOrg, org } = useOrg();
  const [view, setView] = useState<View>("byOrg");
  const [selectedMod, setSelectedMod] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<ModulesResponse>({
    queryKey: ["cc-modules"],
    queryFn: () => authFetch(`${BASE}/api/control-center/modules`).then(r => r.json()),
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: ({ orgId, moduleSlug, isEnabled }: { orgId: number; moduleSlug: string; isEnabled: boolean }) =>
      authFetch(`${BASE}/api/control-center/modules`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, moduleSlug, isEnabled }),
      }).then(r => r.json()),
    onMutate: ({ orgId, moduleSlug }) => setPendingKey(`${orgId}:${moduleSlug}`),
    onSuccess: (_data, { orgId }) => {
      // If the toggled workspace is the admin's own workspace, refresh
      // the OrgContext so the sidebar reflects the change immediately.
      if (org && org.id === orgId) refetchOrg();
    },
    onSettled: () => {
      setPendingKey(null);
      void qc.invalidateQueries({ queryKey: ["cc-modules"] });
    },
  });

  const handleToggle = (orgId: number, moduleSlug: string, currentEnabled: boolean) => {
    toggleMut.mutate({ orgId, moduleSlug, isEnabled: !currentEnabled });
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={32} className="animate-spin text-violet-400" />
    </div>
  );

  const catalog = data?.catalog ?? [];
  const allOrgs = data?.orgs ?? [];

  const filteredOrgs = search.trim()
    ? allOrgs.filter(o => o.org.name.toLowerCase().includes(search.toLowerCase()))
    : allOrgs;

  const moduleStats = catalog.map(mod => {
    const enabledCount = allOrgs.filter(o => {
      const m = o.modules.find(mm => mm.slug === mod.slug);
      return m ? m.isEnabled : mod.slug === "crm";
    }).length;
    return { ...mod, enabledCount, totalCount: allOrgs.length };
  });

  const activeMod = moduleStats.find(m => m.slug === selectedMod);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Puzzle size={24} className="text-violet-400" /> Módulos por Workspace
          </h1>
          <p className="text-slate-500 mt-1">
            {catalog.length} módulos · {allOrgs.length} workspace{allOrgs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar workspace…"
              className="bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 w-52 transition-colors"
            />
          </div>
          {/* Refresh */}
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Actualizar
          </button>
          {/* View toggle */}
          <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
            <button
              onClick={() => setView("byOrg")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === "byOrg" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              <List size={14} /> Por Workspace
            </button>
            <button
              onClick={() => setView("byModule")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === "byModule" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              <LayoutGrid size={14} /> Por Módulo
            </button>
          </div>
        </div>
      </div>

      {/* Module catalog summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-10">
        {moduleStats.map(mod => (
          <button
            key={mod.slug}
            onClick={() => { setSelectedMod(mod.slug === selectedMod ? null : mod.slug); setView("byModule"); }}
            className={cn(
              "bg-[#0d0e1e] border rounded-2xl p-4 text-left transition-all",
              selectedMod === mod.slug
                ? "border-violet-500/50 ring-1 ring-violet-500/20"
                : "border-white/[0.06] hover:border-white/10",
            )}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${MODULE_COLORS[mod.slug] ?? "from-slate-600 to-slate-700"} flex items-center justify-center text-xl mb-2.5`}>
              {MODULE_ICONS[mod.slug] ?? "📦"}
            </div>
            <p className="text-white font-medium text-xs leading-tight mb-1">{mod.name}</p>
            <p className="text-slate-500 text-xs">{mod.enabledCount}/{mod.totalCount} activo{mod.enabledCount !== 1 ? "s" : ""}</p>
            <div className="mt-2 w-full bg-white/5 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${MODULE_COLORS[mod.slug] ?? "from-slate-500 to-slate-600"} transition-all`}
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
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Workspace</th>
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Estado</th>
                      <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Activar / Desactivar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrgs.map(({ org, modules }) => {
                      const modEntry = modules.find(m => m.slug === activeMod.slug);
                      const isEnabled = modEntry ? modEntry.isEnabled : activeMod.slug === "crm";
                      const alwaysOn = activeMod.alwaysOn ?? activeMod.slug === "crm";
                      const key = `${org.id}:${activeMod.slug}`;
                      return (
                        <tr key={org.id} className={cn("border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors", org.status === "suspended" ? "opacity-50" : "")}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-violet-600/20 flex items-center justify-center flex-shrink-0">
                                <Building2 size={13} className="text-violet-400" />
                              </div>
                              <div>
                                <p className="text-white text-sm font-medium">{org.name}</p>
                                {org.status === "suspended" && <p className="text-amber-400 text-xs">Suspendido</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            {!alwaysOn && (
                              <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                                isEnabled ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-500",
                              )}>
                                {isEnabled ? "● Activo" : "○ Inactivo"}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex justify-end">
                              <ModuleSwitch
                                slug={activeMod.slug}
                                name={activeMod.name}
                                isEnabled={isEnabled}
                                alwaysOn={alwaysOn}
                                isPending={pendingKey === key}
                                onToggle={() => handleToggle(org.id, activeMod.slug, isEnabled)}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredOrgs.length === 0 && (
                  <div className="text-center py-10 text-slate-500 text-sm">No hay workspaces que coincidan</div>
                )}
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
          {filteredOrgs.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Building2 size={40} className="mx-auto mb-3 opacity-30" />
              <p>{search ? "No hay workspaces que coincidan" : "No hay workspaces"}</p>
            </div>
          )}
          <div className="space-y-4">
            {filteredOrgs.map(({ org, modules }) => {
              const enabledCount = modules.filter(m => m.isEnabled || m.alwaysOn || m.slug === "crm").length;
              return (
                <div
                  key={org.id}
                  className={cn(
                    "bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden",
                    org.status === "suspended" ? "opacity-60" : "",
                  )}
                >
                  {/* Workspace header */}
                  <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center flex-shrink-0">
                      <Building2 size={15} className="text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{org.name}</p>
                      {org.status === "suspended" && <p className="text-amber-400 text-xs">Suspendido</p>}
                    </div>
                    <span className="text-xs text-slate-500 flex-shrink-0">
                      {enabledCount}/{modules.length} activos
                    </span>
                  </div>

                  {/* Module rows */}
                  <div className="divide-y divide-white/[0.04]">
                    {modules.map(mod => {
                      const alwaysOn = mod.alwaysOn || mod.slug === "crm";
                      const key = `${org.id}:${mod.slug}`;
                      return (
                        <div
                          key={mod.slug}
                          className={cn(
                            "flex items-center gap-4 px-6 py-3 hover:bg-white/[0.02] transition-colors",
                            !mod.isEnabled && !alwaysOn ? "opacity-70" : "",
                          )}
                        >
                          <span className="text-base flex-shrink-0 w-6 text-center">{MODULE_ICONS[mod.slug] ?? "📦"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium">{mod.name}</p>
                            <p className="text-slate-500 text-xs truncate">{mod.description}</p>
                          </div>
                          <ModuleSwitch
                            slug={mod.slug}
                            name={mod.name}
                            isEnabled={mod.isEnabled}
                            alwaysOn={alwaysOn}
                            isPending={pendingKey === key}
                            onToggle={() => handleToggle(org.id, mod.slug, mod.isEnabled)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
