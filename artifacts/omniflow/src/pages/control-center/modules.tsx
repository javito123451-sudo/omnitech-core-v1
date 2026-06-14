import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Puzzle, Loader2, CheckCircle2, XCircle, Building2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ModuleCatalog {
  slug: string;
  name: string;
  description: string;
}

interface OrgModules {
  org: { id: number; name: string };
  modules: Array<ModuleCatalog & { isEnabled: boolean; configId: number | null }>;
}

interface ModulesResponse {
  catalog: ModuleCatalog[];
  orgs: OrgModules[];
}

const MODULE_ICONS: Record<string, string> = {
  crm:             "🏢",
  whatsapp:        "💬",
  omni_import_ai:  "🤖",
  omni_docs:       "📄",
  omni_security:   "🔒",
  omni_marketing:  "📣",
  analytics:       "📊",
  automations:     "⚡",
  ai_agents:       "🧠",
};

const MODULE_COLORS: Record<string, string> = {
  crm:             "from-blue-600 to-cyan-600",
  whatsapp:        "from-green-600 to-teal-600",
  omni_import_ai:  "from-violet-600 to-purple-600",
  omni_docs:       "from-amber-600 to-orange-600",
  omni_security:   "from-red-600 to-pink-600",
  omni_marketing:  "from-pink-600 to-rose-600",
  analytics:       "from-indigo-600 to-blue-600",
  automations:     "from-yellow-600 to-amber-600",
  ai_agents:       "from-fuchsia-600 to-violet-600",
};

export default function ModulesPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ModulesResponse>({
    queryKey: ["cc-modules"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/modules`).then(r => r.json()),
  });

  const toggleMut = useMutation({
    mutationFn: ({ orgId, moduleSlug, isEnabled }: { orgId: number; moduleSlug: string; isEnabled: boolean }) =>
      authFetch(`${BASE}/api/control-center/modules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, moduleSlug, isEnabled }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cc-modules"] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>;
  }

  const catalog = data?.catalog ?? [];
  const orgs    = data?.orgs ?? [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Puzzle size={24} className="text-violet-400" /> Module Management
        </h1>
        <p className="text-slate-500 mt-1">{catalog.length} módulos disponibles</p>
      </div>

      {/* Module Catalog */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-10">
        {catalog.map(mod => (
          <div key={mod.slug} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-4 hover:border-white/10 transition-all">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${MODULE_COLORS[mod.slug] ?? "from-slate-600 to-slate-700"} flex items-center justify-center text-xl mb-3`}>
              {MODULE_ICONS[mod.slug] ?? "📦"}
            </div>
            <p className="text-white font-medium text-sm">{mod.name}</p>
            <p className="text-slate-500 text-xs mt-1">{mod.description}</p>
          </div>
        ))}
      </div>

      {/* Per-Org Configuration */}
      <h2 className="text-white font-semibold text-lg mb-4 flex items-center gap-2">
        <Building2 size={18} className="text-violet-400" /> Configuración por Workspace
      </h2>

      {orgs.map(({ org, modules }) => (
        <div key={org.id} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
              <Building2 size={15} className="text-violet-400" />
            </div>
            <p className="text-white font-semibold text-sm">{org.name}</p>
            <span className="ml-auto text-xs text-slate-500">{modules.filter(m => m.isEnabled).length}/{modules.length} activos</span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {modules.map(mod => (
              <div key={mod.slug} className="flex items-center gap-3 bg-white/[0.02] rounded-xl px-4 py-3">
                <span className="text-lg">{MODULE_ICONS[mod.slug] ?? "📦"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">{mod.name}</p>
                </div>
                <button
                  onClick={() => toggleMut.mutate({ orgId: org.id, moduleSlug: mod.slug, isEnabled: !mod.isEnabled })}
                  disabled={toggleMut.isPending}
                  className="flex-shrink-0"
                >
                  {mod.isEnabled
                    ? <CheckCircle2 size={20} className="text-emerald-400 hover:text-emerald-300 transition-colors" />
                    : <XCircle size={20} className="text-slate-600 hover:text-slate-400 transition-colors" />
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
