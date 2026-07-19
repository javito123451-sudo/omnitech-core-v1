import { Users, FileText, Receipt, CalendarDays, Search, BarChart3, Zap } from "lucide-react";

const ACTIONS = [
  { icon: Users,       label: "Mis clientes",      msg: "Mis clientes activos" },
  { icon: FileText,    label: "Crear presupuesto", msg: "Crear un presupuesto" },
  { icon: Receipt,     label: "Crear factura",     msg: "Crear una factura" },
  { icon: CalendarDays,label: "Agenda de hoy",     msg: "Mis citas de hoy" },
  { icon: Search,      label: "Qué puedo hacer",   msg: "Ayuda" },
  { icon: BarChart3,   label: "Resumen financiero",msg: "Cuánto he facturado este mes" },
  { icon: Zap,         label: "Mis tareas",        msg: "Mis tareas pendientes" },
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
