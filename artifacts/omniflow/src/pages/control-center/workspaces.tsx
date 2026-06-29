import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Building2, Plus, Edit2, Trash2, Users, UserCheck, Calendar, Loader2,
  CheckCircle2, AlertCircle, PauseCircle, PlayCircle, X, Save,
  UserPlus, UserMinus, Crown, BarChart3, Eye, Shield, LayoutGrid,
  ChevronRight, ArrowRightLeft, XCircle, Search, KeyRound,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Workspace {
  id: number; name: string; slug: string; plan: string;
  status: string; users: number; clients: number; createdAt: string;
}

interface Member {
  userId: number; role: string; isSuspended: boolean; joinedAt: string;
  email: string | null; name: string | null; clerkId: string | null; userStatus: string;
}

interface Consumption {
  users: number; clients: number; messages: number;
  invoices: number; expenses: number; quotes: number;
  ai: { calls: number; tokens: number };
  storage: { mb: number; description: string };
}

const PLAN_COLORS: Record<string, string> = {
  starter:      "bg-slate-500/20 text-slate-300",
  professional: "bg-blue-500/20 text-blue-400",
  enterprise:   "bg-violet-500/20 text-violet-400",
  scale:        "bg-emerald-500/20 text-emerald-400",
  free:         "bg-slate-500/20 text-slate-400",
};

const ROLE_COLORS: Record<string, string> = {
  owner:     "bg-amber-500/15 text-amber-400 border-amber-500/20",
  admin:     "bg-violet-500/15 text-violet-400 border-violet-500/20",
  member:    "bg-blue-500/15 text-blue-400 border-blue-500/20",
  read_only: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  vendedor:  "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "suspended") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
        <PauseCircle size={11} /> Suspendido
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
      <CheckCircle2 size={12} /> Activo
    </span>
  );
}

