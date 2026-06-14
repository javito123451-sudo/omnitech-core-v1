import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import {
  Building2, Plus, Edit2, Trash2, Users, UserCheck, Calendar, Loader2,
  CheckCircle2, AlertCircle, PauseCircle, PlayCircle, X, Save,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Workspace {
  id: number; name: string; slug: string; plan: string;
  status: string; users: number; clients: number; createdAt: string;
}

const PLAN_COLORS: Record<string, string> = {
  starter:      "bg-slate-500/20 text-slate-300",
  professional: "bg-blue-500/20 text-blue-400",
  enterprise:   "bg-violet-500/20 text-violet-400",
  free:         "bg-slate-500/20 text-slate-400",
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

function EditModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(ws.name);

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/workspaces/${ws.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
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
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Nombre..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm mb-5"
          onKeyDown={e => e.key === "Enter" && name.trim() && mut.mutate()}
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!name.trim() || mut.isPending || name === ws.name}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-[#0d0e1e] border rounded-2xl p-6 w-full max-w-md ${isActive ? "border-amber-500/20" : "border-emerald-500/20"}`}>
        <div className="flex items-center gap-3 mb-4">
          {isActive
            ? <PauseCircle size={28} className="text-amber-400" />
            : <PlayCircle  size={28} className="text-emerald-400" />}
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
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Describe el motivo de la suspensión..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-amber-500 mb-4"
            />
          </>
        ) : (
          <p className="text-slate-400 text-sm mb-6">
            Se restaurará el acceso a todos los usuarios del workspace.
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 transition-all ${isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
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
  const [showCreate, setShowCreate]   = useState(false);
  const [newName, setNewName]         = useState("");
  const [deleteId, setDeleteId]       = useState<number | null>(null);
  const [editWs, setEditWs]           = useState<Workspace | null>(null);
  const [suspendWs, setSuspendWs]     = useState<Workspace | null>(null);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["cc-workspaces"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/workspaces`).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (name: string) => authFetch(`${BASE}/api/control-center/workspaces`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); setShowCreate(false); setNewName(""); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authFetch(`${BASE}/api/control-center/workspaces/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["cc-workspaces"] }); setDeleteId(null); },
  });

  const active    = workspaces.filter(w => w.status !== "suspended").length;
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
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-all"
        >
          <Plus size={16} /> Nuevo Workspace
        </button>
      </div>

      {/* Modals */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-white font-semibold text-lg mb-4">Crear Workspace</h2>
            <input
              type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Nombre del workspace..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
              onKeyDown={e => e.key === "Enter" && newName.trim() && createMut.mutate(newName)}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setShowCreate(false); setNewName(""); }} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm transition-all">Cancelar</button>
              <button
                disabled={!newName.trim() || createMut.isPending}
                onClick={() => newName.trim() && createMut.mutate(newName)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
                {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {editWs    && <EditModal    ws={editWs}    onClose={() => setEditWs(null)} />}
      {suspendWs && <SuspendModal ws={suspendWs} onClose={() => setSuspendWs(null)} />}

      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0e1e] border border-red-500/20 rounded-2xl p-6 w-full max-w-md">
            <AlertCircle size={32} className="text-red-400 mb-3" />
            <h2 className="text-white font-semibold text-lg mb-2">¿Eliminar workspace?</h2>
            <p className="text-slate-400 text-sm mb-6">Esta acción es <strong className="text-red-400">irreversible</strong>. Se eliminarán todos los datos asociados (clientes, mensajes, presupuestos).</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
              <button
                onClick={() => deleteMut.mutate(deleteId)}
                disabled={deleteMut.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
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
                    <div className="flex items-center gap-1.5">
                      <button
                        title="Editar"
                        onClick={() => setEditWs(ws)}
                        className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        title={ws.status === "active" ? "Suspender" : "Activar"}
                        onClick={() => setSuspendWs(ws)}
                        className={`p-1.5 rounded-lg transition-all ${ws.status === "active" ? "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10" : "text-amber-400 hover:text-emerald-400 hover:bg-emerald-500/10"}`}
                      >
                        {ws.status === "active" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                      </button>
                      <button
                        title="Eliminar"
                        onClick={() => setDeleteId(ws.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
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
