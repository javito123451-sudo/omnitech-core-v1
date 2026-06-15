import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Shield, ShieldAlert, ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
  Lock, Users, Building2, Activity, Eye, Loader2, RefreshCw, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SecuritySummary {
  stats: {
    criticalEvents: number; warningEvents: number;
    suspendedUsers: number; suspendedOrgs: number;
    platformAdmins: number; totalUsers: number;
    totalOrgs: number; eventsLast24h: number;
  };
  checks: {
    encryptionConfigured: boolean; emailConfigured: boolean;
    openaiConfigured: boolean; clerkConfigured: boolean;
    postgresRls: boolean; rateLimiting: boolean; twoFactorForced: boolean;
  };
  vulnerabilities: Array<{
    id: string; severity: "high" | "medium" | "low";
    title: string; detail: string; status: "open" | "resolved";
  }>;
  recentCritical: Array<{
    id: number; action: string; actorEmail: string | null;
    orgId: number | null; createdAt: string; details: Record<string, unknown> | null;
  }>;
}

const SEV_COLORS = {
  high:   { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20"    },
  medium: { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20"  },
  low:    { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/20" },
};

const ACTION_LABELS: Record<string, string> = {
  workspace_deleted:   "Workspace eliminado",
  workspace_suspended: "Workspace suspendido",
  platform_role_granted: "Rol de plataforma concedido",
  platform_role_revoked: "Rol de plataforma revocado",
  user_suspended:      "Usuario suspendido",
};

function CheckRow({ ok, label, detail, warn }: { ok: boolean; label: string; detail?: string; warn?: boolean }) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const color = ok ? "text-emerald-400" : warn ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/[0.04] last:border-0">
      <Icon size={16} className={`${color} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${ok ? "text-white" : warn ? "text-amber-300" : "text-red-300"}`}>{label}</p>
        {detail && <p className="text-slate-500 text-xs mt-0.5">{detail}</p>}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${ok ? "bg-emerald-500/10 text-emerald-400" : warn ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>
        {ok ? "OK" : warn ? "Advertencia" : "Fallo"}
      </span>
    </div>
  );
}

export default function SecurityPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<SecuritySummary>({
    queryKey: ["cc-security-summary"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/security/summary`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-violet-400" />
      </div>
    );
  }

  const s = data?.stats;
  const c = data?.checks;
  const vulns = data?.vulnerabilities ?? [];
  const recent = data?.recentCritical ?? [];

  const openVulns   = vulns.filter(v => v.status === "open");
  const highVulns   = openVulns.filter(v => v.severity === "high").length;
  const mediumVulns = openVulns.filter(v => v.severity === "medium").length;
  const lowVulns    = openVulns.filter(v => v.severity === "low").length;

  const checksOk = c ? Object.values(c).filter(Boolean).length : 0;
  const checksTotal = c ? Object.keys(c).length : 0;
  const overallScore = checksTotal > 0 ? Math.round((checksOk / checksTotal) * 100) : 0;
  const scoreColor = overallScore >= 80 ? "text-emerald-400" : overallScore >= 60 ? "text-amber-400" : "text-red-400";
  const scoreBg    = overallScore >= 80 ? "bg-emerald-500/10 border-emerald-500/20" : overallScore >= 60 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Shield size={24} className="text-violet-400" /> Panel de Seguridad
          </h1>
          <p className="text-slate-500 mt-1">Estado de seguridad de la plataforma</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className={`rounded-2xl border p-5 ${scoreBg}`}>
          <ShieldCheck size={20} className={`${scoreColor} mb-2`} />
          <p className={`text-3xl font-bold ${scoreColor}`}>{overallScore}%</p>
          <p className="text-slate-500 text-xs mt-1">Puntuación de seguridad</p>
          <p className="text-slate-600 text-xs">{checksOk}/{checksTotal} controles OK</p>
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <ShieldAlert size={20} className="text-red-400 mb-2" />
          <p className="text-3xl font-bold text-white">{openVulns.length}</p>
          <p className="text-slate-500 text-xs mt-1">Vulnerabilidades abiertas</p>
          <p className="text-slate-600 text-xs">{highVulns} alta · {mediumVulns} media · {lowVulns} baja</p>
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <Activity size={20} className="text-amber-400 mb-2" />
          <p className="text-3xl font-bold text-white">{s?.eventsLast24h ?? 0}</p>
          <p className="text-slate-500 text-xs mt-1">Eventos (24h)</p>
          <p className="text-slate-600 text-xs">{s?.criticalEvents ?? 0} críticos total</p>
        </div>
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <Users size={20} className="text-blue-400 mb-2" />
          <p className="text-3xl font-bold text-white">{s?.suspendedUsers ?? 0}</p>
          <p className="text-slate-500 text-xs mt-1">Usuarios suspendidos</p>
          <p className="text-slate-600 text-xs">{s?.suspendedOrgs ?? 0} orgs suspendidas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Security Checks */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Lock size={16} className="text-violet-400" /> Controles de Seguridad
          </h2>
          <div>
            <CheckRow ok={!!c?.clerkConfigured}       label="Clerk Secret Key configurada"          detail="Autenticación de usuarios operativa" />
            <CheckRow ok={!!c?.openaiConfigured}       label="OpenAI API Key configurada"            detail="Necesaria para funciones de IA" />
            <CheckRow ok={!!c?.emailConfigured}        label="Email (Resend) configurado"            detail="Necesario para invitaciones y notificaciones" warn={!c?.emailConfigured} />
            <CheckRow ok={!!c?.encryptionConfigured}   label="Cifrado de integraciones configurado"  detail="Tokens almacenados con cifrado fuerte" warn={!c?.encryptionConfigured} />
            <CheckRow ok={!!c?.rateLimiting}           label="Rate limiting en chat"                 detail="Chat API protegido contra abuso" />
            <CheckRow ok={!!c?.postgresRls}            label="Row-Level Security en PostgreSQL"      detail="Segunda barrera de aislamiento entre orgs" warn={false} />
            <CheckRow ok={!!c?.twoFactorForced}        label="2FA forzado para SUPER_ADMIN"          detail="Protección adicional para accesos críticos" warn={!c?.twoFactorForced} />
          </div>
        </div>

        {/* Platform stats */}
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Eye size={16} className="text-violet-400" /> Estado de la Plataforma
          </h2>
          <div className="space-y-3">
            {[
              { label: "Administradores de plataforma", value: s?.platformAdmins ?? 0, icon: Shield, color: "text-violet-400" },
              { label: "Total usuarios registrados",    value: s?.totalUsers ?? 0,     icon: Users,    color: "text-blue-400"   },
              { label: "Total organizaciones",          value: s?.totalOrgs ?? 0,       icon: Building2, color: "text-teal-400" },
              { label: "Usuarios suspendidos",          value: s?.suspendedUsers ?? 0,  icon: XCircle,  color: "text-red-400"   },
              { label: "Orgs suspendidas",              value: s?.suspendedOrgs ?? 0,   icon: XCircle,  color: "text-amber-400" },
              { label: "Eventos críticos (histórico)",  value: s?.criticalEvents ?? 0,  icon: ShieldAlert, color: "text-red-400" },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div className="flex items-center gap-2.5">
                  <item.icon size={14} className={item.color} />
                  <span className="text-slate-400 text-sm">{item.label}</span>
                </div>
                <span className="text-white font-semibold text-sm">{item.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vulnerabilities */}
      <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-400" /> Vulnerabilidades Detectadas
          </h2>
          <span className="text-xs text-slate-500">{openVulns.length} abiertas · {vulns.length - openVulns.length} resueltas</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {vulns.map(v => {
            const sc = SEV_COLORS[v.severity];
            return (
              <div key={v.id} className={`px-6 py-4 flex items-start gap-4 ${v.status === "resolved" ? "opacity-40" : ""}`}>
                <div className={`px-2.5 py-1 rounded-lg border text-xs font-mono font-bold flex-shrink-0 ${sc.bg} ${sc.text} ${sc.border}`}>
                  {v.id}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{v.title}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{v.detail}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border} capitalize`}>
                    {v.severity === "high" ? "Alta" : v.severity === "medium" ? "Media" : "Baja"}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${v.status === "open" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                    {v.status === "open" ? "Abierta" : "Resuelta"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent critical events */}
      {recent.length > 0 && (
        <div className="bg-[#0d0e1e] border border-red-500/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <ShieldAlert size={16} className="text-red-400" /> Eventos Críticos Recientes (7 días)
            </h2>
            <Link href={`${BASE}/control-center/audit`}>
              <span className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer">
                Ver todos <ArrowRight size={12} />
              </span>
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recent.map(e => (
              <div key={e.id} className="px-6 py-3.5 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">{ACTION_LABELS[e.action] ?? e.action.replace(/_/g, " ")}</p>
                  <p className="text-slate-500 text-xs">{e.actorEmail ?? "Sistema"}{e.orgId ? ` · org:${e.orgId}` : ""}</p>
                </div>
                <span className="text-slate-600 text-xs flex-shrink-0">
                  {new Date(e.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {recent.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6 flex items-center gap-4">
          <ShieldCheck size={28} className="text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-emerald-300 font-semibold">Sin eventos críticos en los últimos 7 días</p>
            <p className="text-slate-400 text-sm mt-0.5">No se han registrado acciones críticas recientemente.</p>
          </div>
        </div>
      )}
    </div>
  );
}
