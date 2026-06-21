import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { Lock } from "lucide-react";
import { useOrg } from "@/lib/orgContext";

const MODULE_LABELS: Record<string, string> = {
  crm:           "CRM",
  whatsapp:      "WhatsApp Business",
  omni_import_ai:"Omni Import AI",
  omni_docs:     "Omni Docs",
  analytics:     "Analytics",
  automations:   "Automations",
  omni_marketing:"Marketing Hub",
  omni_security: "Security Core",
  integrations:  "Integraciones",
  ai_agents:       "AI Center",
  omni_accounting: "Omni Accounting",
};

function ModuleNotAvailable({ moduleKey }: { moduleKey: string }) {
  const [, navigate] = useLocation();
  const label = MODULE_LABELS[moduleKey] ?? moduleKey;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-white/10 flex items-center justify-center mb-5">
        <Lock size={28} className="text-slate-400" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Módulo no disponible
      </h2>
      <p className="text-slate-400 text-sm max-w-xs mb-6">
        El módulo <span className="text-white font-medium">{label}</span> no está
        activado en tu workspace. Contacta con tu administrador para habilitarlo.
      </p>
      <button
        onClick={() => navigate("/executive-dashboard")}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
      >
        Volver al Dashboard
      </button>
    </div>
  );
}

export function ModuleGuard({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: ReactNode;
}) {
  const { canAccessModule, loading } = useOrg();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccessModule(moduleKey)) {
    return <ModuleNotAvailable moduleKey={moduleKey} />;
  }

  return <>{children}</>;
}
