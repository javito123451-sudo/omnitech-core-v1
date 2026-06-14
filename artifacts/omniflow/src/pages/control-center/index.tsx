import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Building2, Users, UserCheck, MessageSquare, FileText,
  Shield, Zap, Bot, HardDrive, CheckCircle2, TrendingUp,
  Clock, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Metrics {
  workspaces: number;
  users: number;
  clients: number;
  messages: number;
  quotes: number;
  superAdmins: number;
  aiAgents: number;
  automations: number;
  storageUsedMb: number;
  systemStatus: string;
}

function MetricCard({ icon: Icon, label, value, color, trend }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  trend?: string;
}) {
  return (
    <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 hover:border-white/10 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        {trend && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <TrendingUp size={12} /> {trend}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOk = status === "operational";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isOk ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
      <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isOk ? "bg-emerald-400" : "bg-red-400"}`} />
      {isOk ? "Operativo" : "Alerta"}
    </span>
  );
}

export default function ControlCenterDashboard() {
  const { data: metrics, isLoading } = useQuery<Metrics>({
    queryKey: ["cc-metrics"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/metrics`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const now = new Date();
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">OmniTech Control Center</h1>
            <p className="text-slate-500 mt-1 capitalize">{dateStr}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={metrics?.systemStatus ?? "operational"} />
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Clock size={14} />
              <span>{timeStr}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        <MetricCard icon={Building2}    label="Workspaces"    value={isLoading ? "—" : metrics!.workspaces}     color="bg-violet-600"   trend="+2 mes" />
        <MetricCard icon={Users}        label="Usuarios"      value={isLoading ? "—" : metrics!.users}           color="bg-blue-600"     />
        <MetricCard icon={UserCheck}    label="Clientes"      value={isLoading ? "—" : metrics!.clients}         color="bg-cyan-600"     />
        <MetricCard icon={MessageSquare} label="Mensajes"     value={isLoading ? "—" : metrics!.messages}        color="bg-teal-600"     />
        <MetricCard icon={FileText}     label="Presupuestos"  value={isLoading ? "—" : metrics!.quotes}          color="bg-amber-600"    />
        <MetricCard icon={Bot}          label="Agentes IA"    value={isLoading ? "—" : metrics!.aiAgents}        color="bg-pink-600"     trend="activos" />
        <MetricCard icon={Zap}          label="Automatizaciones" value={isLoading ? "—" : metrics!.automations}  color="bg-orange-600"   />
        <MetricCard icon={HardDrive}    label="Almacenamiento" value={isLoading ? "—" : `${metrics!.storageUsedMb} MB`} color="bg-slate-600" />
      </div>

      {/* Status Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Status */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400" /> Estado del Sistema
          </h2>
          <div className="space-y-3">
            {[
              { name: "API Server",       status: "operational" },
              { name: "Base de Datos",    status: "operational" },
              { name: "WhatsApp Gateway", status: "operational" },
              { name: "AI Engine",        status: "operational" },
              { name: "Autenticación",    status: "operational" },
            ].map(svc => (
              <div key={svc.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <span className="text-slate-400 text-sm">{svc.name}</span>
                <StatusBadge status={svc.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Super Admins */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Shield size={18} className="text-violet-400" /> Administradores de Plataforma
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 py-2 border-b border-white/[0.04]">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 text-xs font-bold">A3</div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">a3servicio@gmail.com</p>
                <p className="text-xs text-violet-400">SUPER_ADMIN</p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-2 border-b border-white/[0.04]">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 text-xs font-bold">OT</div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">omnitechcore01@gmail.com</p>
                <p className="text-xs text-violet-400">SUPER_ADMIN</p>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500">
              <AlertTriangle size={12} className="inline mr-1 text-amber-400" />
              El acceso al Control Center está restringido a estos usuarios
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
