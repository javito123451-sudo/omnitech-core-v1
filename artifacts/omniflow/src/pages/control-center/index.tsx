import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Link } from "wouter";
import {
  Building2, Users, UserCheck, MessageSquare, FileText,
  Shield, Zap, Bot, HardDrive, TrendingUp, Clock, AlertTriangle,
  CheckCircle2, XCircle, AlertCircle, Database, Key, Activity,
  Crown, ChevronRight, Puzzle, Lock, ClipboardList, Plug,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Metrics {
  workspaces: number; workspacesSusp: number; users: number; clients: number;
  messages: number; quotes: number; superAdmins: number;
  aiAgents: number; automations: number; storageUsedMb: number; systemStatus: string;
}
interface ServiceHealth { status: "ok" | "warning" | "error"; latencyMs?: number; message: string; }
interface HealthData {
  status: "operational" | "degraded" | "down";
  services: { database: ServiceHealth; openai: ServiceHealth; whatsapp: ServiceHealth; clerk: ServiceHealth };
  system: { uptimeSeconds: number; memoryMb: number; heapMb: number; nodeVersion: string };
  checkedAt: string;
}
interface PlatformRole {
  id: number; clerkUserId: string; role: string;
  displayName: string | null; email: string | null; isActive: boolean; createdAt: string;
}
interface AuditLog {
  id: number; action: string; actorEmail: string | null; orgId: number | null;
  severity: string; createdAt: string;
}
interface AuditResponse { logs: AuditLog[]; total: number; }

const ACTION_LABELS: Record<string, string> = {
  workspace_created: "Workspace creado", workspace_deleted: "Workspace eliminado",
  workspace_suspended: "Workspace suspendido", workspace_activated: "Workspace activado",
  module_enabled: "Módulo activado", module_disabled: "Módulo desactivado",
  license_assigned: "Licencia asignada", platform_role_granted: "Rol concedido",
  platform_role_revoked: "Rol revocado", user_role_changed: "Rol cambiado",
  user_suspended: "Usuario suspendido", user_activated: "Usuario activado",
};

const SEV_DOT: Record<string, string> = {
  info: "bg-blue-400", warning: "bg-amber-400", critical: "bg-red-400",
};

function MetricCard({ icon: Icon, label, value, color, sub, href }: {
  icon: React.ElementType; label: string; value: string | number; color: string; sub?: string; href?: string;
}) {
  const inner = (
    <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 hover:border-white/10 transition-all group cursor-pointer">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        {sub && <span className="text-xs text-slate-500">{sub}</span>}
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-500 mt-1 group-hover:text-slate-400 transition-colors">{label}</p>
    </div>
  );
  if (href) return <Link href={`${BASE}${href}`}>{inner}</Link>;
  return inner;
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

const QUICK_LINKS = [
  { icon: Building2,    label: "Workspaces",      href: "/control-center/workspaces",   color: "text-violet-400",  bg: "bg-violet-600/10"  },
  { icon: Users,        label: "Usuarios",         href: "/control-center/users",        color: "text-blue-400",    bg: "bg-blue-600/10"    },
  { icon: Shield,       label: "Roles",            href: "/control-center/roles",        color: "text-pink-400",    bg: "bg-pink-600/10"    },
  { icon: Puzzle,       label: "Módulos",          href: "/control-center/modules",      color: "text-amber-400",   bg: "bg-amber-600/10"   },
  { icon: Bot,          label: "IA",               href: "/control-center/ai-center",    color: "text-teal-400",    bg: "bg-teal-600/10"    },
  { icon: Plug,         label: "Integraciones",    href: "/control-center/integrations", color: "text-cyan-400",    bg: "bg-cyan-600/10"    },
  { icon: Lock,         label: "Seguridad",        href: "/control-center/security",     color: "text-red-400",     bg: "bg-red-600/10"     },
  { icon: ClipboardList,label: "Auditoría",        href: "/control-center/audit",        color: "text-slate-400",   bg: "bg-slate-600/10"   },
];

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
  const { data: platformRoles = [], isLoading: rolesLoading } = useQuery<PlatformRole[]>({
    queryKey: ["cc-platform-roles"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/platform-roles`).then(r => r.json()),
  });
  const { data: auditData } = useQuery<AuditResponse>({
    queryKey: ["cc-audit-recent"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/audit?limit=6`).then(r => r.json()),
    refetchInterval: 15_000,
  });

  const now     = new Date();
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const overallOk       = health?.status === "operational";
  const overallDegraded = health?.status === "degraded";
  const statusColor = overallOk ? "text-emerald-400" : overallDegraded ? "text-amber-400" : "text-red-400";
  const statusBg    = overallOk ? "bg-emerald-500/10" : overallDegraded ? "bg-amber-500/10" : "bg-red-500/10";
  const statusLabel = overallOk ? "Operativo" : overallDegraded ? "Degradado" : "Caído";
  const statusDot   = overallOk ? "bg-emerald-400" : overallDegraded ? "bg-amber-400" : "bg-red-400";

  const activeAdmins = platformRoles.filter(r => r.isActive);
  const recentLogs   = auditData?.logs ?? [];

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

      {/* Quick Links Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-8">
        {QUICK_LINKS.map(ql => (
          <Link key={ql.href} href={`${BASE}${ql.href}`}>
            <div className={`${ql.bg} border border-white/[0.06] rounded-2xl p-3 flex flex-col items-center gap-2 hover:border-white/10 transition-all cursor-pointer`}>
              <ql.icon size={18} className={ql.color} />
              <span className="text-xs text-slate-400 text-center leading-tight">{ql.label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        <MetricCard icon={Building2}     label="Workspaces"       value={metricsLoading ? "—" : metrics!.workspaces}     color="bg-violet-600"
          sub={metrics?.workspacesSusp ? `${metrics.workspacesSusp} susp.` : undefined} href="/control-center/workspaces" />
        <MetricCard icon={Users}         label="Usuarios"          value={metricsLoading ? "—" : metrics!.users}          color="bg-blue-600"   href="/control-center/users" />
        <MetricCard icon={UserCheck}     label="Clientes"          value={metricsLoading ? "—" : metrics!.clients}        color="bg-cyan-600"   />
        <MetricCard icon={MessageSquare} label="Mensajes"          value={metricsLoading ? "—" : metrics!.messages}       color="bg-teal-600"   />
        <MetricCard icon={FileText}      label="Presupuestos"      value={metricsLoading ? "—" : metrics!.quotes}         color="bg-amber-600"  />
        <MetricCard icon={Bot}           label="AI Agents activos" value={metricsLoading ? "—" : metrics!.aiAgents}       color="bg-pink-600"   href="/control-center/ai-center" />
        <MetricCard icon={Zap}           label="Automations"       value={metricsLoading ? "—" : metrics!.automations}    color="bg-orange-600" />
        <MetricCard icon={HardDrive}     label="Almacenamiento"    value={metricsLoading ? "—" : `${metrics!.storageUsedMb} MB`} color="bg-slate-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Health Check */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
            <Activity size={18} className="text-emerald-400" /> Estado del Sistema
          </h2>
          {health && (
            <p className="text-slate-600 text-xs mb-4">
              Comprobado: {new Date(health.checkedAt).toLocaleTimeString("es-ES")}
            </p>
          )}
          {healthLoading ? (
            <div className="flex items-center gap-2 py-4 text-slate-500 text-sm">
              <Activity size={16} className="animate-pulse" /> Comprobando…
            </div>
          ) : health ? (
            <div>
              <ServiceStatusRow name="Base de Datos"    icon={Database}      service={health.services.database}  />
              <ServiceStatusRow name="OpenAI / IA"      icon={Bot}           service={health.services.openai}    />
              <ServiceStatusRow name="WhatsApp Gateway" icon={MessageSquare} service={health.services.whatsapp}  />
              <ServiceStatusRow name="Autenticación"    icon={Key}           service={health.services.clerk}     />
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

        {/* Platform Admins — dynamic from DB */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Shield size={18} className="text-violet-400" /> Administradores de Plataforma
            </h2>
            <Link href={`${BASE}/control-center/roles`}>
              <span className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer">
                Gestionar <ChevronRight size={12} />
              </span>
            </Link>
          </div>
          {rolesLoading ? (
            <div className="text-slate-500 text-sm">Cargando…</div>
          ) : activeAdmins.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              <Shield size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin administradores configurados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeAdmins.map(r => {
                const isSA  = r.role === "SUPER_ADMIN";
                const label = r.displayName ?? r.email ?? r.clerkUserId;
                const initials = label.slice(0, 2).toUpperCase();
                return (
                  <div key={r.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isSA ? "bg-violet-600/20 text-violet-400" : "bg-pink-600/20 text-pink-400"}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{label}</p>
                      <p className={`text-xs ${isSA ? "text-violet-400" : "text-pink-400"}`}>
                        {isSA ? <span className="flex items-center gap-1"><Crown size={10} /> {r.role}</span> : <span className="flex items-center gap-1"><Shield size={10} /> {r.role}</span>}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Activo
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-violet-400 font-bold text-lg">{activeAdmins.filter(r => r.role === "SUPER_ADMIN").length}</p>
              <p className="text-slate-600 text-xs">SUPER_ADMIN</p>
            </div>
            <div>
              <p className="text-pink-400 font-bold text-lg">{activeAdmins.filter(r => r.role === "STAFF_OMNITECH").length}</p>
              <p className="text-slate-600 text-xs">STAFF</p>
            </div>
            <div>
              <p className="text-blue-400 font-bold text-lg">{metricsLoading ? "—" : metrics?.workspaces ?? 0}</p>
              <p className="text-slate-600 text-xs">Workspaces</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-400" /> Actividad Reciente
          </h2>
          <Link href={`${BASE}/control-center/audit`}>
            <span className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer">
              Ver todo <ChevronRight size={12} />
            </span>
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">Sin actividad registrada</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {recentLogs.map(log => (
              <div key={log.id} className="px-6 py-3.5 flex items-center gap-4">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEV_DOT[log.severity] ?? SEV_DOT.info}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">{ACTION_LABELS[log.action] ?? log.action.replace(/_/g, " ")}</p>
                  <p className="text-slate-500 text-xs">
                    {log.actorEmail ?? "Sistema"}
                    {log.orgId ? ` · org #${log.orgId}` : ""}
                  </p>
                </div>
                <span className="text-slate-600 text-xs flex-shrink-0 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
