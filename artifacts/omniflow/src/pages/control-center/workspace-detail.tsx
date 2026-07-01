import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useOrg } from "@/lib/orgContext";
import {
  Building2, ArrowLeft, Users, UserCheck, MessageSquare, FileText,
  Puzzle, Clock, CheckCircle2, XCircle, PauseCircle, PlayCircle,
  ChevronDown, Loader2, ShieldAlert, Info, AlertTriangle,
  Edit2, Save, X, Crown, Shield, Eye,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface WorkspaceDetail {
  id: number; name: string; slug: string;
  plan: string; status: string; createdAt: string;
  stats: { users: number; clients: number; messages: number; quotes: number };
  license: {
    plan: string; seats: number; billingCycle: string;
    validFrom: string | null; validUntil: string | null; notes: string | null;
  } | null;
  modules: Array<{ moduleSlug: string; isEnabled: boolean; updatedAt: string }>;
  recentAudit: Array<{
    id: number; action: string; actorEmail: string | null;
    severity: string; createdAt: string;
  }>;
}

interface Member {
  userId: number; role: string; isSuspended: boolean; joinedAt: string | null;
  email: string | null; name: string | null; clerkId: string | null; userStatus: string;
}

type Tab = "general" | "members" | "modules" | "history";

const PLAN_COLORS: Record<string, string> = {
  starter:      "bg-slate-500/20 text-slate-300",
  professional: "bg-blue-500/20 text-blue-400",
  enterprise:   "bg-violet-500/20 text-violet-400",
};

const ROLE_COLORS: Record<string, string> = {
  owner:     "bg-amber-500/20 text-amber-400",
  admin:     "bg-blue-500/20 text-blue-400",
  manager:   "bg-cyan-500/20 text-cyan-400",
  member:    "bg-slate-500/20 text-slate-300",
  client:    "bg-emerald-500/20 text-emerald-400",
  guest:     "bg-slate-600/20 text-slate-500",
  read_only: "bg-slate-600/20 text-slate-400",
  vendedor:  "bg-orange-500/20 text-orange-400",
  cliente:   "bg-emerald-500/20 text-emerald-400",
};

const ROLE_ICON: Record<string, React.ElementType> = {
  owner:     Crown,
  admin:     Shield,
  manager:   UserCheck,
  member:    Users,
  client:    Eye,
  guest:     Eye,
  read_only: Eye,
};

const SEV_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  info:     { icon: Info,         color: "text-blue-400" },
  warning:  { icon: AlertTriangle, color: "text-amber-400" },
  critical: { icon: ShieldAlert,  color: "text-red-400" },
};

const ACTION_LABELS: Record<string, string> = {
  workspace_created: "Workspace creado", workspace_updated: "Workspace actualizado",
  workspace_suspended: "Workspace suspendido", workspace_activated: "Workspace activado",
  module_enabled: "Módulo activado", module_disabled: "Módulo desactivado",
  license_assigned: "Licencia asignada", user_role_changed: "Rol cambiado",
  user_suspended: "Usuario suspendido", user_activated: "Usuario activado",
};

const MODULE_NAMES: Record<string, string> = {
  crm: "CRM", whatsapp: "WhatsApp Business", omni_import_ai: "Omni Import AI",
  omni_docs: "Omni Docs", omni_security: "Omni Security", omni_marketing: "Omni Marketing",
  analytics: "Analytics", automations: "Automations", ai_agents: "AI Agents",
};
const MODULE_ICONS: Record<string, string> = {
  crm: "🏢", whatsapp: "💬", omni_import_ai: "🤖", omni_docs: "📄",
  omni_security: "🔒", omni_marketing: "📣", analytics: "📊", automations: "⚡", ai_agents: "🧠",
};

