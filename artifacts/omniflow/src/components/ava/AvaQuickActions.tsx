import {
  Users, FileText, Receipt, CalendarDays, Search, BarChart3, Zap,
  Building2, ShieldCheck, ClipboardList, Bot, HeartPulse,
} from "lucide-react";

const CRM_ACTIONS = [
  { icon: Users,       label: "Mis clientes",      msg: "Mis clientes activos" },
  { icon: FileText,    label: "Crear presupuesto", msg: "Crear un presupuesto" },
  { icon: Receipt,     label: "Crear factura",     msg: "Crear una factura" },
  { icon: CalendarDays,label: "Agenda de hoy",     msg: "Mis citas de hoy" },
  { icon: Search,      label: "Qué puedo hacer",   msg: "Ayuda" },
  { icon: BarChart3,   label: "Resumen financiero",msg: "Cuánto he facturado este mes" },
  { icon: Zap,         label: "Mis tareas",        msg: "Mis tareas pendientes" },
] as const;

// AVA CORE super_admin has no CRM tools (clients/quotes/tasks) — offering
// those quick actions there just leads to a dead end, since the model has
// nothing to call for them. These map onto the real Super Admin tool catalog
// (superAdminTools.ts) instead.
const SUPER_ADMIN_ACTIONS = [
  { icon: HeartPulse,    label: "Salud del sistema", msg: "¿Cómo está la salud del sistema?" },
  { icon: Building2,     label: "Workspaces",        msg: "Muéstrame los workspaces" },
  { icon: Users,         label: "Usuarios",          msg: "Lista de usuarios de la plataforma" },
  { icon: ShieldCheck,   label: "Seguridad",         msg: "Resumen de seguridad" },
  { icon: ClipboardList, label: "Auditoría",         msg: "Últimos eventos de auditoría" },
  { icon: Bot,           label: "Uso de IA",         msg: "Cuánto se ha gastado en IA este mes" },
  { icon: BarChart3,     label: "Facturación",       msg: "Resumen de facturación por workspace" },
] as const;

export default function AvaQuickActions({ onAction, superAdmin }: { onAction: (msg: string) => void; superAdmin?: boolean }) {
  const ACTIONS = superAdmin ? SUPER_ADMIN_ACTIONS : CRM_ACTIONS;
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
