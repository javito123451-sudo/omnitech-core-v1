import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Building2, Users, UserCheck, MessageSquare, FileText,
  Shield, Zap, Bot, HardDrive, TrendingUp, Clock, AlertTriangle,
  CheckCircle2, XCircle, AlertCircle, Database, Key, Activity,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Metrics {
  workspaces: number; workspacesSusp: number; users: number; clients: number;
  messages: number; quotes: number; superAdmins: number;
  aiAgents: number; automations: number; storageUsedMb: number; systemStatus: string;
}

interface ServiceHealth {
  status: "ok" | "warning" | "error";
  latencyMs?: number;
  message: string;
}
interface HealthData {
  status: "operational" | "degraded" | "down";
  services: {
    database:  ServiceHealth;
    openai:    ServiceHealth;
    whatsapp:  ServiceHealth;
    clerk:     ServiceHealth;
  };
  system: { uptimeSeconds: number; memoryMb: number; heapMb: number; nodeVersion: string };
  checkedAt: string;
}

function MetricCard({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType; label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 hover:border-white/10 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        {sub && <span className="text-xs text-slate-500">{sub}</span>}
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function ServiceStatusRow({ name, icon: Icon, service }: {
  name: string; icon: React.ElementType; service: ServiceHealth | undefined;
}) {
  if (!service) return null;
  const { status, latencyMs, message } = service;
  const color = status === "ok" ? "text-emerald-400" : status === "warning" ? "text-amber-400" : "text-red-400";
  const bg    = status === "ok" ? "bg-emerald-500/10" : status === "warning" ? "bg-amber-500/10" : "bg-red-500/10";
  const StatusIcon = status === "ok" ? CheckCircle2 : status === "warning" ? AlertCircle : XCircle;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2.5">
        <Icon size={15} className="text-slate-500" />
        <span className="text-slate-400 text-sm">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {latencyMs !== undefined && <span className="text-xs text-slate-600 font-mono">{latencyMs}ms</span>}
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${bg} ${color}`}>
          <StatusIcon size={11} />
          {status === "ok" ? "Operativo" : status === "warning" ? "Advertencia" : "Error"}
        </span>
      </div>
    </div>
  );
}

function UptimeDisplay({ seconds }: { seconds: number }) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return <>{d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}</>;
}

export default function ControlCenterDashboard() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<Metrics>({
    queryKey: ["cc-metrics"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/metrics`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: health, isLoading: healthLoading } = useQuery<HealthData>({
    queryKey: ["cc-health"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/health`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const now     = new Date();
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const overallOk     = health?.status === "operational";
  const overallDegraded = health?.status === "degraded";
  const statusColor   = overallOk ? "text-emerald-400" : overallDegraded ? "text-amber-400" : "text-red-400";
  const statusBg      = overallOk ? "bg-emerald-500/10" : overallDegraded ? "bg-amber-500/10" : "bg-red-500/10";
  const statusLabel   = overallOk ? "Operativo" : overallDegraded ? "Degradado" : "Caído";
  const statusDot     = overallOk ? "bg-emerald-400" : overallDegraded ? "bg-amber-400" : "bg-red-400";

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
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusBg} ${statusColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${statusDot}`} />
              {healthLoading ? "Comprobando…" : statusLabel}
            </span>
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Clock size={14} />
              <span>{timeStr}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        <MetricCard icon={Building2}     label="Workspaces"       value={metricsLoading ? "—" : metrics!.workspaces}        color="bg-violet-600"
          sub={metrics?.workspacesSusp ? `${metrics.workspacesSusp} susp.` : undefined} />
        <MetricCard icon={Users}         label="Usuarios"          value={metricsLoading ? "—" : metrics!.users}              color="bg-blue-600"     />
        <MetricCard icon={UserCheck}     label="Clientes"          value={metricsLoading ? "—" : metrics!.clients}            color="bg-cyan-600"     />
        <MetricCard icon={MessageSquare} label="Mensajes"          value={metricsLoading ? "—" : metrics!.messages}           color="bg-teal-600"     />
        <MetricCard icon={FileText}      label="Presupuestos"      value={metricsLoading ? "—" : metrics!.quotes}             color="bg-amber-600"    />
        <MetricCard icon={Bot}           label="AI Agents activos" value={metricsLoading ? "—" : metrics!.aiAgents}           color="bg-pink-600"     />
        <MetricCard icon={Zap}           label="Automations"       value={metricsLoading ? "—" : metrics!.automations}        color="bg-orange-600"   />
        <MetricCard icon={HardDrive}     label="Almacenamiento"    value={metricsLoading ? "—" : `${metrics!.storageUsedMb} MB`} color="bg-slate-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real Health Check */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
            <Activity size={18} className="text-emerald-400" /> Estado del Sistema
          </h2>
          {health && (
            <p className="text-slate-600 text-xs mb-4">
              Última comprobación: {new Date(health.checkedAt).toLocaleTimeString("es-ES")}
            </p>
          )}
          {healthLoading ? (
            <div className="flex items-center gap-2 py-4 text-slate-500 text-sm">
              <Activity size={16} className="animate-pulse" /> Comprobando servicios…
            </div>
          ) : health ? (
            <div className="space-y-0">
              <ServiceStatusRow name="Base de Datos"    icon={Database}  service={health.services.database}  />
              <ServiceStatusRow name="OpenAI / IA"      icon={Bot}       service={health.services.openai}    />
              <ServiceStatusRow name="WhatsApp Gateway" icon={MessageSquare} service={health.services.whatsapp} />
              <ServiceStatusRow name="Autenticación"    icon={Key}       service={health.services.clerk}     />
            </div>
          ) : null}
          {health && (
            <div className="mt-5 pt-4 border-t border-white/[0.06] grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-white font-semibold text-sm"><UptimeDisplay seconds={health.system.uptimeSeconds} /></p>
                <p className="text-slate-500 text-xs mt-0.5">Uptime</p>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-sm">{health.system.memoryMb} MB</p>
                <p className="text-slate-500 text-xs mt-0.5">RAM</p>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-sm">{health.system.nodeVersion}</p>
                <p className="text-slate-500 text-xs mt-0.5">Node.js</p>
              </div>
            </div>
          )}
        </div>

        {/* Admins panel */}
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
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Activo
              </span>
            </div>
            <div className="flex items-center gap-3 py-2 border-b border-white/[0.04]">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 text-xs font-bold">OT</div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">omnitechcore01@gmail.com</p>
                <p className="text-xs text-violet-400">SUPER_ADMIN</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Activo
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-400" />
              El acceso al Control Center está restringido a estos usuarios
            </p>
          </div>

          {/* System stats */}
          {!metricsLoading && metrics && (
            <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center gap-4">
              <div className="text-center flex-1">
                <p className="text-violet-400 font-bold text-lg">{metrics.superAdmins}</p>
                <p className="text-slate-600 text-xs">Super Admins</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-blue-400 font-bold text-lg">{metrics.workspaces}</p>
                <p className="text-slate-600 text-xs">Workspaces</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-teal-400 font-bold text-lg">{metrics.users}</p>
                <p className="text-slate-600 text-xs">Usuarios</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
