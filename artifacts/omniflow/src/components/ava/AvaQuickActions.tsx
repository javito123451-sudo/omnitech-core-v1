import { Users, FileText, Receipt, CalendarDays, Search, BarChart3, Zap } from "lucide-react";

const ACTIONS = [
  { icon: Users,       label: "Buscar cliente",    msg: "Necesito buscar información sobre un cliente del CRM." },
  { icon: FileText,    label: "Crear presupuesto", msg: "Quiero crear un presupuesto para un cliente." },
  { icon: Receipt,     label: "Crear factura",     msg: "Ayúdame a crear una factura para un cliente." },
  { icon: CalendarDays,label: "Ver agenda",        msg: "Muéstrame mi agenda de hoy y las próximas citas." },
  { icon: Search,      label: "Buscar documento",  msg: "Necesito buscar un documento en el sistema." },
  { icon: BarChart3,   label: "Analizar ventas",   msg: "Dame un análisis rápido de las ventas recientes." },
  { icon: Zap,         label: "Automatizar tarea", msg: "Quiero automatizar una tarea repetitiva en el sistema." },
] as const;

export default function AvaQuickActions({ onAction }: { onAction: (msg: string) => void }) {
  return (
    <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">
        Acciones rápidas
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.map(({ icon: Icon, label, msg }) => (
          <button
            key={label}
            onClick={() => onAction(msg)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-primary/10 border border-white/[0.07] hover:border-primary/25 text-slate-400 hover:text-primary transition-all duration-150 text-[11px] font-medium group"
          >
            <Icon className="w-3 h-3 shrink-0 group-hover:text-primary transition-colors" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
