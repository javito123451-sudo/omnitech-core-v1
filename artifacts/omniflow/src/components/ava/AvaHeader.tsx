import { X, Sparkles } from "lucide-react";
import AvaAvatar from "./AvaAvatar";
import { useAva } from "./AvaContext";

const MODULE_GREETINGS: Record<string, string> = {
  "Clientes":            "Veo que estás en Clientes.",
  "Presupuestos":        "Gestionando Presupuestos.",
  "Contabilidad":        "Área de Contabilidad activa.",
  "Calendario":          "Calendario a la vista.",
  "Dashboard Ejecutivo": "Resumen ejecutivo preparado.",
  "Panel CRM":           "Panel CRM activo.",
  "Pipeline":            "Estás en el Pipeline.",
  "Estadísticas":        "Datos de Estadísticas disponibles.",
  "Intelligence":        "Intelligence activo.",
  "Marketing Hub":       "Marketing Hub abierto.",
  "OmniAds":             "OmniAds en pantalla.",
  "OmniLeads AI":        "OmniLeads AI activo.",
  "Ava Autopilot":       "Ava Autopilot visible.",
  "Conversaciones":      "Bandeja de Conversaciones activa.",
};

export default function AvaHeader() {
  const { close, moduleLabel } = useAva();
  const greeting = moduleLabel ? (MODULE_GREETINGS[moduleLabel] ?? `Estás en ${moduleLabel}.`) : null;

  return (
    <div className="px-5 py-4 border-b border-white/[0.07] flex items-start gap-4 shrink-0 bg-gradient-to-r from-[#0c0e1c] to-[#0f1120]">
      <AvaAvatar size={48} breathing={false} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold text-white text-[15px] leading-snug">Hola, soy Ava.</span>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-medium">Online</span>
          </div>
        </div>
        <p className="text-[13px] text-slate-400 leading-snug">¿En qué puedo ayudarte?</p>
        {greeting && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary/50 shrink-0" />
            <span className="text-[11px] text-primary/60 leading-none">{greeting}</span>
          </div>
        )}
      </div>

      <button
        onClick={close}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 mt-0.5"
        aria-label="Cerrar"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