function Modal({ children, onClose, title, icon: Icon, accent = "violet" }: {
  children: React.ReactNode; onClose: () => void; title: string;
  icon: React.ElementType; accent?: string;
}) {
  const accentMap: Record<string, string> = {
    violet: "text-violet-400", amber: "text-amber-400", emerald: "text-emerald-400",
    red: "text-red-400", blue: "text-blue-400", pink: "text-pink-400",
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <Icon size={20} className={accentMap[accent] ?? accentMap.violet} />
            <h2 className="text-white font-semibold text-lg">{title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-all"><X size={18} /></button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function AssignUserModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/assign-user`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-ws-members", ws.id] }); qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); setEmail(""); },
  });

  return (
    <Modal title="Asignar usuario" icon={UserPlus} onClose={onClose} accent="emerald">
      <p className="text-slate-400 text-sm mb-4">Asigna un usuario existente al workspace <strong className="text-white">{ws.name}</strong>.</p>
      <div className="space-y-3 mb-5">
        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Email del usuario *</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@empresa.com"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Rol</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500">
            <option value="member">Miembro</option>
            <option value="admin">Administrador</option>
            <option value="owner">Owner</option>
            <option value="read_only">Solo lectura</option>
            <option value="vendedor">Vendedor</option>
          </select>
        </div>
      </div>
      {mut.isError && <p className="text-red-400 text-xs mb-3">{String(mut.error)}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
        <button onClick={() => mut.mutate()} disabled={!email.trim() || mut.isPending}
          className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all">
          {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
          Asignar
        </button>
      </div>
    </Modal>
  );
}

function TransferOwnerModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/transfer-owner`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerEmail: email }),
    }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-ws-members", ws.id] }); qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); onClose(); },
  });

  return (
    <Modal title="Transferir propiedad" icon={Crown} onClose={onClose} accent="amber">
      <p className="text-slate-400 text-sm mb-4">
        El usuario actual owner pasará a ser <strong className="text-white">admin</strong>.
        El nuevo owner debe estar registrado en la plataforma.
      </p>
      <div className="mb-5">
        <label className="text-xs text-slate-500 mb-1.5 block">Email del nuevo owner *</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nuevo-owner@empresa.com"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-sm" />
      </div>
      {mut.isError && <p className="text-red-400 text-xs mb-3">{String(mut.error)}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
        <button onClick={() => mut.mutate()} disabled={!email.trim() || mut.isPending}
          className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all">
          {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
          Transferir
        </button>
      </div>
    </Modal>
  );
}

function ConsumptionPanel({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const { data, isLoading } = useQuery<Consumption>({
    queryKey: ["cc-ws-consumption", ws.id],
    queryFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/consumption`).then(r => r.json()),
  });

  const items = data ? [
    { label: "Usuarios", value: data.users, icon: Users, color: "text-blue-400" },
    { label: "Clientes", value: data.clients, icon: UserCheck, color: "text-emerald-400" },
    { label: "Mensajes", value: data.messages, icon: LayoutGrid, color: "text-violet-400" },
    { label: "Facturas", value: data.invoices, icon: BarChart3, color: "text-amber-400" },
    { label: "Gastos", value: data.expenses, icon: BarChart3, color: "text-pink-400" },
    { label: "Presupuestos", value: data.quotes, icon: LayoutGrid, color: "text-slate-400" },
    { label: "AI Calls", value: data.ai.calls, icon: Shield, color: "text-cyan-400" },
    { label: "AI Tokens", value: data.ai.tokens.toLocaleString(), icon: KeyRound, color: "text-cyan-400" },
  ] : [];

  return (
    <Modal title="Consumo del workspace" icon={BarChart3} onClose={onClose} accent="blue">
      <p className="text-slate-400 text-sm mb-4">Métricas de uso para <strong className="text-white">{ws.name}</strong>.</p>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {items.map(it => (
              <div key={it.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <it.icon size={14} className={it.color} />
                  <span className="text-xs text-slate-500">{it.label}</span>
                </div>
                <p className="text-white font-semibold text-lg">{it.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Almacenamiento estimado</span>
              <span className="text-white font-semibold">{data.storage.mb} MB</span>
            </div>
            <p className="text-xs text-slate-600">{data.storage.description}</p>
          </div>
        </>
      ) : (
        <p className="text-slate-500 text-center py-8">No hay datos de consumo disponibles</p>
      )}
    </Modal>
  );
}

function MembersPanel({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["cc-ws-members", ws.id],
    queryFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/members`).then(r => r.json()),
  });

  const removeMut = useMutation({
    mutationFn: (clerkId: string) => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/remove-user/${clerkId}`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cc-ws-members", ws.id] }),
  });

  return (
    <Modal title={`Usuarios de ${ws.name}`} icon={Users} onClose={onClose} accent="violet">
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-violet-400" /></div>
      ) : members.length === 0 ? (
        <p className="text-slate-500 text-center py-8">No hay usuarios asignados</p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.userId} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 text-xs font-bold">
                  {(m.name ?? m.email ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{m.name ?? m.email ?? "Sin nombre"}</p>
                  <p className="text-slate-500 text-xs">{m.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${ROLE_COLORS[m.role] ?? ROLE_COLORS.member}`}>{m.role}</span>
                {m.clerkId && (
                  <button onClick={() => removeMut.mutate(m.clerkId!)}
                    disabled={removeMut.isPending}
                    title="Eliminar del workspace"
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all">
                    <XCircle size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EditModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(ws.name);

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Editar Workspace</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <label className="block text-xs text-slate-500 mb-1.5">Nombre del workspace</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm mb-5"
          onKeyDown={e => e.key === "Enter" && name.trim() && mut.mutate()} />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button onClick={() => mut.mutate()} disabled={!name.trim() || mut.isPending || name === ws.name}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all">
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function SuspendModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const isActive = ws.status === "active";

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}/${isActive ? "suspend" : "activate"}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); onClose(); },
  });

  return (
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
            <p className="text-slate-400 text-sm mb-4">
              Todos los usuarios de este workspace <strong className="text-white">perderán acceso</strong> inmediatamente.
            </p>
            <label className="block text-xs text-slate-500 mb-1.5">Motivo (opcional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe el motivo de la suspensión..." rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-amber-500 mb-4" />
          </>
        ) : (
          <p className="text-slate-400 text-sm mb-6">Se restaurará el acceso a todos los usuarios del workspace.</p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 transition-all ${isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : isActive ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
            {isActive ? "Suspender" : "Activar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkspacesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editWs, setEditWs] = useState<Workspace | null>(null);
  const [suspendWs, setSuspendWs] = useState<Workspace | null>(null);
  const [manageWs, setManageWs] = useState<Workspace | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showConsumption, setShowConsumption] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [impersonateConfirm, setImpersonateConfirm] = useState<Workspace | null>(null);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["cc-workspaces"],
    queryFn: () => authFetch(`${BASE}/api/control-center/workspaces`).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: ({ name, ownerEmail }: { name: string; ownerEmail?: string }) =>
      authFetch(`${BASE}/api/control-center/workspaces`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ownerEmail: ownerEmail || undefined }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc-workspaces"] });
      setShowCreate(false); setNewName(""); setNewOwnerEmail("");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/control-center/workspaces/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); setDeleteId(null); },
  });

  const impersonateMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/control-center/workspaces/${id}/impersonate`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data) => {
      setImpersonateConfirm(null);
      if (data?.orgId) {
        localStorage.setItem("wsOverride", String(data.orgId));
        localStorage.setItem("wsOverrideName", data.orgName ?? "Workspace");
        localStorage.setItem("wsSupportReason", "Impersonación desde Workspace Management");
        window.location.href = `${BASE}/dashboard`;
      }
    },
  });

  const active = workspaces.filter(w => w.status !== "suspended").length;
  const suspended = workspaces.filter(w => w.status === "suspended").length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Building2 size={24} className="text-violet-400" /> Workspace Management
          </h1>
          <p className="text-slate-500 mt-1">
            {active} activos
            {suspended > 0 && <span className="text-amber-400 ml-2">· {suspended} suspendidos</span>}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-all">
          <Plus size={16} /> Nuevo Workspace
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-white font-semibold text-lg mb-4">Crear Workspace</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Nombre del workspace *</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej: A3Servicios, Mi Empresa..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Email del owner <span className="text-slate-600">(opcional — debe haberse registrado)</span></label>
                <input type="email" value={newOwnerEmail} onChange={e => setNewOwnerEmail(e.target.value)} placeholder="usuario@empresa.com"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm" />
              </div>
            </div>
            {createMut.data && !createMut.data.ownerAssigned && newOwnerEmail && (
              <p className="text-xs text-amber-400 mt-2">⚠️ Owner no encontrado — el workspace fue creado sin owner. El usuario debe registrarse primero.</p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setShowCreate(false); setNewName(""); setNewOwnerEmail(""); }} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm transition-all">Cancelar</button>
              <button disabled={!newName.trim() || createMut.isPending}
                onClick={() => newName.trim() && createMut.mutate({ name: newName, ownerEmail: newOwnerEmail })}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2">
                {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {editWs && <EditModal ws={editWs} onClose={() => setEditWs(null)} />}
      {suspendWs && <SuspendModal ws={suspendWs} onClose={() => setSuspendWs(null)} />}
      {manageWs && showAssign && <AssignUserModal ws={manageWs} onClose={() => { setShowAssign(false); setManageWs(null); }} />}
      {manageWs && showTransfer && <TransferOwnerModal ws={manageWs} onClose={() => { setShowTransfer(false); setManageWs(null); }} />}
      {manageWs && showConsumption && <ConsumptionPanel ws={manageWs} onClose={() => { setShowConsumption(false); setManageWs(null); }} />}
      {manageWs && showMembers && <MembersPanel ws={manageWs} onClose={() => { setShowMembers(false); setManageWs(null); }} />}

      {impersonateConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0e1e] border border-amber-500/20 rounded-2xl p-6 w-full max-w-md">
            <Shield size={28} className="text-amber-400 mb-3" />
            <h2 className="text-white font-semibold text-lg mb-2">Impersonar workspace</h2>
            <p className="text-slate-400 text-sm mb-2">
              Vas a acceder como admin al workspace <strong className="text-white">{impersonateConfirm.name}</strong>.
            </p>
            <p className="text-amber-400 text-xs mb-5">
              ⚠️ Esta acción se registrará en el log de auditoría con severidad <strong>warning</strong>.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setImpersonateConfirm(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
              <button onClick={() => impersonateMut.mutate(impersonateConfirm.id)} disabled={impersonateMut.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all">
                {impersonateMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0e1e] border border-red-500/20 rounded-2xl p-6 w-full max-w-md">
            <AlertCircle size={32} className="text-red-400 mb-3" />
            <h2 className="text-white font-semibold text-lg mb-2">¿Eliminar workspace?</h2>
            <p className="text-slate-400 text-sm mb-6">Esta acción es <strong className="text-red-400">irreversible</strong>. Se eliminarán todos los datos asociados (clientes, mensajes, presupuestos).</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
              <button onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-all flex items-center justify-center gap-2">
                {deleteMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["Workspace", "Plan", "Estado", "Usuarios", "Clientes", "Creado", "Acciones"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspaces.map(ws => (
                <tr key={ws.id} className={`border-b border-white/[0.04] transition-colors ${ws.status === "suspended" ? "bg-amber-500/[0.02] hover:bg-amber-500/[0.04]" : "hover:bg-white/[0.02]"}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${ws.status === "suspended" ? "bg-amber-600/20" : "bg-violet-600/20"}`}>
                        <Building2 size={16} className={ws.status === "suspended" ? "text-amber-400" : "text-violet-400"} />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{ws.name}</p>
                        <p className="text-slate-500 text-xs">{ws.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${PLAN_COLORS[ws.plan] ?? PLAN_COLORS.starter}`}>
                      {ws.plan}
                    </span>
                  </td>
                  <td className="px-5 py-4"><StatusBadge status={ws.status} /></td>
                  <td className="px-5 py-4"><span className="flex items-center gap-1.5 text-slate-400 text-sm"><Users size={14} /> {ws.users}</span></td>
                  <td className="px-5 py-4"><span className="flex items-center gap-1.5 text-slate-400 text-sm"><UserCheck size={14} /> {ws.clients}</span></td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-1.5 text-slate-500 text-xs">
                      <Calendar size={12} />
                      {ws.createdAt ? new Date(ws.createdAt).toLocaleDateString("es-ES") : "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      {/* Administrar dropdown actions */}
                      <div className="relative group">
                        <button
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all flex items-center gap-1"
                          onClick={() => setManageWs(ws)}
                        >
                          <LayoutGrid size={13} /> Gestionar <ChevronRight size={12} className="group-hover:rotate-90 transition-transform" />
                        </button>
                        {manageWs?.id === ws.id && (
                          <div className="absolute right-0 top-full mt-1 bg-[#0d0e1e] border border-white/10 rounded-xl shadow-2xl z-40 min-w-[200px] overflow-hidden">
                            <button onClick={() => { setShowMembers(true); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <Users size={13} className="text-violet-400" /> Ver usuarios
                            </button>
                            <button onClick={() => { setShowAssign(true); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <UserPlus size={13} className="text-emerald-400" /> Asignar usuario
                            </button>
                            <button onClick={() => { setShowTransfer(true); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <ArrowRightLeft size={13} className="text-amber-400" /> Transferir owner
                            </button>
                            <button onClick={() => { setShowConsumption(true); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <BarChart3 size={13} className="text-blue-400" /> Ver consumo
                            </button>
                            <button onClick={() => { setImpersonateConfirm(ws); setManageWs(null); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <Eye size={13} className="text-pink-400" /> Impersonar
                            </button>
                            <div className="border-t border-white/[0.06] my-1" />
                            <button onClick={() => { setManageWs(null); setEditWs(ws); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-all">
                              <Edit2 size={13} /> Editar nombre
                            </button>
                            <button onClick={() => { setManageWs(null); setSuspendWs(ws); }} className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-amber-500/10 flex items-center gap-2 transition-all">
                              {ws.status === "active" ? <><PauseCircle size={13} /> Suspender</> : <><PlayCircle size={13} /> Activar</>}
                            </button>
                            <button onClick={() => { setManageWs(null); setDeleteId(ws.id); }} className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-all">
                              <Trash2 size={13} /> Eliminar
                            </button>
                          </div>
                        )}
                        {/* Close on outside click */}
                        {manageWs?.id === ws.id && (
                          <div className="fixed inset-0 z-30" onClick={() => setManageWs(null)} />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {workspaces.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Building2 size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay workspaces</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