function EditNameModal({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(name);
  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: val }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspace", id] }); qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Editar nombre</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <input
          type="text" value={val} onChange={e => setVal(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 text-sm mb-4"
          onKeyDown={e => e.key === "Enter" && val.trim() && mut.mutate()}
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">Cancelar</button>
          <button onClick={() => mut.mutate()} disabled={!val.trim() || mut.isPending || val === name}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { refetch: refetchOrg, org } = useOrg();
  const wsId = Number(id);
  const [tab, setTab]         = useState<Tab>("general");
  const [editName, setEditName] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [suspendReason, setSuspendReason]   = useState("");

  const { data: ws, isLoading } = useQuery<WorkspaceDetail>({
    queryKey: ["cc-workspace", wsId],
    queryFn:  () => authFetch(`${BASE}/api/control-center/workspaces/${wsId}`).then(r => r.json()),
    enabled:  !isNaN(wsId),
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ["cc-workspace-members", wsId],
    queryFn:  () => authFetch(`${BASE}/api/control-center/workspaces/${wsId}/members`).then(r => r.json()),
    enabled:  tab === "members" && !isNaN(wsId),
  });

  const suspendMut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${wsId}/${ws?.status === "active" ? "suspend" : "activate"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: suspendReason }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspace", wsId] }); qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); setConfirmSuspend(false); },
  });

  const toggleModuleMut = useMutation({
    mutationFn: ({ moduleSlug, isEnabled }: { moduleSlug: string; isEnabled: boolean }) =>
      authFetch(`${BASE}/api/control-center/modules`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: wsId, moduleSlug, isEnabled }),
      }).then(r => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cc-workspace", wsId] });
      // If this workspace is the admin's own workspace, refresh the OrgContext
      // so the sidebar reflects the change without requiring a page reload.
      if (org && org.id === wsId) refetchOrg();
    },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
  );
  if (!ws) return (
    <div className="p-8 text-center text-slate-500">
      <Building2 size={40} className="mx-auto mb-3 opacity-30" />
      <p>Workspace no encontrado</p>
      <button onClick={() => navigate(`${BASE}/control-center/workspaces`)} className="text-violet-400 text-sm mt-3 hover:text-violet-300">
        Volver a Workspaces
      </button>
    </div>
  );

  const isActive = ws.status === "active";
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "general", label: "General" },
    { id: "members", label: `Miembros (${ws.stats.users})` },
    { id: "modules", label: "Módulos" },
    { id: "history", label: "Historial" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {editName && <EditNameModal id={wsId} name={ws.name} onClose={() => setEditName(false)} />}

      {/* Confirm suspend modal */}
      {confirmSuspend && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`bg-[#0d0e1e] border rounded-2xl p-6 w-full max-w-md ${isActive ? "border-amber-500/20" : "border-emerald-500/20"}`}>
            <div className="flex items-center gap-3 mb-4">
              {isActive ? <PauseCircle size={28} className="text-amber-400" /> : <PlayCircle size={28} className="text-emerald-400" />}
              <div>
                <h2 className="text-white font-semibold">{isActive ? "Suspender workspace" : "Activar workspace"}</h2>
                <p className="text-slate-500 text-sm">{ws.name}</p>
              </div>
            </div>
            {isActive ? (
              <>
                <p className="text-slate-400 text-sm mb-4">Todos los usuarios perderán acceso inmediatamente.</p>
                <textarea
                  value={suspendReason} onChange={e => setSuspendReason(e.target.value)}
                  placeholder="Motivo (opcional)..." rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-amber-500 mb-4"
                />
              </>
            ) : (
              <p className="text-slate-400 text-sm mb-6">Se restaurará el acceso a todos los usuarios.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setConfirmSuspend(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white">Cancelar</button>
              <button onClick={() => suspendMut.mutate()} disabled={suspendMut.isPending}
                className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 ${isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {suspendMut.isPending ? <Loader2 size={15} className="animate-spin" /> : isActive ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                {isActive ? "Suspender" : "Activar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(`${BASE}/control-center/workspaces`)}
          className="flex items-center gap-2 text-slate-500 hover:text-white text-sm mb-5 transition-all"
        >
          <ArrowLeft size={16} /> Volver a Workspaces
        </button>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isActive ? "bg-violet-600/20" : "bg-amber-600/20"}`}>
              <Building2 size={22} className={isActive ? "text-violet-400" : "text-amber-400"} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{ws.name}</h1>
                <button onClick={() => setEditName(true)} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
                  <Edit2 size={14} />
                </button>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${PLAN_COLORS[ws.plan] ?? PLAN_COLORS.starter}`}>
                  {ws.plan}
                </span>
                {!isActive && (
                  <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                    <PauseCircle size={11} /> Suspendido
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-sm mt-1 font-mono">{ws.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const reason = prompt("Motivo del modo soporte (requerido):");
                if (!reason) return;
                localStorage.setItem("wsOverride", String(ws.id));
                localStorage.setItem("wsOverrideName", ws.name);
                localStorage.setItem("wsSupportReason", reason);
                navigate(`${BASE}/dashboard`);
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-amber-600/10 border border-amber-500/20 text-amber-400 hover:bg-amber-600/20 transition-all"
            >
              <Eye size={16} /> Modo Soporte
            </button>
            <button
              onClick={() => setConfirmSuspend(true)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? "bg-amber-600/10 border border-amber-500/20 text-amber-400 hover:bg-amber-600/20"
                  : "bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-600/20"
              }`}
            >
              {isActive ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
              {isActive ? "Suspender" : "Activar"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Users,          label: "Usuarios",    value: ws.stats.users    },
          { icon: UserCheck,      label: "Clientes",    value: ws.stats.clients  },
          { icon: MessageSquare,  label: "Mensajes",    value: ws.stats.messages },
          { icon: FileText,       label: "Presupuestos",value: ws.stats.quotes   },
        ].map(s => (
          <div key={s.label} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-4">
            <s.icon size={16} className="text-violet-400 mb-2" />
            <p className="text-2xl font-bold text-white">{s.value.toLocaleString()}</p>
            <p className="text-slate-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06] mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-shrink-0 px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: General ── */}
      {tab === "general" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4 text-sm flex items-center gap-2">
              <Building2 size={15} className="text-violet-400" /> Información General
            </h2>
            <div className="space-y-3">
              {[
                { label: "Nombre",     value: ws.name },
                { label: "Slug",       value: ws.slug, mono: true },
                { label: "Plan",       value: ws.plan },
                { label: "Estado",     value: isActive ? "Activo" : "Suspendido" },
                { label: "Creado",     value: ws.createdAt ? new Date(ws.createdAt).toLocaleDateString("es-ES", { dateStyle: "long" }) : "—" },
                { label: "ID interno", value: String(ws.id), mono: true },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <span className="text-slate-500 text-sm">{row.label}</span>
                  <span className={`text-white text-sm ${row.mono ? "font-mono" : "font-medium"}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4 text-sm flex items-center gap-2">
              <Puzzle size={15} className="text-violet-400" /> Licencia y Plan
            </h2>
            {ws.license ? (
              <div className="space-y-3">
                {[
                  { label: "Plan",           value: ws.license.plan },
                  { label: "Seats",          value: `${ws.license.seats} usuarios` },
                  { label: "Ciclo de pago",  value: ws.license.billingCycle === "monthly" ? "Mensual" : "Anual" },
                  { label: "Válida desde",   value: ws.license.validFrom ? new Date(ws.license.validFrom).toLocaleDateString("es-ES") : "—" },
                  { label: "Expira",         value: ws.license.validUntil ? new Date(ws.license.validUntil).toLocaleDateString("es-ES") : "Sin expiración" },
                  { label: "Notas",          value: ws.license.notes ?? "—" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <span className="text-slate-500 text-sm">{row.label}</span>
                    <span className="text-white text-sm font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Sin licencia asignada — plan Starter por defecto</p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Members ── */}
      {tab === "members" && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {membersLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
          ) : members.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Users size={36} className="mx-auto mb-3 opacity-30" />
              <p>Sin miembros</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Usuario", "Rol Workspace", "Estado", "Miembro desde"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const RIcon = ROLE_ICON[m.role] ?? Users;
                  return (
                    <tr key={m.userId} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold uppercase">
                            {(m.name ?? m.email ?? "?").charAt(0)}
                          </div>
                          <div>
                            <p className="text-white text-sm font-medium">{m.name ?? m.email ?? `User #${m.userId}`}</p>
                            {m.name && <p className="text-slate-500 text-xs">{m.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize flex items-center gap-1.5 w-fit ${ROLE_COLORS[m.role] ?? ROLE_COLORS.member}`}>
                          <RIcon size={11} /> {m.role}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {m.isSuspended || m.userStatus === "suspended"
                          ? <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={12} /> Suspendido</span>
                          : <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Activo</span>
                        }
                      </td>
                      <td className="px-5 py-4 text-slate-500 text-xs">
                        {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString("es-ES") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Modules ── */}
      {tab === "modules" && (
        <div className="space-y-3">
          {Object.entries(MODULE_NAMES).map(([slug, name]) => {
            const mod = ws.modules.find(m => m.moduleSlug === slug);
            const isEnabled = mod ? mod.isEnabled : slug === "crm";
            const isAlwaysOn = slug === "crm";
            return (
              <div key={slug} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl px-5 py-4 flex items-center gap-4">
                <span className="text-2xl flex-shrink-0">{MODULE_ICONS[slug] ?? "📦"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{name}</p>
                  {mod?.updatedAt && (
                    <p className="text-slate-600 text-xs">Actualizado {new Date(mod.updatedAt).toLocaleDateString("es-ES")}</p>
                  )}
                </div>
                {isAlwaysOn ? (
                  <span className="text-xs text-slate-500 bg-white/5 px-2.5 py-1 rounded-full">Siempre activo</span>
                ) : (
                  <button
                    onClick={() => toggleModuleMut.mutate({ moduleSlug: slug, isEnabled: !isEnabled })}
                    disabled={toggleModuleMut.isPending}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      isEnabled
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-slate-500/10 border border-slate-500/20 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {isEnabled ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    {isEnabled ? "Activo" : "Inactivo"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab: History ── */}
      {tab === "history" && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {ws.recentAudit.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Clock size={36} className="mx-auto mb-3 opacity-30" />
              <p>Sin historial registrado</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {ws.recentAudit.map(e => {
                const sev = SEV_STYLES[e.severity] ?? SEV_STYLES.info;
                const SevIcon = sev.icon;
                return (
                  <div key={e.id} className="px-6 py-4 flex items-center gap-4">
                    <SevIcon size={15} className={`${sev.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm">{ACTION_LABELS[e.action] ?? e.action.replace(/_/g, " ")}</p>
                      <p className="text-slate-500 text-xs">{e.actorEmail ?? "Sistema"}</p>
                    </div>
                    <span className="text-slate-600 text-xs flex-shrink-0">
                      {new Date(e.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
