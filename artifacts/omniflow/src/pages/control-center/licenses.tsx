import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useState } from "react";
import { CreditCard, Building2, Check, Loader2, Edit2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LicensePlan {
  id: number | null;
  orgId: number;
  orgName: string;
  plan: string;
  seats: number;
  isActive: boolean;
  billingCycle: string;
  validFrom: string | null;
  validUntil: string | null;
  notes: string | null;
  assignedBy: string | null;
  createdAt: string | null;
}

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    desc: "Para equipos pequeños",
    price: "Gratis",
    seats: 3,
    features: ["CRM básico", "WhatsApp (100 msg/mes)", "Soporte básico"],
    color: "border-slate-700",
    badge: "bg-slate-500/20 text-slate-300",
  },
  {
    id: "professional",
    name: "Professional",
    desc: "Para empresas en crecimiento",
    price: "€49/mes",
    seats: 10,
    features: ["CRM completo", "WhatsApp ilimitado", "IA avanzada", "Analytics", "Soporte prioritario"],
    color: "border-blue-500/30",
    badge: "bg-blue-500/20 text-blue-400",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    desc: "Para grandes organizaciones",
    price: "Personalizado",
    seats: 999,
    features: ["Todo en Professional", "Módulos personalizados", "SLA garantizado", "Onboarding dedicado", "API avanzada"],
    color: "border-violet-500/30",
    badge: "bg-violet-500/20 text-violet-400",
  },
];

function AssignModal({ orgId, orgName, currentPlan, onClose }: { orgId: number; orgName: string; currentPlan: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [plan, setPlan]             = useState(currentPlan);
  const [seats, setSeats]           = useState(5);
  const [billingCycle, setBilling]  = useState("monthly");
  const [notes, setNotes]           = useState("");

  const mut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/control-center/licenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, plan, seats, billingCycle, notes }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-licenses"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-white font-semibold text-lg mb-1">Asignar Licencia</h2>
        <p className="text-slate-500 text-sm mb-5">{orgName}</p>

        {/* Plan Select */}
        <div className="space-y-2 mb-4">
          {PLANS.map(p => (
            <button
              key={p.id}
              onClick={() => setPlan(p.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${plan === p.id ? "border-violet-500 bg-violet-600/10" : "border-white/10 hover:border-white/20"}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${plan === p.id ? "border-violet-400" : "border-slate-600"}`}>
                {plan === p.id && <div className="w-2 h-2 rounded-full bg-violet-400" />}
              </div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{p.name}</p>
                <p className="text-slate-500 text-xs">{p.price}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Asientos</label>
            <input type="number" min={1} value={seats} onChange={e => setSeats(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Ciclo</label>
            <select value={billingCycle} onChange={e => setBilling(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500">
              <option value="monthly">Mensual</option>
              <option value="annual">Anual</option>
            </select>
          </div>
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas (opcional)..."
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500 resize-none mb-4" />

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancelar</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
          >
            {mut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LicensesPage() {
  const [editingOrg, setEditingOrg] = useState<{ id: number; name: string; plan: string } | null>(null);

  const { data: licenses = [], isLoading } = useQuery<LicensePlan[]>({
    queryKey: ["cc-licenses"],
    queryFn:  () => authFetch(`${BASE}/api/control-center/licenses`).then(r => r.json()),
  });

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <CreditCard size={24} className="text-violet-400" /> License Management
        </h1>
        <p className="text-slate-500 mt-1">Gestiona los planes de licencia por workspace</p>
      </div>

      {editingOrg && (
        <AssignModal orgId={editingOrg.id} orgName={editingOrg.name} currentPlan={editingOrg.plan} onClose={() => setEditingOrg(null)} />
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {PLANS.map(p => (
          <div key={p.id} className={`bg-[#0d0e1e] border ${p.color} rounded-2xl p-6`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${p.badge}`}>{p.name}</span>
                <p className="text-2xl font-bold text-white mt-3">{p.price}</p>
                <p className="text-slate-500 text-sm">{p.desc}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {p.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-400">
                  <Check size={14} className="text-emerald-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-600 mt-4">{p.seats === 999 ? "Asientos ilimitados" : `Hasta ${p.seats} asientos`}</p>
          </div>
        ))}
      </div>

      {/* License Table */}
      <h2 className="text-white font-semibold text-lg mb-4">Licencias Asignadas</h2>
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-violet-400" /></div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["Workspace", "Plan", "Asientos", "Ciclo", "Estado", "Válido hasta", ""].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {licenses.map(lic => {
                const planData = PLANS.find(p => p.id === lic.plan);
                return (
                  <tr key={`${lic.orgId}-${lic.plan}`} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 text-white text-sm font-medium">
                        <Building2 size={15} className="text-violet-400" /> {lic.orgName}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${planData?.badge ?? "bg-slate-500/20 text-slate-300"}`}>
                        {planData?.name ?? lic.plan}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-sm">{lic.seats}</td>
                    <td className="px-5 py-4 text-slate-400 text-sm capitalize">{lic.billingCycle === "monthly" ? "Mensual" : "Anual"}</td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Activa
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-500 text-xs">
                      {lic.validUntil ? new Date(lic.validUntil).toLocaleDateString("es-ES") : "Sin expiración"}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => setEditingOrg({ id: lic.orgId, name: lic.orgName, plan: lic.plan })}
                        className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                      >
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
